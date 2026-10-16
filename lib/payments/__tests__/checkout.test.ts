import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/payments/stripe', () => ({ isStripeConfigured: true, stripe: {} }));
vi.mock('@/lib/payments/midtrans', () => ({ midtransSnap: {} }));

import {
  checkoutCurrencyError,
  isMidtransCheckoutConfigured,
  pickShareCheckoutProvider,
  shareCheckoutIdempotencyKey,
  shareCheckoutKeyPrefix,
  stripeSessionExpiresAt,
} from '@/lib/payments/checkout';
import { PAYABLE_INVOICE_STATUSES, isInvoicePayable } from '@/lib/payments/lifecycle';

describe('pickShareCheckoutProvider', () => {
  it.each([
    ['IDR', true, true, 'midtrans'],
    ['idr', true, true, 'midtrans'],
    ['USD', true, true, 'stripe'],
    ['EUR', true, true, 'stripe'],
    ['IDR', true, false, 'stripe'],
    ['USD', false, true, 'midtrans'],
    ['IDR', false, true, 'midtrans'],
    ['USD', true, false, 'stripe'],
    ['IDR', false, false, null],
    ['USD', false, false, null],
  ] as const)('%s with stripe=%s midtrans=%s -> %s', (currency, stripeEnabled, midtransEnabled, expected) => {
    expect(pickShareCheckoutProvider({ currency, stripeEnabled, midtransEnabled })).toBe(expected);
  });
});

describe('isInvoicePayable', () => {
  it('accepts SENT, UNPAID and OVERDUE only', () => {
    expect([...PAYABLE_INVOICE_STATUSES]).toEqual(['SENT', 'UNPAID', 'OVERDUE']);
    for (const status of PAYABLE_INVOICE_STATUSES) expect(isInvoicePayable(status)).toBe(true);
    for (const status of ['DRAFT', 'PAID', 'sent', '', null, undefined]) expect(isInvoicePayable(status)).toBe(false);
  });
});

describe('checkoutCurrencyError', () => {
  it('limits Midtrans to IDR and Stripe to supported currencies', () => {
    expect(checkoutCurrencyError('midtrans', 'idr')).toBeNull();
    expect(checkoutCurrencyError('midtrans', 'USD')).toBe('Midtrans only supports IDR invoices');
    expect(checkoutCurrencyError('stripe', 'usd')).toBeNull();
    expect(checkoutCurrencyError('stripe', 'xyz')).toBe('Unsupported invoice currency: XYZ');
  });
});

describe('isMidtransCheckoutConfigured', () => {
  it('needs both the server key and the public client key', () => {
    expect(isMidtransCheckoutConfigured({ MIDTRANS_SERVER_KEY: 'SB-s', NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: 'SB-c' })).toBe(true);
    expect(isMidtransCheckoutConfigured({ MIDTRANS_SERVER_KEY: 'SB-s' })).toBe(false);
    expect(isMidtransCheckoutConfigured({ NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: 'SB-c' })).toBe(false);
    expect(isMidtransCheckoutConfigured({ MIDTRANS_SERVER_KEY: ' ', NEXT_PUBLIC_MIDTRANS_CLIENT_KEY: 'SB-c' })).toBe(false);
  });
});

describe('shareCheckoutIdempotencyKey', () => {
  it('is stable within a 30 s window and changes after it', () => {
    const base = 1_700_000_010_000; // a multiple of 30 000
    expect(shareCheckoutIdempotencyKey('stripe', 'inv', base)).toBe(shareCheckoutIdempotencyKey('stripe', 'inv', base + 29_999));
    expect(shareCheckoutIdempotencyKey('stripe', 'inv', base)).not.toBe(shareCheckoutIdempotencyKey('stripe', 'inv', base + 30_000));
    expect(shareCheckoutIdempotencyKey('midtrans', 'inv', base)).toBe(`share:midtrans:inv:${base / 30_000}`);
  });
});

describe('shareCheckoutKeyPrefix', () => {
  it('prefixes every window key of the invoice and provider', () => {
    const key = shareCheckoutIdempotencyKey('stripe', 'inv', 1_700_000_010_000);
    expect(key.startsWith(shareCheckoutKeyPrefix('stripe', 'inv'))).toBe(true);
    expect(key.startsWith(shareCheckoutKeyPrefix('midtrans', 'inv'))).toBe(false);
  });
});

describe('stripeSessionExpiresAt', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const minutes = (n: number) => now.getTime() + n * 60_000;

  it('raises an attempt expiry below Stripe\'s 30-minute minimum to 32 minutes', () => {
    expect(stripeSessionExpiresAt(new Date(minutes(30)), now)).toBe(minutes(32) / 1000);
    expect(stripeSessionExpiresAt(null, now)).toBe(minutes(32) / 1000);
  });

  it('keeps a later attempt expiry', () => {
    expect(stripeSessionExpiresAt(new Date(minutes(60)), now)).toBe(minutes(60) / 1000);
  });
});
