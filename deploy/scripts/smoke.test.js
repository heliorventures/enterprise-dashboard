const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const db = require('../../api/src/db');
const { reportingCurrency } = require('../../api/src/reportCurrency');

const source = readFileSync(require('node:path').join(__dirname, '../smoke.js'), 'utf8');
const unknown = 'Reporting currency is unknown or unsupported. Publish a validated company snapshot with a confirmed currency basis.';
const mixed = 'Selected companies have different currencies. Choose one company to view monetary reports; no currency conversion is applied.';

async function smoke({ currencies = ['INR'], dashboardStatus = 200, dashboardError, brokenBooks = false, malformedDashboard = false, brokenCompany = false, currencyDatabaseError = false } = {}) {
  const originalQuery = db.query;
  const output = [];
  const requests = [];
  let closes = 0;
  const process = { env: { DASHBOARD_USER: 'admin' }, exitCode: 0 };
  db.query = async (_sql, values) => {
    if (currencyDatabaseError) throw new Error('Currency query failed');
    return { rows: (values[0] === 0 ? currencies : [currencies[Number(values[0]) - 1]])
      .map(currency => ({ currency, uniform_currency: currency ? 'true' : null })) };
  };
  const context = vm.createContext({
    process, URL, AbortSignal, console: { log: value => output.push(value), error: value => output.push(value) },
    require(name) {
      if (name === 'node:assert/strict') return assert;
      if (name === './src/auth') return { validateConfiguration() {}, COOKIE: 'helior_session', sign: () => 'test-token' };
      if (name === './src/reportCurrency') return { reportingCurrency };
      if (name === './src/db') return {
        query: async () => ({ rowCount: 2, rows: [] }), close: async () => { closes++; },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    fetch: async (address, options = {}) => {
      const url = new URL(address);
      requests.push(url.pathname + url.search);
      let status = 200;
      let data = {};
      if (url.pathname === '/api/health') data = { ok: true };
      else if (!options.headers?.Cookie) status = 401;
      else if (url.pathname === '/api/companies') data = currencies.map((_, i) => ({ id: String(i + 1), name: `Company ${i + 1}` }));
      else if (url.pathname === '/api/dashboard') {
        const individual = url.searchParams.get('company');
        status = individual ? (currencies[Number(individual) - 1] ? 200 : 422) : dashboardStatus;
        if (individual && brokenCompany) status = 500;
        data = status === 200 ? (malformedDashboard ? {} : { kpis: {}, companyFinancials: [] })
          : { error: individual ? unknown : dashboardError };
      } else if (url.pathname === '/api/ledgers' || url.pathname === '/api/vouchers') {
        status = brokenBooks ? 500 : 200;
        data = { items: [], total: 0 };
      }
      return { status, json: async () => data };
    },
  });
  try { await vm.runInContext(source, context, { filename: 'smoke.js' }); }
  finally { db.query = originalQuery; }
  return { code: process.exitCode, output: output.join('\n'), requests, closes };
}

test('healthy known-currency reports pass', async () => {
  const result = await smoke();
  assert.equal(result.code, 0, result.output);
  assert.equal(result.closes, 1);
});

test('confirmed unknown currency is unavailable rather than a failed deployment', async () => {
  const result = await smoke({ currencies: [null], dashboardStatus: 422, dashboardError: unknown });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /currency|unavailable/i);
  assert.ok(result.requests.includes('/api/ledgers'));
});

test('mixed-currency aggregate is unavailable and individual company reports are exercised', async () => {
  const result = await smoke({ currencies: ['USD', 'INR'], dashboardStatus: 422, dashboardError: mixed });
  assert.equal(result.code, 0, result.output);
  assert.ok(result.requests.includes('/api/dashboard?company=1'));
  assert.ok(result.requests.includes('/api/dashboard?company=2'));
});

test('unexpected or unconfirmed dashboard 422 responses still fail validation', async () => {
  for (const options of [
    { currencies: ['USD'], dashboardStatus: 422, dashboardError: unknown },
    { currencies: [null], dashboardStatus: 422, dashboardError: 'Unexpected validation error' },
  ]) {
    const result = await smoke(options);
    assert.equal(result.code, 1, result.output);
    assert.equal(result.closes, 1);
  }
});

test('dashboard failures and malformed successful responses still fail validation', async () => {
  for (const options of [{ dashboardStatus: 500 }, { malformedDashboard: true }]) {
    const result = await smoke(options);
    assert.equal(result.code, 1, result.output);
    assert.equal(result.closes, 1);
  }
});

test('expected currency unavailability cannot hide broken books endpoints', async () => {
  const result = await smoke({ currencies: [null], dashboardStatus: 422, dashboardError: unknown, brokenBooks: true });
  assert.equal(result.code, 1, result.output);
  assert.equal(result.closes, 1);
});

test('mixed aggregate cannot hide a failing company report', async () => {
  const result = await smoke({ currencies: ['USD', 'INR'], dashboardStatus: 422, dashboardError: mixed, brokenCompany: true });
  assert.equal(result.code, 1, result.output);
  assert.equal(result.closes, 1);
});

test('database errors during currency verification remain release failures', async () => {
  const result = await smoke({ currencies: [null], dashboardStatus: 422, dashboardError: unknown, currencyDatabaseError: true });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Currency query failed/);
  assert.equal(result.closes, 1);
});
