process.env.DASHBOARD_USER = 'site-test-user';
process.env.DASHBOARD_PASSWORD = 'site-test-password';
process.env.DASHBOARD_SESSION_SECRET = 'site-test-secret-with-at-least-32-characters';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const enabled = process.env.DASHBOARD_SITE_TESTS === '1'
  && process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '58429'
  && process.env.DB_NAME === 'dashboard_sites_test' && process.env.DB_USER === 'dashboard_sites_test';
after(() => db.close());

test('real PostgreSQL enforces website companies across reads, writes and pooled work', { skip: !enabled }, async t => {
  await db.migrate();
  const a = await db.siteForHost('scfinance.heliorsoft.com');
  const b = await db.siteForHost('sbfinance.heliorsoft.com');
  assert.ok(a && b);
  const [ca, cb] = (await db.query(`INSERT INTO "Companies"("CompanyName","ExternalID")
    VALUES ('Site Test A','site-a'),('Site Test B','site-b') RETURNING "CompanyID" AS id`)).rows;
  await db.query('INSERT INTO dashboard_site_companies(site_id,company_id) VALUES($1,$2),($3,$4)', [a.id, ca.id, b.id, cb.id]);
  await db.query(`INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory","CurrentBalance")
    VALUES($1,'A ledger','Sales Accounts',100),($2,'B secret ledger','Sales Accounts',900)`, [ca.id, cb.id]);
  await db.query(`INSERT INTO tally_source_snapshots(batch_id,company_external_id,company_name,captured_at,schema_version,coverage_status,manifest)
    VALUES('site-a-batch','site-a','Site Test A',now(),1,'complete','{}'),
          ('site-b-batch','site-b','Site Test B',now(),1,'complete','{}')`);
  await db.query(`INSERT INTO tally_source_records(batch_id,collection,ordinal,payload)
    VALUES('site-a-batch','LEDGER',0,'{"name":"A"}'),('site-b-batch','LEDGER',0,'{"name":"B secret"}')`);
  const intel = (await db.query(`INSERT INTO intel_companies(name,tally_company_id)
    VALUES('Site Test A',$1),('Site Test B',$2) RETURNING id`, [ca.id, cb.id])).rows;
  const files = (await db.query(`INSERT INTO intel_import_files(company_id,file_name,stored_path,file_hash,file_size)
    VALUES($1,'a.xlsx','a','a',1),($2,'b-secret.xlsx','b','b',1) RETURNING id`, [intel[0].id, intel[1].id])).rows;
  const within = (site, fn) => db.withSite(site, fn);
  try {
    await t.test('runtime database role and every company table enforce row security', async () => {
      assert.deepEqual((await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows,
        [{ rolsuper: false, rolbypassrls: false }]);
      const unsafe = await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname NOT IN
        ('schema_migrations','application_migrations','application_schema_history','intel_schema_migrations',
        'dashboard_sites','dashboard_site_companies','intel_field_catalog') AND NOT(c.relrowsecurity AND c.relforcerowsecurity)`);
      assert.deepEqual(unsafe.rows, []);
    });
    await t.test('connections without explicit application context cannot expose data after cutover', async () => {
      const { Pool } = require('pg');
      const raw = new Pool({ host: '127.0.0.1', port: 58429, database: 'dashboard_sites_test', user: 'dashboard_sites_test' });
      try {
        assert.equal((await raw.query('SELECT * FROM "Companies"')).rowCount, 0);
        assert.equal((await raw.query('SELECT * FROM intel_import_files')).rowCount, 0);
        await assert.rejects(raw.query(`INSERT INTO "Companies"("CompanyName") VALUES('old binary')`), e => e.code === '42501');
      } finally { await raw.end(); }
    });
    await t.test('all-company totals and direct company selection stay within the site', async () => {
      const books = require('../src/books');
      assert.deepEqual((await within(a, () => require('../src/dashboardService').getCompanies())).map(c => c.CompanyID), [ca.id]);
      const result = await within(a, () => books.listLedgers({ company: 'all' }));
      assert.equal(result.total, 1);
      assert.equal(result.items[0].balance, 100);
      assert.equal((await within(a, () => books.listLedgers({ company: String(cb.id) }))).total, 0);
      assert.equal((await within(b, () => books.listLedgers({ company: 'all' }))).items[0].balance, 900);
    });
    await t.test('raw archive IDs and import UUIDs cannot bypass ownership', async () => {
      const source = require('../src/sourceReports');
      assert.equal((await within(a, () => source.archives())).total, 1);
      await assert.rejects(within(a, () => source.record({ batch: 'site-b-batch', collection: 'LEDGER', ordinal: 0 })), e => e.status === 404);
      const imports = require('../src/intelligence/imports/service');
      await assert.rejects(within(a, () => imports.getFile(files[1].id)), e => e.status === 404);
      assert.equal((await within(a, () => db.query('SELECT * FROM intel_import_files'))).rowCount, 1);
    });
    await t.test('legacy embedded duplicate metadata cannot disclose another company import', async () => {
      await db.query('UPDATE intel_import_files SET analysis=$2 WHERE id=$1', [files[0].id,
        { duplicateOf: { id: files[1].id, file_name: 'b-secret.xlsx', status: 'COMPLETED' } }]);
      const file = await within(a, () => require('../src/intelligence/imports/service').getFile(files[0].id));
      assert.equal(file.analysis.duplicateOf, null);
      assert.doesNotMatch(JSON.stringify(file), /b-secret/);
    });
    await t.test('cross-company writes are denied and valid transactions still work', async () => {
      await assert.rejects(within(a, () => db.transaction(client => client.query(
        `INSERT INTO "Ledgers"("CompanyID","LedgerName","GroupCategory") VALUES($1,'blocked','test')`, [cb.id]))), e => e.code === '42501');
      assert.equal((await within(a, () => db.query('UPDATE intel_import_files SET file_name=$1 WHERE id=$2', ['stolen', files[1].id]))).rowCount, 0);
      await within(a, () => db.transaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        assert.equal((await client.query('SELECT * FROM "Companies"')).rowCount, 1);
      }));
    });
    await t.test('concurrent sites, deferred work and unscoped ingestion never share session state', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => within(i % 2 ? a : b, async () => {
        await new Promise(resolve => setImmediate(resolve));
        return db.readSnapshot(async () => (await db.query('SELECT "CompanyID" AS id FROM "Companies"')).rows.map(r => r.id));
      })));
      results.forEach((ids, i) => assert.deepEqual(ids, [i % 2 ? ca.id : cb.id]));
      assert.equal((await db.query('SELECT * FROM "Companies"')).rowCount, 2);
    });
    await t.test('audit history follows company ownership and survives a project deletion', async () => {
      const audit = require('../src/intelligence/audit');
      await within(a, () => audit.record({ action: 'UPLOAD', entity: 'import_file', entityId: files[0].id, newValue: { name: 'A' } }));
      await within(b, () => audit.record({ action: 'UPLOAD', entity: 'import_file', entityId: files[1].id, newValue: { name: 'B secret' } }));
      assert.equal((await within(a, () => audit.list())).length, 1);
      await assert.rejects(within(a, () => audit.record({ action: 'UPLOAD', entity: 'import_file', entityId: files[1].id })), e => e.code === '42501');
      await within(a, () => db.query(`INSERT INTO intel_audit(action,entity,entity_id,old_value)
        VALUES('DELETE','project','deleted-project',$1)`, [{ company_id: intel[0].id, name: 'Removed project' }]));
      assert.equal((await within(a, () => audit.list())).length, 2);
    });
    await t.test('startup recovers interrupted syncs before a website can start another run', async () => {
      const run = (await db.query(`INSERT INTO source_sync_runs(status,triggered_by,site_id,company_total)
        VALUES('running','interrupted',$1,1) RETURNING run_id`, [a.id])).rows[0];
      await db.query(`INSERT INTO source_sync_items(run_id,company_external_id,company_name,batch_id,status)
        VALUES($1,'site-a','Site Test A','site-a-batch','running')`, [run.run_id]);
      const config = require('../src/config');
      const previous = { port: config.port, host: config.host };
      config.port = 0; config.host = '127.0.0.1';
      let server;
      try {
        server = await require('../src/server').start();
        await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
        const history = await within(a, () => require('../src/sourceSync').history());
        assert.equal(history.current, null);
        assert.equal(history.runs.find(r => r.id === run.run_id).status, 'error');
      } finally {
        Object.assign(config, previous);
        if (server) await new Promise(resolve => server.close(resolve));
      }
    });
    await t.test('HTTP sessions, direct IDs and exports enforce the selected Host', async () => {
      const { siteRequest } = require('./helpers/siteHttp');
      const { app } = require('../src/server');
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const request = (site, path, options) => siteRequest(server.address().port, site, path, options);
      try {
        const login = await request(a.hostname, '/api/auth/login', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'site-test-user', password: 'site-test-password' }) });
        assert.equal(login.status, 200);
        const cookie = login.headers['set-cookie'][0];
        assert.doesNotMatch(cookie, /Domain=/);
        const options = { headers: { Cookie: cookie.split(';')[0], 'X-Forwarded-Host': b.hostname } };
        assert.deepEqual((await request(a.hostname, '/api/companies', options)).json().map(c => +c.id), [ca.id]);
        assert.deepEqual((await request(b.hostname, '/api/companies', options)).json().map(c => +c.id), [cb.id]);
        assert.equal((await request('unknown.heliorsoft.com', '/api/companies', options)).status, 404);
        assert.equal((await request(a.hostname, `/api/imports/${files[1].id}/preview`, options)).status, 404);
        const imports = await request(a.hostname, '/api/imports', options);
        assert.equal(imports.status, 200);
        assert.doesNotMatch(imports.text(), /b-secret/);
        const csv = await request(a.hostname, '/api/imports/reports/quality.csv', options);
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'], /text\/csv/);
        assert.doesNotMatch(csv.text(), /B secret/);
        assert.equal((await request('finance.heliorsoft.com','/api/ingest/tally', { method: 'POST' })).status, 401);
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
    await t.test('membership changes and disablement take effect without restart', async () => {
      await db.query('UPDATE dashboard_site_companies SET site_id=$1 WHERE site_id=$2 AND company_id=$3', [b.id, a.id, ca.id]);
      assert.equal((await within(a, () => db.query('SELECT * FROM "Companies"'))).rowCount, 0);
      assert.equal((await within(b, () => db.query('SELECT * FROM "Companies"'))).rowCount, 2);
      assert.equal((await within(a, () => db.query('SELECT * FROM intel_audit'))).rowCount, 0);
      assert.equal((await within(b, () => db.query('SELECT * FROM intel_audit'))).rowCount, 3);
      await db.query('UPDATE dashboard_sites SET enabled=false WHERE id=$1', [b.id]);
      assert.equal(await db.siteForHost(b.hostname), undefined);
      assert.equal((await within(b, () => db.query('SELECT * FROM intel_import_files'))).rowCount, 0);
      await db.query('UPDATE dashboard_sites SET enabled=true WHERE id=$1', [b.id]);
      await db.query('UPDATE dashboard_site_companies SET site_id=$1 WHERE site_id=$2 AND company_id=$3', [a.id, b.id, ca.id]);
    });
  } finally {
    await db.query('TRUNCATE "Companies",tally_source_snapshots,intel_companies,source_sync_runs,"SyncLog" RESTART IDENTITY CASCADE');
    await db.query('UPDATE dashboard_sites SET enabled=true');
  }
});

test('site migration resolves only the six exact seed companies and rolls back mismatches', { skip: !enabled }, async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const directory = path.join(__dirname, '../migrations');
  const files = (await fs.readdir(directory)).filter(name => /^0\d\d_.*\.sql$/.test(name)).sort();
  const sql = await Promise.all(files.map(name => fs.readFile(path.join(directory, name), 'utf8')));
  const names = ['Mr. VPP (Individual)', 'SOLVIAN CONSULTANCY LLP', 'SOLVIAN INFRA AND AGRO LLP',
    'HOMECRAFT ENTERPRISES', 'SOLVIAN INFRASTRUCTURE AND PROJECTS LLP', 'SOLVIAN BUILDCON LLP'];
  async function fixture(companyNames, check) {
    const rollback = new Error('rollback isolated schema');
    try {
      await db.transaction(async client => {
        await client.query('CREATE SCHEMA dashboard_seed_rehearsal');
        await client.query('SET LOCAL search_path=dashboard_seed_rehearsal,pg_catalog');
        for (const script of sql.slice(0, -1)) await client.query(script);
        for (const name of companyNames) await client.query('INSERT INTO "Companies"("CompanyName") VALUES($1)', [name]);
        await client.query(sql.at(-1));
        await check(client);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }
  await t.test('five Group A IDs and one Buildcon ID are seeded; unrelated companies stay unmapped', async () => {
    await fixture([...names, 'Unmapped Company'], async client => {
      const rows = (await client.query(`SELECT s.hostname,count(m.company_id)::int AS companies
        FROM dashboard_sites s JOIN dashboard_site_companies m ON s.id=m.site_id GROUP BY s.hostname ORDER BY s.hostname`)).rows;
      assert.deepEqual(rows, [{ hostname: 'sbfinance.heliorsoft.com', companies: 1 }, { hostname: 'scfinance.heliorsoft.com', companies: 5 }]);
    });
  });
  await t.test('missing and ambiguous names stop the migration', async () => {
    await assert.rejects(fixture(names.slice(1), () => {}), /exactly one active company.*Mr\. VPP/);
    await assert.rejects(fixture([...names, ' HOMECRAFT ENTERPRISES '], () => {}), /exactly one active company.*HOMECRAFT/);
    assert.equal((await db.query("SELECT to_regnamespace('dashboard_seed_rehearsal') AS schema")).rows[0].schema, null);
  });
});
