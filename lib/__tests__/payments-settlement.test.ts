import { describe, expect, it, vi } from 'vitest';

import { buildAttemptMetadata, settleInvoiceOnce, type PaymentLike } from '@/lib/payments/settlement';

function fakeTx(options: {
  claimCount: number;
  // Sequence of results for payment.findFirst({ where: { attemptId } }).
  ownPayments: Array<PaymentLike | null>;
  invoicePayment?: PaymentLike | null;
}) {
  const own = [...options.ownPayments];
  return {
    $queryRaw: vi.fn(async () => []),
    invoice: { updateMany: vi.fn(async () => ({ count: options.claimCount })) },
    payment: {
      findFirst: vi.fn(async ({ where }: { where: { attemptId?: string; invoiceId?: string } }) =>
        'attemptId' in where ? (own.shift() ?? null) : (options.invoicePayment ?? null)),
    },
  };
}

const input = (createPayment: () => Promise<PaymentLike>) => ({
  attemptId: 'attempt-1',
  invoiceId: 'invoice-1',
  gatewayPaymentId: 'gw-1',
  paidAt: new Date('2026-10-01T10:00:00Z'),
  createPayment,
});

const ownPayment: PaymentLike = { id: 'payment-own', attemptId: 'attempt-1', gatewayPaymentId: 'gw-1' };

describe('settleInvoiceOnce', () => {
  it('claim succeeds: records the Payment without review', async () => {
    const tx = fakeTx({ claimCount: 1, ownPayments: [null] });
    const create = vi.fn(async () => ownPayment);

    const outcome = await settleInvoiceOnce(tx, input(create));

    expect(outcome).toEqual({ kind: 'recorded', payment: ownPayment, manualReview: false });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('backstop: a failed claim with a Payment of this same attempt and gateway id is a replay, not a duplicate', async () => {
    // First lookup sees nothing (the sibling event had not committed), the
    // re-check after locking the invoice sees the sibling's Payment.
    const tx = fakeTx({ claimCount: 0, ownPayments: [null, ownPayment], invoicePayment: ownPayment });
    const create = vi.fn(async () => ownPayment);

    const outcome = await settleInvoiceOnce(tx, input(create));

    expect(outcome).toEqual({ kind: 'replay', payment: ownPayment });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('a Payment of this attempt with a different gateway id is a conflict', async () => {
    const tx = fakeTx({ claimCount: 0, ownPayments: [{ ...ownPayment, gatewayPaymentId: 'other' }] });

    expect(await settleInvoiceOnce(tx, input(vi.fn()))).toEqual({ kind: 'conflict' });
  });

  it('a Payment of another attempt makes the settlement a duplicate', async () => {
    const winner: PaymentLike = { id: 'payment-winner', attemptId: 'attempt-2', gatewayPaymentId: 'gw-2' };
    const tx = fakeTx({ claimCount: 0, ownPayments: [null, null], invoicePayment: winner });
    const create = vi.fn();

    expect(await settleInvoiceOnce(tx, input(create))).toEqual({ kind: 'duplicate', settledPaymentId: 'payment-winner' });
    expect(create).not.toHaveBeenCalled();
  });

  it('PAID with no Payment row at all is recorded and flagged for manual review', async () => {
    const tx = fakeTx({ claimCount: 0, ownPayments: [null, null], invoicePayment: null });
    const create = vi.fn(async () => ownPayment);

    const outcome = await settleInvoiceOnce(tx, input(create));

    expect(outcome).toEqual({ kind: 'recorded', payment: ownPayment, manualReview: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('buildAttemptMetadata', () => {
  it('drops marker keys from the provider payload and carries only real markers', () => {
    const forged = { refundRequired: true };
    expect(buildAttemptMetadata(
      { id: 'cs_1', duplicateSettlement: forged, reviewRequired: forged },
      { duplicate: null, review: null },
    )).toEqual({ id: 'cs_1' });

    const real = {
      reason: 'invoice_already_settled' as const,
      refundRequired: true,
      settledPaymentId: 'p1',
      providerEventId: 'e1',
      providerPaymentId: 'pi_1',
      detectedAt: '2026-10-01T00:00:00.000Z',
    };
    expect(buildAttemptMetadata({ id: 'cs_1', duplicateSettlement: forged }, { duplicate: real, review: null }))
      .toEqual({ id: 'cs_1', duplicateSettlement: real });
  });
});
