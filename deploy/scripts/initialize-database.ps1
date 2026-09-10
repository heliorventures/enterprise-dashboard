<#
.SYNOPSIS
Run database initialization on the VPS from local PowerShell over SSH.
.DESCRIPTION
Streams the existing Bash initializer to SSH without a manual file upload or
database tunnel. SSH may prompt for a VPS password/key passphrase. Database
credentials are generated on the VPS and remain there. The SSH account must
already have Docker access and write access to /opt/apps/enterprise-dashboard.
#>
[CmdletBinding()]
param(
    [string]$VpsHost = '159.198.70.19',
    [string]$VpsUser = 'deploy',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [string]$SshIdentityFile,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')][string]$PostgresContainer = 'postgres',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')][string]$DockerNetwork = 'apps_app-network',
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser '/opt/apps/enterprise-dashboard' ''
$initializerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'initialize-database.sh'
$initializer = [IO.File]::ReadAllText($initializerPath).Replace("`r`n", "`n")
$sshOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Interactive:(-not $NonInteractive))
$remote = "${VpsUser}@${VpsHost}"
# Windows PowerShell adds CRLF to pipeline output; strip CR on the remote side.
# Both environment values are constrained to shell-safe container/network names.
$remoteCommand = "tr -d '\r' | env POSTGRES_CONTAINER='$PostgresContainer' DOCKER_NETWORK='$DockerNetwork' bash -se"
Write-Host "Initializing enterprise_dashboard through SSH on $remote. Credentials remain on the VPS."
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    $initializer | & ssh @sshOptions -T $remote $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw "Remote database initialization failed (SSH exit code $LASTEXITCODE). Review the output before retrying." }
} finally {
    $OutputEncoding = $previousEncoding
}
Write-Host 'Initialization completed. The VPS stores the API credentials in /opt/apps/enterprise-dashboard/shared/api.env.'
