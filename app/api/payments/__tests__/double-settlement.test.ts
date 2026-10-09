import crypto from 'node:crypto';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const state = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_double_settlement';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_double_settlement';
  process.env.MIDTRANS_SERVER_KEY = 'midtrans-double-settlement-key';

  const store = {
    invoice: {} as Row,
    attempts: [] as Row[],
    events: [] as Row[],
    payments: [] as Row[],
  };
  const withInvoice = (attempt: Row | undefined) => (attempt ? { ...attempt, invoice: store.invoice } : null);
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);

  const models = {
    paymentAttempt: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        withInvoice(store.attempts.find((a) => matches(a, where)))),
      findUnique: vi.fn(async ({ where }: { where: Row }) =>
        withInvoice(store.attempts.find((a) => a.id === where.id))),
      create: vi.fn(),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const attempt = store.attempts.find((a) => a.id === where.id)!;
        Object.assign(attempt, data);
        return attempt;
      }),
    },
    paymentEvent: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        store.events.find((e) => e.providerEventId === where.providerEventId) || null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const event = { id: `event-${store.events.length + 1}`, ...data };
        store.events.push(event);
        return event;
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where, include }: { where: Row; include?: Row }) => {
        const payment = store.payments.find((p) => matches(p, where));
        if (!payment) return null;
        if (!include?.attempt) return payment;
        return { ...payment, attempt: withInvoice(store.attempts.find((a) => a.id === payment.attemptId)) };
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        // Widen the race window between the checks and the write.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const payment = { id: `payment-${store.payments.length + 1}`, createdAt: new Date(), ...data };
        store.payments.push(payment);
        return payment;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const payment = store.payments.find((p) => p.id === where.id)!;
        Object.assign(payment, data);
        return payment;
      }),
    },
    invoice: {
      findUnique: vi.fn(async () => store.invoice),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(store.invoice, data)),
      // Mirrors the SQL semantics of the conditional claim: only rows whose
      // status differs from PAID are updated.
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (store.invoice.id === where.id && store.invoice.status !== where.status.not) {
          Object.assign(store.invoice, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
  };
  // Row locks (SELECT ... FOR UPDATE and the implicit lock taken by an
  // UPDATE) are held until the owning transaction finishes, like Postgres.
  const locks = new Map<string, Promise<void>>();
  const acquire = async (key: string) => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, previous.then(() => mine));
    await previous;
    return release;
  };
  const db = {
    ...models,
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const held: Array<() => void> = [];
      const tx = {
        ...models,
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, id: string) => {
          const table = /"(\w+)"/.exec(strings.join('?'))![1];
          held.push(await acquire(`${table}:${id}`));
          return [{ id }];
        }),
        invoice: {
          ...models.invoice,
          updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
            const release = await acquire(`Invoice:${args.where.id}`);
            const result = await models.invoice.updateMany(args);
            if (result.count === 1) held.push(release);
            else release();
            return result;
          }),
        },
      };
      try {
        return await cb(tx);
      } finally {
        held.forEach((release) => release());
      }
    }),
  };
  const audit = vi.fn();
  return { store, db, models, audit };
});

vi.mock('@/lib/db', () => ({ db: state.db }));
vi.mock('@/lib/audit/auditLogger', () => ({
  logAuditEvent: state.audit,
  AuditAction: { INVOICE_UPDATE: 'INVOICE_UPDATE' },
  AuditEntity: { INVOICE: 'Invoice' },
}));

import { POST as midtransNotification } from '@/app/api/payments/midtrans/notification/route';
import { POST as stripeWebhook } from '@/app/api/payments/stripe/webhook/route';

const TOTAL = 150_000;

function seed(
  invoiceStatus: 'UNPAID' | 'PAID',
  provider: 'midtrans' | 'stripe',
  { winnerPayment = true }: { winnerPayment?: boolean } = {},
) {
  state.store.invoice = {
    id: 'invoice-1',
    userId: 'user-1',
    status: invoiceStatus,
    paidAt: invoiceStatus === 'PAID' ? new Date('2026-10-01T09:00:00Z') : null,
    total: TOTAL,
    currency: 'IDR',
  };
  state.store.attempts = [{
    id: 'attempt-late',
    invoiceId: 'invoice-1',
    provider,
    providerOrderId: 'invo_attempt-late',
    providerSessionId: provider === 'stripe' ? 'cs_late' : null,
    providerPaymentId: null,
    amount: TOTAL,
    currency: 'IDR',
    status: 'PENDING',
    metadata: { source: 'checkout' },
  }];
  state.store.events = [];
  state.store.payments = invoiceStatus === 'PAID' && winnerPayment
    ? [{ id: 'payment-winner', invoiceId: 'invoice-1', attemptId: 'attempt-winner', gatewayPaymentId: 'winner-tx', paidAmount: TOTAL }]
    : [];
}

function midtransRequest(overrides: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    order_id: 'invo_attempt-late',
    status_code: '200',
    gross_amount: `${TOTAL}.00`,
    currency: 'IDR',
    transaction_id: 'mid-tx-late',
    transaction_status: 'settlement',
    settlement_time: '2026-10-01 10:05:00',
    fraud_status: 'accept',
    payment_type: 'bank_transfer',
    ...overrides,
  };
  payload.signature_key = crypto
    .createHash('sha512')
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest('hex');
  return new Request('http://localhost/api/payments/midtrans/notification', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });
}

function stripeRequest(eventId: string, type = 'checkout.session.completed', object: Row = {}) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type,
    data: {
      object: {
        id: 'cs_late',
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: TOTAL * 100, // Stripe minor units: IDR is two-decimal
        currency: 'idr',
        payment_intent: 'pi_late',
        metadata: { invoiceId: 'invoice-1', attemptId: 'attempt-late' },
        ...object,
      },
    },
  });
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return new Request('http://localhost/api/payments/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header },
  });
}

function chargeRefundRequest(eventId: string, paymentIntent: string) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'charge.refunded',
    // No attemptId/invoiceId metadata: the charge is resolved via its PaymentIntent.
    data: {
      object: {
        id: 'ch_1',
        object: 'charge',
        payment_intent: paymentIntent,
        amount: TOTAL * 100,
        amount_refunded: TOTAL * 100,
        currency: 'idr',
        metadata: {},
      },
    },
  });
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return new Request('http://localhost/api/payments/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header },
  });
}

const duplicateAudits = () =>
  state.audit.mock.calls.filter(([entry]) => entry.details?.event === 'DUPLICATE_PAYMENT_REFUND_REQUIRED');

describe('double settlement across providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('Midtrans: a settlement for an invoice already paid creates no Payment, flags the attempt, and returns 200', async () => {
    seed('PAID', 'midtrans');

    const response = await midtransNotification(midtransRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: true, duplicate: false, status: 'SETTLED', duplicatePayment: true, refundRequired: true,
    });
    expect(state.models.payment.create).not.toHaveBeenCalled();
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.events).toHaveLength(1);
    expect(state.store.events[0]).toMatchObject({ provider: 'midtrans', status: 'SETTLED' });
    expect(state.store.attempts[0].metadata.duplicateSettlement).toMatchObject({
      reason: 'invoice_already_settled',
      refundRequired: true,
      settledPaymentId: 'payment-winner',
      providerPaymentId: 'mid-tx-late',
    });
    // The winning payment's invoice state is untouched.
    expect(state.store.invoice.paidAt).toEqual(new Date('2026-10-01T09:00:00Z'));
    expect(state.models.invoice.update).not.toHaveBeenCalled();
    expect(duplicateAudits()).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('manual refund required'));
  });

  it('Midtrans: a redelivered duplicate settlement is acknowledged without a second audit entry', async () => {
    seed('PAID', 'midtrans');
    const first = await midtransNotification(midtransRequest());
    expect(first.status).toBe(200);
    const replay = await midtransNotification(midtransRequest());

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(state.store.payments).toHaveLength(1);
    expect(duplicateAudits()).toHaveLength(1);
  });

  it('Midtrans: refunding the duplicate charge does not flip the paid invoice back to UNPAID', async () => {
    seed('PAID', 'midtrans');
    await midtransNotification(midtransRequest());

    const refund = await midtransNotification(midtransRequest({
      transaction_status: 'refund',
      refund_key: 'refund-1',
      status_code: '200',
    }));

    expect(refund.status).toBe(200);
    expect(await refund.json()).toMatchObject({ duplicatePayment: true, refundRequired: false });
    expect(state.store.attempts[0].status).toBe('REFUNDED');
    expect(state.store.attempts[0].metadata.duplicateSettlement).toMatchObject({ refundRequired: false });
    expect(state.store.invoice.status).toBe('PAID');
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.payments[0].refundedAmount).toBeUndefined();
  });

  it('Midtrans: the first settlement of an unpaid invoice claims it and creates the Payment', async () => {
    seed('UNPAID', 'midtrans');

    const response = await midtransNotification(midtransRequest());

    expect(response.status).toBe(200);
    expect(state.models.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1', status: { not: 'PAID' } },
    }));
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.invoice.status).toBe('PAID');
    expect(duplicateAudits()).toHaveLength(0);
  });

  it('Stripe: a settlement for an invoice already paid creates no Payment, flags the attempt, and returns 200', async () => {
    seed('PAID', 'stripe');

    const response = await stripeWebhook(stripeRequest('evt_late'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: true, duplicate: false, status: 'SETTLED', duplicatePayment: true, refundRequired: true,
    });
    expect(state.models.payment.create).not.toHaveBeenCalled();
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.events).toHaveLength(1);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toMatchObject({
      reason: 'invoice_already_settled',
      refundRequired: true,
      settledPaymentId: 'payment-winner',
      providerPaymentId: 'pi_late',
    });
    expect(state.models.invoice.update).not.toHaveBeenCalled();
    expect(duplicateAudits()).toHaveLength(1);
  });

  it('Stripe: a distinct later event for the duplicate attempt stays flagged and is not re-announced', async () => {
    seed('PAID', 'stripe');
    await stripeWebhook(stripeRequest('evt_late'));

    const later = await stripeWebhook(stripeRequest('evt_late_2', 'checkout.session.async_payment_succeeded'));

    expect(later.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.events).toHaveLength(2);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeDefined();
    expect(duplicateAudits()).toHaveLength(1);
  });

  it('Stripe: the first settlement of an unpaid invoice claims it and creates the Payment', async () => {
    seed('UNPAID', 'stripe');

    const response = await stripeWebhook(stripeRequest('evt_first'));

    expect(response.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.payments[0]).toMatchObject({ gatewayProvider: 'stripe', gatewayPaymentId: 'pi_late' });
    expect(state.store.invoice.status).toBe('PAID');
    expect(duplicateAudits()).toHaveLength(0);
  });

  it('Stripe then Midtrans on the same invoice yield exactly one Payment', async () => {
    seed('UNPAID', 'stripe');
    state.store.attempts.push({
      id: 'attempt-mid',
      invoiceId: 'invoice-1',
      provider: 'midtrans',
      providerOrderId: 'invo_attempt-mid',
      amount: TOTAL,
      currency: 'IDR',
      status: 'PENDING',
      metadata: null,
    });

    expect((await stripeWebhook(stripeRequest('evt_first'))).status).toBe(200);
    const second = await midtransNotification(midtransRequest({
      order_id: 'invo_attempt-mid',
      transaction_id: 'mid-tx-second',
    }));

    expect(second.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.payments[0].gatewayProvider).toBe('stripe');
    expect(state.store.attempts.find((a) => a.id === 'attempt-mid')!.metadata.duplicateSettlement).toBeDefined();
  });

  it('same attempt: Midtrans capture and settlement arriving together record one Payment and flag nothing', async () => {
    seed('UNPAID', 'midtrans');

    const [capture, settlement] = await Promise.all([
      midtransNotification(midtransRequest({ transaction_status: 'capture', fraud_status: 'accept' })),
      midtransNotification(midtransRequest({ transaction_status: 'settlement' })),
    ]);

    expect(capture.status).toBe(200);
    expect(settlement.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeUndefined();
    expect(state.store.invoice.status).toBe('PAID');
    expect(duplicateAudits()).toHaveLength(0);

    // A refund must still reach the real Payment and re-open the invoice.
    const refund = await midtransNotification(midtransRequest({
      transaction_status: 'refund',
      refund_key: 'refund-1',
    }));
    expect(refund.status).toBe(200);
    expect(state.store.payments[0].refundedAmount).toBe(TOTAL);
    expect(state.store.invoice.status).toBe('UNPAID');
  });

  it('same attempt: concurrent Stripe completed + async_payment_succeeded events record one Payment', async () => {
    seed('UNPAID', 'stripe');

    const responses = await Promise.all([
      stripeWebhook(stripeRequest('evt_a')),
      stripeWebhook(stripeRequest('evt_b', 'checkout.session.async_payment_succeeded')),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeUndefined();
    expect(duplicateAudits()).toHaveLength(0);
  });

  it('invoice marked PAID by hand with no Payment: the gateway payment is recorded for review, not refunded', async () => {
    seed('PAID', 'midtrans', { winnerPayment: false });

    const response = await midtransNotification(midtransRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ received: true, status: 'SETTLED', reviewRequired: true });
    expect(body.duplicatePayment).toBeUndefined();
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.payments[0]).toMatchObject({ gatewayProvider: 'midtrans', gatewayPaymentId: 'mid-tx-late' });
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeUndefined();
    expect(state.store.attempts[0].metadata.reviewRequired).toMatchObject({
      reason: 'gateway_payment_on_manually_paid_invoice',
      paymentId: state.store.payments[0].id,
    });
    // The manual paidAt is preserved.
    expect(state.store.invoice.paidAt).toEqual(new Date('2026-10-01T09:00:00Z'));
    expect(duplicateAudits()).toHaveLength(0);
    expect(state.audit.mock.calls.filter(([entry]) =>
      entry.details?.event === 'GATEWAY_PAYMENT_ON_MANUALLY_PAID_INVOICE')).toHaveLength(1);
  });

  it('manually paid invoice settled by both providers at once: one Payment, the other is a duplicate', async () => {
    seed('PAID', 'stripe', { winnerPayment: false });
    state.store.attempts.push({
      id: 'attempt-mid',
      invoiceId: 'invoice-1',
      provider: 'midtrans',
      providerOrderId: 'invo_attempt-mid',
      amount: TOTAL,
      currency: 'IDR',
      status: 'PENDING',
      metadata: null,
    });

    const [stripeRes, midtransRes] = await Promise.all([
      stripeWebhook(stripeRequest('evt_race')),
      midtransNotification(midtransRequest({ order_id: 'invo_attempt-mid', transaction_id: 'mid-tx-race' })),
    ]);

    expect(stripeRes.status).toBe(200);
    expect(midtransRes.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    const flagged = state.store.attempts.filter((a) => a.metadata?.duplicateSettlement);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].metadata.duplicateSettlement.refundRequired).toBe(true);
  });

  it('a provider payload carrying marker keys cannot forge a duplicate or review marker', async () => {
    seed('UNPAID', 'midtrans');

    const response = await midtransNotification(midtransRequest({
      duplicateSettlement: { reason: 'invoice_already_settled', refundRequired: true, settledPaymentId: 'x' },
      reviewRequired: { reason: 'gateway_payment_on_manually_paid_invoice', paymentId: 'x' },
    }));

    expect(response.status).toBe(200);
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeUndefined();
    expect(state.store.attempts[0].metadata.reviewRequired).toBeUndefined();

    // A real refund therefore still reaches the real Payment.
    await midtransNotification(midtransRequest({
      transaction_status: 'refund',
      refund_key: 'refund-1',
      duplicateSettlement: { refundRequired: true },
    }));
    expect(state.store.payments[0].refundedAmount).toBe(TOTAL);
    expect(state.store.invoice.status).toBe('UNPAID');
  });

  it('Stripe: a payload carrying marker keys is stripped before it is stored', async () => {
    seed('UNPAID', 'stripe');

    const response = await stripeWebhook(stripeRequest('evt_inject', 'checkout.session.completed', {
      duplicateSettlement: { refundRequired: true },
      reviewRequired: { reason: 'forged' },
    }));

    expect(response.status).toBe(200);
    expect(state.store.attempts[0].metadata.duplicateSettlement).toBeUndefined();
    expect(state.store.attempts[0].metadata.reviewRequired).toBeUndefined();
    expect(state.store.payments).toHaveLength(1);
  });

  it('Stripe charge.refunded without metadata refunds the winning Payment and re-opens the invoice', async () => {
    seed('UNPAID', 'stripe');
    expect((await stripeWebhook(stripeRequest('evt_first'))).status).toBe(200);

    const refund = await stripeWebhook(chargeRefundRequest('evt_refund', 'pi_late'));

    expect(refund.status).toBe(200);
    expect(state.store.payments[0].refundedAmount).toBe(TOTAL);
    expect(state.store.attempts[0].status).toBe('REFUNDED');
    expect(state.store.invoice.status).toBe('UNPAID');
  });

  it('Stripe charge.refunded without metadata for a flagged duplicate clears the marker and leaves the invoice PAID', async () => {
    seed('PAID', 'stripe');
    expect((await stripeWebhook(stripeRequest('evt_late'))).status).toBe(200);
    expect(state.store.attempts[0].providerPaymentId).toBe('pi_late');

    const refund = await stripeWebhook(chargeRefundRequest('evt_refund', 'pi_late'));

    expect(refund.status).toBe(200);
    expect(await refund.json()).toMatchObject({ duplicatePayment: true, refundRequired: false });
    expect(state.store.attempts[0].status).toBe('REFUNDED');
    expect(state.store.attempts[0].metadata.duplicateSettlement).toMatchObject({ refundRequired: false });
    expect(state.store.invoice.status).toBe('PAID');
    expect(state.store.payments).toHaveLength(1);
    expect(state.store.payments[0].id).toBe('payment-winner');
    expect(state.store.payments[0].refundedAmount).toBeUndefined();
  });

  it('Stripe: rejects an IDR amount_total that is the whole-rupiah value instead of Stripe minor units', async () => {
    seed('UNPAID', 'stripe');

    const response = await stripeWebhook(stripeRequest('evt_wrong_unit', 'checkout.session.completed', {
      amount_total: TOTAL, // Rp1,500.00 in Stripe terms, not Rp150,000
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Payment amount does not match invoice' });
    expect(state.store.payments).toHaveLength(0);
    expect(state.store.invoice.status).toBe('UNPAID');
  });
});
