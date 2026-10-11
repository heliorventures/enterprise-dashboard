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

// The deployed 019 runner rejects unknown rows in application_migrations.
// Keep that compatibility ledger frozen, apart from deliberate breaking-schema
// guards. Every later migration belongs to the permanent forward ledger below.
const BASELINE_READER = 19;
const migrationNumber = version => Number(version.split('_')[0]);

async function migrationFiles(directory) {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort((a, b) => migrationNumber(a) - migrationNumber(b));
  const numbers = new Set();
  return Promise.all(names.map(async version => {
    const number = migrationNumber(version);
    if (!Number.isSafeInteger(number) || number < 1 || numbers.has(number)) throw new Error(`Invalid or duplicate migration number: ${version}`);
    numbers.add(number);
    const sql = (await readFile(path.join(directory, version), 'utf8')).replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    let minimumReader = null;
    if (number > BASELINE_READER) {
      const declarations = sql.match(/^-- minimum-reader:.*$/gm) || [];
      minimumReader = Number(declarations[0]?.match(/^-- minimum-reader:[ \t]*(\d+)[ \t]*$/)?.[1]);
      if (declarations.length !== 1 || !Number.isSafeInteger(minimumReader)
        || minimumReader < BASELINE_READER || minimumReader > number) {
        throw new Error(`Migration ${version} requires one valid -- minimum-reader: version declaration`);
      }
    }
    return { version, number, sql, checksum, minimumReader };
  }));
}

function validateForwardHistory(history, compatibility, files) {
  const supportedReader = Math.max(BASELINE_READER, ...files.map(file => file.number));
  const numbers = new Set();
  for (const row of history) {
    const number = migrationNumber(row.version);
    if (!/^\d+_[a-z0-9_]+\.sql$/.test(row.version) || !Number.isSafeInteger(number) || number <= BASELINE_READER
      || !/^[a-f0-9]{64}$/.test(row.checksum) || !Number.isInteger(row.minimum_reader)
      || row.minimum_reader < BASELINE_READER || row.minimum_reader > number || numbers.has(number)) {
      throw new Error(`Invalid forward migration evidence: ${row.version}`);
    }
    numbers.add(number);
    if (row.minimum_reader > supportedReader) {
      throw new Error(`Database migration ${row.version} requires application schema ${row.minimum_reader}; this image supports ${supportedReader}`);
    }
    const known = files.find(file => file.version === row.version);
    if (!known && number <= supportedReader) throw new Error(`Unknown database migration: ${row.version}`);
    if (known && row.checksum !== known.checksum) throw new Error(`Migration changed after application: ${row.version}`);
    if (known && row.minimum_reader !== known.minimumReader) throw new Error(`Migration compatibility declaration changed after application: ${row.version}`);
    if (row.minimum_reader > BASELINE_READER) {
      const guard = compatibility.find(item => item.version === row.version);
      if (!guard || guard.checksum !== row.checksum) throw new Error(`Missing or changed baseline compatibility guard: ${row.version}`);
    }
  }
  for (const row of compatibility.filter(item => migrationNumber(item.version) > BASELINE_READER)) {
    const guard = history.find(item => item.version === row.version && item.minimum_reader > BASELINE_READER);
    if (!guard || guard.checksum !== row.checksum) {
      throw new Error(`Unexpected migration in legacy compatibility tracker: ${row.version}. Preserve the evidence and review the tracking history before proceeding.`);
    }
  }
  const latestApplied = Math.max(0, ...numbers);
  for (const file of files.filter(item => item.number < latestApplied)) {
    const ledger = file.number > BASELINE_READER ? history : compatibility;
    if (!ledger.some(row => row.version === file.version)) {
      throw new Error(`Incomplete migration history: missing earlier migration ${file.version}`);
    }
  }
}

// Deployed backfill SQL must remain checksum-stable. Older databases can contain
// names longer than its varchar(200) key columns allow, before 020 can run.
// Prepare only the pending backfill's columns inside the same migration lock
// and transaction; current installations are widened by migration 020 instead.
async function prepareSourceKeyBackfill(client, file) {
  const tables = file === '008_incremental_source_keys.sql' ? ['Ledgers', 'Vouchers']
    : file === '010_project_source_keys.sql' ? ['Projects'] : [];
  for (const table of tables) {
    await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "SourceKey" text`);
    await client.query(`ALTER TABLE "${table}" ALTER COLUMN "SourceKey" TYPE text`);
  }
}

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74312001)');
    await client.query(`CREATE TABLE IF NOT EXISTS application_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS application_schema_history (
      version text PRIMARY KEY, checksum text NOT NULL,
      minimum_reader integer NOT NULL CHECK (minimum_reader >= 19),
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const directory = path.join(__dirname, '..', 'migrations');
    const files = await migrationFiles(directory);
    const names = files.map(file => file.version);
    const { rows } = await client.query('SELECT version, checksum FROM application_migrations');
    const { rows: forwardHistory } = await client.query('SELECT version, checksum, minimum_reader FROM application_schema_history');
    validateForwardHistory(forwardHistory, rows, files);
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
      if (!(migrationNumber(row.version) > BASELINE_READER) && !names.includes(row.version)) throw new Error(`Unknown database migration: ${row.version}`);
    }
    for (const row of previousCore) {
      if (!names.includes(row.version)) throw new Error(`Unknown legacy core migration: ${row.version}`);
    }
    // Older images validate every row in their trackers. Preserve those trackers
    // without adding new filenames they cannot recognise during container rollback.
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS intel_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const { version: file, number, sql, checksum, minimumReader } of files) {
      const existing = (number > BASELINE_READER ? forwardHistory : rows).find(row => row.version === file);
      const oldCore = previousCore.find(row => row.version === file);
      if (oldCore && oldCore.checksum !== checksum) throw new Error(`Legacy migration changed after application: ${file}`);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration changed after application: ${file}`);
        continue;
      }
      // Legacy migrations had no checksums. Adopt their known identities unchanged;
      // the canonical copy is checksum-protected from this transaction onward.
      if (!oldCore && !legacy.includes(legacyIntelligence[file])) {
        await prepareSourceKeyBackfill(client, file);
        await client.query(sql);
      }
      if (number > BASELINE_READER) {
        await client.query('INSERT INTO application_schema_history (version, checksum, minimum_reader) VALUES ($1, $2, $3)', [file, checksum, minimumReader]);
      }
      // A breaking migration deliberately makes pre-forward-ledger binaries fail
      // their existing unknown-migration startup guard, before serving requests.
      if (number <= BASELINE_READER || minimumReader > BASELINE_READER) {
        await client.query('INSERT INTO application_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      }
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

function migrationErrorMessage(error) {
  return error.code === 'P2101'
    ? [error.message, error.detail, error.hint].filter(Boolean).join('\n')
    : error.message;
}

module.exports = { migrate, migrationErrorMessage };

if (require.main === module) {
  const db = require('./db');
  db.migrate()
    .then(() => console.log('All database migrations completed.'))
    .catch(error => { console.error(migrationErrorMessage(error)); process.exitCode = 1; })
    .finally(() => db.close());
}
