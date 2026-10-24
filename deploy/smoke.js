// Runs inside the API container. Read-only; never imports production data.
const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('./src/db');
function request(path, hostname = '127.0.0.1', { method = 'GET', cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: Number(process.env.PORT) || 3000, path, method,
      headers: { Host: hostname, ...(cookie ? { Cookie: cookie } : {}) } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Smoke request timed out')));
    req.end();
  });
}
(async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json().ok, true);
  assert.equal((await request('/api/companies')).status, 401);
  const auth = require('./src/auth');
  auth.validateConfiguration();
  const cookie = `${auth.COOKIE}=${auth.sign(process.env.DASHBOARD_USER || 'admin')}`;
  assert.equal((await request('/api/companies', 'unconfigured.invalid', { cookie })).status, 404);
  const sites = (await db.query('SELECT id,hostname FROM dashboard_sites WHERE enabled ORDER BY hostname')).rows;
  assert.ok(sites.length, 'Configure at least one enabled dashboard website');
  for (const site of sites) {
    await db.withSite(site, async () => {
      async function checkDashboard(response, path, company = 'all') {
        const data = response.json();
        if (response.status === 422) {
          let expectedError;
          try { await require('./src/reportCurrency').reportingCurrency(company); }
          catch (error) { if (error.status !== 422) throw error; expectedError = error.message; }
          assert.equal(typeof expectedError, 'string', `${site.hostname}${path}: unexpected 422`);
          assert.equal(data.error, expectedError);
          console.log(`${site.hostname}${path}: monetary totals unavailable. ${expectedError}`);
          return false;
        }
        assert.equal(response.status, 200, `${site.hostname}${path}`);
        assert.ok(data.kpis && Array.isArray(data.companyFinancials));
        return true;
      }
      let companies = [], dashboardAvailable = true;
      for (const path of ['/api/companies', '/api/dashboard', '/api/ledgers', '/api/vouchers', '/api/imports']) {
        const response = await request(path, site.hostname, { cookie });
        if (path === '/api/dashboard') { dashboardAvailable = await checkDashboard(response, path); continue; }
        assert.equal(response.status, 200, `${site.hostname}${path}`);
        const data = response.json();
        if (path === '/api/companies') {
          companies = data;
          const expected = (await db.query(`SELECT c."CompanyID" AS id FROM dashboard_site_companies m
            JOIN "Companies" c ON c."CompanyID"=m.company_id WHERE m.site_id=$1 AND c."IsActive" ORDER BY c."CompanyID"`, [site.id])).rows;
          assert.deepEqual(companies.map(c => Number(c.id)).sort((a,b) => a-b), expected.map(c => c.id));
        }
        if (path === '/api/ledgers' || path === '/api/vouchers') assert.ok(Array.isArray(data.items) && Number.isInteger(data.total));
      }
      if (!dashboardAvailable) for (const company of companies.slice(0, 3)) {
        const path = '/api/dashboard?company=' + encodeURIComponent(company.id);
        await checkDashboard(await request(path, site.hostname, { cookie }), path, company.id);
      }
      console.log(`${site.hostname}: read-only company scope smoke checks passed (${companies.length} companies).`);
    });
  }
  for (const suffix of ['', '/source/begin', '/source/chunk', '/source/complete']) {
    assert.equal((await request('/api/ingest/tally' + suffix, 'finance.heliorsoft.com', { method: 'POST' })).status, 401);
  }
  assert.equal((await request('/api/process/tally/unpack', 'finance.heliorsoft.com', { method: 'POST' })).status, 401);
  const result = await db.query("SELECT version FROM application_schema_history WHERE version='028_dashboard_sites.sql' AND minimum_reader=28");
  assert.equal(result.rowCount, 1, 'Website access migration must be applied');
  console.log('API read-only smoke checks passed.');
})().finally(() => db.close()).catch(error => { console.error(error.message); process.exitCode = 1; });
