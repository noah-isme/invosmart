// F5 Payments, Stripe: PAY-06..08, PAY-16, PAY-17 (Stripe side)
// (plan .plans/e2e-scenarios.md, "F5 Payments").
//
// Verified against the code:
// - PaymentGatewayModal "Stripe" posts /api/payments/stripe/create-session and
//   sets window.location.href to the session url; the seam (lib/payments/stripe.ts)
//   sends the Stripe call to the stub, whose session url is its /checkout/<id> page.
// - create-session metadata: invoiceId, userId, attemptId, orderId; client_reference_id
//   = orderId = invo_<attemptId>; success_url <origin>/app/invoices/<id>?payment=success.
// - Current line items read item.rate/description, which invoice items do not
//   have ({name, qty, price}), so the lines never add up and the route falls
//   back to one "Invoice <number>" line for the total. The total is asserted
//   (true before and after the fix); the per-item lines are asserted against
//   the fixed behaviour (test.fixme, PAYMENT_FIX_BRANCH).
// - Amounts: USD is two-decimal on Stripe in both the current
//   lib/payments/money.ts and the fix branch, so these specs use USD invoices
//   (IDR is zero-decimal today and x100 on the fix branch).
// - Webhook (app/api/payments/stripe/webhook/route.ts): 400 without a
//   Stripe-Signature header or when constructEvent fails (wrong secret, timestamp
//   outside the default 300 s tolerance); attempt by metadata.attemptId, then
//   session id, then a legacy attempt for metadata.invoiceId (404 when that
//   invoice does not exist); metadata.invoiceId must equal the attempt's invoice
//   (403); amount and currency verified (400).
import { expect, test } from "../../fixtures";
import { uniqueForwardedFor } from "../../support/auth";
import { signStripe } from "../../support/webhooks";
import { reserveInvoiceDetailLoads } from "../../support/invoice-detail-budget";
import {
  PAYMENT_FIX_BRANCH,
  covers,
  createStripeSession,
  getAttempt,
  getInvoice,
  parseStripeSessionForm,
} from "./payment-helpers";

const USD_ITEMS = [{ name: "E2E design", qty: 3, price: 120 }];
const WEBHOOK = "/api/payments/stripe/webhook";

test.describe("payments: Stripe checkout", () => {
  test(
    "PAY-06 Pay Now -> Stripe returns the stub session URL, the stub gets amount and invoice metadata, and the browser lands on the checkout page",
    { annotation: covers("/app/invoices/[id]", "/api/payments/stripe/create-session") },
    async ({ persona, factory, api, stub, payments, baseURL }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      expect(invoice.total).toBe(396);

      // goto only (the Stripe button leaves the app); reserved before the page opens.
      await reserveInvoiceDetailLoads(1);
      const { page } = await persona("owner");
      await page.goto(`/app/invoices/${invoice.id}`);
      await page.getByRole("button", { name: "Pay Now" }).click();
      await expect(page.getByRole("heading", { name: "Select Payment Method" })).toBeVisible();
      const createResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/payments/stripe/create-session" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /Stripe/ }).click();
      // The page navigates to the checkout URL right away, so the response body
      // is gone; read the ids from the stub call and the attempt API instead.
      expect((await createResponse).status()).toBe(200);
      const sessionId = await payments.waitForCheckoutPage(page);

      const calls = (await stub.requests("/v1/checkout/sessions")).filter((entry) => entry.method === "POST");
      expect(calls).toHaveLength(1);
      const session = parseStripeSessionForm(calls[0].body);
      const attemptId = session.metadata.attemptId!;
      expect(session.form.get("mode")).toBe("payment");
      expect(session.form.get("client_reference_id")).toBe(`invo_${attemptId}`);
      expect(session.form.get("success_url")).toBe(`${baseURL}/app/invoices/${invoice.id}?payment=success`);
      expect(session.metadata).toEqual({
        invoiceId: invoice.id,
        attemptId,
        orderId: `invo_${attemptId}`,
        userId: expect.any(String),
      });
      expect(session.lineItemsTotal).toBe(39_600);
      for (const line of session.lineItems) expect(line.currency).toBe("usd");

      const created = { attemptId, sessionId, url: `${stub.url}/checkout/${sessionId}` };
      expect(await getAttempt(api, created.attemptId)).toMatchObject({
        provider: "stripe",
        sessionId: created.sessionId,
        checkoutUrl: created.url,
        amount: invoice.total,
        currency: "USD",
        status: "PENDING",
        invoice: { id: invoice.id, status: "SENT" },
      });
    },
  );

  test(
    "PAY-06b Checkout line items are the invoice lines plus tax in Stripe minor units",
    { annotation: covers("/api/payments/stripe/create-session") },
    async ({ factory, api, stub }) => {
      test.fixme(true, `Needs ${PAYMENT_FIX_BRANCH} (unmerged): current lines read item.rate/description and collapse into one total line.`);
      const invoice = await factory.createInvoice({ status: "SENT" });
      await createStripeSession(api, invoice.id);
      const [call] = (await stub.requests("/v1/checkout/sessions")).filter((entry) => entry.method === "POST");
      const session = parseStripeSessionForm(call.body);
      // IDR is two-decimal on Stripe on the fix branch.
      expect(session.lineItems).toEqual([
        { name: "E2E consulting", currency: "idr", unitAmount: 500_000 * 100, quantity: 2 },
        { name: "Tax", currency: "idr", unitAmount: invoice.tax * 100, quantity: 1 },
      ]);
      expect(session.lineItemsTotal).toBe(invoice.total * 100);
    },
  );

  test(
    "PAY-07 a checkout.session.completed event signed with generateTestHeaderString settles the attempt and the invoice is PAID",
    { annotation: covers("/api/payments/stripe/webhook", "/api/payments/[attemptId]") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      const created = await createStripeSession(api, invoice.id);
      const paymentIntentId = `pi_e2e_${created.attemptId.replace(/-/g, "")}`;

      const response = await payments.postStripeEvent(
        payments.stripeCheckoutCompletedEvent({
          sessionId: created.sessionId,
          attemptId: created.attemptId,
          invoiceId: invoice.id,
          amountMinor: 39_600,
          currency: "USD",
          paymentIntentId,
        }),
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ received: true, duplicate: false, status: "SETTLED" });

      const attempt = await getAttempt(api, created.attemptId);
      expect(attempt).toMatchObject({ status: "SETTLED", paymentId: paymentIntentId, invoice: { id: invoice.id, status: "PAID" } });
      expect(attempt.payments).toHaveLength(1);
      expect(attempt.payments[0]).toMatchObject({ paidAmount: 396, paidCurrency: "USD", gatewayStatus: "paid" });
      expect((await getInvoice(api, invoice.id)).status).toBe("PAID");
    },
  );
});

test.describe("payments: Stripe webhook rules", () => {
  test(
    "PAY-08 a bad signature, a missing header, or a timestamp outside tolerance is 400 and changes nothing",
    { annotation: covers("/api/payments/stripe/webhook") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      const created = await createStripeSession(api, invoice.id);
      const event = payments.stripeCheckoutCompletedEvent({
        sessionId: created.sessionId,
        attemptId: created.attemptId,
        invoiceId: invoice.id,
        amountMinor: 39_600,
        currency: "USD",
      });

      const wrongSecret = await payments.postStripeEvent(event, { secret: "whsec_not_the_e2e_secret" });
      expect(wrongSecret.status()).toBe(400);
      expect(await wrongSecret.json()).toEqual({ error: "Invalid signature" });

      const stale = await payments.postStripeEvent(event, { timestamp: Math.floor(Date.now() / 1000) - 600 });
      expect(stale.status()).toBe(400);
      expect(await stale.json()).toEqual({ error: "Invalid signature" });

      const payload = JSON.stringify(event);
      const missing = await api.request.post(WEBHOOK, {
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueForwardedFor() },
        data: payload,
      });
      expect(missing.status()).toBe(400);
      expect(await missing.json()).toEqual({ error: "Missing signature" });

      // A valid signature over a different body.
      const tampered = await api.request.post(WEBHOOK, {
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueForwardedFor(), "stripe-signature": signStripe(payload) },
        data: payload.replace('"amount_total":39600', '"amount_total":1'),
      });
      expect(tampered.status()).toBe(400);

      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
    },
  );

  test(
    "PAY-16 an event whose metadata invoice id does not exist or is not the attempt's invoice is 4xx and changes nothing",
    { annotation: covers("/api/payments/stripe/webhook") },
    async ({ factory, api, payments, newApiUser }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      const created = await createStripeSession(api, invoice.id);
      const other = await newApiUser("pay16-other");
      const foreign = await other.factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });

      // Unknown session, no attempt id, invoice id that does not exist.
      const unknown = payments.stripeCheckoutCompletedEvent({
        sessionId: `cs_test_unknown_${Date.now()}`,
        attemptId: "",
        invoiceId: `missing-${Date.now()}`,
        amountMinor: 39_600,
        currency: "USD",
      });
      (unknown.data as { object: { metadata: Record<string, string> } }).object.metadata = { invoiceId: `missing-${Date.now()}` };
      const notFound = await payments.postStripeEvent(unknown);
      expect(notFound.status()).toBe(404);

      // This workspace's attempt, another workspace's invoice id.
      const mismatched = await payments.postStripeEvent(
        payments.stripeCheckoutCompletedEvent({
          sessionId: created.sessionId,
          attemptId: created.attemptId,
          invoiceId: foreign.id,
          amountMinor: 39_600,
          currency: "USD",
        }),
      );
      expect(mismatched.status()).toBe(403);
      expect(await mismatched.json()).toEqual({ error: "Payment ownership mismatch" });

      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
      expect((await getInvoice(other.api, foreign.id)).status).toBe("SENT");
    },
  );

  test(
    "PAY-17 a Stripe event whose currency differs from the attempt is rejected",
    { annotation: covers("/api/payments/stripe/webhook") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: USD_ITEMS });
      const created = await createStripeSession(api, invoice.id);

      const response = await payments.postStripeEvent(
        payments.stripeCheckoutCompletedEvent({
          sessionId: created.sessionId,
          attemptId: created.attemptId,
          invoiceId: invoice.id,
          amountMinor: 39_600,
          currency: "EUR",
        }),
      );
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "Payment currency does not match invoice" });
      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
    },
  );
});
