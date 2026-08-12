import { describe, expect, it } from 'vitest';

import { formatCurrency, getCurrencySymbol } from '@/lib/currency';

describe('currency formatting', () => {
  it('formats stored IDR totals without a minor-unit conversion', () => {
    expect(formatCurrency(1_000_000, 'IDR')).toContain('1.000.000');
  });

  it('formats nominal foreign-currency amounts with decimals', () => {
    expect(formatCurrency(125.5, 'USD')).toContain('125.50');
  });

  it('defaults omitted currency values to IDR', () => {
    expect(formatCurrency(50_000)).toContain('50.000');
  });

  it('normalizes currency codes for symbol lookup', () => {
    expect(getCurrencySymbol('usd')).toBe('$');
  });
});
