[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,100}$')][string]$Tag,
    [string]$VpsHost = '159.198.70.19',
    [string]$VpsUser = 'deploy',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [string]$SshIdentityFile,
    [string]$AppDir = '/opt/apps/enterprise-dashboard',
    [string]$PublicBaseUrl = 'https://finance.heliorsoft.com',
    [ValidateSet('linux/amd64','linux/arm64')][string]$Platform = 'linux/amd64',
    [switch]$SkipUpload,
    [switch]$SkipBuild,
    [switch]$DeployAfterUpload,
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser $AppDir $PublicBaseUrl
if ($DeployAfterUpload -and ($SkipUpload -or -not $PublicBaseUrl)) { throw '-DeployAfterUpload requires upload and -PublicBaseUrl' }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$output = Join-Path $root "dist-images/$Tag"
if (-not $SkipBuild) {
    if (Test-Path $output) { throw "Local release already exists: $output. Use a new tag, -SkipBuild to upload a completed build, or deploy-on-vps.ps1 to resume an uploaded release." }
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    Invoke-Native docker @('info', '--format', '{{.ServerVersion}}')
    foreach ($role in @('api', 'ui')) {
        $image = "enterprise-dashboard-${role}:$Tag"
        Invoke-Native docker @('build', '--platform', $Platform, '--tag', $image, (Join-Path $root $role))
        Invoke-Native docker @('save', '--output', (Join-Path $output "enterprise-dashboard-$role-$Tag.tar"), $image)
    }
    foreach ($name in @('compose.yml','deploy.sh','smoke.js')) {
        # Linux helpers and checksums use LF regardless of the checkout's autocrlf setting.
        $content = [IO.File]::ReadAllText((Join-Path $root "deploy/$name")).Replace("`r`n", "`n")
        [IO.File]::WriteAllText((Join-Path $output $name), $content, (New-Object Text.UTF8Encoding($false)))
    }
    $lines = @(Get-ChildItem -LiteralPath $output -File | Sort-Object Name | ForEach-Object {
        "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
    })
    [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
} else {
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $output 'SHA256SUMS'))) {
        if ($line -notmatch '^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$') { throw 'Invalid release manifest' }
        $expectedHash = $Matches[1]
        $releaseFile = Join-Path $output $Matches[2]
        if ((Get-FileHash -LiteralPath $releaseFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw "Release file changed: $releaseFile" }
    }
}
if ($SkipUpload) { Write-Host "Built release: $output"; return }
$remote = "${VpsUser}@${VpsHost}"
$stage = "$AppDir/incoming/$Tag.$([guid]::NewGuid().ToString('N'))"
$sshOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Interactive:(-not $NonInteractive))
$scpOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Scp -Interactive:(-not $NonInteractive))
Invoke-Native ssh ($sshOptions + @($remote, "umask 077; mkdir -p '$stage'"))
foreach ($file in Get-ChildItem -LiteralPath $output -File) {
    Invoke-Native scp ($scpOptions + @($file.FullName, "${remote}:$stage/$($file.Name)"))
}
Write-Host "Uploaded verified-release inputs to $stage"
if ($DeployAfterUpload) {
    & "$PSScriptRoot/deploy-on-vps.ps1" -Tag $Tag -VpsHost $VpsHost -VpsUser $VpsUser -SshPort $SshPort -SshIdentityFile $SshIdentityFile -AppDir $AppDir -PublicBaseUrl $PublicBaseUrl -StagingDir $stage -NonInteractive:$NonInteractive
} else {
    Write-Host "Resume with deploy-on-vps.ps1 -Tag $Tag -StagingDir '$stage' -PublicBaseUrl $PublicBaseUrl (and the same SSH options)."
}
