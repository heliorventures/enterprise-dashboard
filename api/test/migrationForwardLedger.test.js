const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');

const historical = '019_intelligence_publication.sql';
const forward = '020_ingestion_integrity.sql';
const hash = sql => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

// Exercise the real migration owner with an in-memory database boundary and
// image-specific SQL inventory. This does not claim PostgreSQL execution proof.
async function fixture(sqlFiles = {
  [historical]: 'SELECT 19;',
  [forward]: '-- minimum-reader: 19\nSELECT 20;',
}) {
  const state = { application: [], forward: [], core: [], intel: [], calls: [] };
  let before;
  const client = {
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (sql === 'BEGIN') before = structuredClone({ application: state.application, forward: state.forward, core: state.core, intel: state.intel });
      if (sql === 'ROLLBACK') Object.assign(state, before);
      if (sql === 'SELECT version, checksum FROM application_migrations') return { rows: structuredClone(state.application) };
      if (sql.startsWith('SELECT version, checksum, minimum_reader FROM application_schema_history')) return { rows: structuredClone(state.forward) };
      if (sql.includes("to_regclass('schema_migrations')")) return { rows: [{ name: 'schema_migrations' }] };
      if (sql.includes("to_regclass('intel_schema_migrations')")) return { rows: [{ name: 'intel_schema_migrations' }] };
      if (sql === 'SELECT version, checksum FROM schema_migrations') return { rows: state.core };
      if (sql === 'SELECT version FROM intel_schema_migrations') return { rows: state.intel };
      if (sql.startsWith('INSERT INTO application_migrations')) state.application.push({ version: params[0], checksum: params[1] });
      if (sql.startsWith('INSERT INTO application_schema_history')) state.forward.push({ version: params[0], checksum: params[1], minimum_reader: params[2] });
      return { rows: [] };
    },
    release() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(await readFile(path.join(__dirname, '../src/migrate.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '../src'), console, process,
    require: name => name === 'node:fs/promises'
      ? { readdir: async () => Object.keys(sqlFiles), readFile: async filename => sqlFiles[path.basename(filename)] }
      : require(name),
  });
  return { ...module.exports, state, pool: { connect: async () => client }, sqlFiles };
}

function baselineStartupBoundary(state, files) {
  // Baseline 8e8f010 rejects unknown application_migrations rows before startup
  // and checks every known SQL checksum. Its image has no forward ledger reader.
  for (const row of state.application) {
    assert.ok(Object.hasOwn(files, row.version), `Unknown database migration: ${row.version}`);
    assert.equal(row.checksum, hash(files[row.version]), `Migration changed after application: ${row.version}`);
  }
}

test('forward migrations leave the baseline startup boundary unchanged and remain idempotent', async () => {
  const f = await fixture();
  await f.migrate(f.pool);
  baselineStartupBoundary(f.state, { [historical]: f.sqlFiles[historical] });
  assert.deepEqual(f.state.forward, [{ version: forward, checksum: hash(f.sqlFiles[forward]), minimum_reader: 19 }]);
  f.state.calls.length = 0;
  await f.migrate(f.pool);
  assert.equal(f.state.calls.some(call => Object.values(f.sqlFiles).includes(call.sql)), false);
});

test('compatible newer schema is accepted while an incompatible reader floor is refused atomically', async () => {
  const f = await fixture();
  await f.migrate(f.pool);
  f.state.forward.push({ version: '025_future.sql', checksum: hash('future'), minimum_reader: 19 });
  await f.migrate(f.pool);
  f.state.forward[1].minimum_reader = 25;
  await assert.rejects(f.migrate(f.pool), /requires.*25|incompatible/i);
  assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
});

test('known historical and forward SQL checksums and compatibility declarations remain strict', async () => {
  for (const table of ['application', 'forward']) {
    const f = await fixture();
    await f.migrate(f.pool);
    f.state[table][0].checksum = hash('changed');
    await assert.rejects(f.migrate(f.pool), /changed after application/i);
  }
  const f = await fixture();
  await f.migrate(f.pool);
  f.state.forward[0].minimum_reader = 20;
  await assert.rejects(f.migrate(f.pool), /compatibility.*changed|minimum.reader.*changed/i);
});

test('every forward migration needs one valid explicit compatibility declaration', async () => {
  for (const sql of ['SELECT 20;', '-- minimum-reader: 21\nSELECT 20;', '-- minimum-reader: 19\n-- minimum-reader: 19\nSELECT 20;', '-- minimum-reader: 19\n-- minimum-reader: invalid\nSELECT 20;']) {
    const f = await fixture({ [historical]: 'SELECT 19;', [forward]: sql });
    await assert.rejects(f.migrate(f.pool), /minimum.reader|compatibility/i);
    assert.equal(f.state.application.length, 0);
    assert.equal(f.state.forward.length, 0);
  }
});

test('breaking migrations leave a checksum guard that makes the baseline refuse startup', async () => {
  const breaking = '021_breaking.sql';
  const f = await fixture({ [historical]: 'SELECT 19;', [forward]: '-- minimum-reader: 19\nSELECT 20;', [breaking]: '-- minimum-reader: 20\nSELECT 21;' });
  await f.migrate(f.pool);
  assert.ok(f.state.application.some(row => row.version === breaking));
  assert.equal(f.state.application.some(row => row.version === forward), false);
  assert.throws(() => baselineStartupBoundary(f.state, { [historical]: f.sqlFiles[historical] }), /Unknown database migration/);
  await f.migrate(f.pool);
  f.state.application.find(row => row.version === breaking).checksum = hash('tampered guard');
  await assert.rejects(f.migrate(f.pool), /guard|changed after application/i);
});

test('a compatible future schema requiring a modern reader retains its baseline guard', async () => {
  const f = await fixture();
  await f.migrate(f.pool);
  const future = { version: '025_future.sql', checksum: hash('future'), minimum_reader: 20 };
  f.state.forward.push(future);
  f.state.application.push({ version: future.version, checksum: future.checksum });
  await f.migrate(f.pool);
  f.state.application.pop();
  await assert.rejects(f.migrate(f.pool), /guard/i);
});

test('unexpected forward evidence in the legacy tracker is retained and rejected', async () => {
  const f = await fixture();
  f.state.application.push({ version: forward, checksum: hash(f.sqlFiles[forward]) });
  await assert.rejects(f.migrate(f.pool), /legacy.*tracker|compatibility.*tracker/i);
  assert.equal(f.state.application[0].version, forward);
});

test('unknown legacy names and malformed or duplicate future evidence are never trusted', async () => {
  const legacy = await fixture();
  legacy.state.application.push({ version: 'unrecognized.sql', checksum: hash('unknown') });
  await assert.rejects(legacy.migrate(legacy.pool), /Unknown database migration/);
  for (const rows of [
    [{ version: '025_future.sql', checksum: 'not-a-checksum', minimum_reader: 19 }],
    [{ version: '025_future.sql', checksum: hash('future'), minimum_reader: null }],
    [{ version: '025_future.sql', checksum: hash('future'), minimum_reader: 19 }, { version: '025_other.sql', checksum: hash('other'), minimum_reader: 19 }],
  ]) {
    const f = await fixture();
    await f.migrate(f.pool);
    f.state.forward.push(...rows);
    await assert.rejects(f.migrate(f.pool), /Invalid|duplicate/i);
  }
});

test('newer applied history cannot conceal a missing earlier migration', async () => {
  const f = await fixture();
  f.state.forward.push({ version: '025_future.sql', checksum: hash('future'), minimum_reader: 19 });
  await assert.rejects(f.migrate(f.pool), /missing.*migration|incomplete.*history/i);
  assert.equal(f.state.application.length, 0);
});

test('only the controlled company-ownership error exposes database detail and hint', async () => {
  const f = await fixture();
  assert.equal(typeof f.migrationErrorMessage, 'function');
  const error = { message: 'Duplicate ownership', detail: 'Tally 7: IDs A, B', hint: 'Reconcile history' };
  assert.equal(f.migrationErrorMessage(error), 'Duplicate ownership');
  const message = f.migrationErrorMessage({ ...error, code: 'P2101' });
  assert.match(message, /Tally 7: IDs A, B/);
  assert.match(message, /Reconcile history/);
});
