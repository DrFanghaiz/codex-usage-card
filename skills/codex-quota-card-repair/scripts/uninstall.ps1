[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Quota Card Repair',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexBar')
)

$ErrorActionPreference = 'Stop'
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
  Stop-Process -Id $process.ProcessId -Force
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
