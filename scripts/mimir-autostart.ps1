<#
.SYNOPSIS
  Opt-in: keep the Mimir coordinator running whenever you are logged in to this PC.

.DESCRIPTION
  Registers (or removes) a per-user Windows Scheduled Task that starts the coordinator at logon
  and restarts it if it exits. No admin rights needed. Nothing is installed until you run -Install.

  Honest limits: this keeps Mimir alive while the PC is on and you are logged in. A sleeping or
  powered-off PC runs nothing; missed slots are coalesced into one catch-up run on wake.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\mimir-autostart.ps1 -Install
  powershell -ExecutionPolicy Bypass -File scripts\mimir-autostart.ps1 -Status
  powershell -ExecutionPolicy Bypass -File scripts\mimir-autostart.ps1 -Uninstall
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [int]$Port = 4567,
  # Optional 'HH:mm'. Asks Windows to wake the PC from sleep at this time each day so due routines
  # can run. Needs "Allow wake timers" enabled in the power plan; cannot wake a powered-off PC.
  [string]$WakeAt = '',
  # Optional data directory (defaults to the app's normal one). Useful for a trial run.
  [string]$DataDir = '',
  [string]$TaskName = 'Mimir Coordinator'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task '$TaskName' (if it existed)."
  return
}

if ($Install) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node -and (Test-Path 'D:\node.exe')) { $node = 'D:\node.exe' }
  if (-not $node) { throw 'node.exe not found on PATH. Install Node.js or add it to PATH first.' }

  # cmd wrapper sets the port for this process only; the coordinator binds 127.0.0.1.
  $cmdLine = "/c set MIMIR_PORT=$Port&& "
  if ($DataDir) { $cmdLine += 'set "MIMIR_DATA_DIR=' + $DataDir + '"&& ' }
  $cmdLine += '"' + $node + '" daemon\coordinator.mjs'
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdLine -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if ($WakeAt) {
    if ($WakeAt -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw '-WakeAt must be HH:mm (24h), e.g. 07:55' }
    # The daily trigger is a no-op while the coordinator is already running (IgnoreNew); its job is the wake.
    $trigger = @($trigger, (New-ScheduledTaskTrigger -Daily -At $WakeAt))
    $settings.WakeToRun = $true
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Output "Installed '$TaskName'. Coordinator starts at logon on http://127.0.0.1:$Port and restarts on exit."
  Write-Output "Pause scheduled work any time from Routines > Mimir 24/7 Watch, or remove with -Uninstall."
  return
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Output "'$TaskName' is not installed. Run with -Install to enable it."; return }
$info = $task | Get-ScheduledTaskInfo
Write-Output "'$TaskName': state=$($task.State) lastRun=$($info.LastRunTime) lastResult=$($info.LastTaskResult)"
try {
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
  Write-Output "Coordinator healthy: $($health.service) $($health.version)"
} catch {
  Write-Output "Coordinator not answering on port $Port."
}
