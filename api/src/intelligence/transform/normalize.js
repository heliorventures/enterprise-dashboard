const { parseDate, parseDecimal, parseInteger, normalizeSpace } = require('../excel/parser');

const DATE_FIELDS = new Set(['last_payment_date', 'last_date']);
const INT_FIELDS = new Set(['credit_days']);
const DECIMAL_FIELDS = new Set([
  'bill_amount', 'paid_amount', 'last_payment_requisition_amount', 'last_payment_amount',
  'pending_bill_debit', 'pending_bill_credit',
  'age_0_1_year_debit', 'age_0_1_year_credit', 'age_1_2_year_debit', 'age_1_2_year_credit',
  'age_2_3_year_debit', 'age_2_3_year_credit', 'age_3_plus_year_debit', 'age_3_plus_year_credit',
]);

function transformValue(field, value) {
  if (value == null || value === '') return { value: null };
  if (field === 'account_name' || field === 'particulars' || field === 'gst_number' || field === 'pan_number' || field === 'msme_number') {
    return { value: normalizeSpace(value) };
  }
  if (DATE_FIELDS.has(field)) {
    const date = parseDate(value);
    if (!date) return { error: { code: 'INVALID_DATE', field, original: value } };
    return { value: date };
  }
  if (INT_FIELDS.has(field)) {
    const n = parseInteger(value);
    if (n === undefined) return { error: { code: 'INVALID_INTEGER', field, original: value } };
    return { value: n };
  }
  if (DECIMAL_FIELDS.has(field)) {
    const n = parseDecimal(value);
    if (n === undefined) return { error: { code: 'INVALID_DECIMAL', field, original: value } };
    return { value: n };
  }
  return { value };
}

function transformRow(raw, columns) {
  const mapped = {};
  const extra = {};
  const errors = [];
  for (const col of columns) {
    const original = raw[col.canonical];
    if (!col.target) {
      if (original != null && original !== '') extra[col.canonical] = original;
      continue;
    }
    const result = transformValue(col.target, original);
    if (result.error) {
      errors.push({ ...result.error, column: col.canonical, sourceRow: raw.sourceRowNumber });
      extra[col.canonical] = original;
      continue;
    }
    if (result.value != null) mapped[col.target] = result.value;
  }
  if (!mapped.account_name && mapped.particulars) mapped.account_name = mapped.particulars;
  if (!mapped.account_name && raw.Particulars) mapped.account_name = normalizeSpace(raw.Particulars);
  if (mapped.account_name && !mapped.particulars) mapped.particulars = mapped.account_name;
  mapped.extra = extra;
  return { mapped, errors };
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function netOutstanding(mapped, formula = 'pending_bill_debit - pending_bill_credit') {
  if (formula === 'bill_amount - paid_amount') return money((mapped.bill_amount || 0) - (mapped.paid_amount || 0));
  return money((mapped.pending_bill_debit || 0) - (mapped.pending_bill_credit || 0));
}

function ageingEntries(mapped, columns) {
  const buckets = [
    ['age_0_1_year', '0-1 Year'],
    ['age_1_2_year', '1-2 Year'],
    ['age_2_3_year', '2-3 Year'],
    ['age_3_plus_year', '3+ Year'],
  ];
  return buckets.map(([key, label]) => {
    const meta = columns.find((col) => col.target === `${key}_debit` || col.target === `${key}_credit`)?.ageing;
    return {
      ageing_bucket: key,
      bucket_label: meta?.label || label,
      bucket_from: meta?.from || null,
      bucket_to: meta?.to || null,
      debit_amount: mapped[`${key}_debit`] || 0,
      credit_amount: mapped[`${key}_credit`] || 0,
    };
  });
}

module.exports = { transformRow, transformValue, netOutstanding, ageingEntries, money, DECIMAL_FIELDS };
