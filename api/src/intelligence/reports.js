const dashboard = require('./dashboard/service');

const EXPORT_LIMIT = 10000;
const RECON_STATUSES = ['MATCHED', 'AMOUNT_MISMATCH', 'MISSING_IN_TALLY', 'MISSING_IN_SOURCE', 'PARTIALLY_MATCHED', 'COMPARISON_UNAVAILABLE'];
const EXCEPTION_STATUSES = ['OPEN', 'RESOLVED', 'REJECTED'];
const NUMERIC_FIELDS = new Set([
  'amount', 'bill_amount', 'paid_amount', 'pending_bill_debit', 'pending_bill_credit',
  'last_payment_requisition_amount', 'last_payment_amount', 'tally_amount', 'source_amount',
  'difference', 'difference_pct', 'match_score', 'credit_days', 'debit_amount', 'credit_amount',
]);

function bad(message) { return Object.assign(new Error(message), { status: 400 }); }

function keys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw bad('Unsupported request fields');
  }
}

function text(value, name, max = 200) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw bad(`${name} must be text of at most ${max} characters`);
  return value;
}

function integer(value, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
    throw bad(`${name} must be a positive integer of at most ${max}`);
  }
  return Number(value);
}

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw bad('id must be a UUID');
  return value;
}

function company(value) {
  if (value === undefined || value === '' || value === 'all') return null;
  return integer(value, 'company', null, 2147483647);
}

function status(value, kind = 'reconciliation', fallback) {
  const candidate = text(value, 'status', 50);
  if (candidate === undefined || candidate === '') return fallback;
  if (candidate === 'all') return null;
  const allowed = kind === 'exceptions' ? EXCEPTION_STATUSES : RECON_STATUSES;
  if (!allowed.includes(candidate) && !(kind === 'sync' && candidate === 'differences')) throw bad('Unsupported status');
  return candidate;
}

function filters(query, kind = 'reconciliation', extraKeys = []) {
  keys(query, ['company', 'status', 'q', 'page', 'pageSize', ...extraKeys]);
  const page = integer(query.page, 'page', 1);
  const pageSize = integer(query.pageSize, 'pageSize', 50, 500);
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw bad('page is too large');
  return {
    company: company(query.company),
    status: status(query.status, kind, kind === 'exceptions' ? 'OPEN' : undefined),
    q: text(query.q, 'q'), page, pageSize,
  };
}

function decision(body) {
  keys(body, ['status', 'comment']);
  if (!['RESOLVED', 'REJECTED'].includes(body.status)) throw bad('status must be RESOLVED or REJECTED');
  const comment = text(body.comment, 'comment', 2000);
  return { status: body.status, ...(comment !== undefined ? { comment } : {}) };
}

function cell(value, field) {
  let output = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Protect string/header cells even when an attacker prefixes a formula with whitespace.
  // PostgreSQL returns NUMERIC as text. Preserve the exact decimal only for known
  // numeric columns; text columns and formula-like numeric values remain escaped.
  const numeric = typeof value === 'number' || (NUMERIC_FIELDS.has(field) && /^-?\d+(?:\.\d+)?$/.test(output));
  if (!numeric && /^(?:[\s\u0000-\u001f]*[=+\-@]|[\t\r\n])/.test(output)) output = `'${output}`;
  return /[",\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
}

function csv(rows) {
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!headers.length) return '';
  return [headers.map(header => cell(header)).join(','), ...rows.map(row => headers.map(key => cell(row[key], key)).join(','))].join('\r\n') + '\r\n';
}

async function report(type, scope) {
  let rows;
  if (type === 'outstanding') {
    const result = await dashboard.outstanding({ ...scope, page: 1, pageSize: EXPORT_LIMIT + 1 });
    rows = result.items;
    if (result.total > EXPORT_LIMIT) throw Object.assign(new Error('Export exceeds 10,000 rows; narrow the filters'), { status: 413 });
    if (!Array.isArray(rows) || rows.length !== result.total) {
      throw Object.assign(new Error('Report changed or could not be exported completely; retry'), { status: 409 });
    }
  } else if (type === 'reconciliation') {
    rows = await dashboard.gaps({ ...scope, limit: EXPORT_LIMIT + 1 });
  } else if (type === 'exceptions') {
    rows = await dashboard.listExceptions({ ...scope, limit: EXPORT_LIMIT + 1 });
  } else if (type === 'quality') {
    rows = [await dashboard.dataQuality({ companyId: scope.companyId })];
  } else {
    throw Object.assign(new Error('Report not found'), { status: 404 });
  }
  if (rows.length > EXPORT_LIMIT) throw Object.assign(new Error('Export exceeds 10,000 rows; narrow the filters'), { status: 413 });
  return csv(rows);
}

module.exports = { bad, keys, text, integer, uuid, company, status, filters, decision, report };
