const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.TALLY_INGEST_TOKEN = 'test-token-with-at-least-32-characters';
process.env.DASHBOARD_USER = 'admin';
process.env.DASHBOARD_PASSWORD = 'secret-pass';
process.env.DASHBOARD_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
const { app } = require('../src/server');
const db = require('../src/db');
let server;

test('saved exports succeed independently of automatic sync validation, including retries', async () => {
  const archive = require('../src/sourceArchive');
  const sync = require('../src/sourceSync');
  const originalComplete = archive.complete, originalPromote = sync.recordBatch;
  const local = app.listen(0, '127.0.0.1');
  await new Promise(resolve => local.once('listening', resolve));
  try {
    for (const [coverageStatus, duplicate, ok, expected] of [
      ['complete', false, false, 'error'],
      ['complete', true, false, 'error'],
      ['complete', true, true, 'validated'],
      ['partial', false, true, 'blocked'],
    ]) {
      let promotions = 0;
      archive.complete = async () => ({ ok: true, batchId: 'example', coverageStatus, duplicate });
      sync.recordBatch = async () => { promotions++; return { ok }; };
      const response = await fetch(`http://127.0.0.1:${local.address().port}/api/ingest/tally/source/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TALLY_INGEST_TOKEN }, body: '{"batchId":"example"}',
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ok, true); // Archive acknowledgement remains retry-safe.
      assert.equal(result.coverageStatus, coverageStatus);
      assert.equal(result.reportingStatus, expected);
      assert.equal(promotions, coverageStatus === 'complete' ? 1 : 0);
    }
  } finally {
    archive.complete = originalComplete; sync.recordBatch = originalPromote;
    await new Promise(resolve => local.close(resolve));
  }
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
});
test('ingestion authenticates before parsing and rejects malformed authenticated payloads', async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/ingest/tally`;
  const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  assert.equal(denied.status, 401);
  for (const operation of ['begin','chunk','complete','source/begin','source/chunk','source/complete']) {
    const response=await fetch(`${url}/${operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});
    assert.equal(response.status,401);
  }
  const unpackDenied = await fetch(`http://127.0.0.1:${server.address().port}/api/process/tally/unpack`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unpackDenied.status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/tally/sync`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/tally/sync`, { method: 'POST' })).status, 401);
  const invalid = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TALLY_INGEST_TOKEN }, body: '{}',
  });
  assert.equal(invalid.status, 400);
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/dashboard?company=oops', '/api/ledgers?page=1.5', '/api/vouchers?from=2026-02-30', '/api/reports/expenses?company=oops', '/api/reports/projects?company=oops']) {
    const denied = await fetch(`${origin}${path}`);
    assert.equal(denied.status, 401, path);
  }
  const rejected = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }),
  });
  assert.equal(rejected.status, 401);
  const signedIn = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'secret-pass' }),
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie');
  assert.match(cookie, /helior_session=/);
  const cookieValue = cookie.split(';')[0];
  for (const path of ['/api/dashboard?company=oops', '/api/ledgers?page=1.5', '/api/vouchers?from=2026-02-30', '/api/reports/expenses?company=oops', '/api/reports/projects?company=oops']) {
    const response = await fetch(`${origin}${path}`, { headers: { Cookie: cookieValue } });
    assert.equal(response.status, 400, path);
  }
  const signedOut = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookieValue } });
  assert.equal(signedOut.status, 200);
  assert.match(signedOut.headers.get('set-cookie') || '', /Max-Age=0/);
});
