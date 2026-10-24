const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const db = require('../src/db');
const sites = require('../src/dashboardSites');

after(() => db.close());

test('site host normalization accepts DNS hosts and rejects ambiguous authority input', () => {
  assert.equal(sites.hostname('SCFinance.heliorsoft.com:443'), 'scfinance.heliorsoft.com');
  assert.equal(sites.hostname('sbfinance.heliorsoft.com.'), 'sbfinance.heliorsoft.com');
  assert.equal(sites.hostname('localhost:4200'), 'localhost');
  for (const value of [undefined, '', 'a,b', 'https://scfinance.heliorsoft.com', 'a/b',
    'a@scfinance.heliorsoft.com', 'a..com', 'a.com:0', 'a.com:65536', ' a.com', '-a.com']) {
    assert.throws(() => sites.hostname(value), error => error.status === 400, String(value));
  }
});

test('site context is isolated across concurrent and deferred work', async () => {
  const results = await Promise.all([1, 2].map(id => db.withSite({ id }, async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.currentSite().id, id);
    return db.currentSite().id;
  })));
  assert.deepEqual(results, [1, 2]);
  assert.equal(db.currentSite(), undefined);
  for (const id of [null, undefined, 0, -1, '1', NaN]) {
    assert.throws(() => db.withSite({ id }, () => {}), /site/i);
  }
});

test('HTTP uses Host alone, denies unknown sites, and resolves changes on the next request', async () => {
  const previous = db.siteForHost;
  const configured = new Map([
    ['scfinance.heliorsoft.com', { id: 1, hostname: 'scfinance.heliorsoft.com' }],
    ['sbfinance.heliorsoft.com', { id: 2, hostname: 'sbfinance.heliorsoft.com' }],
  ]);
  db.siteForHost = async hostname => configured.get(hostname);
  const app = express();
  app.use(sites.middleware);
  app.get('/', (_req, res) => res.json({ site: db.currentSite().id }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = (host, forwarded) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.address().port}/`, {
      headers: { Host: host, ...(forwarded ? { 'X-Forwarded-Host': forwarded } : {}) },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode,
        headers: { get: name => response.headers[name] }, json: () => JSON.parse(body), text: () => body }));
    }).on('error', reject);
  });
  try {
    const a = await get('scfinance.heliorsoft.com', 'sbfinance.heliorsoft.com');
    assert.deepEqual(await a.json(), { site: 1 });
    assert.match(a.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await (await get('sbfinance.heliorsoft.com')).json(), { site: 2 });
    assert.equal((await get('unknown.heliorsoft.com', 'scfinance.heliorsoft.com')).status, 404);
    configured.delete('scfinance.heliorsoft.com');
    assert.equal((await get('scfinance.heliorsoft.com')).status, 404);
    db.siteForHost = async () => { throw new Error('database unavailable'); };
    const failure = await get('sbfinance.heliorsoft.com');
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text(), /database unavailable/);
  } finally {
    db.siteForHost = previous;
    await new Promise(resolve => server.close(resolve));
  }
});

test('shared sync run summaries contain only the visible company totals and outcomes', () => {
  const { mapRun } = require('../src/sourceSync');
  const row = { run_id: 9, status: 'error', company_total: 6, company_done: 6,
    message: 'Secret other company failed', triggered_by: 'source-complete' };
  const items = [{ item_id: 1, company_name: 'Visible', status: 'ok' }];
  const visible = db.withSite({ id: 1 }, () => mapRun(row, items));
  assert.equal(visible.companyTotal, 1);
  assert.equal(visible.companyDone, 1);
  assert.equal(visible.status, 'ok');
  assert.doesNotMatch(visible.message, /Secret|6/);
  assert.equal(mapRun(row, items).companyTotal, 6);
});
