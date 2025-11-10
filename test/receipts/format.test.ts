import { describe, it, expect } from 'vitest';
import { formatAmount, formatDate, formatDateTime } from '@/lib/receipts/format';

describe('receipts-format', () => {
  it('formats IDR amount correctly', () => {
    const result = formatAmount(1000000);
    expect(result).toContain('1.000.000');
    expect(result).toContain('Rp');
  });

  it('formats date in Indonesian locale', () => {
    const date = new Date('2025-01-15T10:00:00Z');
    const result = formatDate(date);
    expect(result).toMatch(/15|Januari|2025/);
  });

  it('formats datetime with time', () => {
    const date = new Date('2025-01-15T10:30:00Z');
    const result = formatDateTime(date);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(10);
  });
});
