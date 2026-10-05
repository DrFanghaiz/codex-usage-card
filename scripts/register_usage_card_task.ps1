param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$Helper = ''
)

$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
if (-not $Helper) {
  $Helper = Join-Path $project 'native-patch\CodexNativeQuotaPatch.next.exe'
}
$Helper = [IO.Path]::GetFullPath($Helper)
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) {
  throw "Native helper was not found: $Helper"
}
$nativeScript = Join-Path (Split-Path -Parent $Helper) 'native_patch.js'
if (-not (Test-Path -LiteralPath $nativeScript -PathType Leaf)) {
  throw "Native patch script was not found: $nativeScript"
}

$helperDirectory = Split-Path -Parent $Helper
$existingTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  if ($existingTask.Actions.Count -ne 1) { throw 'The existing task has an unexpected number of actions and was not changed.' }
  $action = $existingTask.Actions[0]
  if ([String]::IsNullOrWhiteSpace($action.Execute) -or
      [String]::IsNullOrWhiteSpace($action.WorkingDirectory) -or
      -not [String]::Equals([IO.Path]::GetFullPath($action.Execute), $Helper, [StringComparison]::OrdinalIgnoreCase) -or
      -not [String]::Equals([IO.Path]::GetFullPath($action.WorkingDirectory), $helperDirectory, [StringComparison]::OrdinalIgnoreCase) -or
      -not [String]::IsNullOrWhiteSpace($action.Arguments)) {
    throw 'The existing task action does not match the expected executable, working directory and empty arguments; it was not changed.'
  }
}
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
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
  -TaskPath '\' `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Runs Codex Usage Card without a console window.' `
  -Force | Out-Null

Start-ScheduledTask -TaskPath '\' -TaskName $TaskName
Start-Sleep -Milliseconds 500
$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskPath '\' -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  Executable = $Helper
  Mode = 'native-cdp-event-driven'
} | Format-List
