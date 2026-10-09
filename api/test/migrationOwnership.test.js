const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { migrate } = require('../src/migrate');

async function fixture(legacy = ['001_intelligence.sql', '002_difference_pct.sql', '003_account_maps.sql', '004_recon_tally_only.sql']) {
  const directory = path.join(__dirname, '../migrations');
  const files = (await readdir(directory)).filter(n => /^\d+_[a-z0-9_]+\.sql$/.test(n)).sort();
  const core = await Promise.all(files.filter(n => n < '015').map(async version => ({
    version, checksum: createHash('sha256').update((await readFile(path.join(directory, version), 'utf8')).replace(/\r\n/g, '\n')).digest('hex'),
  })));
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql === 'SELECT version, checksum FROM application_migrations') return { rows: [] };
    if (sql.includes("to_regclass('schema_migrations')")) return { rows: [{ name: 'schema_migrations' }] };
    if (sql === 'SELECT version, checksum FROM schema_migrations') return { rows: core };
    if (sql.includes("to_regclass('intel_schema_migrations')")) return { rows: [{ name: 'intel_schema_migrations' }] };
    if (sql.includes('SELECT version FROM intel_schema_migrations')) return { rows: legacy.map(version => ({ version })) };
    return { rows: [] };
  }, release() { calls.push({ sql: 'RELEASE' }); } };
  return { pool: { connect: async () => client }, calls };
}

test('existing Intel identities are adopted into the checksum owner without executing their DDL again', async () => {
  const { pool, calls } = await fixture();
  await migrate(pool);
  assert.equal(calls.some(c => c.sql.includes('CREATE TABLE IF NOT EXISTS intel_companies')), false);
  const versions = calls.filter(c => c.sql.startsWith('INSERT INTO application_migrations')).map(c => c.params[0]);
  for (const version of ['015_intelligence.sql','016_intelligence_difference_pct.sql','017_intelligence_account_maps.sql','018_intelligence_recon_tally_only.sql']) {
    assert.ok(versions.includes(version));
  }
  assert.ok(calls.findIndex(c => c.sql.includes('pg_advisory_xact_lock')) < calls.findIndex(c => c.sql.includes('intel_schema_migrations')));
  assert.deepEqual(calls.slice(-2).map(c => c.sql), ['COMMIT', 'RELEASE']);
  assert.equal(calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations')), false,
    'old images must not see unknown new identities during a rollback');
});

test('unknown legacy migration is rejected atomically rather than guessing its schema', async () => {
  const { pool, calls } = await fixture(['999_unknown.sql']);
  await assert.rejects(migrate(pool), /Unknown.*Intel.*migration/i);
  assert.deepEqual(calls.slice(-2).map(c => c.sql), ['ROLLBACK', 'RELEASE']);
});
