const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

test('capture applies the negotiated cumulative budget and leaves no complete manifest on overflow', async t => {
  const source = require('../source-export'), { capture } = require('../source-agent');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-source-budget-'));
  const events = [];
  t.mock.method(global, 'fetch', async (_url, options) => {
    const collection = Object.keys(source.CATALOG).find(name => options.body.includes(`<TYPE>${source.CATALOG[name]}</TYPE>`));
    const records = collection === 'COMPANY' ? '<COMPANY><GUID>company</GUID><NAME>Company</NAME></COMPANY>' :
      collection === 'VOUCHER' ? `<VOUCHER><GUID>voucher</GUID><NARRATION>${'x'.repeat(6000)}</NARRATION></VOUCHER>` : '';
    return new Response(`<ENVELOPE><BODY><DATA><COLLECTION>${records}</COLLECTION></DATA></BODY></ENVELOPE>`);
  });
  try {
    await assert.rejects(() => capture({ tallyUrl: 'http://localhost:9000', requestTimeoutMs: 1000, sourceSnapshotMaxBytes: 5000 },
      { name: 'Company', externalId: 'company' }, directory, event => events.push(event)), error => error.code === 'SOURCE_SNAPSHOT_LIMIT');
    const error = events.find(e => e.event === 'source_collection_failed');
    assert.equal(error.diagnostic.limitBytes, 5000);
    assert.ok(error.diagnostic.actualBytes > 5000);
    assert.ok(!fs.existsSync(path.join(directory, 'manifest.json')));
    assert.ok(!fs.existsSync(path.join(directory, 'VOUCHER.jsonl')));
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('source negotiation uses the authenticated API budget and preserves old-server limits', async () => {
  const { negotiate } = require('../source-limits');
  const config = { apiUrl: 'https://finance.example', requestTimeoutMs: 1000 };
  const result = await negotiate(config, 'private-token', async (url, options) => {
    assert.equal(url, 'https://finance.example/api/ingest/tally/source/capabilities');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ protocol: 1, maxSnapshotBytes: 1024 ** 3 }));
  });
  assert.equal(result.sourceSnapshotMaxBytes, 1024 ** 3);
  assert.equal((await negotiate(config, 'token', async () => new Response('', { status: 404 }))).sourceSnapshotMaxBytes, 500 * 1024 ** 2);
  for (const value of [0, -1, '1024', Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(() => negotiate(config, 'token', async () => new Response(JSON.stringify({ protocol: 1, maxSnapshotBytes: value }))), /capabilit/i);
  }
  await assert.rejects(() => negotiate(config, 'token', async () => new Response('', { status: 401 })), /HTTP 401/);
  await assert.rejects(() => negotiate(config, 'token', async () => new Response('PRIVATE SERVER RESPONSE')), error =>
    /capabilit/i.test(error.message) && !error.message.includes('PRIVATE'));
  await assert.rejects(() => negotiate(config, 'token', async () => new Response('null')), /capabilit/i);
});
