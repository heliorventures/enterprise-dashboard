const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { validateSnapshot, appendRows, attachProjects } = require('../src/ingest');
after(() => db.close());

test('pre-008 upgrade backfills long identities and preserves capacity for accepted input', {
  skip: process.env.DB_NAME !== 'enterprise_dashboard_test',
}, async () => {
  const rollback = new Error('rollback ingestion migration fixture');
  await assert.rejects(db.transaction(async client => {
    await client.query('CREATE SCHEMA ingestion_integrity_fixture');
    await client.query('SET LOCAL search_path TO ingestion_integrity_fixture');
    const directory = path.join(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    await client.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)');
    for (const file of files.filter(name => name < '008')) {
      const sql = (await fs.readFile(path.join(directory, file), 'utf8')).replace(/\r\n/g, '\n');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations VALUES($1,$2)', [file, createHash('sha256').update(sql).digest('hex')]);
    }
    const name = 'L'.repeat(200), project = 'P'.repeat(200), party = 'A'.repeat(200);
    await client.query('INSERT INTO "Companies"("CompanyName","ExternalID") VALUES($1,$2)', ['Long key company', 'long-keys']);
    await client.query('INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory") VALUES(1,$1,\'Cash\')', [name]);
    await client.query('INSERT INTO "Projects"("CompanyID","ProjectName") VALUES(1,$1)', [project]);
    await client.query(`INSERT INTO "Vouchers"("CompanyID","VoucherDate","VoucherType","Amount","PartyLedgerName","Source")
      VALUES(1,'2026-09-01','Sales',12.00,$1,'tally')`, [party]);
    // Reproduce the historical capacity failure without changing deployed SQL.
    for (const file of ['008_incremental_source_keys.sql', '010_project_source_keys.sql']) {
      await client.query('SAVEPOINT old_source_key_backfill');
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      await assert.rejects(client.query(sql), { code: '22001' });
      await client.query('ROLLBACK TO SAVEPOINT old_source_key_backfill');
      await client.query('RELEASE SAVEPOINT old_source_key_backfill');
    }
    // Run the real migration owner inside the rollback-only fixture.
    const nested = { query: (sql, args) => client.query(
      sql === 'BEGIN' ? 'SAVEPOINT migration_owner' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT migration_owner'
        : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT migration_owner' : sql, args), release() {} };
    await migrate({ connect: async () => nested });
    const stored = async table => (await client.query('SELECT "SourceKey" FROM "' + table + '"')).rows[0].SourceKey;
    assert.equal(await stored('Ledgers'), 'ledger:' + name.toLowerCase());
    assert.equal(await stored('Projects'), 'project:' + project.toLowerCase());
    assert.equal(await stored('Vouchers'), 'voucher|2026-09-01|Sales||12.00|' + party);
    const input = validateSnapshot({ batchId: 'long-input', capturedAt: '2026-09-10T00:00:00Z', fullSnapshot: true,
      company: { externalId: 'long-keys', name: 'Long key company' },
      ledgers: [{ name: 'N'.repeat(200), group: 'Cash', balance: '1.00' }],
      vouchers: [{ date: '2026-09-02', type: 'T'.repeat(80), number: 'V'.repeat(80),
        amount: '9999999999999999.99', party, project }] });
    await appendRows(client, 1, input.ledgers, input.vouchers);
    await attachProjects(1, input.vouchers, [], client);
    assert.equal((await client.query('SELECT max(length("SourceKey")) AS length FROM "Vouchers"')).rows[0].length,
      input.vouchers[0].sourceKey.length);
    assert.equal((await client.query('SELECT "ProjectID" FROM "Vouchers" WHERE "VoucherDate"=\'2026-09-02\'')).rows[0].ProjectID, 1);
    await migrate({ connect: async () => nested }); // checksum adoption remains idempotent.
    throw rollback;
  }), error => error === rollback);
});
