[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard'),
  [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ('Codex' + [char]0xff08 + [char]0x989d + [char]0x5ea6 + [char]0x5361 + [char]0xff09 + '.lnk'))
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDirectory = Join-Path $InstallRoot 'native-patch'
$executable = Join-Path $installDirectory 'CodexNativeQuotaPatch.next.exe'
$ShortcutPath = [IO.Path]::GetFullPath($ShortcutPath)
$shortcutMatches = $false
if (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) {
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($ShortcutPath)
  $shortcutMatches = -not [String]::IsNullOrWhiteSpace($shortcut.TargetPath) -and
    -not [String]::IsNullOrWhiteSpace($shortcut.WorkingDirectory) -and
    [String]::Equals([IO.Path]::GetFullPath($shortcut.TargetPath), $executable, [StringComparison]::OrdinalIgnoreCase) -and
    [String]::Equals([IO.Path]::GetFullPath($shortcut.WorkingDirectory), $installDirectory, [StringComparison]::OrdinalIgnoreCase) -and
    $shortcut.Arguments -ceq '--launch'
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

$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue

if ($task) {
  if ($task.Actions.Count -ne 1) {
    throw 'The task has an unexpected number of actions and was not removed.'
  }
  $actualExecutable = [IO.Path]::GetFullPath($task.Actions[0].Execute)
  if (-not (& $taskActionMatches $task $executable)) {
    throw ('The task action does not match and was not removed: {0}' -f $actualExecutable)
  }
  Stop-ScheduledTask -TaskPath '\' -TaskName $TaskName
  Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false
}

$matchingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and
  [String]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $executable, [StringComparison]::OrdinalIgnoreCase)
})
foreach ($process in $matchingProcesses) {
  $nativeProcess = Get-Process -Id $process.ProcessId -ErrorAction Stop
  Stop-Process -Id $nativeProcess.Id -Force
  if (-not $nativeProcess.WaitForExit(5000)) {
    throw ('Helper process did not exit: {0}' -f $nativeProcess.Id)
  }
}

if ($shortcutMatches) { Remove-Item -LiteralPath $ShortcutPath -Force }

foreach ($fileName in @('CodexNativeQuotaPatch.cs', 'CodexNativeQuotaPatch.next.exe', 'native_patch.js')) {
  $path = Join-Path $installDirectory $fileName
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    Remove-Item -LiteralPath $path -Force
  }
}
if ((Test-Path -LiteralPath $installDirectory -PathType Container) -and
    @(Get-ChildItem -LiteralPath $installDirectory -Force).Count -eq 0) {
  Remove-Item -LiteralPath $installDirectory -Force
}
$doctorPath = Join-Path $InstallRoot 'scripts\doctor.ps1'
if (Test-Path -LiteralPath $doctorPath -PathType Leaf) {
  Remove-Item -LiteralPath $doctorPath -Force
}
$scriptsDirectory = Join-Path $InstallRoot 'scripts'
if ((Test-Path -LiteralPath $scriptsDirectory -PathType Container) -and
    @(Get-ChildItem -LiteralPath $scriptsDirectory -Force).Count -eq 0) {
  Remove-Item -LiteralPath $scriptsDirectory -Force
}
if ((Test-Path -LiteralPath $InstallRoot -PathType Container) -and
    @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -eq 0) {
  Remove-Item -LiteralPath $InstallRoot -Force
}

[pscustomobject]@{
  Uninstalled = $true
  InstallRoot = $InstallRoot
  TaskName = $TaskName
} | Format-List
