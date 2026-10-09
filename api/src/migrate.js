const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Preserve legacy identities while moving all execution to the core owner.
const legacyIntelligence = {
  '015_intelligence.sql': '001_intelligence.sql',
  '016_intelligence_difference_pct.sql': '002_difference_pct.sql',
  '017_intelligence_account_maps.sql': '003_account_maps.sql',
  '018_intelligence_recon_tally_only.sql': '004_recon_tally_only.sql',
};

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74312001)');
    await client.query(`CREATE TABLE IF NOT EXISTS application_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const directory = path.join(__dirname, '..', 'migrations');
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    const { rows } = await client.query('SELECT version, checksum FROM application_migrations');
    const coreTable = await client.query("SELECT to_regclass('schema_migrations') AS name");
    const previousCore = coreTable.rows[0]?.name
      ? (await client.query('SELECT version, checksum FROM schema_migrations')).rows : [];
    const legacyTable = await client.query("SELECT to_regclass('intel_schema_migrations') AS name");
    const legacy = legacyTable.rows[0]?.name
      ? (await client.query('SELECT version FROM intel_schema_migrations')).rows.map(row => row.version)
      : [];
    for (const version of legacy) {
      if (!Object.values(legacyIntelligence).includes(version)) throw new Error(`Unknown Intel database migration: ${version}`);
    }
    for (const row of rows) {
      if (!files.includes(row.version)) throw new Error(`Unknown database migration: ${row.version}`);
    }
    for (const row of previousCore) {
      if (!files.includes(row.version)) throw new Error(`Unknown legacy core migration: ${row.version}`);
    }
    // Older images validate every row in their trackers. Preserve those trackers
    // without adding new filenames they cannot recognise during container rollback.
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS intel_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const file of files) {
      const sql = (await readFile(path.join(directory, file), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = rows.find(row => row.version === file);
      const oldCore = previousCore.find(row => row.version === file);
      if (oldCore && oldCore.checksum !== checksum) throw new Error(`Legacy migration changed after application: ${file}`);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration changed after application: ${file}`);
        continue;
      }
      // Legacy migrations had no checksums. Adopt their known identities unchanged;
      // the canonical copy is checksum-protected from this transaction onward.
      if (!oldCore && !legacy.includes(legacyIntelligence[file])) await client.query(sql);
      await client.query('INSERT INTO application_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      if (file < '015' && !oldCore) {
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      }
      if (legacyIntelligence[file] && !legacy.includes(legacyIntelligence[file])) {
        await client.query('INSERT INTO intel_schema_migrations (version) VALUES ($1)', [legacyIntelligence[file]]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  const db = require('./db');
  db.migrate()
    .then(() => console.log('All database migrations completed.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.close());
}
