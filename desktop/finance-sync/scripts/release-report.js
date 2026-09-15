'use strict';
// Run only against a new loopback PostgreSQL cluster. Never load a repository .env.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '../..');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const pgBin = path.resolve(option('--pg-bin', 'C:/Program Files/PostgreSQL/17/bin'));
function findOpenSsl() {
  const explicit = option('--openssl-bin', '');
  if (explicit) {
    const resolved = path.resolve(explicit);
    return fs.statSync(resolved).isDirectory() ? path.join(resolved, 'openssl.exe') : resolved;
  }
  const pathValue = process.env[Object.keys(process.env).find(k => k.toLowerCase() === 'path')] || '';
  const candidates = [...pathValue.split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'openssl.exe')),
    'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error('OpenSSL is required for the isolated HTTPS test API; install Git for Windows or pass --openssl-bin');
  return found;
}
const vouchers = Number(option('--vouchers', '10000'));
if (!Number.isInteger(vouchers) || vouchers < 1000 || vouchers > 100000) throw new Error('Vouchers must be 1000..100000');
const artifacts = path.join(desktop, 'test-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const output = fs.mkdtempSync(path.join(artifacts, `release-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
const pgdata = path.join(output, 'pgdata');
const env = {};
// An allowlist excludes inherited DB/PG credentials, API URLs, tokens and Node hooks.
for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'NUMBER_OF_PROCESSORS']) {
  const source = Object.keys(process.env).find(k => k.toLowerCase() === key.toLowerCase());
  if (source) env[key] = process.env[source];
}
Object.assign(env, { DB_HOST: '127.0.0.1', DB_USER: 'finance_release_test', DB_NAME: 'enterprise_dashboard_test', DB_PASSWORD: '',
  PGHOST: '127.0.0.1', PGUSER: 'finance_release_test', PGPASSFILE: path.join(output, 'no-password-file'),
  PGSERVICEFILE: path.join(output, 'no-service-file'), READONLY_DB_TEST: '1', NODE_ENV: 'test', HOST: '127.0.0.1',
  RELEASE_TEST_DIR: output, RELEASE_TEST_PGDATA: pgdata, RELEASE_TEST_VOUCHERS: String(vouchers),
  TALLY_INGEST_TOKEN: 'RELEASE-TEST-ONLY-SYNTHETIC-TOKEN-000000', DASHBOARD_USER: 'release-test',
  DASHBOARD_PASSWORD: 'release-test-only', DASHBOARD_SESSION_SECRET: 'RELEASE-TEST-ONLY-SESSION-SECRET-000000000000' });
const report = { startedAt: new Date().toISOString(), output, synthetic: true, vouchers, stages: [], artifacts: [],
  pendingGates: ['Windows installer clean installation', 'Windows upgrade with preserved settings and history', 'Real Tally reconciliation against independent accounting totals', 'Real Tally CPU, memory, responsiveness and Stop acceptance', 'Authenticated dashboard browser acceptance'] };
console.log(`Release evidence: ${output}`);
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function run(name, exe, argv, timeoutMs = 180000, cwd = output, record = true, digestOnly = false) {
  const start = Date.now();
  const log = path.join(output, `${name}.log`);
  const fd = fs.openSync(log, 'w');
  let timedOut = false;
  let code;
  const digest = digestOnly ? crypto.createHash('sha256') : null;
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(exe, argv, { cwd, env, windowsHide: true, stdio: ['ignore', digestOnly ? 'pipe' : fd, fd] });
      if (digestOnly) child.stdout.on('data', chunk => digest.update(chunk));
      const timer = setTimeout(() => {
        timedOut = true;
        // Terminate the stage tree, including Electron workers. PostgreSQL has its own finally stop.
        const killer = spawn(path.join(env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env });
        const killTimer = setTimeout(() => { killer.kill(); child.kill(); resolve(null); }, 10000);
        killer.on('error', () => { clearTimeout(killTimer); child.kill(); resolve(null); });
        killer.on('exit', () => { clearTimeout(killTimer); resolve(null); });
      }, timeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      // Do not wait for inherited descendant handles to close (pg_ctl starts a daemon).
      child.on(digestOnly ? 'close' : 'exit', value => { clearTimeout(timer); resolve(value); });
    });
  } catch (error) {
    fs.writeSync(fd, `Unable to execute stage: ${error.message}\n`);
    code = null;
  } finally { fs.closeSync(fd); }
  const text = fs.readFileSync(log, 'utf8');
  const count = label => Number(text.match(new RegExp(`^# ${label} (\\d+)\\s*$`, 'm'))?.[1] || 0);
  const stage = { name, status: code === 0 && !timedOut ? 'passed' : 'failed', exitCode: code, timedOut, durationMs: Date.now() - start, log,
    tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), todo: count('todo') };
  if (record) { report.stages.push(stage); console.log(`${name}: ${stage.status} (${stage.durationMs} ms)`); }
  if (stage.status !== 'passed') throw new Error(`${name} failed; see ${log}`);
  return digestOnly ? digest.digest('hex') : text;
}
async function availablePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
function tests(directory) { return fs.readdirSync(directory).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(directory, f)); }
async function sourceIdentity(prefix = '') {
  const source = { head: (await run(`${prefix}git-head`, 'git', ['rev-parse', 'HEAD'], 15000, root, false)).trim(),
    status: (await run(`${prefix}git-status`, 'git', ['status', '--porcelain'], 15000, root, false)).trim() };
  source.dirty = source.status.length > 0;
  source.diffSha256 = await run(`${prefix}git-diff`, 'git', ['diff', 'HEAD', '--binary'], 30000, root, false, true);
  source.runnerSha256 = hash(__filename);
  const untracked = await run(`${prefix}git-untracked`, 'git', ['ls-files', '--others', '--exclude-standard', '-z'], 15000, root, false);
  source.untracked = untracked.split('\0').filter(Boolean).sort().map(file => ({ file, sha256: hash(path.join(root, file)) }));
  return source;
}
function artifactIdentity(file) {
  const full = path.join(desktop, 'release', file);
  return { file, bytes: fs.statSync(full).size, sha256: hash(full) };
}
async function verifyInstallerPayload() {
  const sevenZip = path.join(desktop, 'node_modules/electron-winstaller/vendor/7z.exe');
  if (!fs.existsSync(sevenZip)) throw new Error('Restore desktop dependencies: bundled 7z.exe is required for installer verification');
  const payload = path.join(output, 'installer-payload');
  const content = path.join(payload, 'content');
  fs.mkdirSync(content, { recursive: true });
  const installer = path.join(desktop, 'release', report.artifacts[0].file);
  await run('installer-extract-payload', sevenZip, ['e', '-y', installer, '$PLUGINSDIR\\app-64.7z', `-o${payload}`], 120000);
  const archive = path.join(payload, 'app-64.7z');
  if (!fs.existsSync(archive)) throw new Error('Installer has no expected x64 application payload');
  const listing = await run('installer-payload-list', sevenZip, ['l', '-slt', archive], 30000);
  const paths = listing.split(/\r?\n/).filter(line => line.startsWith('Path = ')).map(line => line.slice(7).replace(/\\/g, '/'));
  for (const expected of ['resources/app.asar', 'Helior Finance Sync.exe']) {
    if (paths.filter(p => p === expected).length !== 1) throw new Error(`Installer payload must contain exactly one ${expected}`);
  }
  await run('installer-extract-content', sevenZip, ['e', '-y', archive, 'resources/app.asar', 'Helior Finance Sync.exe', `-o${content}`], 120000);
  report.installerPayload = { compared: [], verified: false };
  for (const [file, packagedFile] of [['app.asar', 'win-unpacked/resources/app.asar'], ['Helior Finance Sync.exe', 'win-unpacked/Helior Finance Sync.exe']]) {
    const digest = hash(path.join(content, file));
    const expected = report.artifacts.find(a => a.file === packagedFile).sha256;
    if (digest !== expected) throw new Error(`Installer embeds a different ${file} than the tested unpacked package`);
    report.installerPayload.compared.push({ file, sha256: digest });
  }
  report.installerPayload.verified = true;
}
async function resetOwnedDatabase(stage) {
  // Prove the server identity before each reset, not merely its familiar test DB name.
  const verify = `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const { Client } = require(${JSON.stringify(path.join(root, 'api/node_modules/pg'))});
    const expected = path.resolve(process.env.RELEASE_TEST_PGDATA);
    assert.equal(expected, path.join(path.resolve(process.env.RELEASE_TEST_DIR), 'pgdata'));
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    assert.equal(process.env.DB_USER, 'finance_release_test');
    assert.equal(process.env.DB_NAME, 'enterprise_dashboard_test');
    assert.ok(Number(process.env.DB_PORT) > 0 && process.env.DB_PORT !== '5432');
    const client = new Client({ host: '127.0.0.1', port: Number(process.env.DB_PORT), user: 'finance_release_test', database: 'postgres', password: '', connectionTimeoutMillis: 5000 });
    (async () => {
      try {
        await client.connect();
        const actual = (await client.query('SHOW data_directory')).rows[0].data_directory;
        assert.equal(path.resolve(actual).toLowerCase(), expected.toLowerCase(), 'Refusing database reset on a different cluster');
        console.log('Verified this release run owns the PostgreSQL data directory');
      } finally { await client.end(); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  await run(`${stage}-database-identity`, process.execPath, ['-e', verify], 15000);
  const connection = ['-h', '127.0.0.1', '-p', env.DB_PORT, '-U', env.DB_USER, '-w'];
  await run(`${stage}-database-drop`, path.join(pgBin, 'dropdb.exe'), [...connection, '--if-exists', env.DB_NAME], 30000);
  await run(`${stage}-database-create`, path.join(pgBin, 'createdb.exe'), [...connection, env.DB_NAME], 30000);
}
async function main() {
  let clusterCreated = false;
  try {
    if (process.platform !== 'win32') throw new Error('This release runner requires Windows');
    const openssl = findOpenSsl();
    for (const exe of ['initdb', 'pg_ctl', 'createdb', 'dropdb']) if (!fs.existsSync(path.join(pgBin, `${exe}.exe`))) throw new Error(`Missing PostgreSQL executable: ${exe}`);
    if (fs.existsSync(pgdata)) throw new Error('Refusing to reuse an existing database cluster');
    report.version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
    report.source = await sourceIdentity();
    const packageVersion = JSON.parse(require('@electron/asar').extractFile(path.join(desktop, 'release/win-unpacked/resources/app.asar'), 'package.json')).version;
    report.packagedVersion = packageVersion;
    if (packageVersion !== report.version) throw new Error('Packaged version does not match current source version');
    for (const file of [`Helior-Finance-Sync-${packageVersion}-Setup.exe`, 'win-unpacked/resources/app.asar', 'win-unpacked/Helior Finance Sync.exe']) {
      report.artifacts.push(artifactIdentity(file));
    }
    if (!report.artifacts.length) throw new Error('Build the Windows installer before release testing');
    await run('package-verification', process.execPath, [path.join(__dirname, 'verify-package.js')]);
    await verifyInstallerPayload();
    const certificate = path.join(output, 'test-api-cert.pem');
    const privateKey = path.join(output, 'test-api-key.pem');
    await run('local-api-certificate', openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes',
      '-keyout', privateKey, '-out', certificate, '-subj', '/CN=FinanceReleaseTest',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-addext', 'basicConstraints=critical,CA:TRUE'], 30000);
    env.NODE_EXTRA_CA_CERTS = certificate;
    report.localHttps = { certificate, certificateSha256: hash(certificate), trustScope: 'child processes only via NODE_EXTRA_CA_CERTS; Windows trust store unchanged' };
    env.DB_PORT = String(await availablePort()); env.PGPORT = env.DB_PORT;
    report.database = { host: env.DB_HOST, port: Number(env.DB_PORT), name: env.DB_NAME, pgdata };
    await run('postgres-init', path.join(pgBin, 'initdb.exe'), ['-D', pgdata, '-U', env.DB_USER, '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--no-locale']);
    clusterCreated = true;
    fs.appendFileSync(path.join(pgdata, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${env.DB_PORT}\n`);
    await run('postgres-start', path.join(pgBin, 'pg_ctl.exe'), ['-D', pgdata, '-l', path.join(output, 'postgres.log'), '-w', '-t', '45', 'start'], 60000);
    await run('postgres-create-database', path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', env.DB_PORT, '-U', env.DB_USER, env.DB_NAME], 30000);
    await run('agent-desktop-tests', process.execPath, ['--test', '--test-reporter=tap', ...tests(path.join(root, 'deploy/tally-agent/test')), ...tests(path.join(desktop, 'test'))], 300000);
    report.database.fixtureIsolation = 'fresh database per API test file; cluster data_directory verified before every reset';
    const apiFiles = tests(path.join(root, 'api/test'));
    if (!apiFiles.length) throw new Error('API test file inventory is empty');
    report.apiTestFiles = apiFiles.map(file => path.relative(root, file).replace(/\\/g, '/'));
    for (const file of apiFiles) {
      const stem = `api-${path.basename(file, '.test.js')}`;
      await resetOwnedDatabase(stem);
      await run(`${stem}-tests`, process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', file], 600000);
    }
    if (report.stages.filter(s => s.name.endsWith('-tests')).some(s => s.tests === 0)) throw new Error('A required test stage reported no tests');
    const ui = path.join(root, 'ui');
    const ng = path.join(ui, 'node_modules/@angular/cli/bin/ng.js');
    const uiReportFile = path.join(output, 'dashboard-tests.json');
    await run('dashboard-tests', process.execPath, [ng, 'test', '--watch=false', '--include=src/app/pages/dashboard/dashboard.spec.ts', '--reporters=json', `--output-file=${uiReportFile}`], 600000, ui);
    const uiReport = JSON.parse(fs.readFileSync(uiReportFile, 'utf8'));
    Object.assign(report.stages.at(-1), { tests: uiReport.numTotalTests || 0, passed: uiReport.numPassedTests || 0,
      failed: uiReport.numFailedTests || 0, skipped: uiReport.numPendingTests || 0, todo: uiReport.numTodoTests || 0 });
    if (uiReport.success !== true || !uiReport.numTotalTests || uiReport.numFailedTests) throw new Error('Dashboard test report is missing successful test execution');
    await run('dashboard-build', process.execPath, [ng, 'build', '--configuration=production'], 600000, ui);
    await run('packaged-smoke', process.execPath, [path.join(__dirname, 'launch-electron.js'), path.join(__dirname, 'smoke.js'), '--packaged'], 180000);
    await run('packaged-e2e', process.execPath, [path.join(__dirname, 'launch-electron.js'), path.join(__dirname, 'release-e2e.js'), '--packaged'], 900000);
    const e2eFile = path.join(output, 'e2e-report.json');
    if (!fs.existsSync(e2eFile)) throw new Error('Packaged E2E did not produce e2e-report.json');
    report.e2eReport = e2eFile;
    const e2e = JSON.parse(fs.readFileSync(e2eFile, 'utf8'));
    report.e2eScenarios = require('./release-contract').validateE2EReport(e2e);
    const samples = Array.isArray(e2e.resourceSamples) ? e2e.resourceSamples : [];
    const peak = values => values.length ? Math.max(...values) : null;
    const sum = (processes, field) => processes.reduce((total, p) => total + (Number.isFinite(p[field]) ? p[field] : 0), 0);
    report.resources = {
      sampleCount: samples.length,
      peakObservedElectronWorkingSetKiB: peak(samples.map(s => sum(s.processes || [], 'workingSetKiB'))),
      peakObservedElectronCpuPercent: peak(samples.map(s => sum(s.processes || [], 'cpuPercent'))),
      peakObservedUtilityWorkingSetKiB: peak(samples.filter(s => s.processes?.some(p => p.type === 'Utility')).map(s => sum(s.processes.filter(p => p.type === 'Utility'), 'workingSetKiB'))),
      peakObservedUtilityCpuPercent: peak(samples.filter(s => s.processes?.some(p => p.type === 'Utility')).map(s => sum(s.processes.filter(p => p.type === 'Utility'), 'cpuPercent'))),
      notes: e2e.measurementNotes || 'Sampled Electron process observations; not production thresholds. Utility metrics may include processes besides the sync worker.'
    };
    report.finalSource = await sourceIdentity('final-');
    report.finalArtifacts = report.artifacts.map(artifact => artifactIdentity(artifact.file));
    report.inputsUnchanged = JSON.stringify(report.source) === JSON.stringify(report.finalSource) && JSON.stringify(report.artifacts) === JSON.stringify(report.finalArtifacts);
    if (!report.inputsUnchanged) throw new Error('Source or release artifacts changed during testing; rebuild as needed and rerun with unchanged inputs');
  } catch (error) { report.error = error.message; console.error(error.message); }
  finally {
    if (clusterCreated) {
      try { await run('postgres-stop', path.join(pgBin, 'pg_ctl.exe'), ['-D', pgdata, '-m', 'fast', '-w', '-t', '45', 'stop'], 60000); }
      catch (error) { report.error = [report.error, error.message].filter(Boolean).join('; '); }
    }
    report.finishedAt = new Date().toISOString();
    report.skippedTests = report.stages.reduce((n, stage) => n + stage.skipped + stage.todo, 0);
    report.automatedPassed = !report.error && report.stages.length > 0 && report.stages.every(s => s.status === 'passed') && report.skippedTests === 0;
    report.releaseApproved = false;
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'summary.md'), [
      '# Finance Sync release testing', '', `Version: ${report.version || 'unknown'}`, `Synthetic automated gates: ${report.automatedPassed ? 'PASS' : 'FAIL / INCOMPLETE'}`,
      `Skipped/todo tests: ${report.skippedTests}`, 'Release approval: PENDING manual gates', '',
      '| Stage | Result | Duration ms | Exit | Tests | Skipped/todo |', '|---|---|---:|---:|---:|---:|',
      ...report.stages.map(s => `| ${s.name} | ${s.status} | ${s.durationMs} | ${s.exitCode ?? 'none'} | ${s.tests} | ${s.skipped + s.todo} |`),
      '', ...(report.resources ? [`Observed resource samples: ${report.resources.sampleCount}; peak Electron working set: ${report.resources.peakObservedElectronWorkingSetKiB ?? 'unavailable'} KiB; peak Utility working set: ${report.resources.peakObservedUtilityWorkingSetKiB ?? 'unavailable'} KiB.`, report.resources.notes] : []),
      '', ...(report.error ? [`Error: ${report.error}`, ''] : []), '## Pending manual gates', '', ...report.pendingGates.map(g => `- [ ] ${g}`), '',
      'Logs, installer SHA-256 values and source identity are in summary.json. The database is retained for diagnostics and stopped; it contains synthetic data only.', ''
    ].join('\n'));
    console.log(`Summary: ${path.join(output, 'summary.md')}`);
    process.exitCode = report.automatedPassed ? 0 : 1;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
