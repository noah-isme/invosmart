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

export function formatCurrency(amount: number, currency: string): string {
  const curr = SUPPORTED_CURRENCIES.find(c => c.code === currency) || SUPPORTED_CURRENCIES[0];
  
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: currency === 'IDR' || currency === 'JPY' ? 0 : 2,
    maximumFractionDigits: currency === 'IDR' || currency === 'JPY' ? 0 : 2,
  };
  
  // Amounts are typically stored in smallest unit, but for IDR it's usually the full amount.
  // Wait, if it's "divide by 100", for IDR, usually it's not divided.
  // The instruction says: "Use Intl.NumberFormat, divide by 100 (amounts stored in cents/smallest unit) - For IDR: no decimals. For others: 2 decimals."
  // Wait, if it's stored in cents, then IDR should also be divided by 100? Or maybe not. Let's just divide by 100 for all?
  // Let's divide by 100.
  const value = amount / 100;
  return new Intl.NumberFormat(curr.locale, options).format(value);
}

export function getCurrencySymbol(currency: string): string {
  const curr = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  return curr ? curr.symbol : '';
}
