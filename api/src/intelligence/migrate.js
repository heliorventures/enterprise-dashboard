const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS intel_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const directory = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await db.query('SELECT 1 FROM intel_schema_migrations WHERE version=$1', [file]);
    if (applied.rowCount) continue;
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO intel_schema_migrations(version) VALUES ($1)', [file]);
    });
  }
}

module.exports = { migrate };
