const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));
function knownCurrency(currency: string | null): currency is string {
  return !!currency && supportedCurrencies.has(currency) && currency !== 'XXX' && currency !== 'XTS';
}

export function compactInr(value: number | null | undefined, currency: string | null = 'INR') {
  if (value == null || !Number.isFinite(value)) return 'Not available';
  if (!knownCurrency(currency)) return 'Currency unavailable';
  if (currency !== 'INR') return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value || 0);
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  }
  return fullInr(value, currency);
}

export function fullInr(value: number | null | undefined, currency: string | null = 'INR') {
  if (value == null || !Number.isFinite(value)) return 'Not available';
  if (!knownCurrency(currency)) return 'Currency unavailable';
  return (value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function drCr(value: number) {
  return value < 0 ? 'Cr' : 'Dr';
}
