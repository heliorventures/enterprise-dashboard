const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.TALLY_INGEST_TOKEN = 'test-token-with-at-least-32-characters';
const { app } = require('../src/server');
const db = require('../src/db');
let server;
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
  const invalid = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TALLY_INGEST_TOKEN }, body: '{}',
  });
  assert.equal(invalid.status, 400);
  for (const path of ['/api/dashboard?company=oops', '/api/ledgers?page=1.5', '/api/vouchers?from=2026-02-30']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 400, path);
  }
});
