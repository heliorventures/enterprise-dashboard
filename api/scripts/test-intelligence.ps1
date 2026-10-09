# Uses only the dedicated local disposable database. Never inherits DB credentials
# from api/.env; the complete connection is explicit and restricted to loopback.
[CmdletBinding()]
param([switch]$MigrateOnly)
$ErrorActionPreference = 'Stop'
$connection = @{
    DB_HOST = '127.0.0.1'
    DB_PORT = '58419'
    DB_NAME = 'enterprise_dashboard_test'
    DB_USER = 'dashboard_test'
    DB_PASSWORD = 'isolated-intelligence-test-only'
}
$previous = @{}
foreach ($key in $connection.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $connection[$key], 'Process')
}
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & rtk proxy node src/migrate.js
    if ($LASTEXITCODE -ne 0) { throw 'Disposable test database migration failed' }
    if (-not $MigrateOnly) {
        $testFiles = @(Get-ChildItem -LiteralPath test -Filter 'intelligence*.test.js' | ForEach-Object { $_.FullName })
        $testFiles += @(Get-ChildItem -LiteralPath test/intelligence -Filter '*.test.js' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        & rtk proxy node --test --test-concurrency=1 @testFiles
        if ($LASTEXITCODE -ne 0) { throw 'Intelligence regression tests failed' }
    }
} finally {
    Pop-Location
    foreach ($key in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
    }
}
