# Isolated fault injection: no real tasks, processes, downloads, or user installs.
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility, Microsoft.PowerShell.Archive
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\installer-' + [Guid]::NewGuid().ToString('N'))
$installer = Join-Path $workspace 'skills\codex-usage-card\scripts\install.ps1'
$fileNames = @('CodexNativeQuotaPatch.cs', 'CodexNativeQuotaPatch.next.exe', 'native_patch.js')
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
Add-Type -TypeDefinition @'
using System;
using System.Threading;
public static class InstallerMutexProbe {
  public static bool Unavailable(string name) {
    bool unavailable = false;
    var thread = new Thread(() => {
      using (var mutex = new Mutex(false, name)) {
        bool acquired = false;
        try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
        unavailable = !acquired;
        if (acquired) mutex.ReleaseMutex();
      }
    });
    thread.Start(); thread.Join(); return unavailable;
  }
}
'@
$global:installerTest_expectedSha256 = [regex]::Match((Get-Content -LiteralPath (Join-Path $workspace 'install.ps1') -Raw), '\$expectedSha256\s*=\s*''([0-9A-Fa-f]{64})''').Groups[1].Value
Assert ($global:installerTest_expectedSha256.Length -eq 64) 'Release archive hash was not found in install.ps1'
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  if ($TaskName -eq 'Codex Quota Card Repair') {
    if ($global:installerTest_scenario -eq 'legacy-identity') { return [pscustomobject]@{ Actions = @([pscustomobject]@{ Execute = 'C:\unrelated.exe' }) } }
    if ($global:installerTest_scenario -in @('migration-failure', 'legacy-arguments', 'legacy-working-directory', 'network-legacy-existing', 'network-legacy-migration')) {
      $legacyDirectory = Join-Path $global:installerTest_legacyRoot 'native-patch'
      return [pscustomobject]@{ Actions = @([pscustomobject]@{
        Execute = (Join-Path $legacyDirectory 'CodexNativeQuotaPatch.next.exe')
        WorkingDirectory = $(if ($global:installerTest_scenario -eq 'legacy-working-directory') { 'C:\unrelated' } else { $legacyDirectory })
        Arguments = $(if ($global:installerTest_scenario -eq 'legacy-arguments') { '--other' } else { '' })
      }); State = 'Running' }
    }
    return $null
  }
  if ($global:installerTest_scenario -in @('fresh-startup', 'network-legacy-migration') -and -not $global:installerTest_registered) { return $null }
  $path = if ($global:installerTest_scenario -eq 'identity') { 'C:\unrelated.exe' } else { Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe' }
  return [pscustomobject]@{ Actions = @([pscustomobject]@{
    Execute = $path
    WorkingDirectory = $(if ($global:installerTest_scenario -eq 'working-directory') { 'C:\unrelated' } else { Split-Path -Parent $path })
    Arguments = $(if ($global:installerTest_scenario -eq 'arguments') { '--other' } else { '' })
  }); State = 'Running' }
}
function Export-ScheduledTask { param($TaskPath, $TaskName) '<Task>old definition</Task>' }
function Stop-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  if ($global:installerTest_scenario -eq 'fresh-startup' -and $global:installerTest_running) {
    $global:installerTest_networkPresentAtStop = Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'native-patch\network-settings.json')
    Assert $global:installerTest_networkPresentAtStop 'Rollback removed network settings while the Helper could still recreate them'
  }
  $global:installerTest_stopped++; $global:installerTest_running = $false
}
function Start-ScheduledTask {
  param($TaskPath, $TaskName)
  Assert ([InstallerMutexProbe]::Unavailable($global:installerTest_mutexName)) 'Installation released the shortcut maintenance lock before task startup or rollback completed'
  $global:installerTest_started++; $global:installerTest_running = $true
}
function Unregister-ScheduledTask {
  param($TaskPath, $TaskName, $Confirm, $ErrorAction)
  $global:installerTest_unregistered++
  if ($TaskName -eq 'Codex Quota Card Repair' -and $global:installerTest_scenario -eq 'migration-failure') { throw 'Injected migration failure' }
}
function Get-CimInstance {
  param($ClassName)
  if ($global:installerTest_scenario -in @('migration-failure', 'shortcut-create', 'shortcut-existing', 'startup-prompt', 'helper-window', 'startup-launcher', 'helper-multiple', 'network-legacy-existing', 'network-legacy-migration') -and $global:installerTest_running) {
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
  if ($global:installerTest_scenario -eq 'module-copy-failure' -and -not $global:installerTest_faultInjected -and
      $Destination -eq (Join-Path $global:installerTest_destination 'scripts\official_shortcuts.ps1')) {
    $global:installerTest_faultInjected = $true
    throw 'Injected shortcut repair module copy failure'
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
  foreach ($global:installerTest_scenario in @('identity', 'legacy-identity', 'arguments', 'working-directory', 'legacy-arguments', 'legacy-working-directory', 'copy-failure', 'module-copy-failure', 'startup', 'fresh-startup', 'skip-success', 'migration-failure', 'shortcut-target', 'shortcut-arguments', 'shortcut-working-directory', 'shortcut-create', 'shortcut-existing', 'shortcut-rollback', 'startup-prompt', 'helper-window', 'startup-launcher', 'helper-multiple', 'official-failure', 'official-undo-failure', 'network-legacy-existing', 'network-legacy-migration')) {
    $caseRoot = Join-Path $testRoot $global:installerTest_scenario
    $global:installerTest_destination = Join-Path $caseRoot 'installed'
    $global:installerTest_legacyRoot = Join-Path $caseRoot 'legacy'
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
    $installerText = Get-Content -LiteralPath $installer -Raw
    $legacyDeclaration = '$legacyInstallRoot = Join-Path ([Environment]::GetFolderPath(''LocalApplicationData'')) ''CodexBar'''
    Assert ($installerText.Contains($legacyDeclaration)) 'Legacy installation fixture boundary changed'
    $installerText = $installerText.Replace($legacyDeclaration, ('$legacyInstallRoot = ''' + $global:installerTest_legacyRoot.Replace('''', '''''') + ''''))
    $global:installerTest_mutexName = 'Local\CodexUsageCard.Fixture.' + [Guid]::NewGuid().ToString('N')
    Assert ($installerText.Contains("'Local\CodexUsageCard.OfficialShortcuts'")) 'Installer maintenance mutex boundary changed'
    $installerText = $installerText.Replace("'Local\CodexUsageCard.OfficialShortcuts'", ("'" + $global:installerTest_mutexName + "'"))
    [IO.File]::WriteAllText((Join-Path $scripts 'install.ps1'), $installerText, [Text.UTF8Encoding]::new($false))
    if ($global:installerTest_scenario -in @('network-legacy-existing', 'network-legacy-migration')) {
      $oldProxyPath = Join-Path $global:installerTest_legacyRoot 'native-patch\api-proxy.dat'
      [void][IO.Directory]::CreateDirectory((Split-Path -Parent $oldProxyPath))
      Add-Type -AssemblyName System.Security
      $encryptedFixture = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('http://127.0.0.1:61823'), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
      [IO.File]::WriteAllBytes($oldProxyPath, $encryptedFixture)
    }
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath (Join-Path $workspace 'skills\codex-usage-card\scripts\uninstall.ps1') -Destination (Join-Path $scripts 'uninstall.ps1')
    $global:installerTest_officialPath = Join-Path $caseRoot 'official.lnk'
    Set-Content -LiteralPath $global:installerTest_officialPath -Value 'original official shortcut'
    # Isolate the installer orchestration: real Shell/PIDL behavior has its own regression script.
    Set-Content -LiteralPath (Join-Path $scripts 'official_shortcuts.ps1') -Value @'
function Install-CodexOfficialShortcuts {
  param($InstallRoot, $BackupDirectory)
  Assert ([InstallerMutexProbe]::Unavailable($global:installerTest_mutexName)) 'Shortcut installation was not inside the transaction lock'
  $global:installerTest_officialCalls++
  if ($global:installerTest_scenario -eq 'official-failure') { throw 'Injected official shortcut failure' }
  Set-Content -LiteralPath $global:installerTest_officialPath -Value 'configured official shortcut'
  [pscustomobject]@{Status='Configured';ConfiguredCount=1;AlreadyConfiguredCount=0;Paths=@($global:installerTest_officialPath)}
}
function Undo-CodexOfficialShortcutInstall {
  param($Transaction)
  Assert ([InstallerMutexProbe]::Unavailable($global:installerTest_mutexName)) 'Shortcut rollback was not inside the transaction lock'
  $global:installerTest_officialUndos++
  Assert (-not $global:installerTest_running) 'Rollback restored shortcuts before stopping the repair Helper'
  if ($global:installerTest_scenario -eq 'official-undo-failure') { throw 'Injected official shortcut rollback failure' }
  Set-Content -LiteralPath $global:installerTest_officialPath -Value 'original official shortcut'
}
function Restore-CodexOfficialShortcuts {
  param($InstallRoot)
  $global:installerTest_officialRestores++
  Assert (-not $global:installerTest_running) 'Uninstall restored shortcuts before stopping the repair Helper'
  Assert (Test-Path -LiteralPath (Join-Path $InstallRoot 'scripts\official_shortcuts.ps1')) 'Uninstall deleted the repair module before restoring shortcuts'
  Set-Content -LiteralPath $global:installerTest_officialPath -Value 'original official shortcut'
  [pscustomobject]@{RestoredCount=1;SkippedCount=0;Paths=@($global:installerTest_officialPath)}
}
'@
    Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value 'new doctor'
    Set-Content -LiteralPath (Join-Path $scripts 'configure_network.ps1') -Value 'new network configuration utility'
    if ($global:installerTest_scenario -in @('migration-failure', 'shortcut-create', 'shortcut-existing', 'network-legacy-existing', 'network-legacy-migration')) {
      Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'ready' }"
    }
    $promptDoctor = "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'AwaitingStartupDecision'; StartupPromptVisible = `$true; HelperWindowless = `$false }"
    if ($global:installerTest_scenario -eq 'startup-launcher') { $promptDoctor = $promptDoctor.Replace('HelperWindowless = $false', 'HelperWindowless = $true') }
    if ($global:installerTest_scenario -in @('startup-prompt', 'startup-launcher')) {
      Set-Content -LiteralPath (Join-Path $scripts 'doctor.ps1') -Value $promptDoctor
    }
    if ($global:installerTest_scenario -notin @('fresh-startup', 'network-legacy-migration')) {
      New-Item -ItemType Directory -Path (Join-Path $global:installerTest_destination 'scripts') -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $global:installerTest_destination 'scripts\doctor.ps1') -Value 'old doctor'
      Set-Content -LiteralPath (Join-Path $global:installerTest_destination 'scripts\official_shortcuts.ps1') -Value 'old shortcut repair module'
    }
    foreach ($name in $fileNames) {
      Set-Content -LiteralPath (Join-Path $assets $name) -Value ('new ' + $name)
      if ($global:installerTest_scenario -notin @('fresh-startup', 'network-legacy-migration')) {
        Set-Content -LiteralPath (Join-Path $global:installerTest_destination ('native-patch\' + $name)) -Value ('old ' + $name)
      }
    }
    $global:installerTest_stopped = 0; $global:installerTest_started = 0; $global:installerTest_unregistered = 0
    $global:installerTest_registered = $false; $global:installerTest_restoredXml = $null; $global:installerTest_faultInjected = $false
    $global:installerTest_running = $false
    $global:installerTest_networkPresentAtStop = $false
    $global:installerTest_comCreated = 0
    $global:installerTest_officialCalls = 0; $global:installerTest_officialUndos = 0
    $global:installerTest_officialRestores = 0
    $successExpected = $global:installerTest_scenario -in @('skip-success', 'shortcut-create', 'shortcut-existing', 'startup-prompt', 'startup-launcher', 'network-legacy-existing', 'network-legacy-migration')
    $failure = $null
    try { $installOutput = & (Join-Path $scripts 'install.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath -SkipTaskRegistration:($global:installerTest_scenario -eq 'skip-success') | Out-String }
    catch { $failure = $_ }
    Assert (-not [InstallerMutexProbe]::Unavailable($global:installerTest_mutexName)) 'Installation leaked its transaction lock'
    if ($successExpected) {
      Assert (-not $failure) ('Installation failed: ' + $failure)
    } else {
      Assert ($null -ne $failure) ('Expected failure: ' + $global:installerTest_scenario)
    }
    $officialExpected = if (($successExpected -and $global:installerTest_scenario -ne 'skip-success') -or $global:installerTest_scenario -eq 'official-undo-failure') { 'configured official shortcut' } else { 'original official shortcut' }
    Assert ((Get-Content -LiteralPath $global:installerTest_officialPath -Raw).Trim() -ceq $officialExpected) 'Official shortcut configuration or rollback was not preserved'
    if ($successExpected -and $global:installerTest_scenario -ne 'skip-success') {
      Assert ($installOutput -match 'OfficialShortcutStatus\s*:\s*Configured') 'Official shortcut result was not reported'
    }
    if ($global:installerTest_scenario -eq 'official-failure') {
      Assert ($failure -like '*Injected official shortcut failure*') 'Official shortcut failure was not surfaced'
      Assert ($global:installerTest_started -eq 1) 'Prior helper was not restored after shortcut configuration failure'
    }
    if ($global:installerTest_scenario -eq 'official-undo-failure') {
      Assert ($failure -like '*Files and task restored, but official shortcut rollback failed*') 'Partial rollback failure was not reported'
      Assert ($global:installerTest_restoredXml -eq '<Task>old definition</Task>' -and $global:installerTest_started -eq 2) 'Shortcut rollback failure blocked task recovery'
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
      New-Item -ItemType Directory -Path (Join-Path $global:installerTest_destination 'official-shortcuts') -Force | Out-Null
      Set-Content -LiteralPath (Join-Path $global:installerTest_destination 'official-shortcuts\state.json') -Value '{}'
      $uninstallFailure = $null
      try { & (Join-Path $scripts 'uninstall.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath | Out-Null }
      catch { $uninstallFailure = $_ }
      Assert ($uninstallFailure -like '*task action does not match*') 'Uninstall did not reject the unrelated task action'
      Assert ($global:installerTest_stopped -eq 0 -and $global:installerTest_unregistered -eq 0) 'Uninstall changed an unrelated task'
      Assert ($global:installerTest_officialRestores -eq 0) 'Uninstall changed official shortcuts before validating task identity'
      Assert (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'native-patch\native_patch.js')) 'Uninstall removed files after identity mismatch'
    }
    if ($global:installerTest_scenario -eq 'copy-failure') { Assert ($global:installerTest_started -eq 1) ('Old task was not restarted after failed copy: ' + $failure) }
    if ($global:installerTest_scenario -eq 'startup') {
      Assert ($global:installerTest_restoredXml -eq '<Task>old definition</Task>') 'Old task definition was not restored'
      Assert ($global:installerTest_started -eq 2) 'Old running task was not restarted'
    }
    if ($global:installerTest_scenario -eq 'fresh-startup') {
      Assert ($global:installerTest_unregistered -eq 1) 'Failed fresh task was not removed'
      Assert $global:installerTest_networkPresentAtStop 'Rollback did not stop the Helper before cleaning its configuration'
      Assert (-not (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'native-patch\network-settings.json'))) 'Failed fresh install left default network settings'
    }
    if ($global:installerTest_scenario -in @('network-legacy-existing', 'network-legacy-migration')) {
      $copiedProxyPath = Join-Path $global:installerTest_destination 'native-patch\api-proxy.dat'
      if ($global:installerTest_scenario -eq 'network-legacy-existing') {
        Assert (-not (Test-Path -LiteralPath $copiedProxyPath)) 'A leftover legacy task reintroduced its proxy into an existing installation'
      } else {
        Assert ((Test-Path -LiteralPath $copiedProxyPath) -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($copiedProxyPath)) -ceq [Convert]::ToBase64String($encryptedFixture)) 'Legacy proxy was not migrated without changing its encrypted bytes'
      }
      Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($oldProxyPath)) -ceq [Convert]::ToBase64String($encryptedFixture)) 'Migration modified the legacy encrypted proxy'
      Assert (-not (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'native-patch\network-settings.json'))) 'Migration bypassed the Helper environment precedence'
    }
    if ($global:installerTest_scenario -eq 'migration-failure') {
      Assert ($failure -like '*Injected migration failure*') 'Migration failure was not reached'
      Assert ($global:installerTest_started -eq 3) 'Current and legacy tasks were not restarted after migration rollback'
    }
    $doctorPath = Join-Path $global:installerTest_destination 'scripts\doctor.ps1'
    if ($global:installerTest_scenario -eq 'fresh-startup') { Assert (-not (Test-Path -LiteralPath $doctorPath)) 'Fresh install left a doctor script' }
    else {
      $expectedDoctor = if ($global:installerTest_scenario -in @('startup-prompt', 'startup-launcher')) { $promptDoctor } elseif ($global:installerTest_scenario -in @('shortcut-create', 'shortcut-existing', 'network-legacy-existing', 'network-legacy-migration')) { "param(`$TaskName, `$InstallRoot); [pscustomobject]@{ ActivationState = 'ready' }" } elseif ($global:installerTest_scenario -eq 'skip-success') { 'new doctor' } else { 'old doctor' }
      Assert ((Get-Content -LiteralPath $doctorPath -Raw).Trim() -eq $expectedDoctor) 'Incorrect doctor deployment or rollback'
    }
    $repairModulePath = Join-Path $global:installerTest_destination 'scripts\official_shortcuts.ps1'
    if ($global:installerTest_scenario -eq 'fresh-startup') { Assert (-not (Test-Path -LiteralPath $repairModulePath)) 'Failed fresh install left a shortcut repair module' }
    else {
      $expectedRepairModule = if ($successExpected) { [IO.File]::ReadAllText((Join-Path $scripts 'official_shortcuts.ps1')).Trim() } else { 'old shortcut repair module' }
      Assert ((Get-Content -LiteralPath $repairModulePath -Raw).Trim() -ceq $expectedRepairModule) 'Incorrect shortcut repair module deployment or rollback'
    }
    if ($global:installerTest_scenario -eq 'module-copy-failure') { Assert ($failure -like '*Injected shortcut repair module copy failure*' -and $global:installerTest_started -eq 1) 'Repair module copy failure did not roll back and restart the old Helper' }
    if ($previousShortcut) {
      Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath)) -ceq $previousShortcut) 'Existing shortcut bytes changed during installation or rollback'
    } elseif ($global:installerTest_scenario -in @('shortcut-create', 'startup-prompt', 'startup-launcher', 'network-legacy-existing', 'network-legacy-migration')) {
      $shortcut = (Microsoft.PowerShell.Utility\New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
      Assert ($shortcut.TargetPath -eq (Join-Path $global:installerTest_destination 'native-patch\CodexNativeQuotaPatch.next.exe')) 'Shortcut target is incorrect'
      Assert ($shortcut.Arguments -ceq '--launch') 'Shortcut launch arguments are incorrect'
      Assert ($shortcut.WorkingDirectory -eq (Join-Path $global:installerTest_destination 'native-patch')) 'Shortcut working directory is incorrect'
    } else {
      Assert (-not (Test-Path -LiteralPath $shortcutPath)) 'Failed installation left a new shortcut'
    }
    if ($global:installerTest_scenario -eq 'skip-success') { Assert ($global:installerTest_comCreated -eq 0 -and $global:installerTest_officialCalls -eq 0) 'Skip registration accessed shell shortcuts' }
    if ($global:installerTest_scenario -in @('shortcut-target', 'shortcut-arguments', 'shortcut-working-directory', 'shortcut-create')) {
      $global:installerTest_running = $global:installerTest_scenario -eq 'shortcut-create'
      if ($global:installerTest_scenario -eq 'shortcut-create') {
        New-Item -ItemType Directory -Path (Join-Path $global:installerTest_destination 'official-shortcuts') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $global:installerTest_destination 'official-shortcuts\state.json') -Value '{}'
      }
      $uninstallOutput = & (Join-Path $scripts 'uninstall.ps1') -InstallRoot $global:installerTest_destination -ShortcutPath $shortcutPath | Out-String
      Assert ($global:installerTest_officialRestores -eq 1) 'Uninstall must synchronize restoration even before a shortcut state file exists'
      Assert (-not (Test-Path -LiteralPath $repairModulePath)) 'Uninstall retained the repair module after synchronized restoration'
      if ($global:installerTest_scenario -eq 'shortcut-create') {
        Assert ($global:installerTest_officialRestores -eq 1) 'Uninstall did not restore the official shortcut'
        Assert (-not (Test-Path -LiteralPath $repairModulePath)) 'Uninstall retained the repair module after restoring shortcuts'
        Assert ($uninstallOutput -match 'OfficialShortcutsRestored\s*:\s*1') 'Uninstall did not report restored official shortcut'
        Assert ((Get-Content -LiteralPath $global:installerTest_officialPath -Raw).Trim() -ceq 'original official shortcut') 'Uninstall removed or failed to restore original official link'
      }
      if ($previousShortcut) {
        Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($shortcutPath)) -ceq $previousShortcut) 'Uninstall changed an unrelated shortcut'
      } else { Assert (-not (Test-Path -LiteralPath $shortcutPath)) 'Uninstall left its exact shortcut' }
    }
  }
  foreach ($networkCase in @('fresh', 'existing-helper', 'existing-settings', 'legacy-proxy')) {
    $global:installerTest_scenario = 'network-' + $networkCase
    $global:installerTest_destination = Join-Path $testRoot $global:installerTest_scenario
    $runtime = Join-Path $global:installerTest_destination 'native-patch'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $networkPath = Join-Path $runtime 'network-settings.json'
    if ($networkCase -eq 'existing-helper') { Set-Content -LiteralPath (Join-Path $runtime 'CodexNativeQuotaPatch.next.exe') -Value 'old helper' }
    if ($networkCase -eq 'existing-settings') { Set-Content -LiteralPath $networkPath -Value '{"version":1,"mode":"proxy","source":"explicit","proxyProtected":"fixture"}' }
    if ($networkCase -eq 'legacy-proxy') { Set-Content -LiteralPath (Join-Path $runtime 'api-proxy.dat') -Value 'encrypted fixture' }
    $savedNetwork = if (Test-Path -LiteralPath $networkPath) { [IO.File]::ReadAllText($networkPath) } else { $null }
    $global:installerTest_comCreated = 0
    & (Join-Path $scripts 'install.ps1') -InstallRoot $global:installerTest_destination -SkipTaskRegistration | Out-Null
    Assert ($global:installerTest_comCreated -eq 0) 'Isolated network initialization accessed shell shortcuts'
    Assert (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'scripts\configure_network.ps1')) 'Network configuration utility was not deployed'
    Assert (Test-Path -LiteralPath (Join-Path $global:installerTest_destination 'scripts\official_shortcuts.ps1')) 'Skip registration did not deploy the shortcut repair module'
    if ($networkCase -eq 'fresh') {
      $network = Get-Content -LiteralPath $networkPath -Raw | ConvertFrom-Json
      Assert ($network.version -eq 1 -and $network.mode -ceq 'system' -and $network.source -ceq 'default') 'Fresh installs did not default to system networking'
    } elseif ($networkCase -eq 'existing-settings') {
      Assert ([IO.File]::ReadAllText($networkPath) -ceq $savedNetwork) 'Existing network settings were overwritten'
    } else {
      Assert (-not (Test-Path -LiteralPath $networkPath)) 'Upgrade migration must resolve the Helper environment at runtime'
    }
  }
  foreach ($moduleCase in @('runtime-module', 'missing-module')) {
    $global:installerTest_scenario = 'uninstall-' + $moduleCase
    $caseRoot = Join-Path $testRoot $global:installerTest_scenario
    $global:installerTest_destination = Join-Path $caseRoot 'installed'
    $runtime = Join-Path $global:installerTest_destination 'native-patch'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $helperPath = Join-Path $runtime 'CodexNativeQuotaPatch.next.exe'
    Set-Content -LiteralPath $helperPath -Value 'retained helper fixture'
    $isolatedUninstall = Join-Path $caseRoot 'uninstall.ps1'
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath (Join-Path $workspace 'skills\codex-usage-card\scripts\uninstall.ps1') -Destination $isolatedUninstall
    if ($moduleCase -eq 'runtime-module') {
      $runtimeScripts = Join-Path $global:installerTest_destination 'scripts'
      New-Item -ItemType Directory -Path $runtimeScripts -Force | Out-Null
      Microsoft.PowerShell.Management\Copy-Item -LiteralPath (Join-Path $scripts 'official_shortcuts.ps1') -Destination (Join-Path $runtimeScripts 'official_shortcuts.ps1')
    } else {
      $statePath = Join-Path $global:installerTest_destination 'official-shortcuts\state.json'
      New-Item -ItemType Directory -Path (Split-Path -Parent $statePath) -Force | Out-Null
      Set-Content -LiteralPath $statePath -Value 'preserve restoration data'
    }
    $global:installerTest_running = $true
    $global:installerTest_officialRestores = 0
    $failure = $null
    try { & $isolatedUninstall -InstallRoot $global:installerTest_destination -ShortcutPath (Join-Path $caseRoot 'absent.lnk') | Out-Null }
    catch { $failure = $_ }
    if ($moduleCase -eq 'runtime-module') {
      Assert (-not $failure -and $global:installerTest_officialRestores -eq 1) 'Uninstall did not use the available installed module'
      Assert (-not (Test-Path -LiteralPath $helperPath)) 'Uninstall did not finish after using the installed module'
    } else {
      Assert ($failure -like '*maintenance module is missing*') 'Uninstall did not report its missing restoration module'
      Assert ((Test-Path -LiteralPath $helperPath) -and (Get-Content -LiteralPath $statePath -Raw).Trim() -ceq 'preserve restoration data') 'Missing module caused destructive partial cleanup'
    }
  }
  $global:installerTest_skillFiles = @('SKILL.md', 'agents\openai.yaml', 'scripts\install.ps1', 'scripts\doctor.ps1', 'scripts\configure_network.ps1', 'scripts\official_shortcuts.ps1', 'scripts\uninstall.ps1',
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
  # Exercise production process-stop blocks without opening or terminating any OS process.
  & {
    function Get-CimInstance {
      param($ClassName)
      if ($global:installerIdentity_kills -eq 0) {
        [pscustomobject]@{ ExecutablePath=$testExecutable; ProcessId=123; CreationDate=$observedStart }
      }
    }
    function Get-Process { param($Id, $ErrorAction) $fakeProcess }
    function Stop-Process { param($Id, [switch]$Force) $global:installerIdentity_kills++ }
    $testExecutable = Join-Path $testRoot 'native-patch\CodexNativeQuotaPatch.next.exe'
    $observedStart = [DateTime]::UtcNow
    foreach ($operation in @('install', 'uninstall')) {
      $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $workspace ('skills\codex-usage-card\scripts\' + $operation + '.ps1'))
      $startMarker = if ($operation -eq 'install') { '$stopExactProcesses = {' } else { '$matchingProcesses = @(' }
      $endMarker = if ($operation -eq 'install') { '$taskActionMatches = {' } else { '$officialShortcutRestore = $null' }
      $start = $source.IndexOf($startMarker)
      $end = $source.IndexOf($endMarker, $start)
      Assert ($start -ge 0 -and $end -gt $start) 'Production process-stop boundary missing'
      $block = $source.Substring($start, $end - $start)
      if ($operation -eq 'install') { $block += '& $stopExactProcesses $testExecutable' }
      $executable = $testExecutable
      foreach ($scenario in @('reused-path', 'reused-start-time', 'missing-handle', 'matching', 'wmi-precision')) {
        $global:installerIdentity_kills = 0
        $global:installerIdentity_disposed = 0
        $fakeProcess = [pscustomobject]@{
          Id=123
          Handle=$(if ($scenario -eq 'missing-handle') { [IntPtr]::Zero } else { [IntPtr]1 })
          MainModule=[pscustomobject]@{ FileName=$(if ($scenario -eq 'reused-path') { 'C:\Unrelated.exe' } else { $testExecutable }) }
          StartTime=$(if ($scenario -eq 'reused-start-time') { $observedStart.AddSeconds(1) } elseif ($scenario -eq 'wmi-precision') { $observedStart.AddTicks(9) } else { $observedStart })
        }
        $fakeProcess | Add-Member ScriptMethod Kill { $global:installerIdentity_kills++ }
        $fakeProcess | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
        $fakeProcess | Add-Member ScriptMethod Dispose { $global:installerIdentity_disposed++ }
        $failure = $null
        try { & ([scriptblock]::Create($block)) } catch { $failure = $_ }
        if ($scenario -in @('matching', 'wmi-precision')) {
          Assert (-not $failure -and $global:installerIdentity_kills -eq 1) "$operation/$scenario failed to stop the exact helper: $failure"
        } else {
          Assert ($failure -and $global:installerIdentity_kills -eq 0) "$operation/$scenario stopped a process with changed identity"
        }
        Assert ($global:installerIdentity_disposed -eq 1) "$operation/$scenario leaked the process handle"
      }
    }
    Remove-Variable -Name installerIdentity_kills, installerIdentity_disposed -Scope Global
  }
  Write-Output 'Installer regressions: 34 scenarios, 6 uninstall identity checks and 10 process identity checks passed, 0 failed.'
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
