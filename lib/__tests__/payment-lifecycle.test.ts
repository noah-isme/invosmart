import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_ATTEMPT_STATUS,
  calculateRefundedAmount,
  createMidtransEventId,
  createMidtransOrderId,
  decidePaymentTransition,
  getAttemptExpiry,
  isFullyRefunded,
  mapMidtransStatus,
  verifyAmountAndCurrency,
  verifyMidtransSignature,
} from '@/lib/payments/lifecycle';

describe('payment lifecycle', () => {
  it('derives a stable Midtrans order id from an attempt id', () => {
    expect(createMidtransOrderId('attempt-123')).toBe('invo_attempt-123');
    expect(createMidtransOrderId('attempt-123')).toBe(createMidtransOrderId('attempt-123'));
  });

  it('expires attempts using a deterministic TTL', () => {
    const now = new Date('2026-08-12T10:00:00.000Z');
    expect(getAttemptExpiry(now, 30)).toEqual(new Date('2026-08-12T10:30:00.000Z'));
  });

  it('accepts exact amount/currency and rejects mismatches', () => {
    expect(verifyAmountAndCurrency({
      expectedAmount: 125000,
      expectedCurrency: 'IDR',
      actualAmount: '125000',
      actualCurrency: 'idr',
    })).toEqual({ ok: true, amount: 125000, currency: 'IDR' });
    expect(verifyAmountAndCurrency({
      expectedAmount: 125000,
      expectedCurrency: 'IDR',
      actualAmount: 124999,
      actualCurrency: 'IDR',
    }).ok).toBe(false);
    expect(verifyAmountAndCurrency({
      expectedAmount: 125000,
      expectedCurrency: 'IDR',
      actualAmount: 125000,
      actualCurrency: 'USD',
    }).ok).toBe(false);
  });

  it('verifies Midtrans signatures and rejects altered payloads', () => {
    const orderId = 'invo_attempt-123';
    const statusCode = '200';
    const grossAmount = '125000';
    const serverKey = 'server-key';
    const signature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');

    expect(verifyMidtransSignature({ orderId, statusCode, grossAmount, signature, serverKey })).toBe(true);
    expect(verifyMidtransSignature({ orderId, statusCode, grossAmount: '125001', signature, serverKey })).toBe(false);
  });

  it('maps provider statuses into the shared lifecycle', () => {
    expect(mapMidtransStatus({ transactionStatus: 'pending' })).toBe(PAYMENT_ATTEMPT_STATUS.PENDING);
    expect(mapMidtransStatus({ transactionStatus: 'capture', fraudStatus: 'challenge' })).toBe(PAYMENT_ATTEMPT_STATUS.AUTHORIZED);
    expect(mapMidtransStatus({ transactionStatus: 'settlement' })).toBe(PAYMENT_ATTEMPT_STATUS.SETTLED);
    expect(mapMidtransStatus({ transactionStatus: 'partial_refund' })).toBe(PAYMENT_ATTEMPT_STATUS.REFUNDED);
    expect(mapMidtransStatus({ transactionStatus: 'unknown' })).toBeNull();
  });

  it('separates Midtrans lifecycle notifications sharing one transaction id', () => {
    const pending = createMidtransEventId({
      transaction_id: 'txn-1',
      order_id: 'invo-attempt',
      transaction_status: 'pending',
      status_code: '201',
      gross_amount: '1000',
    });
    const settled = createMidtransEventId({
      transaction_id: 'txn-1',
      order_id: 'invo-attempt',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '1000',
    });
    expect(pending).not.toBe(settled);
    expect(createMidtransEventId({
      transaction_id: 'txn-1',
      order_id: 'invo-attempt',
      transaction_status: 'settlement',
      status_code: '200',
      gross_amount: '1000',
    })).toBe(settled);
  });

  it('accepts forward transitions and ignores stale webhook events', () => {
    expect(decidePaymentTransition('PENDING', 'AUTHORIZED')).toBe('apply');
    expect(decidePaymentTransition('AUTHORIZED', 'SETTLED')).toBe('apply');
    expect(decidePaymentTransition('SETTLED', 'AUTHORIZED')).toBe('ignore');
    expect(decidePaymentTransition('SETTLED', 'FAILED')).toBe('ignore');
    expect(decidePaymentTransition('PENDING', 'REFUNDED')).toBe('invalid');
    expect(decidePaymentTransition('SETTLED', 'SETTLED')).toBe('duplicate');
  });

  it('keeps partial refund totals monotonic and detects full refunds', () => {
    expect(calculateRefundedAmount({
      paidAmount: 1000,
      currentRefundedAmount: 0,
      incrementalRefundAmount: 250,
    })).toBe(250);
    expect(calculateRefundedAmount({
      paidAmount: 1000,
      currentRefundedAmount: 250,
      cumulativeRefundedAmount: 200,
    })).toBe(250);
    expect(calculateRefundedAmount({
      paidAmount: 1000,
      currentRefundedAmount: 250,
      fullRefund: true,
    })).toBe(1000);
    expect(isFullyRefunded(1000, 999)).toBe(false);
    expect(isFullyRefunded(1000, 1000)).toBe(true);
  });
});
