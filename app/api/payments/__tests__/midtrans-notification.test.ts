import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const attempt = {
    id: 'attempt-1',
    invoiceId: 'invoice-1',
    provider: 'midtrans',
    idempotencyKey: 'midtrans:invoice:invoice-1',
    providerOrderId: 'invo_attempt-1',
    providerSessionId: null,
    providerPaymentId: null,
    providerToken: null,
    checkoutUrl: null,
    amount: 1000,
    currency: 'IDR',
    status: 'PENDING',
    expiresAt: new Date('2026-08-12T12:00:00.000Z'),
    metadata: null,
    invoice: {
      id: 'invoice-1',
      userId: 'user-1',
      total: 1000,
      currency: 'IDR',
      status: 'UNPAID',
      paidAt: null,
    },
  };
  const events: Array<Record<string, unknown>> = [];
  const payments: Array<Record<string, unknown>> = [];
  const db: Record<string, any> = {
    paymentAttempt: {
      findFirst: vi.fn(async () => attempt),
      findUnique: vi.fn(async () => attempt),
      create: vi.fn(async () => attempt),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(attempt, data);
        return attempt;
      }),
    },
    paymentEvent: {
      findFirst: vi.fn(async ({ where }: { where: { providerEventId: string } }) =>
        events.find((entry) => entry.providerEventId === where.providerEventId) || null),
    },
    payment: {
      findFirst: vi.fn(async () => payments[0] || null),
    },
    invoice: {
      findUnique: vi.fn(async () => attempt.invoice),
    },
    $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(tx)),
  };
  const tx: Record<string, any> = {
    paymentAttempt: {
      findUnique: vi.fn(async () => attempt),
      update: db.paymentAttempt.update,
    },
    paymentEvent: {
      findFirst: db.paymentEvent.findFirst,
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `event-${events.length + 1}`, ...data };
        events.push(event);
        return event;
      }),
    },
    payment: {
      findFirst: vi.fn(async () => payments[0] || null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const payment = { id: 'payment-1', ...data };
        payments.push(payment);
        return payment;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(payments[0], data);
        return payments[0];
      }),
    },
    invoice: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(attempt.invoice, data);
        return attempt.invoice;
      }),
    },
  };
  return { db, tx, attempt, events, payments };
});

vi.mock('@/lib/db', () => ({ db: state.db }));
vi.mock('@/lib/audit/auditLogger', () => ({
  AuditAction: { INVOICE_UPDATE: 'INVOICE_UPDATE' },
  AuditEntity: { INVOICE: 'Invoice' },
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/payments/midtrans/notification/route';

function requestFor(payload: Record<string, unknown>) {
  const serverKey = 'test-server-key';
  const signature = crypto
    .createHash('sha512')
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
    .digest('hex');
  return new Request('http://localhost/api/payments/midtrans/notification', {
    method: 'POST',
    body: JSON.stringify({ ...payload, signature_key: signature }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('Midtrans notification lifecycle', () => {
  beforeEach(() => {
    process.env.MIDTRANS_SERVER_KEY = 'test-server-key';
    state.attempt.status = 'PENDING';
    state.attempt.providerPaymentId = null;
    state.attempt.invoice.status = 'UNPAID';
    state.attempt.invoice.paidAt = null;
    state.events.splice(0);
    state.payments.splice(0);
    vi.clearAllMocks();
    state.db.$transaction.mockImplementation(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(state.tx));
  });

  it('deduplicates event retries, handles ordering, and reconciles refunds', async () => {
    const common = {
      order_id: 'invo_attempt-1',
      transaction_id: 'txn-1',
      gross_amount: '1000',
      currency: 'IDR',
    };

    const pending = await POST(requestFor({
      ...common,
      status_code: '201',
      transaction_status: 'pending',
    }));
    expect(pending.status).toBe(200);
    expect(state.events).toHaveLength(1);
    expect(state.payments).toHaveLength(0);

    const settledPayload = {
      ...common,
      status_code: '200',
      transaction_status: 'settlement',
      settlement_time: '2026-08-12T11:00:00.000Z',
    };
    const settled = await POST(requestFor(settledPayload));
    expect(settled.status).toBe(200);
    expect(state.attempt.status).toBe('SETTLED');
    expect(state.payments).toHaveLength(1);
    expect(state.attempt.invoice.status).toBe('PAID');

    const duplicate = await POST(requestFor(settledPayload));
    expect((await duplicate.json()).duplicate).toBe(true);
    expect(state.events).toHaveLength(2);
    expect(state.payments).toHaveLength(1);

    const partialRefund = await POST(requestFor({
      ...common,
      status_code: '200',
      transaction_status: 'partial_refund',
      refund_amount: '500',
      refund_key: 'refund-1',
    }));
    expect(partialRefund.status).toBe(200);
    expect(state.payments[0].refundedAmount).toBe(500);
    expect(state.attempt.invoice.status).toBe('PAID');

    const fullRefund = await POST(requestFor({
      ...common,
      status_code: '200',
      transaction_status: 'refund',
      refund_key: 'refund-2',
    }));
    expect(fullRefund.status).toBe(200);
    expect(state.payments[0].refundedAmount).toBe(1000);
    expect(state.attempt.invoice.status).toBe('UNPAID');
  });

  it('rejects a signed notification with the wrong amount', async () => {
    const response = await POST(requestFor({
      order_id: 'invo_attempt-1',
      transaction_id: 'txn-wrong',
      status_code: '200',
      gross_amount: '999',
      currency: 'IDR',
      transaction_status: 'settlement',
    }));
    expect(response.status).toBe(400);
    expect(state.payments).toHaveLength(0);
  });
});
