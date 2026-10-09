/**
 * Stripe minor units.
 *
 * Invoice amounts are stored in the currency's major unit (whole IDR rupiah,
 * dollars, ...). Stripe expects amounts in the currency's minor unit:
 * "Currencies are two-decimal currencies unless otherwise specified" and only
 * the documented zero-decimal currencies are sent without multiplication.
 * IDR is NOT zero-decimal on Stripe: Rp150,000 is `15000000`. Stripe's own
 * IDR limit confirms it: "9,999,999,999.99 IDR (`999999999999`)".
 * https://docs.stripe.com/currencies
 *
 * ISK and UGX are documented as two-decimal for charges (the decimal part is
 * always 00), so they use the default x100 as well.
 *
 * This table is Stripe-specific. Midtrans only takes whole-rupiah IDR and
 * needs no conversion.
 */
export const STRIPE_ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function stripeFactor(currency: string): number {
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

/** Invoice amount (major units) -> Stripe `unit_amount` / `amount`. */
export function toStripeMinorUnit(amount: number, currency: string): number {
  return Math.round(amount * stripeFactor(currency));
}

/** Stripe `amount_total` / `amount_refunded` -> invoice amount (major units). */
export function fromStripeMinorUnit(amount: number, currency: string): number {
  return amount / stripeFactor(currency);
}

export function isSupportedPaymentCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency.toUpperCase());
}
