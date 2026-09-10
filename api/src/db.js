const { Pool, types } = require('pg');
const config = require('./config');
const { migrate } = require('./migrate');
// Preserve calendar dates regardless of the server timezone.
types.setTypeParser(1082, value => value);
const pool = new Pool({ ...config.db, max: 5, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, statement_timeout: 30000 });
pool.on('error', error => console.error('Idle database connection failed:', error.code));
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = {
  query: (text, values = []) => pool.query(text, values),
  transaction, migrate: () => migrate(pool), close: () => pool.end(),
};
