// F5 Payments, public share-link checkout (plan .plans/post-audit-fixes.md, Phase 1).
//
// Verified against the code:
// - The invoice email links to /share/<id>?token=…&action=pay
//   (app/api/invoices/[id]/send-email/route.ts). app/share/[id]/page.tsx
//   renders SharePayButton for SENT/UNPAID/OVERDUE invoices when a provider
//   can charge the currency; the server picks the default provider
//   (IDR -> Midtrans, else Stripe) and `action=pay` auto-starts it once.
// - SharePayButton POSTs { invoiceId, token, provider } with plain fetch (no
//   CSRF token; the route is on the CSRF exemption list) to
//   /api/share/checkout, which answers { provider: "stripe", url } or
//   { provider: "midtrans", token, redirectUrl } and nothing else.
// - Stripe success/cancel URLs are the share URL plus payment=success|cancelled;
//   `payment=…` is display-only, the PAID pill comes from a signed webhook.
// - A bad, missing or foreign token is 404 on both the page and the route.
// - next.config.ts sets Referrer-Policy: strict-origin-when-cross-origin on
//   every route, so the share URL's ?token= never reaches the provider or
//   snap.js in a Referer header.
import { expect, test } from "../../fixtures";
import { mintInvoiceShareToken, tamperShareToken } from "../../support/share";
import { toStripeMinorUnit } from "../../../../lib/payments/money";
import { covers, parseStripeSessionForm } from "./payment-helpers";

const USD_ITEMS = [{ name: "E2E share design", qty: 2, price: 150 }];
const shareUrl = (invoiceId: string, token: string, extra = "") =>
  `/share/${invoiceId}?token=${encodeURIComponent(token)}${extra}`;
// Policies that never send the path or query (the share token) cross-origin.
const STRICT_REFERRER_POLICIES = ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"];

test.describe("payments: public share-link checkout", () => {
  // A fresh, unauthenticated browser context: the recipient has no session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "SHARE-PAY-01 email link with action=pay starts Stripe checkout without a session; a signed webhook makes the share page show PAID",
    { tag: "@smoke", annotation: covers("/api/share/checkout", "/share/[id]") },
    async ({ page, newApiUser, stub, payments }) => {
      const owner = await newApiUser("share-pay");
      const invoice = await owner.factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      const token = mintInvoiceShareToken(invoice.id);

      const checkoutResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/share/checkout" && r.request().method() === "POST",
      );
      await page.goto(shareUrl(invoice.id, token, "&action=pay"));
      const response = await checkoutResponse;
      expect(response.status()).toBe(200);
      expect(response.request().headers()["x-csrf-token"]).toBeUndefined();
      // The CSRF-exempt route does not set the CSRF cookie (lib/security/csrf.ts).
      expect((await response.allHeaders())["set-cookie"]).toBeUndefined();
      const sessionId = await payments.waitForCheckoutPage(page);

      // Back from the provider: action=pay was dropped before leaving, so the
      // share page does not start a second checkout and the button is usable.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/share/${invoice.id}\\?token=[^&]+$`));
      await expect(page.getByRole("button", { name: "Pay now" })).toBeEnabled();
      await page.waitForLoadState("networkidle");

      const calls = (await stub.requests("/v1/checkout/sessions")).filter((entry) => entry.method === "POST");
      expect(calls).toHaveLength(1);
      const session = parseStripeSessionForm(calls[0].body);
      const attemptId = session.metadata.attemptId!;
      expect(session.metadata).toMatchObject({ invoiceId: invoice.id, attemptId, orderId: `invo_${attemptId}` });
      expect(session.form.get("metadata[source]")).toBe("share_checkout");
      const success = new URL(session.form.get("success_url")!);
      expect(success.pathname).toBe(`/share/${invoice.id}`);
      expect(success.searchParams.get("token")).toBe(token);
      expect(success.searchParams.get("payment")).toBe("success");
      expect(new URL(session.form.get("cancel_url")!).searchParams.get("payment")).toBe("cancelled");

      // Back from the provider before the webhook: display-only notice, still SENT.
      await page.goto(`${success.pathname}${success.search}`);
      await expect(page.getByRole("status")).toContainText("this page updates once the provider confirms");
      await expect(page.getByText("SENT", { exact: true })).toBeVisible();

      const settled = await payments.postStripeEvent(
        payments.stripeCheckoutCompletedEvent({
          sessionId,
          attemptId,
          invoiceId: invoice.id,
          amountMinor: toStripeMinorUnit(invoice.total, "USD"),
          currency: "USD",
        }),
      );
      expect(settled.status()).toBe(200);
      expect(await settled.json()).toMatchObject({ received: true, duplicate: false, status: "SETTLED" });

      await page.goto(shareUrl(invoice.id, token));
      await expect(page.getByText("PAID", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pay now" })).toHaveCount(0);
    },
  );

  test(
    "SHARE-PAY-02 an IDR invoice uses Midtrans: snap.js loads without a CSP violation and snap.pay returns to the share page",
    { tag: "@smoke", annotation: covers("/api/share/checkout", "/share/[id]") },
    async ({ page, newApiUser, guards }) => {
      const owner = await newApiUser("share-snap");
      const invoice = await owner.factory.createInvoice({ status: "SENT" });
      expect(invoice.currency).toBe("IDR");
      const token = mintInvoiceShareToken(invoice.id);

      await page.goto(shareUrl(invoice.id, token));
      await expect
        .poll(() => page.evaluate(() => typeof (window as unknown as { snap?: { pay?: unknown } }).snap?.pay))
        .toBe("function");
      expect(guards.snapRequests).toEqual(["https://app.sandbox.midtrans.com/snap/snap.js"]);
      // Stripe can charge IDR too, so it is offered as the secondary provider.
      await expect(page.getByRole("button", { name: "Pay with Stripe" })).toBeVisible();

      const checkoutResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/share/checkout" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Pay now" }).click();
      const response = await checkoutResponse;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["provider", "redirectUrl", "token"]);
      expect(body.provider).toBe("midtrans");

      await expect(page).toHaveURL(new RegExp(`/share/${invoice.id}\\?token=[^&]+&payment=success$`));
      await expect(page.getByRole("status")).toContainText("this page updates once the provider confirms");
      expect(guards.cspViolations).toEqual([]);
    },
  );

  test(
    "SHARE-PAY-03 tampered token is 404, a PAID or DRAFT invoice shows no pay button, and the route refuses a missing token and GET",
    { tag: "@smoke", annotation: covers("/api/share/checkout", "/share/[id]") },
    async ({ page, newApiUser, api }) => {
      const owner = await newApiUser("share-neg");
      const open = await owner.factory.createInvoice({ status: "SENT" });
      const token = mintInvoiceShareToken(open.id);

      const tampered = await page.goto(shareUrl(open.id, tamperShareToken(token)));
      expect(tampered?.status()).toBe(404);

      const paid = await owner.factory.createInvoice({ status: "PAID" });
      const paidPage = await page.goto(shareUrl(paid.id, mintInvoiceShareToken(paid.id)));
      expect(paidPage?.status()).toBe(200);
      expect(STRICT_REFERRER_POLICIES).toContain(await paidPage?.headerValue("referrer-policy"));
      await expect(page.getByRole("heading", { name: `Invoice ${paid.number}` })).toBeVisible();
      await expect(page.getByRole("button", { name: /Pay/ })).toHaveCount(0);

      const draft = await owner.factory.createInvoice();
      expect(draft.status).toBe("DRAFT");
      expect((await page.goto(shareUrl(draft.id, mintInvoiceShareToken(draft.id), "&action=pay")))?.status()).toBe(200);
      await expect(page.getByRole("button", { name: /Pay/ })).toHaveCount(0);

      const noToken = await api.post("/api/share/checkout", { data: { invoiceId: open.id, provider: "stripe" } });
      expect(noToken.status()).toBe(404);
      const badToken = await api.post("/api/share/checkout", {
        data: { invoiceId: open.id, provider: "stripe", token: tamperShareToken(token) },
      });
      expect(badToken.status()).toBe(404);
      const draftCheckout = await api.post("/api/share/checkout", {
        data: { invoiceId: draft.id, provider: "stripe", token: mintInvoiceShareToken(draft.id) },
      });
      expect(draftCheckout.status()).toBe(409);
      expect(await draftCheckout.json()).toEqual({ error: "Invoice is not payable" });
      expect((await api.get("/api/share/checkout")).status()).toBe(405);
    },
  );
});
