[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard')
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDirectory = Join-Path $InstallRoot 'native-patch'
$executable = Join-Path $installDirectory 'CodexNativeQuotaPatch.next.exe'
$task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue

if ($task) {
  if ($task.Actions.Count -ne 1) {
    throw 'The task has an unexpected number of actions and was not removed.'
  }
  $actualExecutable = [IO.Path]::GetFullPath($task.Actions[0].Execute)
  if (-not [String]::Equals($actualExecutable, $executable, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('The task points to another path and was not removed: {0}' -f $actualExecutable)
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
if ((Test-Path -LiteralPath $InstallRoot -PathType Container) -and
    @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -eq 0) {
  Remove-Item -LiteralPath $InstallRoot -Force
}

[pscustomobject]@{
  Uninstalled = $true
  InstallRoot = $InstallRoot
  TaskName = $TaskName
} | Format-List
