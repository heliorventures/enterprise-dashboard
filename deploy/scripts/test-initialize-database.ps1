# Offline transport tests. The ssh function below prevents any network connection.
$ErrorActionPreference = 'Stop'
$global:InitializationTestCalls = 0
$global:InitializationTestExitCode = 0
$global:InitializationTestArguments = @()
$global:InitializationTestBody = ''
function global:ssh {
    $global:InitializationTestCalls++
    $global:InitializationTestArguments = @($args)
    $global:InitializationTestBody = ($input | Out-String)
    $global:LASTEXITCODE = $global:InitializationTestExitCode
}
try {
    $originalEncoding = $OutputEncoding
    & "$PSScriptRoot/initialize-database.ps1"
    if ($global:InitializationTestCalls -ne 1) { throw 'Expected one SSH connection' }
    if ($global:InitializationTestArguments -notcontains 'BatchMode=no') { throw 'SSH password prompts must be enabled' }
    if ($global:InitializationTestArguments -notcontains 'deploy@159.198.70.19') { throw 'Incorrect default target' }
    if ($global:InitializationTestBody -notmatch 'CREATE DATABASE enterprise_dashboard') { throw 'Initialization script was not streamed' }
    if ($OutputEncoding -ne $originalEncoding) { throw 'Output encoding was not restored' }
    $global:InitializationTestExitCode = 255
    $failed = $false
    try { & "$PSScriptRoot/initialize-database.ps1" } catch { $failed = $true }
    if (-not $failed) { throw 'SSH errors must propagate' }
    if ($OutputEncoding -ne $originalEncoding) { throw 'Encoding was not restored after failure' }
    $before = $global:InitializationTestCalls
    try { & "$PSScriptRoot/initialize-database.ps1" -PostgresContainer 'postgres;false' } catch {}
    if ($global:InitializationTestCalls -ne $before) { throw 'Unsafe container name reached SSH' }
    . "$PSScriptRoot/common.ps1"
    if ((Get-SshOptions 22 '') -notcontains 'BatchMode=yes') { throw 'Existing unattended deployment behavior changed' }
    Write-Host 'Offline initialization transport tests passed.'
} finally {
    Remove-Item Function:\ssh
    Remove-Variable InitializationTestCalls,InitializationTestExitCode,InitializationTestArguments,InitializationTestBody -Scope Global
}
# The simulated SSH failure is expected; do not leave its exit code on a passing test.
$global:LASTEXITCODE = 0
