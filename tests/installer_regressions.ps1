# Isolated fault injection: no real tasks, processes, downloads, or user installs.
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility, Microsoft.PowerShell.Archive
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\installer-' + [Guid]::NewGuid().ToString('N'))
$installer = Join-Path $workspace 'skills\codex-usage-card\scripts\install.ps1'
$fileNames = @('CodexNativeQuotaPatch.cs', 'CodexNativeQuotaPatch.next.exe', 'native_patch.js')
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
$global:installerTest_expectedSha256 = [regex]::Match((Get-Content -LiteralPath (Join-Path $workspace 'install.ps1') -Raw), '\$expectedSha256\s*=\s*''([0-9A-Fa-f]{64})''').Groups[1].Value
Assert ($global:installerTest_expectedSha256.Length -eq 64) 'Release archive hash was not found in install.ps1'
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  if ($TaskName -eq 'Codex Quota Card Repair') {
    if ($global:installerTest_scenario -eq 'legacy-identity') { return [pscustomobject]@{ Actions = @([pscustomobject]@{ Execute = 'C:\unrelated.exe' }) } }
    if ($global:installerTest_scenario -in @('migration-failure', 'legacy-arguments', 'legacy-working-directory')) {
      $legacyDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexBar\native-patch'
      return [pscustomobject]@{ Actions = @([pscustomobject]@{
        Execute = (Join-Path $legacyDirectory 'CodexNativeQuotaPatch.next.exe')
        WorkingDirectory = $(if ($global:installerTest_scenario -eq 'legacy-working-directory') { 'C:\unrelated' } else { $legacyDirectory })
        Arguments = $(if ($global:installerTest_scenario -eq 'legacy-arguments') { '--other' } else { '' })
      }); State = 'Running' }
    }
    return $null
  }
  if ($global:installerTest_scenario -eq 'fresh-startup' -and -not $global:installerTest_registered) { return $null }
  $path = if ($global:installerTest_scenario -eq 'identity') { 'C:\unrelated.exe' } else { Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe' }
  return [pscustomobject]@{ Actions = @([pscustomobject]@{
    Execute = $path
    WorkingDirectory = $(if ($global:installerTest_scenario -eq 'working-directory') { 'C:\unrelated' } else { Split-Path -Parent $path })
    Arguments = $(if ($global:installerTest_scenario -eq 'arguments') { '--other' } else { '' })
  }); State = 'Running' }
}
function Export-ScheduledTask { param($TaskPath, $TaskName) '<Task>old definition</Task>' }
function Stop-ScheduledTask { param($TaskPath, $TaskName, $ErrorAction) $global:installerTest_stopped++; $global:installerTest_running = $false }
function Start-ScheduledTask { param($TaskPath, $TaskName) $global:installerTest_started++; $global:installerTest_running = $true }
function Unregister-ScheduledTask {
  param($TaskPath, $TaskName, $Confirm, $ErrorAction)
  $global:installerTest_unregistered++
  if ($TaskName -eq 'Codex Quota Card Repair') { throw 'Injected migration failure' }
}
function Get-CimInstance {
  param($ClassName)
  if ($global:installerTest_scenario -in @('migration-failure', 'shortcut-create', 'shortcut-existing', 'startup-prompt', 'helper-window', 'startup-launcher', 'helper-multiple') -and $global:installerTest_running) {
    [pscustomobject]@{ ExecutablePath = (Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe'); ProcessId = 123 }
    if ($global:installerTest_scenario -in @('startup-launcher', 'helper-multiple')) {
      [pscustomobject]@{
        ExecutablePath = (Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe')
        ProcessId = 124
        CommandLine = $(if ($global:installerTest_scenario -eq 'startup-launcher') { 'helper.exe --launch' } else { '' })
      }
    }
  }
}
function Get-Process {
  param($Id)
  [pscustomobject]@{
    MainWindowHandle = $(if ($global:installerTest_scenario -in @('startup-prompt', 'helper-window')) { 1 } else { 0 })
    MainWindowTitle = $(if ($global:installerTest_scenario -eq 'startup-prompt') { [regex]::Unescape('\u52a0\u8f7d Codex \u989d\u5ea6\u5361') } else { 'Unexpected helper window' })
  }
}
function New-ScheduledTaskAction { param($Execute, $WorkingDirectory) [pscustomobject]@{ Execute = $Execute } }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) 'trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'principal' }
function New-ScheduledTaskSettingsSet {
  param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable, $MultipleInstances, $RestartCount, $RestartInterval, $ExecutionTimeLimit)
  'settings'
}
function Register-ScheduledTask {
  param($TaskPath, $TaskName, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force, $Xml)
  $global:installerTest_registered = $true
  if ($Xml) { $global:installerTest_restoredXml = $Xml }
}
function Start-Sleep { param($Milliseconds) }
function New-Object {
  param($ComObject)
  Assert ($ComObject -eq 'WScript.Shell') 'Unexpected COM object requested'
  $global:installerTest_comCreated++
  Microsoft.PowerShell.Utility\New-Object -ComObject $ComObject
}
function Copy-Item {
  param($LiteralPath, $Destination, [switch]$Force)
  if ($global:installerTest_scenario -eq 'copy-failure' -and -not $global:installerTest_faultInjected -and
      $Destination -eq (Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe')) {
    $global:installerTest_faultInjected = $true
    throw 'Injected copy failure'
  }
  Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
function Invoke-WebRequest { param($Uri, $OutFile) Set-Content -LiteralPath $OutFile -Value 'isolated archive' }
function Get-FileHash { param($LiteralPath, $Algorithm) [pscustomobject]@{ Hash = $global:installerTest_expectedSha256 } }
function Unblock-File { param($LiteralPath) }
function Expand-Archive {
  param($LiteralPath, $DestinationPath)
  foreach ($relative in $global:installerTest_skillFiles) {
    $path = Join-Path $DestinationPath ('codex-usage-card\' + $relative)
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    $value = if ($relative -eq 'scripts\install.ps1') { "param(`$InstallRoot, [switch]`$SkipTaskRegistration); throw 'Injected nested installer failure'" } else { 'new skill file' }
    Set-Content -LiteralPath $path -Value $value
  }
}
try {
  foreach ($global:installerTest_scenario in @('identity', 'legacy-identity', 'arguments', 'working-directory', 'legacy-arguments', 'legacy-working-directory', 'copy-failure', 'startup', 'fresh-startup', 'skip-success', 'migration-failure', 'shortcut-target', 'shortcut-arguments', 'shortcut-working-directory', 'shortcut-create', 'shortcut-existing', 'shortcut-rollback', 'startup-prompt', 'helper-window', 'startup-launcher', 'helper-multiple')) {
    $caseRoot = Join-Path $testRoot $global:installerTest_scenario
    $global:installerTest_destination = Join-Path $caseRoot 'installed'
    $scripts = Join-Path $caseRoot 'skill\scripts'
    $assets = Join-Path $caseRoot 'skill\assets\native-patch'
    New-Item -ItemType Directory -Path $scripts, $assets, (Join-Path $global:installerTest_destination 'native-patch') -Force | Out-Null
    $shortcutPath = Join-Path $caseRoot 'launcher.lnk'
    $previousShortcut = $null
    if ($global:installerTest_scenario -in @('shortcut-target', 'shortcut-arguments', 'shortcut-working-directory', 'shortcut-existing', 'shortcut-rollback', 'skip-success')) {
      $shortcut = (Microsoft.PowerShell.Utility\New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
      $shortcut.TargetPath = if ($global:installerTest_scenario -in @('shortcut-target', 'skip-success')) { 'C:\unrelated.exe' } else { Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe' }
      $shortcut.Arguments = if ($global:installerTest_scenario -eq 'shortcut-arguments') { '--other' } else { '--launch' }
      $shortcut.WorkingDirectory = if ($global:installerTest_scenario -eq 'shortcut-working-directory') { 'C:\unrelated' } else { Join-Path $global:installerTest_destination 'native-patch' }
      $shortcut.Description = 'Preserve my exact shortcut metadata'
      $shortcut.Save()
      $previousShortcut = [Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath))
    }
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $installer -Destination (Join-Path $scripts 'install.ps1')
    Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value 'new doctor'
    if ($global:installerTest_scenario -in @('migration-failure', 'shortcut-create', 'shortcut-existing')) {
      Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'ready' }"
    }
    $promptDoctor = "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'AwaitingStartupDecision'; StartupPromptVisible = `$true; HelperWindowless = `$false }"
    if ($global:installerTest_scenario -eq 'startup-launcher') { $promptDoctor = $promptDoctor.Replace('HelperWindowless = $false', 'HelperWindowless = $true') }
    if ($global:installerTest_scenario -in @('startup-prompt', 'startup-launcher')) {
      Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value $promptDoctor
    }
    if ($global:installerTest_scenario -ne 'fresh-startup') {
      New-Item -ItemType Directory -Path (Join-Path $global:installerTest_destination 'scripts') -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $global:installerTest_destination 'scripts\doctor.ps1') -Value 'old doctor'
    }
    foreach ($name in $fileNames) {
      Set-Content -LiteralPath (Join-Path $assets $name) -Value ('new ' + $name)
      if ($global:installerTest_scenario -ne 'fresh-startup') {
        Set-Content -LiteralPath (Join-Path $global:installerTest_destination ('native-patch\' + $name)) -Value ('old ' + $name)
      }
    }
    $global:installerTest_stopped = 0; $global:installerTest_started = 0; $global:installerTest_unregistered = 0
    $global:installerTest_registered = $false; $global:installerTest_restoredXml = $null; $global:installerTest_faultInjected = $false
    $global:installerTest_running = $false
    $global:installerTest_comCreated = 0
    $successExpected = $global:installerTest_scenario -in @('skip-success', 'shortcut-create', 'shortcut-existing', 'startup-prompt', 'startup-launcher')
    $failure = $null
    try { $installOutput = & (Join-Path $scripts 'install.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath -SkipTaskRegistration:($global:installerTest_scenario -eq 'skip-success') | Out-String }
    catch { $failure = $_ }
    if ($successExpected) {
      Assert (-not $failure) ('Installation failed: ' + $failure)
    } else {
      Assert ($null -ne $failure) ('Expected failure: ' + $global:installerTest_scenario)
    }
    if ($global:installerTest_scenario -in @('startup-prompt', 'startup-launcher')) {
      Assert ($installOutput -match 'ActivationState\s*:\s*AwaitingStartupDecision') 'Expected startup interaction state was not returned'
      Assert ($installOutput -match 'StartupPromptVisible\s*:\s*True') 'Startup prompt visibility was not returned'
      $expectedWindowless = if ($global:installerTest_scenario -eq 'startup-launcher') { 'True' } else { 'False' }
      Assert ($installOutput -match ('HelperWindowless\s*:\s*' + $expectedWindowless)) 'Background helper window state is incorrect'
    }
    if ($global:installerTest_scenario -eq 'helper-window') {
      Assert ($failure -like '*helper unexpectedly created a window*') 'Unexpected helper window was not rejected'
    }
    if ($global:installerTest_scenario -eq 'helper-multiple') {
      Assert ($failure -like '*Expected one helper process, found 2*') 'Two background helpers were not rejected'
    }
    foreach ($name in $fileNames) {
      $path = Join-Path $global:installerTest_destination ('native-patch\' + $name)
      if ($global:installerTest_scenario -eq 'fresh-startup') { Assert (-not (Test-Path -LiteralPath $path)) 'Fresh install left a partial file' }
      else {
        $expected = if ($successExpected) { 'new ' + $name } else { 'old ' + $name }
        Assert ((Get-Content -LiteralPath $path -Raw).Trim() -eq $expected) ('Incorrect restored file: ' + $name)
      }
    }
    if ($global:installerTest_scenario -in @('identity', 'legacy-identity', 'arguments', 'working-directory', 'legacy-arguments', 'legacy-working-directory', 'shortcut-target', 'shortcut-arguments', 'shortcut-working-directory')) {
      Assert ($global:installerTest_stopped -eq 0) 'Stopped a task before all identity checks'
      Assert (-not $global:installerTest_registered) 'Changed a task before all identity checks'
      Assert ($global:installerTest_unregistered -eq 0) 'Removed a task before all identity checks'
    }
    if ($global:installerTest_scenario -in @('arguments', 'working-directory')) {
      $uninstallFailure = $null
      try { & (Join-Path $workspace 'skills\codex-usage-card\scripts\uninstall.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath | Out-Null }
      catch { $uninstallFailure = $_ }
      Assert ($uninstallFailure -like '*task action does not match*') 'Uninstall did not reject the unrelated task action'
      Assert ($global:installerTest_stopped -eq 0 -and $global:installerTest_unregistered -eq 0) 'Uninstall changed an unrelated task'
      Assert (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'native-patch\native_patch.js')) 'Uninstall removed files after identity mismatch'
    }
    if ($global:installerTest_scenario -eq 'copy-failure') { Assert ($global:installerTest_started -eq 1) ('Old task was not restarted after failed copy: ' + $failure) }
    if ($global:installerTest_scenario -eq 'startup') {
      Assert ($global:installerTest_restoredXml -eq '<Task>old definition</Task>') 'Old task definition was not restored'
      Assert ($global:installerTest_started -eq 2) 'Old running task was not restarted'
    }
    if ($global:installerTest_scenario -eq 'fresh-startup') { Assert ($global:installerTest_unregistered -eq 1) 'Failed fresh task was not removed' }
    if ($global:installerTest_scenario -eq 'migration-failure') {
      Assert ($failure -like '*Injected migration failure*') 'Migration failure was not reached'
      Assert ($global:installerTest_started -eq 3) 'Current and legacy tasks were not restarted after migration rollback'
    }
    $doctorPath = Join-Path $global:installerTest_destination 'scripts\doctor.ps1'
    if ($global:installerTest_scenario -eq 'fresh-startup') { Assert (-not (Test-Path -LiteralPath $doctorPath)) 'Fresh install left a doctor script' }
    else {
      $expectedDoctor = if ($global:installerTest_scenario -in @('startup-prompt', 'startup-launcher')) { $promptDoctor } elseif ($global:installerTest_scenario -in @('shortcut-create', 'shortcut-existing')) { "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'ready' }" } elseif ($global:installerTest_scenario -eq 'skip-success') { 'new doctor' } else { 'old doctor' }
      Assert ((Get-Content -LiteralPath $doctorPath -Raw).Trim() -eq $expectedDoctor) 'Incorrect doctor deployment or rollback'
    }
    if ($previousShortcut) {
      Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath)) -ceq $previousShortcut) 'Existing shortcut bytes changed during installation or rollback'
    } elseif ($global:installerTest_scenario -in @('shortcut-create', 'startup-prompt', 'startup-launcher')) {
      $shortcut = (Microsoft.PowerShell.Utility\New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
      Assert ($shortcut.TargetPath -eq (Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe')) 'Shortcut target is incorrect'
      Assert ($shortcut.Arguments -ceq '--launch') 'Shortcut launch arguments are incorrect'
      Assert ($shortcut.WorkingDirectory -eq (Join-Path $global:installerTest_destination 'native-patch')) 'Shortcut working directory is incorrect'
    } else {
      Assert (-not (Test-Path -LiteralPath $shortcutPath)) 'Failed installation left a new shortcut'
    }
    if ($global:installerTest_scenario -eq 'skip-success') { Assert ($global:installerTest_comCreated -eq 0) 'Skip registration accessed shell shortcuts' }
    if ($global:installerTest_scenario -in @('shortcut-target', 'shortcut-arguments', 'shortcut-working-directory', 'shortcut-create')) {
      $global:installerTest_running = $false
      & (Join-Path $workspace 'skills\codex-usage-card\scripts\uninstall.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath | Out-Null
      if ($previousShortcut) {
        Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath)) -ceq $previousShortcut) 'Uninstall changed an unrelated shortcut'
      } else { Assert (-not (Test-Path -LiteralPath $shortcutPath)) 'Uninstall left its exact shortcut' }
    }
  }
  $global:installerTest_skillFiles = @('SKILL.md', 'agents\openai.yaml', 'scripts\install.ps1', 'scripts\doctor.ps1', 'scripts\uninstall.ps1',
    'assets\native-patch\CodexNativeQuotaPatch.cs', 'assets\native-patch\CodexNativeQuotaPatch.next.exe', 'assets\native-patch\native_patch.js')
  foreach ($scenario in @('existing-skill', 'fresh-skill')) {
    $skillDestination = Join-Path $testRoot $scenario
    if ($scenario -eq 'existing-skill') {
      foreach ($relative in $global:installerTest_skillFiles) {
        $path = Join-Path $skillDestination $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
        Set-Content -LiteralPath $path -Value 'previous skill file'
      }
    }
    $failure = $null
    try { & (Join-Path $workspace 'install.ps1') -SkillRoot $skillDestination -InstallRoot (Join-Path $testRoot 'unused') -SkipTaskRegistration | Out-Null }
    catch { $failure = $_ }
    Assert ($failure -like '*Injected nested installer failure*') ('Expected nested installer failure: ' + $failure)
    foreach ($relative in $global:installerTest_skillFiles) {
      $path = Join-Path $skillDestination $relative
      if ($scenario -eq 'existing-skill') { Assert ((Get-Content -LiteralPath $path -Raw).Trim() -eq 'previous skill file') 'Skill file was not restored' }
      else { Assert (-not (Test-Path -LiteralPath $path)) 'Partial fresh skill file was not removed' }
    }
  }
  Write-Output 'Installer regressions: 23 scenarios and 6 uninstall identity checks passed, 0 failed.'
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
