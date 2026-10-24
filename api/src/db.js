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
const sites = new AsyncLocalStorage();
function currentSite() { return sites.getStore(); }
function withSite(site, work) {
  if (!Number.isSafeInteger(site?.id) || site.id < 1) throw new Error('A valid dashboard site is required');
  if (reads.getStore() && reads.getStore().siteId !== site.id) {
    throw new Error('Cannot change dashboard site inside a read snapshot');
  }
  return sites.run(Object.freeze({ ...site }), work);
}
async function siteForHost(hostname) {
  const result = await pool.query(
    'SELECT id, hostname, display_name FROM dashboard_sites WHERE hostname=$1 AND enabled', [hostname]);
  return result.rows[0];
}
async function setSite(client) {
  const site = currentSite();
  const result = await client.query(`SELECT set_config('dashboard.site_id',$1,true),
    set_config('dashboard.access_mode',$2,true),
    NOT (rolsuper OR rolbypassrls) AS safe FROM pg_roles WHERE rolname=current_user`,
  [site ? String(site.id) : '', site ? 'site' : 'system']);
  if (site && result.rows[0]?.safe !== true) throw new Error('Dashboard sites require a non-superuser role without BYPASSRLS');
}
function scopedClient(client) {
  let initialized;
  return {
    async query(text, values = []) {
      // Callers may set isolation before their first statement. set_config is a
      // SELECT, so it must follow SET TRANSACTION, not precede it.
      if (/^\s*SET\s+TRANSACTION\b/i.test(text) && !initialized) return client.query(text, values);
      initialized ||= setSite(client);
      await initialized;
      return client.query(text, values);
    },
  };
}
async function readSnapshot(work) {
  if (reads.getStore()) return work();
  const client = await pool.connect();
  const scope = { client, siteId: currentSite()?.id, tail: Promise.resolve(), error: null };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await setSite(client);
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
  if (!scope) return transaction(client => client.query(text, values));
  if (scope.siteId !== currentSite()?.id) throw new Error('Dashboard site changed inside a read snapshot');
  // Parallel report sections share one transaction; serialize their SQL commands.
  const operation = scope.tail.then(() => scope.client.query(text, values));
  scope.tail = operation.catch(error => { scope.error ||= error; });
  return operation;
}
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(scopedClient(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = {
  query,
  currentSite, withSite, siteForHost,
  readSnapshot,
  transaction, migrate: () => migrate(pool), close: () => pool.end(),
};
