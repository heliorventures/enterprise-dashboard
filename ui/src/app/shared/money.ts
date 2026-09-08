export function compactInr(value: number) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value || 0);
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function fullInr(value: number) {
  return (value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

export function drCr(value: number) {
  return value < 0 ? 'Cr' : 'Dr';
}
