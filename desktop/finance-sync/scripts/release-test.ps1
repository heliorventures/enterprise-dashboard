param(
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
  [string]$OpenSslBin = '',
  [ValidateRange(1000,100000)][int]$Vouchers = 10000
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$runnerArguments = @((Join-Path $PSScriptRoot 'release-report.js'), '--pg-bin', $PgBin, '--vouchers', $Vouchers)
if ($OpenSslBin) { $runnerArguments += @('--openssl-bin', $OpenSslBin) }
& $node @runnerArguments
exit $LASTEXITCODE
