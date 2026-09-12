# Invoked with an encoded script and UTF-8 JSON on stdin, never password arguments.
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
$failureCode='failed'
try {
    $settings=[Console]::In.ReadToEnd() | ConvertFrom-Json
    $login=$settings.login
    if (-not [Environment]::UserInteractive) { $failureCode='desktop'; throw 'Unavailable' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FinanceLoginWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
    function Select-Field($controls, [bool]$password, [string]$automationId) {
        $found=@($controls | Where-Object {
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
            $_.Current.IsPassword -eq $password -and $_.Current.IsEnabled -and
            (-not $automationId -or $_.Current.AutomationId -ceq $automationId)
        })
        return ,$found
    }
    $deadline=[DateTime]::UtcNow.AddMilliseconds($login.timeoutMs)
    $failureCode='controls'
    while ([DateTime]::UtcNow -lt $deadline) {
        $name=[IO.Path]::GetFileNameWithoutExtension($settings.executablePath)
        $session=(Get-Process -Id $PID).SessionId
        $processes=@(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path -eq $settings.executablePath -and $_.SessionId -eq $session -and
            (-not $settings.processId -or $_.Id -eq $settings.processId)
        })
        if (-not $processes.Count) { $failureCode='process' }
        $processIds=@($processes | ForEach-Object { $_.Id })
        $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
        $candidates=@()
        foreach ($window in $windows) {
            if ($processIds -notcontains $window.Current.ProcessId) { continue }
            if ($login.windowTitle -and $window.Current.Name -cne $login.windowTitle) { continue }
            $controls=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
            $users=Select-Field $controls $false $login.usernameAutomationId
            $passwords=Select-Field $controls $true $login.passwordAutomationId
            if ($passwords.Count -gt 1 -or ($passwords.Count -and $users.Count -gt 1)) { $failureCode='ambiguous'; throw 'Ambiguous' }
            if ($users.Count -eq 1 -and $passwords.Count -eq 1) {
                $candidates+=@{window=$window;user=$users[0];password=$passwords[0];controls=$controls}
            }
        }
        if ($candidates.Count -gt 1) { $failureCode='ambiguous'; throw 'Ambiguous' }
        if ($candidates.Count -eq 1) {
            $candidate=$candidates[0]
            $userPattern=$null; $passwordPattern=$null
            if (-not $candidate.user.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$userPattern) -or
                -not $candidate.password.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$passwordPattern) -or
                $userPattern.Current.IsReadOnly -or $passwordPattern.Current.IsReadOnly) {
                $failureCode='writable'; throw 'Unsupported'
            }
            $buttonPattern=$null
            if ($login.submitAutomationId -or $login.submitButtonName) {
                $buttons=@($candidate.controls | Where-Object {
                    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled -and
                    (-not $login.submitAutomationId -or $_.Current.AutomationId -ceq $login.submitAutomationId) -and
                    (-not $login.submitButtonName -or $_.Current.Name -ceq $login.submitButtonName)
                })
                if ($buttons.Count -ne 1 -or -not $buttons[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$buttonPattern)) {
                    $failureCode='controls'; throw 'No submit control'
                }
            }
            $handle=[IntPtr]$candidate.window.Current.NativeWindowHandle
            if ($handle -eq [IntPtr]::Zero) { $failureCode='desktop'; throw 'No window handle' }
            [void][FinanceLoginWindow]::ShowWindow($handle,9)
            [void][FinanceLoginWindow]::SetForegroundWindow($handle)
            if ([FinanceLoginWindow]::GetForegroundWindow() -ne $handle) { $failureCode='desktop'; throw 'No foreground access' }
            # Set values through identified controls. Passwords never use clipboard/SendKeys.
            $userPattern.SetValue([string]$login.username)
            $passwordPattern.SetValue([string]$login.password)
            if ($buttonPattern) { $buttonPattern.Invoke() }
            else {
                $candidate.password.SetFocus()
                $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
                if ([FinanceLoginWindow]::GetForegroundWindow() -ne $handle -or
                    -not [System.Windows.Automation.Automation]::Compare($focused,$candidate.password)) {
                    $failureCode='desktop'; throw 'Focus changed'
                }
                [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            }
            # At most one submission per invocation, even if credentials are rejected.
            @{ok=$true;submitted=$true} | ConvertTo-Json -Compress
            exit 0
        }
        $remaining=($deadline-[DateTime]::UtcNow).TotalMilliseconds
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Min($login.pollIntervalMs,$remaining)) }
    }
    @{ok=$false;code=$failureCode} | ConvertTo-Json -Compress
} catch {
    # Do not echo exception text: providers can include supplied field values.
    @{ok=$false;code=$failureCode} | ConvertTo-Json -Compress
}
