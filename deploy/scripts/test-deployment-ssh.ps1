# Offline tests: replace SSH/SCP/Docker so no server or image operation can occur.
$ErrorActionPreference = 'Stop'
$global:DeploymentSshTestCalls = @()
function global:ssh {
    $global:DeploymentSshTestCalls += ,@($args)
    $global:LASTEXITCODE = 0
}
function global:scp {
    $global:DeploymentSshTestCalls += ,@($args)
    $global:LASTEXITCODE = 0
}
function global:docker { throw 'SkipBuild must not invoke Docker' }
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tag = 'ssh-test-' + [guid]::NewGuid().ToString('N')
$fixture = [IO.Path]::GetFullPath((Join-Path $repoRoot "dist-images/$tag"))
try {
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'test.tar'), 'fixture')
    $hash = (Get-FileHash -LiteralPath (Join-Path $fixture 'test.tar') -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $fixture 'SHA256SUMS'), "$hash  test.tar`n")
    foreach ($unattended in @($false, $true)) {
        $global:DeploymentSshTestCalls = @()
        $options = @{}
        if ($unattended) { $options.NonInteractive = $true }
        & "$PSScriptRoot/build-save-upload-images.ps1" -Tag $tag -SkipBuild -DeployAfterUpload @options
        if ($global:DeploymentSshTestCalls.Count -ne 4) { throw 'Expected mkdir, two uploads and deploy SSH calls' }
        $expected = if ($unattended) { 'BatchMode=yes' } else { 'BatchMode=no' }
        foreach ($call in $global:DeploymentSshTestCalls) {
            if ($call -notcontains $expected) { throw "Expected $expected throughout upload/deployment" }
        }
        & "$PSScriptRoot/deploy-on-vps.ps1" -Tag $tag @options
        if ($global:DeploymentSshTestCalls[-1] -notcontains $expected) { throw 'Standalone deployment authentication differs' }
    }
    Write-Host 'Offline deployment SSH tests passed: interactive defaults, unattended mode, forwarding, and no rebuild.'
} finally {
    Remove-Item Function:\ssh,Function:\scp,Function:\docker
    Remove-Variable DeploymentSshTestCalls -Scope Global
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist-images')) + '\'
    if (-not $fixture.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
$global:LASTEXITCODE = 0
