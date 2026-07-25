param(
  [string]$TaskName = 'Codex Quota Card Repair'
)

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Output "Task not found: $TaskName"
  exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Task removed: $TaskName"
