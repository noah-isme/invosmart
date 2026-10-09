import { describe, expect, it } from 'vitest';

import {
  buildMidtransItemDetails,
  buildStripeLineItems,
  truncateText,
} from '@/lib/payments/line-items';

const sum = (rows: Array<{ price: number; quantity: number }>) =>
  rows.reduce((acc, row) => acc + row.price * row.quantity, 0);

const twoItemInvoice = {
  number: 'INV-001',
  currency: 'IDR',
  items: [
    { name: 'Website design', qty: 2, price: 500_000 },
    { name: 'Hosting', qty: 1, price: 250_000 },
  ],
  // subtotal 1_250_000, 10% tax
  tax: 125_000,
  total: 1_375_000,
};

describe('buildMidtransItemDetails', () => {
  it('maps name/qty/price and adds a tax line so the sum equals gross_amount', () => {
    const details = buildMidtransItemDetails(twoItemInvoice);

    expect(details).toEqual([
      { id: 'item_1', price: 500_000, quantity: 2, name: 'Website design' },
      { id: 'item_2', price: 250_000, quantity: 1, name: 'Hosting' },
      { id: 'tax', price: 125_000, quantity: 1, name: 'Tax' },
    ]);
    expect(sum(details)).toBe(twoItemInvoice.total);
  });

  it('adds a rounding adjustment (possibly negative) when the total does not match', () => {
    const higher = buildMidtransItemDetails({ ...twoItemInvoice, total: 1_375_003 });
    expect(sum(higher)).toBe(1_375_003);
    expect(higher.at(-1)).toMatchObject({ id: 'rounding_adjustment', price: 3, quantity: 1 });

    const lower = buildMidtransItemDetails({ ...twoItemInvoice, total: 1_374_999 });
    expect(sum(lower)).toBe(1_374_999);
    expect(lower.at(-1)).toMatchObject({ id: 'rounding_adjustment', price: -1 });
  });

  it('emits no tax or adjustment lines for a tax-free invoice that already adds up', () => {
    const details = buildMidtransItemDetails({ ...twoItemInvoice, tax: 0, total: 1_250_000 });
    expect(details).toHaveLength(2);
    expect(sum(details)).toBe(1_250_000);
  });

  it('truncates long names and ids to the 50 character Midtrans limit without splitting emoji', () => {
    const longName = 'A'.repeat(120);
    const emojiName = '😀'.repeat(60);
    const details = buildMidtransItemDetails({
      ...twoItemInvoice,
      items: [
        { name: longName, qty: 1, price: 1000 },
        { name: emojiName, qty: 1, price: 1000 },
      ],
      tax: 0,
      total: 2000,
    });

    expect(details[0].name).toBe('A'.repeat(50));
    expect(Array.from(details[1].name)).toHaveLength(50);
    expect(details[1].name).toBe('😀'.repeat(50));
    expect(sum(details)).toBe(2000);
  });

  it('keeps prices integral and falls back to safe defaults for malformed items', () => {
    const details = buildMidtransItemDetails({
      ...twoItemInvoice,
      items: [{ qty: 0, price: -5 }, null, { name: '  ', qty: 3, price: 10.4 }],
      tax: 0,
      total: 30,
    });
    for (const row of details) {
      expect(Number.isInteger(row.price)).toBe(true);
      expect(row.name.length).toBeGreaterThan(0);
    }
    expect(sum(details)).toBe(30);
  });
});

describe('buildStripeLineItems', () => {
  const stripeSum = (rows: ReturnType<typeof buildStripeLineItems>) =>
    rows.reduce((acc, row) => acc + row.price_data.unit_amount * row.quantity, 0);

  it('sends IDR in Stripe minor units (x100) and the sum equals the invoice total', () => {
    const rows = buildStripeLineItems(twoItemInvoice);

    expect(rows.map((row) => [row.price_data.product_data.name, row.price_data.unit_amount, row.quantity])).toEqual([
      ['Website design', 50_000_000, 2],
      ['Hosting', 25_000_000, 1],
      ['Tax', 12_500_000, 1],
    ]);
    expect(rows.every((row) => row.price_data.currency === 'idr')).toBe(true);
    expect(stripeSum(rows)).toBe(137_500_000);
  });

  it('keeps zero-decimal currencies (JPY) unmultiplied', () => {
    const rows = buildStripeLineItems({
      number: 'INV-JPY',
      currency: 'JPY',
      items: [{ name: 'Consulting', qty: 2, price: 5000 }],
      tax: 1000,
      total: 11_000,
    });
    expect(rows.map((row) => row.price_data.unit_amount)).toEqual([5000, 1000]);
    expect(stripeSum(rows)).toBe(11_000);
  });

  it('converts to cents for two-decimal currencies', () => {
    const rows = buildStripeLineItems({
      number: 'INV-USD',
      currency: 'usd',
      items: [{ name: 'Consulting', qty: 3, price: 40 }],
      tax: 12,
      total: 132,
    });
    expect(rows[0].price_data.unit_amount).toBe(4000);
    expect(rows[0].price_data.currency).toBe('usd');
    expect(stripeSum(rows)).toBe(13_200);
  });

  it('adds a positive rounding adjustment line', () => {
    const rows = buildStripeLineItems({ ...twoItemInvoice, total: 1_375_002 });
    expect(rows.at(-1)?.price_data.unit_amount).toBe(200);
    expect(stripeSum(rows)).toBe(137_500_200);
  });

  it('falls back to a single total line when the remainder is negative', () => {
    const rows = buildStripeLineItems({ ...twoItemInvoice, total: 1_374_990 });
    expect(rows).toHaveLength(1);
    expect(rows[0].price_data.product_data.name).toBe('Invoice INV-001');
    expect(stripeSum(rows)).toBe(137_499_000);
  });
});

describe('truncateText', () => {
  it('leaves short text untouched', () => {
    expect(truncateText('abc', 50)).toBe('abc');
  });
});
