const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74312001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const directory = path.join(__dirname, '..', 'migrations');
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
    for (const row of rows) {
      if (!files.includes(row.version)) throw new Error(`Unknown database migration: ${row.version}`);
    }
    for (const file of files) {
      const sql = (await readFile(path.join(directory, file), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = rows.find(row => row.version === file);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migration changed after application: ${file}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
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
  db.migrate().then(() => console.log('Database migrations applied.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.close());
}
