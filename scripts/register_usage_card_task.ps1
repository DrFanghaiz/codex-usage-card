param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$Helper = ''
)

$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
if (-not $Helper) {
  $Helper = Join-Path $project 'native-patch\CodexNativeQuotaPatch.next.exe'
}
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) {
  throw "Native helper was not found: $Helper"
}
$nativeScript = Join-Path (Split-Path -Parent $Helper) 'native_patch.js'
if (-not (Test-Path -LiteralPath $nativeScript -PathType Leaf)) {
  throw "Native patch script was not found: $nativeScript"
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$helperDirectory = Split-Path -Parent $Helper
$action = New-ScheduledTaskAction -Execute $Helper -WorkingDirectory $helperDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Runs Codex Usage Card without a console window.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Milliseconds 500
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  Executable = $Helper
  Mode = 'native-cdp-event-driven'
} | Format-List
