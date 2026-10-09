const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile, readdir } = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { migrate } = require('../src/migrate');

const isolated = process.env.DB_NAME === 'enterprise_dashboard_test'
  && process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '58419';

test('legacy database adoption preserves financial rows, tracker identities and checksum protection', { skip: !isolated }, async () => {
  const schema = `intel_adoption_${randomUUID().replaceAll('-', '')}`;
  const connection = {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  };
  const admin = new Pool(connection);
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...connection, options: `-c search_path=${schema},public` });
    const folder = path.join(__dirname, '../migrations');
    const files = (await readdir(folder)).filter(n => /^\d+_[a-z0-9_]+\.sql$/.test(n)).sort();
    await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())');
    await pool.query('CREATE TABLE intel_schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
    const aliases = ['001_intelligence.sql','002_difference_pct.sql','003_account_maps.sql','004_recon_tally_only.sql'];
    for (const file of files.filter(n => n < '019')) {
      const sql = (await readFile(path.join(folder, file), 'utf8')).replace(/\r\n/g, '\n');
      await pool.query(sql);
      if (file < '015') {
        await pool.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [file, createHash('sha256').update(sql).digest('hex')]);
      } else {
        await pool.query('INSERT INTO intel_schema_migrations(version) VALUES($1)', [aliases[Number(file.slice(0, 3)) - 15]]);
      }
    }
    const company = (await pool.query("INSERT INTO intel_companies(name) VALUES('Retained financial history') RETURNING id")).rows[0].id;
    const account = (await pool.query("INSERT INTO intel_accounts(company_id,account_name) VALUES($1,'Retained account') RETURNING id", [company])).rows[0].id;
    await pool.query('INSERT INTO intel_outstanding(company_id,account_id,pending_bill_debit) VALUES($1,$2,123.45)', [company, account]);
    const before = (await pool.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows;
    await migrate(pool);
    assert.deepEqual((await pool.query('SELECT version,checksum,applied_at FROM schema_migrations ORDER BY version')).rows, before);
    assert.equal((await pool.query('SELECT count(*)::int n FROM intel_schema_migrations')).rows[0].n, 4);
    assert.equal((await pool.query('SELECT pending_bill_debit::text amount FROM intel_outstanding')).rows[0].amount, '123.45');
    assert.equal((await pool.query('SELECT count(*)::int n FROM application_migrations')).rows[0].n, files.length);
    await migrate(pool);
    await pool.query("UPDATE application_migrations SET checksum='changed' WHERE version='015_intelligence.sql'");
    await assert.rejects(migrate(pool), /Migration changed after application: 015_intelligence.sql/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM intel_outstanding')).rows[0].n, 1);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
