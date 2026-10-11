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
$resolver = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../resolve-release.sh'))
$remoteScript = ("set -- '$AppDir' '$Tag' '$PublicBaseUrl' '$StagingDir'`n" + $resolver).Replace("`r`n", "`n")
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    $remoteScript | & ssh @sshOptions -T $remote "tr -d '\r' | bash -se"
    if ($LASTEXITCODE -ne 0) { throw "Deployment failed (SSH exit code $LASTEXITCODE). Review the error above." }
} finally {
    $OutputEncoding = $previousEncoding
}
