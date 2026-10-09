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
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        store.payments.find((p) => matches(p, where)) || null),
      create: vi.fn(async ({ data }: { data: Row }) => {
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
  const db = { ...models, $transaction: vi.fn(async (cb: (tx: typeof models) => unknown) => cb(models)) };
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

function seed(invoiceStatus: 'UNPAID' | 'PAID', provider: 'midtrans' | 'stripe') {
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
  state.store.payments = invoiceStatus === 'PAID'
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
        amount_total: TOTAL,
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
});
