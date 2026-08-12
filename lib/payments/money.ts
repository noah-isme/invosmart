const ZERO_DECIMAL_CURRENCIES = new Set(['IDR', 'JPY']);

export function toGatewayMinorUnit(amount: number, currency: string): number {
  const normalized = currency.toUpperCase();
  const multiplier = ZERO_DECIMAL_CURRENCIES.has(normalized) ? 1 : 100;
  return Math.round(amount * multiplier);
}

export function fromGatewayMinorUnit(amount: number, currency: string): number {
  const normalized = currency.toUpperCase();
  const divisor = ZERO_DECIMAL_CURRENCIES.has(normalized) ? 1 : 100;
  return amount / divisor;
}

export function isSupportedPaymentCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency.toUpperCase());
}
