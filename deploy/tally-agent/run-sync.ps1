[CmdletBinding()]
param([string]$ConfigFile = "$PSScriptRoot/config.json", [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$nodeArgs = @("$PSScriptRoot/launcher.js", $ConfigFile)
if ($DryRun) { $nodeArgs += '--dry-run' }
& $node @nodeArgs
exit $LASTEXITCODE