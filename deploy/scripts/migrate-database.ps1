<#
.SYNOPSIS
Apply application database migrations from an uploaded VPS release.
.DESCRIPTION
Updates the live database without rebuilding images or restarting application
services. SSH may prompt for the VPS password or key passphrase. Database
credentials are read by Compose on the VPS and are not printed or copied locally.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$')][string]$Tag,
    [string]$VpsHost = '159.198.70.19',
    [string]$VpsUser = 'deploy',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [string]$SshIdentityFile,
    [string]$AppDir = '/opt/apps/enterprise-dashboard',
    [string]$StagingDir,
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser $AppDir ''
if ($StagingDir -and $StagingDir -notmatch ('^' + [regex]::Escape("$AppDir/incoming/$Tag.") + '[a-fA-F0-9]{32}$')) {
    throw 'StagingDir must be the directory printed by build-save-upload-images.ps1 for this tag'
}
$migrationScript = Get-Content -LiteralPath "$PSScriptRoot/../migrate-database.sh" -Raw
$remoteCommand = ("set -- '$AppDir' '$Tag' '$StagingDir'`n" + $migrationScript).Replace("`r`n", "`n")
$sshOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Interactive:(-not $NonInteractive))
$remote = "${VpsUser}@${VpsHost}"
Write-Host "Applying database migrations from $Tag on $remote. Application services remain running."
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    # Keep Bash syntax in stdin; Windows native argument quoting can strip nested
    # quotes when a multiline command is supplied as an SSH command argument.
    $remoteCommand | & ssh @sshOptions -T $remote "tr -d '\r' | bash -se"
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed (SSH exit code $LASTEXITCODE). Review the migration error above." }
} finally {
    $OutputEncoding = $previousEncoding
}
