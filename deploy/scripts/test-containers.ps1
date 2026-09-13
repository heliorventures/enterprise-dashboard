# Run after building enterprise-dashboard-{api,ui}:local-test and starting the
# disposable enterprise-dashboard-pg-test database on enterprise-dashboard-test-network.
# Uses only the dedicated enterprise-dashboard-test Compose project.
[CmdletBinding()]
param()
. "$PSScriptRoot/common.ps1"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$shared = Join-Path $root 'dist-images/container-test-shared'
New-Item -ItemType Directory -Path $shared -Force | Out-Null
$hash = & docker run --rm enterprise-dashboard-ui:local-test caddy hash-password --plaintext local-test-password
if ($LASTEXITCODE -ne 0) { throw 'Unable to generate test hash' }
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $shared 'api.env'), "DB_HOST=enterprise-dashboard-pg-test`nDB_PORT=5432`nDB_NAME=enterprise_dashboard_test`nDB_USER=dashboard_test`nDB_PASSWORD=local-test-only`nTALLY_INGEST_TOKEN=local-ingest-token-with-at-least-32-characters`n", $utf8)
[IO.File]::WriteAllText((Join-Path $shared 'ui.env'), "DASHBOARD_USER=tester`nDASHBOARD_PASSWORD_HASH=$($hash.Trim())`n", $utf8)
$env:APP_SHARED_DIR = $shared
$env:IMAGE_TAG = 'local-test'
$env:DOCKER_NETWORK = 'enterprise-dashboard-test-network'
$compose = @('compose', '-p', 'enterprise-dashboard-test', '-f', (Join-Path $root 'deploy/compose.yml'))
try {
    Invoke-Native docker ($compose + @('run', '--rm', '--no-deps', 'enterprise-dashboard-api', 'node', 'src/migrate.js'))
    Invoke-Native docker ($compose + @('up', '-d', '--wait', '--wait-timeout', '180'))
    Get-Content -Raw (Join-Path $root 'deploy/smoke.js') | & docker @compose exec -T enterprise-dashboard-api node
    if ($LASTEXITCODE -ne 0) { throw 'API smoke checks failed' }
    @'
const assert = require('node:assert/strict');
(async () => {
  const origin = 'http://enterprise-dashboard-ui:8080';
  assert.equal(await (await fetch(origin + '/healthz')).text(), 'enterprise-dashboard local-test');
  assert.equal((await fetch(origin + '/')).status, 200);
  assert.equal((await fetch(origin + '/api/companies')).status, 401);
  const page = await fetch(origin + '/dashboard');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<app-root>/);
  const endpoint = origin + '/api/ingest/tally';
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
  const payload = {
    batchId: 'container-test-batch', capturedAt: new Date(Date.now() - 1000).toISOString(), fullSnapshot: true,
    company: { name: 'Container Test', externalId: 'container-test-company' },
    ledgers: [{ name: 'Sales', group: 'Sales Accounts', balance: '123.45' }], vouchers: [],
  };
  for (const duplicate of [false, true]) {
    const response = await fetch(endpoint, { method: 'POST', headers: {
      Authorization: 'Bearer ' + process.env.TALLY_INGEST_TOKEN, 'Content-Type': 'application/json',
    }, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicate, duplicate);
  }
  const dashboard = await (await fetch(origin + '/api/dashboard', { headers: { Authorization: basic } })).json();
  assert.equal(dashboard.kpis.revenue, 123.45);
  console.log('Container routing, browser authentication, ingestion and retry checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
'@ | & docker @compose exec -T enterprise-dashboard-api node
    if ($LASTEXITCODE -ne 0) { throw 'Container routing checks failed' }
} finally {
    Invoke-Native docker ($compose + @('down'))
}
