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

Write-Output ('Official shortcut regressions: {0} checks passed, 0 failed. Real shortcuts and tasks unchanged.' -f $passed)
