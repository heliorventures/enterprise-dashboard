const fs = require('node:fs');
const path = require('node:path');

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intel_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const dir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM intel_schema_migrations WHERE version=$1', [file]);
    if (applied.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO intel_schema_migrations(version) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

if (require.main === module) {
  const { Pool } = require('pg');
  const config = require('./config');
  const pool = new Pool(config.db);
  migrate(pool)
    .then(() => {
      console.log('Intelligence migrations applied');
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
      return pool.end();
    });
}

module.exports = { migrate };
