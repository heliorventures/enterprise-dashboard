[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,60}$')][string]$Tag = ('tally-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
    [ValidatePattern('^22\.\d+\.\d+$')][string]$NodeVersion = '22.23.2'
)
$ErrorActionPreference = 'Stop'
$agentSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'tally-agent'
$outputRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'bundles'
$release = Join-Path $outputRoot $Tag
$package = Join-Path $release 'FinanceTallyAgent'
if (Test-Path -LiteralPath $release) { throw 'Bundle tag already exists; use a new tag' }
New-Item -ItemType Directory -Path $package -Force | Out-Null
$previousProgress = $ProgressPreference
$ProgressPreference = 'SilentlyContinue'
try {
    $archiveName = "node-v$NodeVersion-win-x64.zip"
    $baseUrl = "https://nodejs.org/dist/v$NodeVersion"
    $archivePath = Join-Path $release $archiveName
    $manifest = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt").Content
    $matching = @($manifest -split "`n" | Where-Object { $_.Trim() -match ('^[a-f0-9]{64}\s+' + [regex]::Escape($archiveName) + '$') })
    if ($matching.Count -ne 1) { throw 'Official Node checksum not found' }
    $expectedHash = ($matching[0].Trim() -split '\s+')[0]
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archivePath
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Node archive checksum mismatch' }
    Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $release 'node-distribution')
    $nodeRoot = Join-Path $release "node-distribution/node-v$NodeVersion-win-x64"
    New-Item -ItemType Directory -Path (Join-Path $package 'runtime') | Out-Null
    Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe') -Destination (Join-Path $package 'runtime/node.exe')
    Copy-Item -LiteralPath (Join-Path $nodeRoot 'LICENSE') -Destination (Join-Path $package 'runtime/LICENSE')
    # Explicit allowlist: never package source config, tokens, fixtures, logs or state.
    foreach ($file in @('agent.js','tally.js','outbox.js','launcher.js','Run-Sync.cmd','run-sync.ps1','package.json','package-lock.json')) {
        Copy-Item -LiteralPath (Join-Path $agentSource $file) -Destination (Join-Path $package $file)
    }
    Copy-Item -LiteralPath (Join-Path $agentSource 'config.example.json') -Destination (Join-Path $package 'config.json')
    Copy-Item -LiteralPath (Join-Path $agentSource 'PORTABLE-SETUP.txt') -Destination (Join-Path $package 'START-HERE.txt')
    [IO.File]::WriteAllText((Join-Path $package 'token.txt'), '')
    & (Join-Path $package 'runtime/node.exe') (Join-Path $nodeRoot 'node_modules/npm/bin/npm-cli.js') ci --prefix $package --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Bundled dependency install failed' }
    $version = & (Join-Path $package 'runtime/node.exe') --version
    if ($LASTEXITCODE -ne 0 -or $version -ne "v$NodeVersion") { throw 'Portable runtime validation failed' }
    foreach ($file in @('agent.js','tally.js','outbox.js','launcher.js')) {
        & (Join-Path $package 'runtime/node.exe') --check (Join-Path $package $file)
        if ($LASTEXITCODE -ne 0) { throw "Syntax validation failed for $file" }
    }
    & (Join-Path $package 'runtime/node.exe') -e 'require(process.argv[1]); require(process.argv[2]);' (Join-Path $package 'tally.js') (Join-Path $package 'launcher.js')
    if ($LASTEXITCODE -ne 0) { throw 'Portable dependency validation failed' }
    @{tag=$Tag;nodeVersion=$NodeVersion;platform='win-x64';nodeArchiveSha256=$expectedHash;builtAt=[DateTime]::UtcNow.ToString('o')} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $package 'bundle-info.json') -Encoding UTF8
    $zip = Join-Path $release "FinanceTallyAgent-$Tag-win-x64.zip"
    Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal
    $checksum = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($zip + '.sha256'), "$checksum  $([IO.Path]::GetFileName($zip))`n")
    Write-Output "Portable package ready: $zip"
    Write-Output 'Copy and extract the ZIP on the server. Edit config.json and token.txt, then schedule Run-Sync.cmd.'
} finally { $ProgressPreference = $previousProgress }
