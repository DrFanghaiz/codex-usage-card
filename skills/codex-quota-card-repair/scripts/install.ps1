[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Quota Card Repair',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexBar'),
  [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'Codex Bar supports Windows only.'
}

$skillRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $skillRoot 'assets\native-patch'
$installDirectory = Join-Path $InstallRoot 'native-patch'
$executable = Join-Path $installDirectory 'CodexNativeQuotaPatch.next.exe'
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

$existingTask = $null
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

  $matchingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $executable, [StringComparison]::OrdinalIgnoreCase)
  })
  foreach ($process in $matchingProcesses) {
    Stop-Process -Id $process.ProcessId -Force
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
  -Description 'Restores the Codex quota card without a console window.' `
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

[pscustomobject]@{
  Installed = $true
  InstallRoot = $InstallRoot
  TaskName = $TaskName
  TaskState = $task.State
  ProcessId = $running[0].ProcessId
  MainWindowHandle = $windowHandle
} | Format-List
