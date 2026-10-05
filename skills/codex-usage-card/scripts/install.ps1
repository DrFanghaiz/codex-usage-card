[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard'),
  [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ('Codex' + [char]0xff08 + [char]0x989d + [char]0x5ea6 + [char]0x5361 + [char]0xff09 + '.lnk')),
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

$deploymentFiles = @($fileNames | ForEach-Object {
  @{ Source = (Join-Path $sourceDirectory $_); Relative = ('native-patch\' + $_) }
}) + @(@{ Source = (Join-Path $PSScriptRoot 'doctor.ps1'); Relative = 'scripts\doctor.ps1' })
foreach ($file in $deploymentFiles) {
  if (-not (Test-Path -LiteralPath $file.Source -PathType Leaf)) {
    throw ('Skill asset is missing: {0}' -f $file.Relative)
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
    try {
      # Keep the opened handle and reject PID reuse; CIM creation times have microsecond precision.
      if ($nativeProcess.Handle -eq [IntPtr]::Zero -or -not $process.CreationDate -or
          [Math]::Abs($nativeProcess.StartTime.ToUniversalTime().Ticks - ([DateTime]$process.CreationDate).ToUniversalTime().Ticks) -ge 10 -or
          -not [String]::Equals([IO.Path]::GetFullPath($nativeProcess.MainModule.FileName), $Path, [StringComparison]::OrdinalIgnoreCase)) {
        throw ('Helper process identity changed before stopping: {0}' -f $process.ProcessId)
      }
      $nativeProcess.Kill()
      if (-not $nativeProcess.WaitForExit(5000)) {
        throw ('Helper process did not exit: {0}' -f $nativeProcess.Id)
      }
    } finally {
      $nativeProcess.Dispose()
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

$taskActionMatches = {
  param($Task, [string]$ExpectedExecutable)
  if ($Task.Actions.Count -ne 1) { return $false }
  $action = $Task.Actions[0]
  return -not [String]::IsNullOrWhiteSpace($action.Execute) -and
    -not [String]::IsNullOrWhiteSpace($action.WorkingDirectory) -and
    [String]::Equals([IO.Path]::GetFullPath($action.Execute), $ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase) -and
    [String]::Equals([IO.Path]::GetFullPath($action.WorkingDirectory), (Split-Path -Parent $ExpectedExecutable), [StringComparison]::OrdinalIgnoreCase) -and
    [String]::IsNullOrWhiteSpace($action.Arguments)
}

$existingTask = $null
$legacyTask = $null
$existingShortcut = $false
$shortcutMatches = {
  param($Shortcut)
  return -not [String]::IsNullOrWhiteSpace($Shortcut.TargetPath) -and
    -not [String]::IsNullOrWhiteSpace($Shortcut.WorkingDirectory) -and
    [String]::Equals([IO.Path]::GetFullPath($Shortcut.TargetPath), $executable, [StringComparison]::OrdinalIgnoreCase) -and
    [String]::Equals([IO.Path]::GetFullPath($Shortcut.WorkingDirectory), $installDirectory, [StringComparison]::OrdinalIgnoreCase) -and
    $Shortcut.Arguments -ceq '--launch'
}
if (-not $SkipTaskRegistration) {
  $ShortcutPath = [IO.Path]::GetFullPath($ShortcutPath)
  if ([IO.Path]::GetExtension($ShortcutPath) -ine '.lnk') { throw 'ShortcutPath must be a .lnk file.' }
  $shortcutShell = New-Object -ComObject WScript.Shell
  $existingShortcut = Test-Path -LiteralPath $ShortcutPath
  if ($existingShortcut -and
      (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) -or
       -not (& $shortcutMatches ($shortcutShell.CreateShortcut($ShortcutPath))))) {
    throw ('The existing shortcut does not match this installation and was not changed: {0}' -f $ShortcutPath)
  }
  $existingTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    if ($existingTask.Actions.Count -ne 1) {
      throw 'The existing task has an unexpected number of actions.'
    }
    $actualExecutable = [IO.Path]::GetFullPath($existingTask.Actions[0].Execute)
    if (-not (& $taskActionMatches $existingTask $executable)) {
      throw ('The existing task action does not match the expected executable, working directory and empty arguments: {0}' -f $actualExecutable)
    }
  }

  $legacyTask = Get-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacyTask) {
    if ($legacyTask.Actions.Count -ne 1) {
      throw 'The legacy task has an unexpected number of actions.'
    }
    $actualLegacyExecutable = [IO.Path]::GetFullPath($legacyTask.Actions[0].Execute)
    if (-not (& $taskActionMatches $legacyTask $legacyExecutable)) {
      throw ('The legacy task action does not match the expected executable, working directory and empty arguments: {0}' -f $actualLegacyExecutable)
    }
  }
}

$backupDirectory = Join-Path $InstallRoot ('backups\' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
if ($existingShortcut) {
  Copy-Item -LiteralPath $ShortcutPath -Destination (Join-Path $backupDirectory 'launch-shortcut.lnk')
}
foreach ($file in $deploymentFiles) {
  $installedPath = Join-Path $InstallRoot $file.Relative
  if (Test-Path -LiteralPath $installedPath -PathType Leaf) {
    $savedPath = Join-Path $backupDirectory $file.Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $savedPath) -Force | Out-Null
    Copy-Item -LiteralPath $installedPath -Destination $savedPath
  }
}
$previousTaskXml = if ($existingTask) { Export-ScheduledTask -TaskPath '\' -TaskName $TaskName } else { $null }
if ($previousTaskXml) {
  Set-Content -LiteralPath (Join-Path $backupDirectory 'task.xml') -Value $previousTaskXml -Encoding UTF8
}
$legacyTaskXml = if ($legacyTask) { Export-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName } else { $null }
if ($legacyTaskXml) {
  Set-Content -LiteralPath (Join-Path $backupDirectory 'legacy-task.xml') -Value $legacyTaskXml -Encoding UTF8
}
$taskChanged = $false
$legacyChanged = $false
$processesStopped = $false
$filesChanged = $false
$shortcutCreated = $false
try {
  if (-not $SkipTaskRegistration) {
    $processesStopped = $true
    if ($existingTask) { Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName }
    & $stopExactProcesses $executable
  }
  New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
  $filesChanged = $true
  foreach ($file in $deploymentFiles) {
    $installedPath = Join-Path $InstallRoot $file.Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $installedPath) -Force | Out-Null
    Copy-Item -LiteralPath $file.Source -Destination $installedPath -Force
  }

  if ($SkipTaskRegistration) {
    [pscustomobject]@{
      Installed = $true
      InstallRoot = $InstallRoot
      TaskRegistered = $false
    } | Format-List
    return
  }

  if (-not $existingShortcut) {
    $stagedShortcut = Join-Path $backupDirectory 'new-launch-shortcut.lnk'
    $shortcut = $shortcutShell.CreateShortcut($stagedShortcut)
    $shortcut.TargetPath = $executable
    $shortcut.Arguments = '--launch'
    $shortcut.WorkingDirectory = $installDirectory
    $shortcut.Description = 'Launch Codex with the usage card.'
    $shortcut.Save()
    New-Item -ItemType Directory -Path (Split-Path -Parent $ShortcutPath) -Force | Out-Null
    Move-Item -LiteralPath $stagedShortcut -Destination $ShortcutPath
    $shortcutCreated = $true
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

  $taskChanged = $true
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
  if (-not (& $taskActionMatches $task $executable)) {
    throw ('Registered task action is incorrect: {0}' -f $actualExecutable)
  }
  $running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    $_.CommandLine -cnotmatch '(?:^|\s)(?:--launch|"--launch")\s*\z' -and
    [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $executable, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($running.Count -ne 1) {
    throw ('Expected one helper process, found {0}.' -f $running.Count)
  }
  $helperProcess = Get-Process -Id $running[0].ProcessId
  $windowHandle = $helperProcess.MainWindowHandle
  $startupPromptVisible = $windowHandle -ne 0 -and $helperProcess.MainWindowTitle -cmatch '\A\u52a0\u8f7d Codex \u989d\u5ea6\u5361\z'
  if ($windowHandle -ne 0 -and -not $startupPromptVisible) {
    throw 'The helper unexpectedly created a window.'
  }
  $diagnosis = & (Join-Path $PSScriptRoot 'doctor.ps1') -TaskName $TaskName -InstallRoot $InstallRoot
  if ($legacyTask) {
    $legacyChanged = $true
    Stop-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName
    & $stopExactProcesses $legacyExecutable
    Unregister-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -Confirm:$false
    # Retain the legacy files alongside the saved task XML for recovery.
  }
} catch {
  $installFailure = $_
  try {
    if ($shortcutCreated -and (Test-Path -LiteralPath $ShortcutPath)) {
      if (-not (& $shortcutMatches ($shortcutShell.CreateShortcut($ShortcutPath)))) {
        throw 'Shortcut identity changed during installation; refusing to remove it during rollback.'
      }
      Remove-Item -LiteralPath $ShortcutPath -Force
    }
    if ($taskChanged) {
      $rollbackTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
      if ($rollbackTask) {
        if (-not (& $taskActionMatches $rollbackTask $executable)) {
          throw 'Task identity changed during installation; refusing to overwrite it during rollback.'
        }
        Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName
      }
      & $stopExactProcesses $executable
    }
    if ($filesChanged) {
      foreach ($file in $deploymentFiles) {
        $savedPath = Join-Path $backupDirectory $file.Relative
        $installedPath = Join-Path $InstallRoot $file.Relative
        if (Test-Path -LiteralPath $savedPath -PathType Leaf) {
          Copy-Item -LiteralPath $savedPath -Destination $installedPath -Force
        } elseif (Test-Path -LiteralPath $installedPath -PathType Leaf) {
          Remove-Item -LiteralPath $installedPath -Force
        }
      }
    }
    if ($taskChanged) {
      if ($previousTaskXml) {
        Register-ScheduledTask -TaskPath '\' -TaskName $TaskName -Xml $previousTaskXml -Force | Out-Null
      } else {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
      }
    }
    if ($processesStopped -and $existingTask -and $existingTask.State -eq 'Running') {
      Start-ScheduledTask -TaskPath '\' -TaskName $TaskName
    }
    if ($legacyChanged) {
      $rollbackLegacyTask = Get-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -ErrorAction SilentlyContinue
      if ($rollbackLegacyTask -and -not (& $taskActionMatches $rollbackLegacyTask $legacyExecutable)) {
        throw 'Legacy task identity changed during installation; refusing to overwrite it during rollback.'
      }
      Register-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName -Xml $legacyTaskXml -Force | Out-Null
      if ($legacyTask.State -eq 'Running') { Start-ScheduledTask -TaskPath '\' -TaskName $legacyTaskName }
    }
  } catch {
    throw ('Installation failed: {0}. Rollback also failed: {1}. Backup retained at {2}' -f $installFailure, $_, $backupDirectory)
  }
  throw ('Installation failed; previous files and task restored: {0}. Backup: {1}' -f $installFailure, $backupDirectory)
}

[pscustomobject]@{
  Installed = $true
  InstallRoot = $InstallRoot
  ShortcutPath = $ShortcutPath
  TaskName = $TaskName
  TaskState = $task.State
  ProcessId = $running[0].ProcessId
  MainWindowHandle = $windowHandle
  BackupDirectory = $backupDirectory
  ActivationState = $diagnosis.ActivationState
  StageCodes = $diagnosis.StageCodes
  TaskActionMatches = $diagnosis.TaskActionMatches
  HelperProcessCount = $diagnosis.HelperProcessCount
  HelperWindowless = $diagnosis.HelperWindowless
  StartupPromptVisible = $diagnosis.StartupPromptVisible
  CodexRunning = $diagnosis.CodexRunning
  CdpEndpointFound = $diagnosis.CdpEndpointFound
  MainPageFound = $diagnosis.MainPageFound
  CardVisible = $diagnosis.CardVisible
  CardKind = $diagnosis.CardKind
} | Format-List
