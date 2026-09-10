Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Get-SshOptions {
    param([int]$Port, [string]$IdentityFile, [switch]$Scp, [switch]$Interactive)
    $batchMode = if ($Interactive) { 'BatchMode=no' } else { 'BatchMode=yes' }
    $options = @('-o', $batchMode, '-o', 'ConnectTimeout=15')
    if ($Scp) { $options += @('-P', "$Port") } else { $options += @('-p', "$Port") }
    if ($IdentityFile) { $options += @('-i', $IdentityFile) }
    return $options
}

function Assert-RemoteInputs {
    param([string]$VpsHost, [string]$VpsUser, [string]$AppDir, [string]$PublicBaseUrl)
    if ($VpsHost -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$') { throw 'Invalid VPS hostname or SSH alias' }
    if ($VpsUser -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Invalid VPS user' }
    if ($AppDir -ne '/opt/apps/enterprise-dashboard') { throw 'This deployment manages only /opt/apps/enterprise-dashboard' }
    if ($PublicBaseUrl -and $PublicBaseUrl -notmatch '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$') { throw 'PublicBaseUrl must be an HTTPS origin without a trailing slash' }
}
