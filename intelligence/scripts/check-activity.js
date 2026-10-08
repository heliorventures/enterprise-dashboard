require('dotenv').config({ path: require('path').join(__dirname, '../../api/.env'), quiet: true });
const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  const active = await c.query(`
    SELECT pid, state, wait_event_type, wait_event, left(query, 160) AS q
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
    ORDER BY state
  `);
  console.log(active.rows);
  const batches = await c.query('SELECT id, status, successful_rows, detail_rows, progress_message FROM intel_import_batches ORDER BY id DESC LIMIT 3');
  console.log('batches', batches.rows);
  const rows = await c.query('SELECT count(*) FROM intel_import_rows');
  console.log('import_rows', rows.rows[0]);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
