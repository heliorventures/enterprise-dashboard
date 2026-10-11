// Runs inside the API container. Read-only checks; never imports production data.
const assert = require('node:assert/strict');
const db = require('./src/db');
(async () => {
  const origin = 'http://127.0.0.1:3000';
  async function dashboard(response, path, company = 'all') {
    const data = await response.json();
    if (response.status === 422) {
      // Verify against this image's actual currency policy and current database.
      // An arbitrary 422 or database failure must still reject the release.
      let expectedError;
      try { await require('./src/reportCurrency').reportingCurrency(company); }
      catch (error) {
        if (error.status !== 422) throw error;
        expectedError = error.message;
      }
      assert.equal(typeof expectedError, 'string', `${path}: unexpected 422 for a supported currency basis`);
      assert.equal(data.error, expectedError, `${path}: unexpected validation response`);
      console.log(`${path}: monetary totals unavailable. ${expectedError}`);
      return false;
    }
    assert.equal(response.status, 200, path);
    assert.ok(data.kpis && Array.isArray(data.companyFinancials), `${path}: invalid dashboard contract`);
    return true;
  }
  const health = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal((await fetch(origin + '/api/companies')).status, 401);
  // Runs inside the trusted container. Read-only smoke requests use a signed
  // session without retaining or recovering the administrator's plaintext password.
  const auth = require('./src/auth');
  auth.validateConfiguration();
  const cookie = `${auth.COOKIE}=${auth.sign(process.env.DASHBOARD_USER || 'admin')}`;
  assert.match(cookie, /helior_session=/);
  const headers = { Cookie: cookie };
  let companies = [];
  let dashboardAvailable = true;
  for (const path of ['/api/companies', '/api/dashboard', '/api/ledgers', '/api/vouchers', '/api/imports']) {
    const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(10000) });
    if (path === '/api/dashboard') {
      dashboardAvailable = await dashboard(response, path);
      continue;
    }
    assert.equal(response.status, 200, path);
    const data = await response.json();
    if (path === '/api/companies') {
      assert.ok(Array.isArray(data));
      companies = data;
    }
    if (path === '/api/ledgers' || path === '/api/vouchers') assert.ok(Array.isArray(data.items) && Number.isInteger(data.total));
  }
  // A mixed-currency aggregate must not hide a broken company-specific report.
  // Bound the probe count so deployment duration does not grow with tenant count.
  if (!dashboardAvailable) for (const company of companies.slice(0, 3)) {
    assert.match(String(company.id), /^[1-9][0-9]*$/, 'Invalid company identity');
    const path = '/api/dashboard?company=' + encodeURIComponent(company.id);
    await dashboard(await fetch(origin + path, { headers, signal: AbortSignal.timeout(10000) }), path, company.id);
  }
  for (const suffix of ['', '/source/begin', '/source/chunk', '/source/complete']) {
    const unauthorized = await fetch(origin + '/api/ingest/tally' + suffix, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
  }
  const unpackUnauthorized = await fetch(origin + '/api/process/tally/unpack', { method: 'POST' });
  assert.equal(unpackUnauthorized.status, 401);
  const result = await db.query("SELECT version FROM schema_migrations WHERE version IN ('004_tally_source_archive.sql','010_project_source_keys.sql')");
  assert.equal(result.rowCount, 2, 'Source archive and project key migrations must be applied');
  await db.query('SELECT 1 FROM tally_source_latest LIMIT 0');
  await db.query('SELECT 1 FROM tally_source_records LIMIT 0');
  console.log('API read-only smoke checks passed.');
})().finally(() => db.close()).catch((error) => { console.error(error.message); process.exitCode = 1; });
