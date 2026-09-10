[CmdletBinding()]
param([string]$ConfigFile = "$PSScriptRoot/config.json", [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$configPath = (Resolve-Path -LiteralPath $ConfigFile).Path
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$state = $settings.stateDirectory
if (-not $state) { $state = 'state' }
if (-not [IO.Path]::IsPathRooted($state)) { $state = Join-Path (Split-Path -Parent $configPath) $state }
$state = [IO.Path]::GetFullPath($state)
New-Item -ItemType Directory -Force -Path $state | Out-Null
$lock = $null
$oldLock = $env:FINANCE_AGENT_LOCKED
try {
    # The OS releases this handle after an exit/crash; no stale PID lock to delete.
    try { $lock = [IO.File]::Open((Join-Path $state 'agent.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] {
        $message = @{ at = [DateTime]::UtcNow.ToString('o'); event = 'run_skipped'; reason = 'Another run holds the state directory lock' } | ConvertTo-Json -Compress
        $logDirectory = Join-Path $state 'logs'
        New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
        $message | Set-Content -LiteralPath (Join-Path $logDirectory (([DateTime]::UtcNow.ToString('yyyyMMddTHHmmss')) + '-' + [guid]::NewGuid().ToString() + '.jsonl')) -Encoding UTF8
        Write-Output $message
        exit 2
    }
    $env:FINANCE_AGENT_LOCKED = '1'
    $nodeArgs = @("$PSScriptRoot/agent.js", $configPath)
    if ($DryRun) { $nodeArgs += '--dry-run' }
    & node @nodeArgs
    $result = $LASTEXITCODE
} finally {
    if ($lock) { $lock.Dispose() }
    $env:FINANCE_AGENT_LOCKED = $oldLock
}
exit $result
