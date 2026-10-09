// F5 Payments: PAY-10 (attempt status + workspace isolation), PAY-11 (dashboard
// counters), PAY-12 [ST] (staging sandbox matrix) (plan .plans/e2e-scenarios.md,
// "F5 Payments").
//
// Verified against the code:
// - GET /api/payments/<attemptId> (app/api/payments/[attemptId]/route.ts) scopes
//   the attempt by the caller's workspace (invoice.organizationId) and answers
//   404 for anything else; 401 without a session.
// - Dashboard (DashboardContent.tsx): "Total pendapatan" card = sum of PAID
//   totals (GET /api/invoices `stats.revenue`), status radios with counts from
//   `filterCounts`.
import { expect, test } from "../../fixtures";
import { midtransNotification } from "../../support/api-factories";
import { covers, createMidtransAttempt, createStripeSession, getAttempt } from "./payment-helpers";

/** lib/currency.ts formatCurrency for IDR (id-ID, no fraction digits). */
const idr = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

test.describe("payments: attempts and reporting", () => {
  test(
    "PAY-10 GET /api/payments/<attemptId> follows the attempt status; another workspace gets 404, no session gets 401",
    { annotation: covers("/api/payments/[attemptId]") },
    async ({ factory, api, payments, newApiUser, playwright, baseURL }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      expect(await getAttempt(api, created.attemptId)).toMatchObject({
        attemptId: created.attemptId,
        provider: "midtrans",
        orderId: created.orderId,
        status: "PENDING",
        amount: invoice.total,
        invoice: { id: invoice.id, number: invoice.number, status: "SENT" },
      });

      const settle = await payments.postMidtransNotification(midtransNotification({ orderId: created.orderId, grossAmount: invoice.total }));
      expect(settle.status()).toBe(200);
      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "SETTLED", invoice: { status: "PAID" } });

      const other = await newApiUser("pay10-other");
      const foreign = await other.api.get(`/api/payments/${created.attemptId}`);
      expect(foreign.status()).toBe(404);
      expect(await foreign.json()).toEqual({ error: "Payment attempt not found" });

      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        const response = await anonymous.get(`/api/payments/${created.attemptId}`);
        expect(response.status()).toBe(401);
      } finally {
        await anonymous.dispose();
      }
    },
  );

  test(
    "PAY-11 a paid invoice is counted in the dashboard revenue and Paid counters",
    { annotation: covers("/app/dashboard", "/api/invoices") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const paidInvoice = await factory.createInvoice({ status: "SENT", items: [{ name: "E2E paid work", qty: 1, price: 750_000 }] });
      const openInvoice = await factory.createInvoice({ status: "SENT", items: [{ name: "E2E open work", qty: 1, price: 300_000 }] });
      await factory.payInvoiceViaMidtrans(paidInvoice);

      const body = (await (await api.get("/api/invoices")).json()) as {
        stats: { revenue: number };
        filterCounts: Record<string, number>;
      };
      expect(body.stats.revenue).toBe(paidInvoice.total);
      expect(body.filterCounts).toMatchObject({ ALL: 2, PAID: 1, SENT: 1 });

      const radioCount = (name: string) => page.getByRole("radio", { name, exact: true }).locator("span").nth(1);
      await page.goto("/app/dashboard");
      await expect(page.getByRole("link", { name: paidInvoice.number })).toBeVisible();
      await expect(page.getByRole("link", { name: openInvoice.number })).toBeVisible();
      await expect(page.locator("article").filter({ hasText: "Total pendapatan" })).toContainText(idr(paidInvoice.total));
      await expect(radioCount("Paid")).toHaveText("1");
      await expect(radioCount("Sent")).toHaveText("1");
    },
  );

  test(
    "PAY-12 staging sandbox keys: Midtrans and Stripe checkouts record provider ids",
    { tag: "@staging", annotation: covers("/api/payments/midtrans/create", "/api/payments/stripe/create-session") },
    async ({ factory, api }) => {
      // The full RUNBOOK "Payment provider contract" matrix (docs/RUNBOOK_RELEASE_CERTIFICATION.md)
      // needs real sandbox webhooks; this spec covers the automated part: both
      // checkouts open against the sandbox providers and their ids are recorded.
      test.skip(process.env.E2E_TIER !== "staging", "Sandbox payment providers run on staging only (E2E_TIER=staging)");
      const invoice = await factory.createInvoice({ status: "SENT" });

      const midtrans = await createMidtransAttempt(api, invoice.id);
      expect(midtrans.token).toBeTruthy();
      expect(midtrans.redirectUrl).toMatch(/^https:\/\/app\.sandbox\.midtrans\.com\//);

      const stripe = await createStripeSession(api, invoice.id);
      expect(stripe.sessionId).toMatch(/^cs_test_/);
      expect(stripe.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

      const attempts = await Promise.all([getAttempt(api, midtrans.attemptId), getAttempt(api, stripe.attemptId)]);
      for (const attempt of attempts) expect(attempt.status).toBe("PENDING");
      test.info().annotations.push(
        { type: "provider-id", description: `midtrans order ${midtrans.orderId}` },
        { type: "provider-id", description: `stripe session ${stripe.sessionId}` },
      );
    },
  );
});
