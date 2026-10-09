// PAY-INT-01 (settlement replay) and PAY-INT-02 ("competing-webhooks").
// Webhooks are forged with the providers' real signature algorithms and the
// e2e secrets, and posted to the route handlers in-process.
// @covers: /api/payments/midtrans/notification, /api/payments/stripe/webhook (route handlers called in-process; scripts/e2e-coverage-check.mjs)
import { describe, expect, it } from "vitest";

import { POST as midtransNotification } from "@/app/api/payments/midtrans/notification/route";
import { POST as stripeWebhook } from "@/app/api/payments/stripe/webhook/route";
import { toStripeMinorUnit } from "@/lib/payments/money";
import { signMidtrans, signStripe } from "../../e2e/support/webhooks";

import { createInvoice, createUserWithWorkspace, db, request, uid, waitFor } from "./harness/fixtures";

const TOTAL = 150_000;

async function paymentInvoice() {
  const { user, organization } = await createUserWithWorkspace();
  const invoice = await createInvoice({ userId: user.id, organizationId: organization.id, total: TOTAL, currency: "IDR" });
  return { user, organization, invoice };
}

// Same shape as app/api/payments/midtrans/create/route.ts before the Snap call.
async function midtransAttempt(invoiceId: string) {
  const id = crypto.randomUUID();
  return db.paymentAttempt.create({
    data: {
      id,
      invoiceId,
      provider: "midtrans",
      idempotencyKey: `midtrans:invoice:${invoiceId}:retry:${uid()}`,
      providerOrderId: `invo_${id}`,
      amount: TOTAL,
      currency: "IDR",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60_000),
      metadata: { source: "midtrans_checkout" },
    },
  });
}

// Same shape as app/api/payments/stripe/create-session/route.ts after the session is created.
async function stripeAttempt(invoiceId: string) {
  const id = crypto.randomUUID();
  return db.paymentAttempt.create({
    data: {
      id,
      invoiceId,
      provider: "stripe",
      idempotencyKey: `stripe:invoice:${invoiceId}:retry:${uid()}`,
      providerOrderId: `invo_${id}`,
      providerSessionId: `cs_test_${uid()}`,
      amount: TOTAL,
      currency: "IDR",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60_000),
      metadata: { source: "stripe_checkout" },
    },
  });
}

function midtransNotificationBody(
  orderId: string,
  transactionId: string,
  status: "pending" | "settlement",
) {
  const statusCode = status === "settlement" ? "200" : "201";
  const grossAmount = `${TOTAL}.00`;
  return {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    currency: "IDR",
    transaction_id: transactionId,
    transaction_status: status,
    transaction_time: "2026-10-01 10:00:00",
    ...(status === "settlement" ? { settlement_time: "2026-10-01 10:05:00" } : {}),
    fraud_status: "accept",
    payment_type: "bank_transfer",
    signature_key: signMidtrans({ orderId, statusCode, grossAmount }),
  };
}

const postMidtrans = (body: unknown) =>
  midtransNotification(request("/api/payments/midtrans/notification", { method: "POST", body }));

function stripeEvent(
  attempt: { id: string; invoiceId: string; providerSessionId: string | null; providerOrderId: string | null },
  { eventId = `evt_${uid()}`, type = "checkout.session.completed", paymentIntent }: { eventId?: string; type?: string; paymentIntent: string },
) {
  return JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object: {
        id: attempt.providerSessionId,
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        // Stripe minor units: IDR is two-decimal on Stripe (x100).
        amount_total: toStripeMinorUnit(TOTAL, "IDR"),
        currency: "idr",
        payment_intent: paymentIntent,
        client_reference_id: attempt.providerOrderId,
        metadata: { invoiceId: attempt.invoiceId, attemptId: attempt.id, orderId: attempt.providerOrderId },
      },
    },
  });
}

const postStripe = (payload: string) =>
  stripeWebhook(
    request("/api/payments/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signStripe(payload), "content-type": "application/json" },
    }),
  );

async function ledger(invoiceId: string) {
  const [invoice, attempts, payments, events] = await Promise.all([
    db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
    db.paymentAttempt.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } }),
    db.payment.findMany({ where: { invoiceId } }),
    db.paymentEvent.findMany({ where: { attempt: { invoiceId } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { invoice, attempts, payments, events };
}

// Fire-and-forget payment audit entries are awaited so no write is in flight
// when the next scenario starts.
const paymentAudits = (invoiceId: string, count: number) =>
  waitFor(async () => {
    const n = await db.auditLog.count({ where: { entityId: invoiceId, action: "INVOICE_UPDATE" } });
    return n >= count ? n : null;
  });

describe("PAY-INT-01 settlement replay", () => {
  it("Midtrans: three identical settlements record one event per distinct notification and one transition", async () => {
    const { invoice } = await paymentInvoice();
    const attempt = await midtransAttempt(invoice.id);
    const transactionId = `mid-tx-${uid()}`;

    const pending = await postMidtrans(midtransNotificationBody(attempt.providerOrderId!, transactionId, "pending"));
    expect(pending.status).toBe(200);

    const settlement = midtransNotificationBody(attempt.providerOrderId!, transactionId, "settlement");
    const first = await postMidtrans(settlement);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, duplicate: false, status: "SETTLED" });
    const afterFirst = await ledger(invoice.id);

    for (let i = 0; i < 2; i += 1) {
      const replay = await postMidtrans(settlement);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ received: true, duplicate: true });
    }

    const after = await ledger(invoice.id);
    // One PaymentEvent per distinct provider event: pending + settlement.
    expect(after.events.map((e) => e.status)).toEqual(["PENDING", "SETTLED"]);
    expect(new Set(after.events.map((e) => e.providerEventId)).size).toBe(2);
    // One status transition: PENDING -> SETTLED, applied once.
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].status).toBe("SETTLED");
    expect(after.attempts[0].updatedAt.getTime()).toBe(afterFirst.attempts[0].updatedAt.getTime());
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0].gatewayPaymentId).toBe(transactionId);
    expect(after.invoice.status).toBe("PAID");
    expect(after.invoice.paidAt?.getTime()).toBe(afterFirst.invoice.paidAt?.getTime());
    expect(after.invoice.updatedAt.getTime()).toBe(afterFirst.invoice.updatedAt.getTime());
    await paymentAudits(invoice.id, 1);
  });

  it("Stripe: the same event replayed three times (sequentially and concurrently) is recorded once", async () => {
    const { invoice } = await paymentInvoice();
    const attempt = await stripeAttempt(invoice.id);
    const paymentIntent = `pi_${uid()}`;
    const payload = stripeEvent(attempt, { paymentIntent });

    const first = await postStripe(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, duplicate: false, status: "SETTLED" });
    const afterFirst = await ledger(invoice.id);

    const replays = await Promise.all([postStripe(payload), postStripe(payload)]);
    for (const replay of replays) {
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ received: true, duplicate: true });
    }

    const after = await ledger(invoice.id);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ provider: "stripe", status: "SETTLED" });
    expect(after.attempts[0].status).toBe("SETTLED");
    expect(after.attempts[0].updatedAt.getTime()).toBe(afterFirst.attempts[0].updatedAt.getTime());
    expect(after.payments).toHaveLength(1);
    expect(after.invoice.status).toBe("PAID");
    expect(after.invoice.paidAt?.getTime()).toBe(afterFirst.invoice.paidAt?.getTime());

    // A distinct provider event for the same settlement is recorded, but it
    // is not a second transition and creates no second payment.
    const distinct = await postStripe(stripeEvent(attempt, { type: "checkout.session.async_payment_succeeded", paymentIntent }));
    expect(distinct.status).toBe(200);
    expect(await distinct.json()).toMatchObject({ duplicate: false, status: "SETTLED" });
    const final = await ledger(invoice.id);
    expect(final.events).toHaveLength(2);
    expect(final.attempts[0].status).toBe("SETTLED");
    expect(final.payments).toHaveLength(1);
    await paymentAudits(invoice.id, 2);
  });
});

describe("PAY-INT-02 competing-webhooks", () => {
  async function race() {
    const { invoice } = await paymentInvoice();
    const stripe = await stripeAttempt(invoice.id);
    const midtrans = await midtransAttempt(invoice.id);
    const [stripeRes, midtransRes] = await Promise.all([
      postStripe(stripeEvent(stripe, { paymentIntent: `pi_${uid()}` })),
      postMidtrans(midtransNotificationBody(midtrans.providerOrderId!, `mid-tx-${uid()}`, "settlement")),
    ]);
    const result = await ledger(invoice.id);
    await waitFor(async () => (await db.auditLog.count({ where: { entityId: invoice.id } })) >= 1);
    return { stripeRes, midtransRes, ...result };
  }

  // Each webhook locks its PaymentAttempt and the first settlement claims the
  // invoice (lib/payments/settlement.ts). The losing provider's attempt stays
  // SETTLED (the provider did capture the money) but creates no Payment and
  // carries metadata.duplicateSettlement { reason: "invoice_already_settled",
  // refundRequired: true }. Both webhooks are acknowledged with 200.
  it("settles the invoice once: one Payment, one attempt flagged metadata.duplicateSettlement (refundRequired)", async () => {
    const assertSingleSettlement = async (r: Awaited<ReturnType<typeof race>>) => {
      expect(r.stripeRes.status).toBe(200);
      expect(r.midtransRes.status).toBe(200);
      expect(r.invoice.status).toBe("PAID");
      expect(r.payments).toHaveLength(1);
      expect(r.attempts.filter((a) => a.status === "SETTLED")).toHaveLength(2);
      const flagged = r.attempts.filter(
        (a) => (a.metadata as Record<string, unknown> | null)?.duplicateSettlement,
      );
      expect(flagged).toHaveLength(1);
      expect((flagged[0].metadata as Record<string, any>).duplicateSettlement).toMatchObject({
        reason: "invoice_already_settled",
        refundRequired: true,
      });
    };
    await assertSingleSettlement(await race());

    // Sequential: Stripe settles first, Midtrans arrives afterwards.
    const { invoice } = await paymentInvoice();
    const stripe = await stripeAttempt(invoice.id);
    const midtrans = await midtransAttempt(invoice.id);
    const stripeRes = await postStripe(stripeEvent(stripe, { paymentIntent: `pi_${uid()}` }));
    const midtransRes = await postMidtrans(
      midtransNotificationBody(midtrans.providerOrderId!, `mid-tx-${uid()}`, "settlement"),
    );
    await assertSingleSettlement({ stripeRes, midtransRes, ...(await ledger(invoice.id)) } as any);
  });
});
