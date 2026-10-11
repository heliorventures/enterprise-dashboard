import { fullInr } from '../../shared/money';

/** Imported source amounts keep an explicit unknown currency until declared. */
export function importMoney(value: unknown, currency: unknown = null): string {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'Unavailable';
  if (typeof currency === 'string' && currency) return fullInr(Number(value), currency);
  return `${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (currency unspecified)`;
}
