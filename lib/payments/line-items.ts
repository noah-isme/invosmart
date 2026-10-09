import { toStripeMinorUnit } from '@/lib/payments/money';

/**
 * Invoice line items are persisted as `{ name, qty, price }` (see
 * InvoiceItemSchema in lib/schemas.ts). Invoice amounts (price, tax, total)
 * are stored in the currency's major unit (whole rupiah for IDR). Midtrans
 * takes them as is; Stripe amounts are converted with toStripeMinorUnit, which
 * follows Stripe's own currency table (IDR is two-decimal on Stripe).
 */
type StoredInvoiceItem = { id?: unknown; name?: unknown; qty?: unknown; price?: unknown };

export type PayableInvoice = {
  items: unknown;
  tax: number;
  total: number;
  currency: string;
  number?: string;
};

type NormalizedItem = { id: string; name: string; qty: number; price: number };

/**
 * Midtrans documents `id` and `name` of an item_details entry as String(50).
 * https://docs.midtrans.com/reference/json-objects
 */
export const MIDTRANS_ITEM_FIELD_MAX_LENGTH = 50;

/** Truncate by code point so a surrogate pair is never split. */
export function truncateText(value: string, maxLength: number): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : chars.slice(0, maxLength).join('');
}

function normalizeItems(items: unknown): NormalizedItem[] {
  if (!Array.isArray(items)) return [];
  return (items as StoredInvoiceItem[]).map((item, index) => {
    const qty = typeof item?.qty === 'number' && Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1;
    const price = typeof item?.price === 'number' && Number.isFinite(item.price) && item.price >= 0
      ? item.price
      : 0;
    const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : 'Item';
    // IDs stay deterministic so a retry cannot change the provider payload.
    const id = typeof item?.id === 'string' && item.id ? item.id : `item_${index + 1}`;
    return { id, name, qty, price };
  });
}

export type MidtransItemDetail = { id: string; price: number; quantity: number; name: string };

/**
 * Build Midtrans Snap `item_details` so that
 * `sum(price * quantity) === invoice.total`.
 * Midtrans: "Subtotal (item price multiplied by quantity) of all the item
 * details needs to be exactly same as the gross_amount inside the
 * transaction_details object."
 * https://docs.midtrans.com/reference/item-details-object
 * Prices must be integers (no decimals). A negative price is a valid way to
 * express a rounding correction.
 */
export function buildMidtransItemDetails(invoice: PayableInvoice): MidtransItemDetail[] {
  const details: MidtransItemDetail[] = normalizeItems(invoice.items).map((item) => ({
    id: truncateText(item.id, MIDTRANS_ITEM_FIELD_MAX_LENGTH),
    price: Math.round(item.price),
    quantity: item.qty,
    name: truncateText(item.name, MIDTRANS_ITEM_FIELD_MAX_LENGTH),
  }));

  const tax = Math.round(invoice.tax || 0);
  if (tax !== 0) {
    details.push({ id: 'tax', price: tax, quantity: 1, name: 'Tax' });
  }

  const gross = Math.round(invoice.total);
  const sum = details.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const remainder = gross - sum;
  if (remainder !== 0) {
    details.push({ id: 'rounding_adjustment', price: remainder, quantity: 1, name: 'Rounding adjustment' });
  }
  return details;
}

export type StripeLineItem = {
  price_data: {
    currency: string;
    product_data: { name: string };
    unit_amount: number;
  };
  quantity: number;
};

/**
 * Build Stripe Checkout `line_items` whose sum equals
 * `toStripeMinorUnit(invoice.total)` (the amount_total the webhook verifies).
 * Stripe cannot take a negative unit_amount, so a negative remainder (or an
 * invoice without usable items) falls back to a single invoice-total line.
 */
export function buildStripeLineItems(invoice: PayableInvoice): StripeLineItem[] {
  const currency = invoice.currency.toUpperCase();
  const lower = currency.toLowerCase();
  const line = (name: string, unitAmount: number, quantity = 1): StripeLineItem => ({
    price_data: { currency: lower, product_data: { name }, unit_amount: unitAmount },
    quantity,
  });

  const lines = normalizeItems(invoice.items).map((item) =>
    line(item.name, toStripeMinorUnit(item.price, currency), item.qty));

  const tax = toStripeMinorUnit(invoice.tax || 0, currency);
  if (tax > 0) lines.push(line('Tax', tax));

  const expected = toStripeMinorUnit(invoice.total, currency);
  const sum = lines.reduce((acc, item) => acc + item.price_data.unit_amount * item.quantity, 0);
  const remainder = expected - sum;
  if (lines.length > 0 && remainder === 0) return lines;
  if (lines.length > 0 && remainder > 0) {
    lines.push(line('Rounding adjustment', remainder));
    return lines;
  }
  return [line(invoice.number ? `Invoice ${invoice.number}` : 'Invoice', expected)];
}
