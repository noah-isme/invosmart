import { describe, expect, it } from 'vitest';

import {
  STRIPE_ZERO_DECIMAL_CURRENCIES,
  fromStripeMinorUnit,
  isSupportedPaymentCurrency,
  toStripeMinorUnit,
} from '@/lib/payments/money';

describe('Stripe minor units', () => {
  it('treats IDR as a two-decimal currency (Rp150,000 is 15000000)', () => {
    expect(toStripeMinorUnit(150_000, 'IDR')).toBe(15_000_000);
    expect(toStripeMinorUnit(150_000, 'idr')).toBe(15_000_000);
    expect(fromStripeMinorUnit(15_000_000, 'IDR')).toBe(150_000);
  });

  it('keeps Stripe zero-decimal currencies unchanged', () => {
    expect(toStripeMinorUnit(500, 'JPY')).toBe(500);
    expect(fromStripeMinorUnit(500, 'JPY')).toBe(500);
    expect(toStripeMinorUnit(1000, 'krw')).toBe(1000);
    expect(STRIPE_ZERO_DECIMAL_CURRENCIES.has('IDR')).toBe(false);
  });

  it('converts two-decimal currencies to cents and back', () => {
    expect(toStripeMinorUnit(12.5, 'USD')).toBe(1250);
    expect(fromStripeMinorUnit(1250, 'USD')).toBe(12.5);
  });

  it('uses the default two-decimal factor for ISK and UGX, as documented by Stripe', () => {
    expect(toStripeMinorUnit(5, 'ISK')).toBe(500);
    expect(toStripeMinorUnit(5, 'UGX')).toBe(500);
  });

  it('recognizes ISO-style three-letter currency codes', () => {
    expect(isSupportedPaymentCurrency('usd')).toBe(true);
    expect(isSupportedPaymentCurrency('US')).toBe(false);
  });
});
