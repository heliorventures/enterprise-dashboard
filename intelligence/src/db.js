const { Pool, types } = require('pg');
const config = require('./config');

types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  ...config.db,
  max: 8,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 60000,
});
pool.on('error', (error) => console.error('Intelligence DB idle client failed:', error.code));

function query(text, values = []) {
  return pool.query(text, values);
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Intelligence rollback failed:', rollbackError.code || rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  query,
  transaction,
  migrate: () => require('./migrate').migrate(pool),
  close: () => pool.end(),
  pool,
};
