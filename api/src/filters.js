function bad(message) { return Object.assign(new Error(message), { status: 400 }); }
function companyFilter(value) {
  if (value === undefined || value === '' || value === 'all') return 0;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
    throw bad('company must be a positive integer or all');
  }
  return Number(value);
}
function paging(page = 1, pageSize = 25) {
  const current = Number(page);
  const size = Number(pageSize);
  if (!Number.isSafeInteger(current) || current < 1 || !Number.isSafeInteger(size) || size < 1 || size > 5000 || !Number.isSafeInteger((current - 1) * size)) {
    throw bad('page must be a positive integer and pageSize must be between 1 and 5000');
  }
  return { size, current, offset: (current - 1) * size };
}
function optionalDate(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw bad('date must be a valid YYYY-MM-DD date');
  }
  return value;
}
module.exports = { companyFilter, paging, optionalDate };
