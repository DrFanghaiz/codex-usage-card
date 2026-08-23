[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard'),
  [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'Codex Usage Card supports Windows only.'
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$skillRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $skillRoot 'assets\native-patch'
$installDirectory = Join-Path $InstallRoot 'native-patch'
$executable = Join-Path $installDirectory 'CodexNativeQuotaPatch.next.exe'
$legacyTaskName = 'Codex Quota Card Repair'
$legacyInstallRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexBar'
$legacyInstallDirectory = Join-Path $legacyInstallRoot 'native-patch'
$legacyExecutable = Join-Path $legacyInstallDirectory 'CodexNativeQuotaPatch.next.exe'
if ([String]::Equals($TaskName, $legacyTaskName, [StringComparison]::OrdinalIgnoreCase)) {
  throw ('The task name is reserved for migration: {0}' -f $legacyTaskName)
}
$fileNames = @(
  'CodexNativeQuotaPatch.cs',
  'CodexNativeQuotaPatch.next.exe',
  'native_patch.js'
)

foreach ($fileName in $fileNames) {
  $source = Join-Path $sourceDirectory $fileName
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw ('Skill asset is missing: {0}' -f $fileName)
  }
}

$stopExactProcesses = {
  param([string]$Path)
  $matchingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $Path, [StringComparison]::OrdinalIgnoreCase)
  })
  foreach ($process in $matchingProcesses) {
    $nativeProcess = Get-Process -Id $process.ProcessId -ErrorAction Stop
    Stop-Process -Id $nativeProcess.Id -Force
    if (-not $nativeProcess.WaitForExit(5000)) {
      throw ('Helper process did not exit: {0}' -f $nativeProcess.Id)
    }
  }
  $remaining = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $Path, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($remaining.Count -ne 0) {
    throw ('Helper process still owns the executable: {0}' -f $Path)
  }
}

$existingTask = $null
$legacyTask = $null
if (-not $SkipTaskRegistration) {
  $existingTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    if ($existingTask.Actions.Count -ne 1) {
      throw 'The existing task has an unexpected number of actions.'
    }
    $actualExecutable = [IO.Path]::GetFullPath($existingTask.Actions[0].Execute)
    if (-not [String]::Equals($actualExecutable, $executable, [StringComparison]::OrdinalIgnoreCase)) {
      throw ('The existing task points to another path: {0}' -f $actualExecutable)
    }
    Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName
  }
  & $stopExactProcesses $executable

  $legacyTask = Get-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacyTask) {
    if ($legacyTask.Actions.Count -ne 1) {
      throw 'The legacy task has an unexpected number of actions.'
    }
    $actualLegacyExecutable = [IO.Path]::GetFullPath($legacyTask.Actions[0].Execute)
    if (-not [String]::Equals($actualLegacyExecutable, $legacyExecutable, [StringComparison]::OrdinalIgnoreCase)) {
      throw ('The legacy task points to another path: {0}' -f $actualLegacyExecutable)
    }
  }
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
foreach ($fileName in $fileNames) {
  Copy-Item -LiteralPath (Join-Path $sourceDirectory $fileName) -Destination (Join-Path $installDirectory $fileName) -Force
}

if ($SkipTaskRegistration) {
  [pscustomobject]@{
    Installed = $true
    InstallRoot = $InstallRoot
    TaskRegistered = $false
  } | Format-List
  return
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $executable -WorkingDirectory $installDirectory
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
Start-Sleep -Milliseconds 750

$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction Stop
if ($task.Actions.Count -ne 1) {
  throw 'The registered task has an unexpected number of actions.'
}
$actualExecutable = [IO.Path]::GetFullPath($task.Actions[0].Execute)
if (-not [String]::Equals($actualExecutable, $executable, [StringComparison]::OrdinalIgnoreCase)) {
  throw ('Registered task path is incorrect: {0}' -f $actualExecutable)
}
$running = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and
  [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $executable, [StringComparison]::OrdinalIgnoreCase)
})
if ($running.Count -ne 1) {
  throw ('Expected one helper process, found {0}.' -f $running.Count)
}
$windowHandle = (Get-Process -Id $running[0].ProcessId).MainWindowHandle
if ($windowHandle -ne 0) {
  throw 'The helper unexpectedly created a window.'
}

if ($legacyTask) {
  Stop-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName
  & $stopExactProcesses $legacyExecutable
  Unregister-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -Confirm:$false
  foreach ($fileName in $fileNames) {
    $legacyPath = Join-Path $legacyInstallDirectory $fileName
    if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
      Remove-Item -LiteralPath $legacyPath -Force
    }
  }
  foreach ($legacyDirectory in @($legacyInstallDirectory, $legacyInstallRoot)) {
    if ((Test-Path -LiteralPath $legacyDirectory -PathType Container) -and
        @(Get-ChildItem -LiteralPath $legacyDirectory -Force).Count -eq 0) {
      Remove-Item -LiteralPath $legacyDirectory -Force
    }
  }
}

$diagnosis = & (Join-Path $PSScriptRoot 'doctor.ps1') -TaskName $TaskName -InstallRoot $InstallRoot

[pscustomobject]@{
  Installed = $true
  InstallRoot = $InstallRoot
  TaskName = $TaskName
  TaskState = $task.State
  ProcessId = $running[0].ProcessId
  MainWindowHandle = $windowHandle
  ActivationState = $diagnosis.ActivationState
  StageCodes = $diagnosis.StageCodes
  TaskActionMatches = $diagnosis.TaskActionMatches
  HelperProcessCount = $diagnosis.HelperProcessCount
  HelperWindowless = $diagnosis.HelperWindowless
  CodexRunning = $diagnosis.CodexRunning
  CdpEndpointFound = $diagnosis.CdpEndpointFound
  MainPageFound = $diagnosis.MainPageFound
  CardVisible = $diagnosis.CardVisible
  CardKind = $diagnosis.CardKind
} | Format-List
