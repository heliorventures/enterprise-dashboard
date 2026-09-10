[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$')][string]$Tag,
    [string]$PublicBaseUrl = 'https://finance.heliorsoft.com',
    [string]$VpsHost = '159.198.70.19',
    [string]$VpsUser = 'deploy',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [string]$SshIdentityFile,
    [string]$AppDir = '/opt/apps/enterprise-dashboard',
    [string]$StagingDir,
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser $AppDir $PublicBaseUrl
if ($StagingDir -and $StagingDir -notmatch ('^' + [regex]::Escape("$AppDir/incoming/$Tag.") + '[a-f0-9]{32}$')) { throw 'Invalid staging directory' }
$remote = "${VpsUser}@${VpsHost}"
$sshOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Interactive:(-not $NonInteractive))
if ($StagingDir) {
    $command = "bash '$StagingDir/deploy.sh' '$AppDir' '$Tag' '$PublicBaseUrl' '$StagingDir'"
} else {
    # The target release contains its own matching helper. This also restores archived releases.
    $command = "if test -f '$AppDir/releases/$Tag/deploy.sh'; then bash '$AppDir/releases/$Tag/deploy.sh' '$AppDir' '$Tag' '$PublicBaseUrl'; else bash '$AppDir/archive/$Tag/deploy.sh' '$AppDir' '$Tag' '$PublicBaseUrl'; fi"
}
Invoke-Native ssh ($sshOptions + @($remote, $command))
