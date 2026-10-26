const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const archive = require('../src/sourceArchive');
const db = require('../src/db');
after(() => db.close());

const mib = 1024 ** 2;
test('budget configuration is finite, explicit, and large enough for one complete upload', () => {
  const { fromEnvironment } = require('../src/sourceLimits');
  assert.deepEqual(fromEnvironment({}), { maxSnapshotBytes: 1024 * mib, maxStagingBytes: 4096 * mib });
  for (const value of ['0', '-1', '1.5', '8193', '', 'unlimited']) {
    assert.throws(() => fromEnvironment({ SOURCE_SNAPSHOT_MAX_MIB: value }));
  }
  assert.throws(() => fromEnvironment({ SOURCE_SNAPSHOT_MAX_MIB: '1024', SOURCE_STAGING_MAX_MIB: '512' }));
});
function uploadClient(bytes, totalBytes = bytes) {
  const writes = [];
  return { writes, async query(sql) {
    if (sql.includes('SELECT * FROM tally_source_uploads')) return { rows: [{ bytes, manifest: {
      chunkCount: 1, collections: [{ name: 'LEDGER', status: 'success', count: 1 }],
    } }] };
    if (sql.includes('SELECT checksum')) return { rows: [] };
    if (sql.includes('sum(bytes)')) return { rows: [{ total: totalBytes }] };
    writes.push(sql); return { rows: [] };
  } };
}
const chunk = { batchId: 'large-company', index: 0, records: [{
  collection: 'LEDGER', ordinal: 0, sourceId: 'ledger-1',
  payload: { tag: 'LEDGER', attributes: {}, content: [] },
}] };

test('an authenticated company upload can continue past the former 512 MiB ceiling', async t => {
  const client = uploadClient(600 * mib);
  t.mock.method(db, 'transaction', work => work(client));
  const result = await archive.chunk(chunk);
  assert.equal(result.ok, true);
  assert.ok(client.writes.some(sql => sql.includes('INSERT INTO tally_source_chunks')));
});

test('combined active upload capacity stays bounded independently of a company snapshot', async t => {
  const client = uploadClient(0, 4096 * mib);
  t.mock.method(db, 'transaction', work => work(client));
  await assert.rejects(() => archive.chunk(chunk), error =>
    error.code === 'SOURCE_STAGING_LIMIT' && error.status === 429 && error.limitBytes === 4096 * mib);
  assert.ok(!client.writes.some(sql => sql.includes('INSERT INTO tally_source_chunks')));
});

test('configured snapshot budgets reject before chunk persistence with a structured reason', async t => {
  const before = process.env.SOURCE_SNAPSHOT_MAX_MIB;
  process.env.SOURCE_SNAPSHOT_MAX_MIB = '1';
  try {
    const client = uploadClient(mib);
    t.mock.method(db, 'transaction', work => work(client));
    await assert.rejects(() => archive.chunk(chunk), error =>
      error.code === 'SOURCE_SNAPSHOT_LIMIT' && error.status === 413 && error.limitBytes === mib);
    assert.ok(!client.writes.some(sql => sql.includes('INSERT INTO tally_source_chunks')));
  } finally {
    if (before === undefined) delete process.env.SOURCE_SNAPSHOT_MAX_MIB;
    else process.env.SOURCE_SNAPSHOT_MAX_MIB = before;
  }
});
