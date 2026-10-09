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

function totalLineName(invoice: PayableInvoice): string {
  return invoice.number ? `Invoice ${invoice.number}` : 'Invoice';
}

/**
 * Build Midtrans Snap `item_details` so that
 * `sum(price * quantity) === invoice.total`.
 * Midtrans: "Subtotal (item price multiplied by quantity) of all the item
 * details needs to be exactly same as the gross_amount inside the
 * transaction_details object."
 * https://docs.midtrans.com/reference/item-details-object
 * Prices must be integers (no decimals).
 *
 * Items with a zero price are dropped. A validated invoice always has
 * total = sum(items) + tax, so any other result (legacy or hand-edited rows,
 * no priced items) falls back to one "Invoice <number>" line for the total
 * instead of inventing a correction line.
 */
export function buildMidtransItemDetails(invoice: PayableInvoice): MidtransItemDetail[] {
  const gross = Math.round(invoice.total);
  const single: MidtransItemDetail[] = [{
    id: 'invoice',
    price: gross,
    quantity: 1,
    name: truncateText(totalLineName(invoice), MIDTRANS_ITEM_FIELD_MAX_LENGTH),
  }];

  const details: MidtransItemDetail[] = normalizeItems(invoice.items)
    .filter((item) => Math.round(item.price) > 0)
    .map((item) => ({
      id: truncateText(item.id, MIDTRANS_ITEM_FIELD_MAX_LENGTH),
      price: Math.round(item.price),
      quantity: item.qty,
      name: truncateText(item.name, MIDTRANS_ITEM_FIELD_MAX_LENGTH),
    }));
  if (details.length === 0) return single;

  const tax = Math.round(invoice.tax || 0);
  if (tax > 0) details.push({ id: 'tax', price: tax, quantity: 1, name: 'Tax' });

  const sum = details.reduce((acc, item) => acc + item.price * item.quantity, 0);
  return sum === gross ? details : single;
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
 * Zero-priced items are dropped; if the lines do not add up to the total (or
 * no priced item remains) a single "Invoice <number>" total line is sent.
 */
export function buildStripeLineItems(invoice: PayableInvoice): StripeLineItem[] {
  const currency = invoice.currency.toUpperCase();
  const lower = currency.toLowerCase();
  const line = (name: string, unitAmount: number, quantity = 1): StripeLineItem => ({
    price_data: { currency: lower, product_data: { name }, unit_amount: unitAmount },
    quantity,
  });
  const expected = toStripeMinorUnit(invoice.total, currency);
  const single = [line(totalLineName(invoice), expected)];

  const lines = normalizeItems(invoice.items)
    .map((item) => line(item.name, toStripeMinorUnit(item.price, currency), item.qty))
    .filter((item) => item.price_data.unit_amount > 0);
  if (lines.length === 0) return single;

  const tax = toStripeMinorUnit(invoice.tax || 0, currency);
  if (tax > 0) lines.push(line('Tax', tax));

  const sum = lines.reduce((acc, item) => acc + item.price_data.unit_amount * item.quantity, 0);
  return sum === expected ? lines : single;
}
