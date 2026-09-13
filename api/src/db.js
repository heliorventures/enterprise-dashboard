const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');
const { migrate } = require('./migrate');
// Preserve calendar dates regardless of the server timezone.
types.setTypeParser(1082, value => value);
const pool = new Pool({ ...config.db, max: 5, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, statement_timeout: 30000 });
pool.on('error', error => console.error('Idle database connection failed:', error.code));
const reads = new AsyncLocalStorage();
async function readSnapshot(work) {
  if (reads.getStore()) return work();
  const client = await pool.connect();
  const scope = { client, tail: Promise.resolve(), error: null };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await reads.run(scope, work);
    await scope.tail;
    if (scope.error) throw scope.error;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await scope.tail;
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
function query(text, values = []) {
  const scope = reads.getStore();
  if (!scope) return pool.query(text, values);
  // Parallel report sections share one transaction; serialize their SQL commands.
  const operation = scope.tail.then(() => scope.client.query(text, values));
  scope.tail = operation.catch(error => { scope.error ||= error; });
  return operation;
}
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
  query,
  readSnapshot,
  transaction, migrate: () => migrate(pool), close: () => pool.end(),
};
