// Runs inside the API container. Read-only checks; never imports production data.
const assert = require('node:assert/strict');
(async () => {
  for (const path of ['/api/health', '/api/companies', '/api/dashboard', '/api/ledgers', '/api/vouchers']) {
    const response = await fetch('http://127.0.0.1:3000' + path, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    const data = await response.json();
    if (path === '/api/health') assert.equal(data.ok, true);
    if (path === '/api/companies') assert.ok(Array.isArray(data));
    if (path === '/api/dashboard') assert.ok(data.kpis && Array.isArray(data.companyFinancials));
    if (path === '/api/ledgers' || path === '/api/vouchers') assert.ok(Array.isArray(data.items) && Number.isInteger(data.total));
  }
  const unauthorized = await fetch('http://127.0.0.1:3000/api/ingest/tally', { method: 'POST' });
  assert.equal(unauthorized.status, 401);
  console.log('API read-only smoke checks passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
