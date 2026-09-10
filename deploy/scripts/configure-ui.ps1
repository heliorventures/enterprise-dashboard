[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$')][string]$DashboardUser = 'admin',
    [Security.SecureString]$DashboardPassword,
    [switch]$GeneratePassword,
    [string]$VpsHost = '159.198.70.19',
    [string]$VpsUser = 'deploy',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [string]$SshIdentityFile,
    [switch]$NonInteractive
)
. "$PSScriptRoot/common.ps1"
Assert-RemoteInputs $VpsHost $VpsUser '/opt/apps/enterprise-dashboard' ''
if ($GeneratePassword -and $DashboardPassword) { throw 'Choose GeneratePassword or DashboardPassword, not both' }
if (-not $GeneratePassword -and -not $DashboardPassword) {
    if ($NonInteractive) { throw 'Supply DashboardPassword or GeneratePassword for unattended setup' }
    $DashboardPassword = Read-Host 'Choose a dashboard password (at least 12 characters)' -AsSecureString
}
$previousEncoding = $OutputEncoding
$pointer = [IntPtr]::Zero
$plain = $null
$payload = $null
try {
    if ($GeneratePassword) {
        $bytes = New-Object byte[] 24
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $plain = [Convert]::ToBase64String($bytes)
    } else {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($DashboardPassword)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    if ($plain.Length -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($plain) -gt 72 -or $plain -match '[\r\n\x00]' -or $plain.Trim() -ne $plain) {
        throw 'Password must have at least 12 characters, at most 72 UTF-8 bytes, and no line breaks or surrounding whitespace'
    }
    $deployDir = Split-Path -Parent $PSScriptRoot
    $scriptText = [IO.File]::ReadAllText((Join-Path $deployDir 'configure-ui.sh')).Replace("`r`n", "`n")
    $template = [IO.File]::ReadAllText((Join-Path $deployDir 'ui.env.example')).Replace("`r`n", "`n")
    $password64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))
    $template64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($template))
    # Keep shell syntax in stdin: Windows PowerShell native argument quoting can
    # strip the nested quotes required by a remote bash -c command.
    $payload = "configure_ui() {`n$scriptText`n}`nconfigure_ui <<'UI_SETUP_INPUT'`n$DashboardUser`n$password64`n$template64`nUI_SETUP_INPUT`n"
    $remoteCommand = "tr -d '\r' | bash -se"
    $sshOptions = @(Get-SshOptions $SshPort $SshIdentityFile -Interactive:(-not $NonInteractive))
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    $remoteOutput = @($payload | & ssh @sshOptions -T "${VpsUser}@${VpsHost}" $remoteCommand)
    if ($LASTEXITCODE -ne 0) { throw 'UI login setup failed; the previous ui.env has not been replaced unless the server reported success' }
    if ($remoteOutput -notcontains 'UI_ENV_SAVED') { throw 'The VPS did not confirm ui.env was saved. Setup is not verified; do not deploy yet.' }
    Write-Host 'Verified dashboard login saved on VPS.'
    if ($GeneratePassword) { Write-Host "Dashboard password (save it now): $plain" }
    Write-Host "Dashboard username: $DashboardUser. Resume deployment to apply the saved login."
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plain = $null
    $password64 = $null
    $payload = $null
    $OutputEncoding = $previousEncoding
}
