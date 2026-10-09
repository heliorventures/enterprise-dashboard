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
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser $AppDir ''
$remoteCommand = @'
set -eu
app='__APP_DIR__'
tag='__TAG__'
if test -f "$app/releases/$tag/compose.yml"; then
  release="$app/releases/$tag"
elif test -f "$app/archive/$tag/compose.yml"; then
  release="$app/archive/$tag"
else
  echo "Uploaded release not found: $tag" >&2
  exit 1
fi
exec 9>"$app/.deploy.lock"
flock -n 9 || { echo 'Another setup, migration or deployment is running.' >&2; exit 1; }
export APP_SHARED_DIR="$app/shared" IMAGE_TAG="$tag"
test -s "$APP_SHARED_DIR/api.env"
docker compose -p enterprise-dashboard-migrations -f "$release/compose.yml" run --rm -T --no-deps enterprise-dashboard-api node src/migrate.js
'@
$remoteCommand = $remoteCommand.Replace('__APP_DIR__', $AppDir).Replace('__TAG__', $Tag).Replace("`r`n", "`n")
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
