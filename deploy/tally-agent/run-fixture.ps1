[CmdletBinding()]
param(
    [ValidateSet('1','2')][string]$Version = '1',
    [string]$TokenEnvFile = "$PSScriptRoot/../api.env.example",
    [string]$ApiUrl = 'https://finance.heliorsoft.com',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$state = Join-Path $PSScriptRoot 'state/fixture-test'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$lock = $null
$previousToken = $env:FINANCE_FIXTURE_TOKEN
try {
    $lock = [IO.File]::Open((Join-Path $state 'agent.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    if (-not $DryRun) {
        $line = @(Get-Content -LiteralPath $TokenEnvFile | Where-Object { $_ -match '^TALLY_INGEST_TOKEN=' })
        if ($line.Count -ne 1) { throw 'Expected one TALLY_INGEST_TOKEN entry in the token env file' }
        $env:FINANCE_FIXTURE_TOKEN = $line[0].Substring('TALLY_INGEST_TOKEN='.Length).Trim()
        if ($env:FINANCE_FIXTURE_TOKEN.Length -lt 32 -or $env:FINANCE_FIXTURE_TOKEN -match 'REPLACE_WITH') { throw 'Token env file is not configured' }
    }
    $nodeArgs = @("$PSScriptRoot/fixture-runner.js", $Version, $ApiUrl)
    if ($DryRun) { $nodeArgs += '--dry-run' }
    & node @nodeArgs
    $result = $LASTEXITCODE
} finally {
    $env:FINANCE_FIXTURE_TOKEN = $previousToken
    if ($lock) { $lock.Dispose() }
}
exit $result
