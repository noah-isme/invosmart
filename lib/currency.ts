export const SUPPORTED_CURRENCIES = [
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', locale: 'id-ID' },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', locale: 'ms-MY' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
];

export function formatCurrency(amount: number, currency = 'IDR'): string {
  const normalizedCurrency = currency.toUpperCase();
  const curr = SUPPORTED_CURRENCIES.find(c => c.code === normalizedCurrency) || SUPPORTED_CURRENCIES[0];

  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: curr.code,
    minimumFractionDigits: curr.code === 'IDR' || curr.code === 'JPY' ? 0 : 2,
    maximumFractionDigits: curr.code === 'IDR' || curr.code === 'JPY' ? 0 : 2,
  };

  // Invoice totals are stored in the displayed currency's nominal unit. Stripe and
  // other gateways perform minor-unit conversion at their integration boundary.
  return new Intl.NumberFormat(curr.locale, options).format(amount);
}

export function getCurrencySymbol(currency: string): string {
  const curr = SUPPORTED_CURRENCIES.find(c => c.code === currency.toUpperCase());
  return curr ? curr.symbol : '';
}
