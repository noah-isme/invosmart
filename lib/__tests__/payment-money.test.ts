import { describe, expect, it } from 'vitest';

import {
  fromGatewayMinorUnit,
  isSupportedPaymentCurrency,
  toGatewayMinorUnit,
} from '@/lib/payments/money';

describe('payment money conversion', () => {
  it('keeps zero-decimal IDR values unchanged', () => {
    expect(toGatewayMinorUnit(125_000, 'IDR')).toBe(125_000);
    expect(fromGatewayMinorUnit(125_000, 'IDR')).toBe(125_000);
  });

  it('converts two-decimal currencies at the gateway boundary', () => {
    expect(toGatewayMinorUnit(12.5, 'USD')).toBe(1250);
    expect(fromGatewayMinorUnit(1250, 'USD')).toBe(12.5);
  });

  it('recognizes ISO-style three-letter currency codes', () => {
    expect(isSupportedPaymentCurrency('usd')).toBe(true);
    expect(isSupportedPaymentCurrency('US')).toBe(false);
  });
});
