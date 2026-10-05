param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$Helper = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $Helper) { $Helper = Join-Path $project 'native-patch\CodexNativeQuotaPatch.next.exe' }
$Helper = [IO.Path]::GetFullPath($Helper)
$helperDirectory = Split-Path -Parent $Helper
$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Output "Task not found: $TaskName"
  exit 0
}
if ($task.Actions.Count -ne 1) { throw 'The task has an unexpected number of actions and was not removed.' }
$action = $task.Actions[0]
if ([String]::IsNullOrWhiteSpace($action.Execute) -or
    [String]::IsNullOrWhiteSpace($action.WorkingDirectory) -or
    -not [String]::Equals([IO.Path]::GetFullPath($action.Execute), $Helper, [StringComparison]::OrdinalIgnoreCase) -or
    -not [String]::Equals([IO.Path]::GetFullPath($action.WorkingDirectory), $helperDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    -not [String]::IsNullOrWhiteSpace($action.Arguments)) {
  throw 'The task action does not match the expected executable, working directory and empty arguments; it was not removed.'
}
Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false
Write-Output "Task removed: $TaskName"
