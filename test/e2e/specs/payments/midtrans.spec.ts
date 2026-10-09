// F5 Payments, Midtrans: PAY-01..05, PAY-13..15, PAY-17 (Midtrans side)
// (plan .plans/e2e-scenarios.md, "F5 Payments").
//
// Verified against the code:
// - "Pay Now" (InvoiceDetailClient.tsx) is shown for SENT/UNPAID/OVERDUE only and
//   opens components/payments/PaymentGatewayModal.tsx ("Select Payment Method",
//   buttons "Stripe" and "Midtrans"). Midtrans: POST /api/payments/midtrans/create,
//   then window.snap.pay(token, { onSuccess -> router.push(?payment=success) }).
// - snap.js comes from getSnapScriptUrl(NEXT_PUBLIC_MIDTRANS_CLIENT_KEY): the
//   "SB-Mid" key selects https://app.sandbox.midtrans.com/snap/snap.js, which the
//   `guards` fixture maps to the stub's fake /snap.js.
// - The server Snap client (lib/payments/midtrans.ts) picks isProduction from
//   NODE_ENV, which is "production" under `next start`, so the create call goes
//   to the stub's /snap-production/v1 path despite the sandbox key (see PAY-01).
// - Notification (app/api/payments/midtrans/notification/route.ts): signature
//   sha512(order_id + status_code + gross_amount + server key) (403 when wrong),
//   attempt looked up by order_id (404 unknown), amount and currency verified
//   against the attempt (400), transitions per lib/payments/lifecycle.ts
//   (expire -> EXPIRED, deny -> FAILED, cancel -> CANCELLED), an identical
//   replay is acknowledged as `duplicate`.
// - Create returns 409 for a PAID invoice (both providers) and 422 for a
//   non-IDR invoice (Midtrans only takes whole-rupiah IDR).
// - item_details come from the invoice items {name, qty, price} plus a "Tax"
//   line (lib/payments/line-items.ts buildMidtransItemDetails); zero-priced items
//   are dropped and any remainder falls back to one "Invoice <number>" line.
// - Double settlement (lib/payments/settlement.ts): a second provider settling
//   an already PAID invoice keeps its attempt SETTLED, records no Payment and
//   marks the attempt metadata.duplicateSettlement { refundRequired: true }.
import { randomUUID } from "node:crypto";

import { expect, test } from "../../fixtures";
import { toStripeMinorUnit } from "../../../../lib/payments/money";
import { midtransNotification } from "../../support/api-factories";
import { E2E_SECRETS } from "../../playwright.env";
import {
  covers,
  createMidtransAttempt,
  createStripeSession,
  getAttempt,
  getInvoice,
  listPaymentsForClient,
  snapTransactionRequests,
  uniqueTag,
  type MidtransSnapBody,
} from "./payment-helpers";

test.describe("payments: Midtrans checkout", () => {
  test(
    "PAY-01 Pay Now -> Midtrans creates an attempt, the stub receives the Snap transaction with gross_amount = total, and snap.pay(token) runs",
    {
      tag: "@smoke",
      annotation: [
        ...covers("/app/invoices/[id]", "/api/payments/midtrans/create", "/api/payments/[attemptId]"),
        {
          type: "product-bug",
          description:
            "Snap environment mismatch: the browser loads the sandbox snap.js (SB-Mid client key) but the server calls the PRODUCTION Snap API because lib/payments/midtrans.ts sets isProduction from NODE_ENV (production under next start). The stub received /snap-production/v1/transactions with a sandbox (SB-) server key.",
        },
      ],
    },
    async ({ persona, factory, api, stub, guards }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const { page } = await persona("owner");

      // Record the tokens the page hands to the fake snap.pay (the stub's
      // snap.js assigns window.snap; wrap pay when it does).
      await page.addInitScript(() => {
        const w = window as unknown as { __e2eSnapTokens: string[]; snap?: { pay: (token: string, cb: unknown) => unknown } };
        w.__e2eSnapTokens = [];
        let current: (typeof w)["snap"];
        Object.defineProperty(window, "snap", {
          configurable: true,
          get: () => current,
          set: (value: (typeof w)["snap"]) => {
            if (value && typeof value.pay === "function") {
              const pay = value.pay.bind(value);
              value.pay = (token: string, cb: unknown) => {
                w.__e2eSnapTokens.push(String(token));
                return pay(token, cb);
              };
            }
            current = value;
          },
        });
      });

      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => typeof (window as unknown as { snap?: { pay?: unknown } }).snap?.pay), {
          message: "fake snap.js loaded through the guards mapping",
        })
        .toBe("function");
      expect(guards.snapRequests).toEqual(["https://app.sandbox.midtrans.com/snap/snap.js"]);

      await page.getByRole("button", { name: "Pay Now" }).click();
      await expect(page.getByRole("heading", { name: "Select Payment Method" })).toBeVisible();
      const createResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/payments/midtrans/create" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /Midtrans/ }).click();
      const response = await createResponse;
      expect(response.status()).toBe(200);
      const created = (await response.json()) as { attemptId: string; orderId: string; token: string; status: string };
      expect(created.status).toBe("PENDING");
      expect(created.orderId).toBe(`invo_${created.attemptId}`);
      expect(created.token).toMatch(/^e2e-snap-token-/);

      // snap.pay(token) ran with the stub's token and its onSuccess routed back.
      await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}\\?payment=success$`));
      expect(await page.evaluate(() => (window as unknown as { __e2eSnapTokens: string[] }).__e2eSnapTokens)).toEqual([created.token]);

      const calls = snapTransactionRequests(await stub.requests());
      expect(calls).toHaveLength(1);
      const [call] = calls;
      // The plan expected /snap-sandbox (sandbox key). The app sends the actual
      // path below; see the product-bug annotation.
      expect(call.path).toBe("/snap-production/v1/transactions");
      expect(call.headers.authorization).toBe(`Basic ${Buffer.from(`${E2E_SECRETS.MIDTRANS_SERVER_KEY}:`).toString("base64")}`);
      const body = call.json as MidtransSnapBody;
      expect(body.transaction_details).toEqual({ order_id: created.orderId, gross_amount: invoice.total });
      expect(body.customer_details).toMatchObject({ first_name: invoice.client });

      const attempt = await getAttempt(api, created.attemptId);
      expect(attempt).toMatchObject({
        provider: "midtrans",
        orderId: created.orderId,
        amount: invoice.total,
        currency: "IDR",
        status: "PENDING",
        invoice: { id: invoice.id, number: invoice.number, status: "SENT" },
        payments: [],
      });
    },
  );

  test(
    "PAY-01b Snap item_details are the invoice lines plus tax and sum to gross_amount",
    { annotation: covers("/api/payments/midtrans/create") },
    async ({ factory, api, stub }) => {
      const items = [
        { name: "E2E consulting", qty: 2, price: 500_000 },
        { name: "E2E hosting", qty: 1, price: 250_000 },
      ];
      const invoice = await factory.createInvoice({ status: "SENT", items });
      const created = await createMidtransAttempt(api, invoice.id);

      const [call] = snapTransactionRequests(await stub.requests());
      const body = call.json as MidtransSnapBody;
      expect(body.transaction_details.gross_amount).toBe(invoice.total);
      expect(body.transaction_details.order_id).toBe(created.orderId);
      expect(body.item_details).toEqual([
        { id: "item_1", price: 500_000, quantity: 2, name: "E2E consulting" },
        { id: "item_2", price: 250_000, quantity: 1, name: "E2E hosting" },
        { id: "tax", price: invoice.tax, quantity: 1, name: "Tax" },
      ]);
      expect(body.item_details.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(invoice.total);
    },
  );

  test(
    "PAY-02 a signed settlement notification settles the attempt and the invoice shows PAID",
    { tag: "@smoke", annotation: covers("/api/payments/midtrans/notification", "/api/payments/[attemptId]", "/app/invoices/[id]") },
    async ({ persona, factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      const response = await payments.postMidtransNotification(
        midtransNotification({ orderId: created.orderId, grossAmount: invoice.total, transactionId: `e2e-tx-${created.attemptId}` }),
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ received: true, duplicate: false, status: "SETTLED" });

      const attempt = await getAttempt(api, created.attemptId);
      expect(attempt).toMatchObject({
        status: "SETTLED",
        paymentId: `e2e-tx-${created.attemptId}`,
        invoice: { id: invoice.id, status: "PAID" },
      });
      expect(attempt.payments).toHaveLength(1);
      expect(attempt.payments[0]).toMatchObject({ paidAmount: invoice.total, paidCurrency: "IDR", refundedAmount: 0, gatewayStatus: "settlement" });
      expect((await getInvoice(api, invoice.id)).status).toBe("PAID");

      const { page } = await persona("owner");
      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
      await expect(page.getByText("Lunas", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pay Now" })).toHaveCount(0);
    },
  );
});

test.describe("payments: Midtrans notification rules", () => {
  test(
    "PAY-03 an invalid signature_key is rejected and the invoice stays unpaid",
    { annotation: covers("/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      const wrongKey = midtransNotification({ orderId: created.orderId, grossAmount: invoice.total, serverKey: "SB-Mid-server-wrong" });
      expect((await payments.postMidtransNotification(wrongKey)).status()).toBe(403);

      // A valid signature replayed onto a different status_code.
      const tampered = { ...midtransNotification({ orderId: created.orderId, grossAmount: invoice.total }), status_code: "201" };
      expect((await payments.postMidtransNotification(tampered)).status()).toBe(403);

      const unsigned = midtransNotification({ orderId: created.orderId, grossAmount: invoice.total });
      delete unsigned.signature_key;
      expect((await payments.postMidtransNotification(unsigned)).status()).toBe(400);

      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
      expect((await getInvoice(api, invoice.id)).status).toBe("SENT");
    },
  );

  test(
    "PAY-04 the same settlement delivered twice is idempotent: one transition, one payment, invoice PAID once",
    { annotation: covers("/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const client = uniqueTag("PAY-04");
      const invoice = await factory.createInvoice({ status: "SENT", client });
      const created = await createMidtransAttempt(api, invoice.id);
      const notification = midtransNotification({ orderId: created.orderId, grossAmount: invoice.total });

      const first = await payments.postMidtransNotification(notification);
      expect(first.status()).toBe(200);
      expect(await first.json()).toMatchObject({ duplicate: false, status: "SETTLED" });
      const settled = await getAttempt(api, created.attemptId);
      const paidAt = (await getInvoice(api, invoice.id)).paidAt;

      const second = await payments.postMidtransNotification(notification);
      expect(second.status()).toBe(200);
      expect(await second.json()).toMatchObject({ received: true, duplicate: true, status: "SETTLED" });

      const after = await getAttempt(api, created.attemptId);
      expect(after.status).toBe("SETTLED");
      expect(after.updatedAt).toBe(settled.updatedAt);
      expect(after.payments).toEqual(settled.payments);
      const reread = await getInvoice(api, invoice.id);
      expect(reread.status).toBe("PAID");
      expect(reread.paidAt).toBe(paidAt);
      expect(await listPaymentsForClient(api, client)).toHaveLength(1);
    },
  );

  for (const { transactionStatus, attemptStatus } of [
    { transactionStatus: "expire", attemptStatus: "EXPIRED" },
    { transactionStatus: "deny", attemptStatus: "FAILED" },
    { transactionStatus: "cancel", attemptStatus: "CANCELLED" },
  ]) {
    test(
      `PAY-05 a "${transactionStatus}" notification moves the attempt to ${attemptStatus} and the invoice stays unpaid`,
      { annotation: covers("/api/payments/midtrans/notification", "/api/payments/[attemptId]") },
      async ({ factory, api, payments }) => {
        const invoice = await factory.createInvoice({ status: "SENT" });
        const created = await createMidtransAttempt(api, invoice.id);

        const response = await payments.postMidtransNotification(
          midtransNotification({
            orderId: created.orderId,
            grossAmount: invoice.total,
            transactionStatus,
            statusCode: transactionStatus === "deny" ? "202" : "407",
          }),
        );
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ status: attemptStatus });

        expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: attemptStatus, payments: [], invoice: { status: "SENT" } });

        // Terminal: a late settlement for the same attempt is an invalid transition.
        const late = await payments.postMidtransNotification(midtransNotification({ orderId: created.orderId, grossAmount: invoice.total }));
        expect(late.status()).toBe(409);
        expect((await getInvoice(api, invoice.id)).status).toBe("SENT");
      },
    );
  }

  test(
    "PAY-13 a settlement whose gross_amount differs from the attempt is rejected and the invoice stays unpaid",
    { annotation: covers("/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      // Correctly signed, but for a different amount.
      const response = await payments.postMidtransNotification(
        midtransNotification({ orderId: created.orderId, grossAmount: invoice.total - 1_000 }),
      );
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "Payment amount does not match invoice" });

      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
    },
  );

  test(
    "PAY-14 a settlement for an unknown order_id is 404 and changes nothing",
    { annotation: covers("/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      // An attempt-style order id that was never issued, and a legacy-style
      // `<invoiceId>-<timestamp>` id whose invoice does not exist.
      for (const orderId of [`invo_${randomUUID()}`, `missing-invoice-${Date.now()}`]) {
        const response = await payments.postMidtransNotification(midtransNotification({ orderId, grossAmount: invoice.total }));
        expect(response.status(), orderId).toBe(404);
      }

      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [] });
      expect((await getInvoice(api, invoice.id)).status).toBe("SENT");
    },
  );

  test(
    "PAY-15 an already PAID invoice refuses new attempts and a conflicting settlement; it stays PAID with the original payment",
    { annotation: covers("/api/payments/midtrans/create", "/api/payments/stripe/create-session", "/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const client = uniqueTag("PAY-15");
      const invoice = await factory.createInvoice({ status: "SENT", client });
      const paid = await factory.payInvoiceViaMidtrans(invoice);

      for (const url of ["/api/payments/midtrans/create", "/api/payments/stripe/create-session"]) {
        const response = await api.post(url, { data: { invoiceId: invoice.id } });
        expect(response.status(), url).toBe(409);
        expect(await response.json()).toEqual({ error: "Invoice is already paid" });
      }

      // A new settlement (different provider transaction) for the settled attempt.
      const conflicting = await payments.postMidtransNotification(
        midtransNotification({ orderId: paid.attempt.orderId!, grossAmount: invoice.total, transactionId: `e2e-other-${Date.now()}` }),
      );
      expect(conflicting.status()).toBe(409);

      const attempt = await getAttempt(api, paid.attemptId);
      expect(attempt).toMatchObject({ status: "SETTLED", paymentId: paid.providerPaymentId, invoice: { status: "PAID" } });
      expect(attempt.payments.map((payment) => payment.id)).toEqual([paid.paymentId]);
      expect((await listPaymentsForClient(api, client)).map((payment) => payment.id)).toEqual([paid.paymentId]);
    },
  );

  test(
    "PAY-15b a second provider settling an already PAID invoice records no second payment and is flagged for refund",
    { annotation: covers("/api/payments/stripe/webhook", "/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const client = uniqueTag("PAY-15b");
      const invoice = await factory.createInvoice({ status: "SENT", client });
      // Stripe checkout opened first, then the customer pays through Midtrans.
      const stripeSession = await createStripeSession(api, invoice.id);
      const paid = await factory.payInvoiceViaMidtrans(invoice);

      // IDR is two-decimal on Stripe: amount_total is the invoice total x 100.
      const late = await payments.postStripeEvent(
        payments.stripeCheckoutCompletedEvent({
          sessionId: stripeSession.sessionId,
          attemptId: stripeSession.attemptId,
          invoiceId: invoice.id,
          amountMinor: toStripeMinorUnit(invoice.total, "IDR"),
          currency: "IDR",
        }),
      );
      expect(late.status()).toBe(200);
      expect(await late.json()).toMatchObject({ status: "SETTLED", duplicatePayment: true, refundRequired: true });

      // The loser keeps the provider's truth (SETTLED) but owns no Payment.
      expect(await getAttempt(api, stripeSession.attemptId)).toMatchObject({ status: "SETTLED", payments: [], invoice: { status: "PAID" } });
      const winner = await getAttempt(api, paid.attemptId);
      expect(winner.payments.map((payment) => payment.id)).toEqual([paid.paymentId]);
      expect((await listPaymentsForClient(api, client)).map((payment) => payment.id)).toEqual([paid.paymentId]);
    },
  );

  test(
    "PAY-17 a settlement whose currency differs from the attempt is rejected",
    { annotation: covers("/api/payments/midtrans/notification") },
    async ({ factory, api, payments }) => {
      const invoice = await factory.createInvoice({ status: "SENT" });
      const created = await createMidtransAttempt(api, invoice.id);

      const response = await payments.postMidtransNotification(
        midtransNotification({ orderId: created.orderId, grossAmount: invoice.total, currency: "USD" }),
      );
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "Payment currency does not match invoice" });
      expect(await getAttempt(api, created.attemptId)).toMatchObject({ status: "PENDING", payments: [], invoice: { status: "SENT" } });
    },
  );

  test(
    "PAY-17b a non-IDR invoice cannot open a Midtrans checkout (gross_amount has no currency)",
    { annotation: covers("/api/payments/midtrans/create") },
    async ({ factory, api, stub }) => {
      const invoice = await factory.createInvoice({ status: "SENT", currency: "USD", items: [{ name: "E2E design", qty: 3, price: 120 }] });
      const response = await api.post("/api/payments/midtrans/create", { data: { invoiceId: invoice.id } });
      expect(response.status()).toBe(422);
      expect(await response.json()).toEqual({ error: "Midtrans only supports IDR invoices" });
      expect(snapTransactionRequests(await stub.requests())).toHaveLength(0);
    },
  );
});
