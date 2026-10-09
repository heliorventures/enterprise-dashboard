// Monetary calculations use integer cents. Only presentation ratios use Number.
function cents(value = 0) {
  if (value == null || value === '') return 0n;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Invalid decimal');
  const raw = String(value).trim().replace(/[,₹\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new TypeError('Invalid decimal');
  const fraction = match[3] || '';
  let result = BigInt(match[2]) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= '5') result += 1n;
  return match[1] === '-' ? -result : result;
}
function decimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function amount(value) { return decimal(cents(value)); }
function subtract(left, right) { return decimal(cents(left) - cents(right)); }
function sum(values) { return decimal(values.reduce((total, value) => total + cents(value), 0n)); }
function abs(value) { const n = cents(value); return n < 0n ? -n : n; }
module.exports = { cents, decimal, amount, subtract, sum, abs };
