# All scheduled-task commands are mocked; never reads or changes real tasks.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\developer-tasks-' + [Guid]::NewGuid().ToString('N'))
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-TaskIdentity($TaskPath, $TaskName) {
  Assert ($TaskPath -ceq '\') 'A task operation was not restricted to the root task folder'
  Assert ($TaskName -ceq 'Codex Usage Card Audit') 'Unexpected task name'
}
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  Assert-TaskIdentity $TaskPath $TaskName
  $global:quotaTaskAudit_current
}
function New-ScheduledTaskAction { param($Execute, $WorkingDirectory) [pscustomobject]@{ Execute=$Execute; WorkingDirectory=$WorkingDirectory; Arguments='' } }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) 'synthetic trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'synthetic principal' }
function New-ScheduledTaskSettingsSet {
  param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable,
    $MultipleInstances, $RestartCount, $RestartInterval, $ExecutionTimeLimit)
  'synthetic settings'
}
function Register-ScheduledTask {
  param($TaskPath, $TaskName, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force)
  Assert-TaskIdentity $TaskPath $TaskName
  $global:quotaTaskAudit_mutations += 'register'
  $global:quotaTaskAudit_current = [pscustomobject]@{ TaskName=$TaskName; State='Ready'; Actions=@($Action) }
}
function Start-ScheduledTask {
  param($TaskPath, $TaskName)
  Assert-TaskIdentity $TaskPath $TaskName
  $global:quotaTaskAudit_mutations += 'start'
}
function Get-ScheduledTaskInfo {
  param($TaskPath, $TaskName)
  Assert-TaskIdentity $TaskPath $TaskName
  [pscustomobject]@{ LastRunTime=$null; LastTaskResult=0 }
}
function Unregister-ScheduledTask {
  param($TaskPath, $TaskName, $Confirm)
  Assert-TaskIdentity $TaskPath $TaskName
  $global:quotaTaskAudit_mutations += 'unregister'
}
function Start-Sleep { param($Milliseconds) }
try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  $helper = Join-Path $testRoot 'CodexNativeQuotaPatch.next.exe'
  Set-Content -LiteralPath $helper -Value 'inert synthetic helper'
  Set-Content -LiteralPath (Join-Path $testRoot 'native_patch.js') -Value '// inert synthetic bundle'
  $checks = 0
  foreach ($operation in @('register', 'unregister')) {
    foreach ($scenario in @('absent', 'matching', 'executable', 'working-directory', 'arguments', 'multiple-actions', 'blank-executable', 'blank-working-directory')) {
      $action = [pscustomobject]@{ Execute=$helper; WorkingDirectory=$testRoot; Arguments='' }
      switch ($scenario) {
        'executable' { $action.Execute = 'C:\Unrelated\BackupAgent.exe' }
        'working-directory' { $action.WorkingDirectory = 'C:\Unrelated' }
        'arguments' { $action.Arguments = '--other' }
        'blank-executable' { $action.Execute = '' }
        'blank-working-directory' { $action.WorkingDirectory = '' }
      }
      $global:quotaTaskAudit_current = if ($scenario -eq 'absent') { $null } else {
        [pscustomobject]@{ TaskName='Codex Usage Card Audit'; State='Ready'; Actions=@($action) }
      }
      if ($scenario -eq 'multiple-actions') { $global:quotaTaskAudit_current.Actions = @($action, $action) }
      $global:quotaTaskAudit_mutations = @()
      $failure = $null
      try {
        & (Join-Path $workspace ('scripts\' + $operation + '_usage_card_task.ps1')) -TaskName 'Codex Usage Card Audit' -Helper $helper | Out-Null
      } catch { $failure = $_ }
      if ($scenario -in @('absent', 'matching')) {
        Assert ($null -eq $failure) "$operation/$scenario failed: $failure"
        $expected = if ($operation -eq 'register') { 'register,start' } elseif ($scenario -eq 'matching') { 'unregister' } else { '' }
        Assert (($global:quotaTaskAudit_mutations -join ',') -ceq $expected) "$operation/$scenario performed unexpected task operations"
      } else {
        Assert ($null -ne $failure) "$operation/$scenario accepted an unrelated task"
        Assert ($global:quotaTaskAudit_mutations.Count -eq 0) "$operation/$scenario changed a task before rejecting it"
      }
      $checks++
    }
  }
  Assert ($checks -eq 16) 'Not all task identity checks ran'
  Write-Output "Developer task regressions: $checks passed, 0 failed."
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  Remove-Variable -Name quotaTaskAudit_current, quotaTaskAudit_mutations -Scope Global -ErrorAction SilentlyContinue
}
