# Native ShellLink tests on isolated copies only: no real shortcuts, tasks or apps are changed.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\official-shortcuts-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$module = Join-Path $workspace 'skills\codex-usage-card\scripts\official_shortcuts.ps1'
$loadedBefore = [bool]('CodexUsageCard.OfficialShortcut' -as [type])
$loadOutput = @(. $module)
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
Assert ($loadOutput.Count -eq 0 -and [bool]('CodexUsageCard.OfficialShortcut' -as [type]) -eq $loadedBefore) 'Dot-sourcing performed work.'
$passed = 1
$script:testAppId = 'OpenAI.Codex_2p2nqsd0c76g0!App'
$script:testCandidates = @()
function Get-CodexOfficialAppId { $script:testAppId }
function Get-CodexOfficialShortcutCandidates { $script:testCandidates }
Initialize-CodexOfficialShortcutApi
$script:saveState = ${function:Save-CodexOfficialShortcutState}
# Recorded package PIDL; contains no user path, account data or executable target.
$fixture = [Convert]::FromBase64String('TAAAAAEUAgAAAAAAwAAAAAAAAEaBAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAFoAFAAfgNIFFK3PMHdIhGge4cUsdZ8EACEAQABPAHAAZQBuAEEASQAuAEMAbwBkAGUAeABfADIAcAAyAG4AcQBzAGQAMABjADcANgBnADAAIQBBAHAAcAAAAAAAAAAAAA==')
$required = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=0'
function New-Case([string]$Name) {
  $root = Join-Path $testRoot $Name
  [void][IO.Directory]::CreateDirectory($root)
  $script:testCandidates = @()
  $script:testAppId = 'OpenAI.Codex_2p2nqsd0c76g0!App'
  [pscustomobject]@{Root=$root;Install=(Join-Path $root 'installed');Backup=(Join-Path $root 'transaction')}
}
function New-Link($Case, [string]$Name, [string]$Arguments='') {
  $path = Join-Path $Case.Root $Name
  [IO.File]::WriteAllBytes($path,$fixture)
  if ($Arguments) { [CodexUsageCard.OfficialShortcut]::SetArguments($path,$Arguments) }
  $path
}
function Hash([string]$Path) { [CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($Path)) }
function Install($Case) { Install-CodexOfficialShortcuts -InstallRoot $Case.Install -BackupDirectory $Case.Backup }
function Expect-Failure([scriptblock]$Action,[string]$Pattern) {
  $failure = $null
  try { & $Action | Out-Null } catch { $failure = $_ }
  Assert ($failure -and $failure.Exception.Message -like $Pattern) ('Expected failure: ' + $Pattern + '; received: ' + $failure)
}

foreach ($case in @(
  @('', $required),
  @('--locale=zh --label="two words"', ('--locale=zh --label="two words" ' + $required)),
  @('--remote-debugging-address=127.0.0.1', $required),
  @('--remote-debugging-port 0', '--remote-debugging-port 0 --remote-debugging-address=127.0.0.1'),
  @('--path="C:\folder with spaces\\" ', ('--path="C:\folder with spaces\\" ' + $required)),
  @(($required + ' -- positional'), ($required + ' -- positional'))
)) {
  Assert ([CodexUsageCard.OfficialShortcut]::MergeArguments($case[0]) -ceq $case[1]) 'Argument merge changed unrelated text.'
  $passed++
}
foreach ($arguments in @('--remote-debugging-port=9222','--remote-debugging-port 9222','--remote-debugging-address=0.0.0.0','--remote-debugging-port','--remote-debugging-port --locale=zh','--label="unterminated','-- positional')) {
  Expect-Failure { [CodexUsageCard.OfficialShortcut]::MergeArguments($arguments) } '*'
  $passed++
}

$case = New-Case 'native-metadata'
$link = New-Link $case 'Unrelated display name.lnk' '--locale="zh CN"'
$edit = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$edit.Description='Keep metadata'; $edit.IconLocation='shell32.dll,2'; $edit.WindowStyle=3; $edit.Hotkey='CTRL+ALT+Q'; $edit.WorkingDirectory=$case.Root; $edit.Save()
$before = [CodexUsageCard.OfficialShortcut]::Read($link)
Assert ([CodexUsageCard.OfficialShortcut]::IsPackageTarget($before,$script:testAppId)) 'Native package fixture did not resolve.'
$originalHash = Hash $link
$script:testCandidates=@($link,$link)
$transaction=Install $case
Assert ($transaction.Status -ceq 'Configured' -and $transaction.ConfiguredCount -eq 1 -and $transaction.Paths.Count -eq 1) 'Matching package shortcut was not configured exactly once.'
$after=[CodexUsageCard.OfficialShortcut]::Read($link)
foreach ($property in @('TargetPath','TargetParsingPath','IdList','WorkingDirectory','Description','IconPath','IconIndex','ShowCommand','Hotkey')) { Assert ($before.$property -ceq $after.$property) ('Changed metadata: '+$property) }
Assert ($after.Arguments -ceq ('--locale="zh CN" '+$required)) 'Native arguments not saved.'
$stateHash=Hash $transaction.StatePath
$state=Get-Content -LiteralPath $transaction.StatePath -Raw | ConvertFrom-Json
Assert ($state.Entries.Count -eq 1 -and $state.Entries[0].OriginalHash -ceq $originalHash) 'Original state not recorded.'
$upgrade=Install-CodexOfficialShortcuts -InstallRoot $case.Install -BackupDirectory (Join-Path $case.Root 'upgrade')
Assert ($upgrade.Status -ceq 'AlreadyConfigured' -and $upgrade.Changes.Count -eq 0 -and (Hash $transaction.StatePath) -ceq $stateHash) 'Upgrade rewrote the original backup or state.'
$restored=Restore-CodexOfficialShortcuts -InstallRoot $case.Install
Assert ($restored.RestoredCount -eq 1 -and $restored.SkippedCount -eq 0 -and (Hash $link) -ceq $originalHash) 'Uninstall did not restore first original bytes.'
$passed++

$case=New-Case 'preconfigured'
$link=New-Link $case 'Already configured.lnk' $required
$originalHash=Hash $link; $writeTime=[IO.File]::GetLastWriteTimeUtc($link)
$script:testCandidates=@($link)
$transaction=Install $case
Assert ($transaction.Status -ceq 'AlreadyConfigured' -and -not [IO.Directory]::Exists($case.Install) -and (Hash $link) -ceq $originalHash -and [IO.File]::GetLastWriteTimeUtc($link) -eq $writeTime) 'Installer took ownership of an existing configuration.'
Assert ((Restore-CodexOfficialShortcuts $case.Install).Status -ceq 'NotFound' -and (Hash $link) -ceq $originalHash) 'Uninstall touched a preconfigured shortcut.'
$passed++

$case=New-Case 'not-found'
$link=Join-Path $case.Root 'Codex.lnk'
$edit=(New-Object -ComObject WScript.Shell).CreateShortcut($link);$edit.TargetPath='C:\unrelated.exe';$edit.Save()
$originalHash=Hash $link;$script:testCandidates=@($link)
Assert ((Install $case).Status -ceq 'NotFound' -and (Hash $link) -ceq $originalHash) 'Named EXE shortcut was mistaken for official package.'
$link=New-Link $case 'Wrong app.lnk';$script:testCandidates=@($link);$script:testAppId='OpenAI.Other_wrong!App'
Assert ((Install $case).Status -ceq 'NotFound' -and -not [IO.Directory]::Exists($case.Install)) 'Wrong AUMID was configured.'
$script:testAppId=$null
Assert ((Install $case).Status -ceq 'PackageNotFound') 'Missing package status was lost.'
$passed++

$case=New-Case 'conflict-rollback'
$first=New-Link $case 'first.lnk';$second=New-Link $case 'second.lnk' '--remote-debugging-port=9222'
$originalHash=Hash $first;$secondHash=Hash $second;$script:testCandidates=@($first,$second)
Expect-Failure {Install $case} '*Conflicting*'
Assert ((Hash $first) -ceq $originalHash -and (Hash $second) -ceq $secondHash) 'Conflict did not roll back earlier updates.'
Assert (-not [IO.File]::Exists((Join-Path $case.Install 'official-shortcuts\state.json'))) 'Failed install retained ownership state.'
$passed++

$case=New-Case 'outer-rollback'
$link=New-Link $case 'entry.lnk';$originalHash=Hash $link;$script:testCandidates=@($link)
$transaction=Install $case
Undo-CodexOfficialShortcutInstall $transaction
Undo-CodexOfficialShortcutInstall $transaction
Assert ((Hash $link) -ceq $originalHash -and -not [IO.File]::Exists($transaction.StatePath)) 'Outer rollback did not restore original.'
$passed++

$case=New-Case 'upgrade-new-link-rollback'
$first=New-Link $case 'first.lnk';$originalHash=Hash $first;$script:testCandidates=@($first)
$initial=Install $case;$installedHash=Hash $first;$stateHash=Hash $initial.StatePath
$second=New-Link $case 'second.lnk';$secondHash=Hash $second;$script:testCandidates=@($first,$second)
$upgrade=Install-CodexOfficialShortcuts -InstallRoot $case.Install -BackupDirectory (Join-Path $case.Root 'upgrade')
Assert ($upgrade.ConfiguredCount -eq 1 -and $upgrade.AlreadyConfiguredCount -eq 1) 'Upgrade did not discover the additional link.'
Undo-CodexOfficialShortcutInstall $upgrade
Assert ((Hash $first) -ceq $installedHash -and (Hash $second) -ceq $secondHash -and (Hash $initial.StatePath) -ceq $stateHash) 'Upgrade rollback changed previous ownership.'
Assert ((Restore-CodexOfficialShortcuts $case.Install).RestoredCount -eq 1 -and (Hash $first) -ceq $originalHash) 'Upgrade lost original restoration bytes.'
$passed++

$case=New-Case 'user-edited'
$link=New-Link $case 'entry.lnk';$script:testCandidates=@($link);$transaction=Install $case
[CodexUsageCard.OfficialShortcut]::SetArguments($link,'--user-change')
$editedHash=Hash $link;$stateHash=Hash $transaction.StatePath
$restored=Restore-CodexOfficialShortcuts -InstallRoot $case.Install -WarningAction SilentlyContinue
Assert ($restored.SkippedCount -eq 1 -and $restored.RestoredCount -eq 0 -and (Hash $link) -ceq $editedHash) 'Uninstall overwrote a user edit.'
Expect-Failure {Install $case} '*changed since installation*'
Assert ((Hash $link) -ceq $editedHash -and (Hash $transaction.StatePath) -ceq $stateHash) 'Upgrade overwrote a user edit.'
Expect-Failure {Undo-CodexOfficialShortcutInstall $transaction} '*refused changed files*'
Assert ((Hash $link) -ceq $editedHash) 'Rollback overwrote a user edit.'
$passed++

$case=New-Case 'target-replaced'
$link=New-Link $case 'entry.lnk';$script:testCandidates=@($link);$transaction=Install $case
$edit=(New-Object -ComObject WScript.Shell).CreateShortcut($link);$edit.TargetPath='C:\unrelated.exe';$edit.Save();$editedHash=Hash $link
$restored=Restore-CodexOfficialShortcuts -InstallRoot $case.Install -WarningAction SilentlyContinue
Assert ($restored.SkippedCount -eq 1 -and (Hash $link) -ceq $editedHash) 'Uninstall replaced a different application target.'
$passed++

$case=New-Case 'first-state-write-failure'
$link=New-Link $case 'entry.lnk';$originalHash=Hash $link;$script:testCandidates=@($link)
function Save-CodexOfficialShortcutState {
  param($StatePath,$Entries,$ExpectedHash)
  [void][IO.Directory]::CreateDirectory($StatePath) # Fault: target becomes a directory before atomic state publication.
  & $script:saveState $StatePath $Entries $ExpectedHash
}
try { Expect-Failure {Install $case} '*' } finally { ${function:Save-CodexOfficialShortcutState}=$script:saveState }
$statePath=Join-Path $case.Install 'official-shortcuts\state.json'
Assert ((Hash $link) -ceq $originalHash -and -not [IO.File]::Exists($statePath)) 'First state persistence failure left a modified link or partial state.'
Assert (@(Get-ChildItem -LiteralPath (Split-Path -Parent $statePath) -Filter '*.tmp').Count -eq 0) 'State write left a temporary file.'
[IO.Directory]::Delete($statePath) # Remove only the injected, empty obstacle inside this test case.
$transaction=Install-CodexOfficialShortcuts -InstallRoot $case.Install -BackupDirectory (Join-Path $case.Root 'retry')
Assert ($transaction.Status -ceq 'Configured') 'Installation could not retry after state publication failure.'
$passed++

$case=New-Case 'existing-state-write-failure'
$first=New-Link $case 'first.lnk';$script:testCandidates=@($first);$initial=Install $case;$stateHash=Hash $initial.StatePath;$firstHash=Hash $first
$second=New-Link $case 'second.lnk';$secondHash=Hash $second;$script:testCandidates=@($first,$second)
function Save-CodexOfficialShortcutState {
  param($StatePath,$Entries,$ExpectedHash)
  $lock=[IO.File]::Open($StatePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try { & $script:saveState $StatePath $Entries $ExpectedHash } finally { $lock.Dispose() }
}
try { Expect-Failure {Install-CodexOfficialShortcuts -InstallRoot $case.Install -BackupDirectory (Join-Path $case.Root 'upgrade')} '*' }
finally { ${function:Save-CodexOfficialShortcutState}=$script:saveState }
Assert ((Hash $first) -ceq $firstHash -and (Hash $second) -ceq $secondHash -and (Hash $initial.StatePath) -ceq $stateHash) 'Locked existing state did not preserve previous installation.'
$passed++

$case=New-Case 'corrupt-backup'
$link=New-Link $case 'entry.lnk';$script:testCandidates=@($link);$transaction=Install $case;$installedHash=Hash $link
$state=Get-Content -LiteralPath $transaction.StatePath -Raw | ConvertFrom-Json
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $transaction.StatePath) $state.Entries[0].BackupName),'corrupt')
$restored=Restore-CodexOfficialShortcuts -InstallRoot $case.Install -WarningAction SilentlyContinue
Assert ($restored.SkippedCount -eq 1 -and (Hash $link) -ceq $installedHash) 'Corrupted backup overwrote the current shortcut.'
$passed++

foreach ($arguments in @('', '--locale=zh --remote-debugging-port 0', '--remote-debugging-address=127.0.0.1')) {
  $case=New-Case ('repair-missing-' + $passed)
  $link=New-Link $case 'entry.lnk' $arguments; $originalHash=Hash $link; $script:testCandidates=@($link)
  $result=Repair-CodexOfficialShortcuts -InstallRoot $case.Install
  Assert ($result.ConfiguredCount -eq 1 -and -not $result.RetryNeeded) 'Repair did not add the missing official switches.'
  Assert ([CodexUsageCard.OfficialShortcut]::Read($link).Arguments -ceq [CodexUsageCard.OfficialShortcut]::MergeArguments($arguments)) 'Repair replaced unrelated arguments.'
  Assert ((Restore-CodexOfficialShortcuts $case.Install).RestoredCount -eq 1 -and (Hash $link) -ceq $originalHash) 'Repair restoration did not preserve original bytes.'
  $passed++
}

$case=New-Case 'repair-new-link-noop'
$first=New-Link $case 'first.lnk'; $script:testCandidates=@($first)
$null=Repair-CodexOfficialShortcuts $case.Install
$second=New-Link $case 'new-package-shortcut.lnk' '--locale=zh'; $script:testCandidates=@($first,$second)
$result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.ConfiguredCount -eq 1 -and $result.AlreadyConfiguredCount -eq 1) 'Repair did not discover the new official package shortcut.'
$statePath=Join-Path $case.Install 'official-shortcuts\state.json'; $stateHash=Hash $statePath
$directories=@(Get-ChildItem -LiteralPath (Split-Path $statePath) -Directory).Count
$result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.ConfiguredCount -eq 0 -and $result.AlreadyConfiguredCount -eq 2 -and (Hash $statePath) -ceq $stateHash -and @(Get-ChildItem -LiteralPath (Split-Path $statePath) -Directory).Count -eq $directories) 'No-op repair created a transaction or rewrote state.'
$passed++

$case=New-Case 'repair-recreated-metadata'
$link=New-Link $case 'entry.lnk'; $script:testCandidates=@($link); $initial=Install $case
$statePath=$initial.StatePath; $initialState=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$oldBackup=Join-Path (Split-Path $statePath) $initialState.Entries[0].BackupName; $oldHash=Hash $oldBackup
[CodexUsageCard.OfficialShortcut]::SetArguments($link,'--locale=zh')
$edit=(New-Object -ComObject WScript.Shell).CreateShortcut($link)
$edit.Description='Updated package metadata'; $edit.IconLocation='shell32.dll,9'; $edit.WorkingDirectory=$case.Root; $edit.WindowStyle=3; $edit.Save()
$updatedHash=Hash $link; $updated=[CodexUsageCard.OfficialShortcut]::Read($link); $writeTime=[IO.File]::GetLastWriteTimeUtc($link)
$result=Repair-CodexOfficialShortcuts $case.Install
$state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
Assert ($result.ConfiguredCount -eq 1 -and $state.Entries.Count -eq 1 -and $state.Entries[0].OriginalHash -ceq $updatedHash -and (Hash $oldBackup) -ceq $oldHash) 'Repair did not replace the restoration baseline while retaining its historical backup.'
$after=[CodexUsageCard.OfficialShortcut]::Read($link)
foreach ($property in @('TargetPath','TargetParsingPath','IdList','WorkingDirectory','Description','IconPath','IconIndex','ShowCommand','Hotkey')) { Assert ($updated.$property -ceq $after.$property) ('Repair changed updated metadata: '+$property) }
Assert ((Restore-CodexOfficialShortcuts $case.Install).RestoredCount -eq 1 -and (Hash $link) -ceq $updatedHash -and [IO.File]::GetLastWriteTimeUtc($link) -eq $writeTime) 'Uninstall restored obsolete package metadata.'
$passed++

$case=New-Case 'repair-skip-conflicts'
$conflict=New-Link $case 'conflict.lnk' '--remote-debugging-port=9222'
$quotes=New-Link $case 'quotes.lnk' '--label="unterminated'
$other=Join-Path $case.Root 'other.lnk'; $edit=(New-Object -ComObject WScript.Shell).CreateShortcut($other); $edit.TargetPath='C:\unrelated.exe'; $edit.Save()
$valid=New-Link $case 'valid.lnk'
$hashes=@((Hash $conflict),(Hash $quotes),(Hash $other)); $script:testCandidates=@($conflict,$quotes,$other,$valid)
$result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.ConfiguredCount -eq 1 -and $result.SkippedCount -eq 3 -and -not $result.RetryNeeded) 'Conflicting arguments blocked another shortcut or caused retries.'
Assert ((Hash $conflict) -ceq $hashes[0] -and (Hash $quotes) -ceq $hashes[1] -and (Hash $other) -ceq $hashes[2]) 'Repair modified a skipped shortcut.'
$passed++

$case=New-Case 'repair-invalid-state'
$link=New-Link $case 'entry.lnk'; $originalHash=Hash $link; $script:testCandidates=@($link)
$statePath=Join-Path $case.Install 'official-shortcuts\state.json'; [void][IO.Directory]::CreateDirectory((Split-Path $statePath)); [IO.File]::WriteAllText($statePath,'{broken')
$stateHash=Hash $statePath; $result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.Status -ceq 'InvalidState' -and -not $result.RetryNeeded -and (Hash $link) -ceq $originalHash -and (Hash $statePath) -ceq $stateHash) 'Invalid state was discarded or allowed shortcut writes.'
$passed++

$case=New-Case 'repair-rollback-continue'
$first=New-Link $case 'first.lnk'; $firstHash=Hash $first; $second=New-Link $case 'second.lnk'; $script:testCandidates=@($first,$second)
$script:injectedSaveFailure=$false
function Save-CodexOfficialShortcutState {
  param($StatePath,$Entries,$ExpectedHash)
  if (-not $script:injectedSaveFailure) { $script:injectedSaveFailure=$true; throw [IO.IOException]::new('Injected isolated state failure.') }
  & $script:saveState $StatePath $Entries $ExpectedHash
}
try { $result=Repair-CodexOfficialShortcuts $case.Install } finally { ${function:Save-CodexOfficialShortcutState}=$script:saveState }
Assert ($result.ConfiguredCount -eq 1 -and $result.SkippedCount -eq 1 -and $result.RetryNeeded -and (Hash $first) -ceq $firstHash) 'Repair failed to roll back one candidate and continue with another.'
$state=Get-Content -LiteralPath (Join-Path $case.Install 'official-shortcuts\state.json') -Raw | ConvertFrom-Json
Assert ($state.Entries.Count -eq 1 -and $state.Entries[0].Path -ceq $second) 'Failed candidate leaked ownership into repair state.'
$passed++

$case=New-Case 'repair-preconfigured-no-files'
$link=New-Link $case 'entry.lnk' $required; $script:testCandidates=@($link); $originalHash=Hash $link
$result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.AlreadyConfiguredCount -eq 1 -and -not [IO.Directory]::Exists($case.Install) -and (Hash $link) -ceq $originalHash) 'Repair took ownership of already configured shortcut.'
$script:testAppId=$null; $result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.Status -ceq 'PackageNotFound' -and $result.RetryNeeded) 'Missing package must allow a bounded later retry.'
$passed++

$case=New-Case 'repair-helper-identity'
$link=New-Link $case 'entry.lnk'; $script:testCandidates=@($link); $originalHash=Hash $link
$result=Repair-CodexOfficialShortcuts -InstallRoot $case.Install -HelperProcessId $PID -HelperStartTicks 1
Assert ($result.Status -ceq 'HelperStopped' -and -not $result.RetryNeeded -and (Hash $link) -ceq $originalHash -and -not [IO.Directory]::Exists($case.Install)) 'Stale helper identity changed shortcuts.'
$process=[Diagnostics.Process]::GetCurrentProcess()
try { $result=Repair-CodexOfficialShortcuts -InstallRoot $case.Install -HelperProcessId $PID -HelperStartTicks $process.StartTime.ToUniversalTime().Ticks } finally { $process.Dispose() }
Assert ($result.ConfiguredCount -eq 1) 'Current helper identity was rejected.'
$passed++

$case=New-Case 'repair-lock-before-identity'
$output=Join-Path $case.Root 'result.json'
$childCode=". '"+$module.Replace("'","''")+"'; function Get-CodexOfficialAppId { throw 'Helper check ran too late.' }; Repair-CodexOfficialShortcuts -InstallRoot '"+$case.Install.Replace("'","''")+"' -HelperProcessId 2147483647 -HelperStartTicks 1 | ConvertTo-Json -Compress | Set-Content -LiteralPath '"+$output.Replace("'","''")+"'"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
$mutex=[Threading.Mutex]::new($false,'Local\CodexUsageCard.OfficialShortcuts'); $child=$null
try {
  [void]$mutex.WaitOne()
  $child=Start-Process -FilePath ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 700
  Assert (-not [IO.File]::Exists($output) -and -not $child.HasExited) 'Repair did not wait for the shared maintenance lock.'
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
try {
  Assert ($child.WaitForExit(15000)) 'Repair child did not exit after lock release.'
  $result=Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
  Assert ($result.Status -ceq 'HelperStopped' -and -not [IO.Directory]::Exists($case.Install)) 'Deferred repair did not recheck helper identity after acquiring the lock.'
} finally { if ($child -and -not $child.HasExited) { $child.Kill() }; if ($child) { $child.Dispose() } }
$passed++

$case=New-Case 'repair-reparse-path'
$target=Join-Path $case.Root 'target'; [void][IO.Directory]::CreateDirectory($target)
$linkedCase=[pscustomobject]@{Root=$target}; $linked=New-Link $linkedCase 'entry.lnk'; $linkedHash=Hash $linked
$junction=Join-Path $case.Root 'junction'; $null=New-Item -ItemType Junction -Path $junction -Target $target
$valid=New-Link $case 'valid.lnk'; $script:testCandidates=@((Join-Path $junction 'entry.lnk'),$valid)
$result=Repair-CodexOfficialShortcuts $case.Install
Assert ($result.ConfiguredCount -eq 1 -and $result.SkippedCount -eq 1 -and -not $result.RetryNeeded -and (Hash $linked) -ceq $linkedHash) 'Repair followed a reparse ancestor or blocked another candidate.'
$unsafe=Join-Path $case.Root 'unsafe-install'; [void][IO.Directory]::CreateDirectory($unsafe)
$null=New-Item -ItemType Junction -Path (Join-Path $unsafe 'official-shortcuts') -Target $target
$result=Repair-CodexOfficialShortcuts $unsafe
Assert ($result.Status -ceq 'UnsafeStatePath' -and -not $result.RetryNeeded -and -not [IO.File]::Exists((Join-Path $target 'state.json'))) 'Repair followed a reparse restoration directory.'
$passed++

$case=New-Case 'repair-state-busy'
$link=New-Link $case 'entry.lnk'; $script:testCandidates=@($link); $originalHash=Hash $link
$statePath=Join-Path $case.Install 'official-shortcuts\state.json'; [void][IO.Directory]::CreateDirectory((Split-Path $statePath)); [IO.File]::WriteAllText($statePath,'{"Version":1,"Entries":[]}')
$lock=[IO.File]::Open($statePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try { $result=Repair-CodexOfficialShortcuts $case.Install } finally { $lock.Dispose() }
Assert ($result.RetryNeeded -and $result.ConfiguredCount -eq 0 -and (Hash $link) -ceq $originalHash) 'Busy restoration state was changed or not marked retryable.'
$passed++

$case=New-Case 'repair-rollback-user-edit'
$link=New-Link $case 'entry.lnk'; $script:testCandidates=@($link); $script:concurrentEditHash=$null
function Save-CodexOfficialShortcutState {
  param($StatePath,$Entries,$ExpectedHash)
  [CodexUsageCard.OfficialShortcut]::SetArguments($Entries[0].Path,'--concurrent-user-edit')
  $script:concurrentEditHash=Hash $Entries[0].Path
  throw [IO.IOException]::new('Injected state failure after concurrent shortcut edit.')
}
try { $result=Repair-CodexOfficialShortcuts $case.Install } finally { ${function:Save-CodexOfficialShortcutState}=$script:saveState }
Assert ($result.ConfiguredCount -eq 0 -and $result.SkippedCount -eq 1 -and $result.RetryNeeded -and (Hash $link) -ceq $script:concurrentEditHash) 'Repair rollback overwrote a concurrent user edit.'
Assert (@(Get-ChildItem -LiteralPath (Join-Path $case.Install 'official-shortcuts') -Filter '*.lnk').Count -eq 1) 'Refused rollback discarded the recovery backup.'
Expect-Failure { [CodexUsageCard.OfficialShortcut]::WriteChecked($link,$fixture,('0'*64)) } '*changed before writing*'
Assert ((Hash $link) -ceq $script:concurrentEditHash) 'Write CAS replaced a file changed since inspection.'
$passed++

Write-Output ('Official shortcut regressions: {0} checks passed, 0 failed. Real shortcuts and tasks unchanged.' -f $passed)
