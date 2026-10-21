# Installation-time helpers only. Dot-sourcing does not inspect or modify the host.
function Initialize-CodexOfficialShortcutApi {
  if ('CodexUsageCard.OfficialShortcut' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
namespace CodexUsageCard {
  public static class OfficialShortcut {
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW {
      void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr data, uint flags);
      void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
      void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
      void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
      void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
      void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
      void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
      void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
      void GetHotkey(out short value); void SetHotkey(short value);
      void GetShowCmd(out int value); void SetShowCmd(int value);
      void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count, out int index);
      void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
      void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
      void Resolve(IntPtr window, uint flags);
      void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
    }
    [DllImport("shell32.dll")] private static extern int SHGetNameFromIDList(IntPtr list, uint kind, out IntPtr name);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    public sealed class Info {
      public string TargetPath, TargetParsingPath, IdList, Arguments, WorkingDirectory, Description, IconPath;
      public int IconIndex, ShowCommand; public short Hotkey;
    }
    private static object Load(string path, int mode) {
      object value = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
      try { ((IPersistFile)value).Load(path, mode); return value; }
      catch { Marshal.FinalReleaseComObject(value); throw; }
    }
    public static Info Read(string path) {
      object value = Load(path, 0);
      try {
        var link = (IShellLinkW)value; var text = new StringBuilder(32768); var result = new Info();
        link.GetPath(text, text.Capacity, IntPtr.Zero, 4); result.TargetPath=text.ToString(); text.Clear();
        link.GetArguments(text, text.Capacity); result.Arguments=text.ToString(); text.Clear();
        link.GetWorkingDirectory(text, text.Capacity); result.WorkingDirectory=text.ToString(); text.Clear();
        link.GetDescription(text, text.Capacity); result.Description=text.ToString(); text.Clear();
        link.GetIconLocation(text, text.Capacity, out result.IconIndex); result.IconPath=text.ToString();
        link.GetShowCmd(out result.ShowCommand); link.GetHotkey(out result.Hotkey);
        IntPtr list; link.GetIDList(out list);
        try {
          if (list != IntPtr.Zero) {
            int size=0;
            while (size < 65536) { int item=(ushort)Marshal.ReadInt16(list,size); if (item==0) {size+=2;break;} if(item<2||size+item>=65536)throw new InvalidDataException("Invalid shortcut PIDL.");size+=item; }
            if(size>=65536)throw new InvalidDataException("Shortcut PIDL is too large.");
            var bytes=new byte[size];Marshal.Copy(list,bytes,0,size);result.IdList=Convert.ToBase64String(bytes);
            IntPtr name;
            if(SHGetNameFromIDList(list,0x80028000,out name)==0) {
              try { result.TargetParsingPath=Marshal.PtrToStringUni(name); } finally { Marshal.FreeCoTaskMem(name); }
            }
          }
        } finally { if(list!=IntPtr.Zero)Marshal.FreeCoTaskMem(list); }
        return result;
      } finally { Marshal.FinalReleaseComObject(value); }
    }
    public static bool IsPackageTarget(Info info,string appId) {
      if(!String.IsNullOrEmpty(info.TargetPath)||String.IsNullOrEmpty(info.IdList)||String.IsNullOrEmpty(appId))return false;
      foreach(var prefix in new[]{"shell:AppsFolder\\","::{4234d49b-0245-4df3-b780-3893943456e1}\\","shell:::{4234d49b-0245-4df3-b780-3893943456e1}\\","::{AD1405D2-30CF-4877-8468-1EE1C52C759F}\\Apps\\","shell:::{AD1405D2-30CF-4877-8468-1EE1C52C759F}\\Apps\\"})
        if(String.Equals(info.TargetParsingPath,prefix+appId,StringComparison.OrdinalIgnoreCase))return true;
      return false;
    }
    public static void SetArguments(string path,string arguments) {
      object value=Load(path,2);
      try { ((IShellLinkW)value).SetArguments(arguments);((IPersistFile)value).Save(path,true); }
      finally { Marshal.FinalReleaseComObject(value); }
    }
    public static string MergeArguments(string arguments) {
      arguments=arguments??"";
      bool quoted=false;int slashes=0;
      foreach(char c in arguments) {if(c=='\\'){slashes++;continue;}if(c=='"'&&slashes%2==0)quoted=!quoted;slashes=0;}
      if(quoted)throw new InvalidDataException("Unbalanced quotes in official shortcut arguments; unchanged.");
      int count;IntPtr argv=CommandLineToArgvW("codex.exe "+arguments,out count);
      if(argv==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
      try {
        var values=new List<string>();for(int i=1;i<count;i++)values.Add(Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv,i*IntPtr.Size)));
        var required=new[]{"--remote-debugging-address=127.0.0.1","--remote-debugging-port=0"};
        var missing=new List<string>();bool separator=values.Contains("--");
        foreach(string flag in required) {
          int equal=flag.IndexOf('=');string key=flag.Substring(0,equal),expected=flag.Substring(equal+1);bool found=false;
          for(int i=0;i<values.Count;i++) {
            if(values[i]=="--")break;
            if(values[i]==key) {
              if(i+1>=values.Count||values[++i]!=expected)throw new InvalidDataException("Conflicting "+key+" in official shortcut; unchanged.");
              found=true;
            } else if(values[i].StartsWith(key+"=",StringComparison.Ordinal)) {
              if(values[i]!=flag)throw new InvalidDataException("Conflicting "+key+" in official shortcut; unchanged.");found=true;
            }
          }
          if(!found)missing.Add(flag);
        }
        if(missing.Count==0)return arguments;
        if(separator)throw new InvalidDataException("Cannot append debugging switches after --; official shortcut unchanged.");
        return arguments+(arguments.Length==0||arguments.EndsWith(" ")||arguments.EndsWith("\t")?"":" ")+String.Join(" ",missing.ToArray());
      } finally { LocalFree(argv); }
    }
    public static string Hash(byte[] bytes) { using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-",""); }
    // Hold the existing file exclusively: verify its bytes before changing them.
    public static void WriteChecked(string path,byte[] bytes,string expected) {
      using(var file=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
        byte[] original;
        using(var memory=new MemoryStream()){file.CopyTo(memory);original=memory.ToArray();}
        if(!String.Equals(Hash(original),expected,StringComparison.OrdinalIgnoreCase))throw new IOException("Shortcut or state changed before writing: "+path);
        try {file.Position=0;file.Write(bytes,0,bytes.Length);file.SetLength(bytes.Length);file.Flush(true);}
        catch {file.Position=0;file.Write(original,0,original.Length);file.SetLength(original.Length);file.Flush(true);throw;}
      }
    }
  }
}
'@
}

function Get-CodexOfficialAppId {
  $package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { return $null }
  $apps = @((Get-AppxPackageManifest -Package $package.PackageFullName -ErrorAction Stop).Package.Applications.Application | Where-Object { $_.Executable -and $_.Executable.Replace([char]92,[char]47) -ieq 'app/ChatGPT.exe' })
  if ($apps.Count -ne 1) { throw 'Registered Codex application is ambiguous; official shortcuts were not changed.' }
  return $package.PackageFamilyName + '!' + $apps[0].Id
}

function Get-CodexOfficialShortcutCandidates {
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $locations = @(
    @{Path=[Environment]::GetFolderPath('DesktopDirectory'); Recurse=$false},
    @{Path=[Environment]::GetFolderPath('Programs'); Recurse=$true},
    @{Path=(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'); Recurse=$false}
  )
  foreach ($location in $locations) {
    if (-not $location.Path -or -not [IO.Directory]::Exists($location.Path)) { continue }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($location.Path)
    while ($pending.Count) {
      $directory = $pending.Pop()
      if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      foreach ($item in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if ($item.PSIsContainer) { if ($location.Recurse) { $pending.Push($item.FullName) } }
        elseif ($item.Extension -ieq '.lnk' -and $seen.Add($item.FullName)) { $item.FullName }
      }
    }
  }
}

function Read-CodexOfficialShortcutState {
  param([string]$StatePath)
  if (-not [IO.File]::Exists($StatePath)) { return @() }
  $state = [IO.File]::ReadAllText($StatePath) | ConvertFrom-Json -ErrorAction Stop
  if ($state.Version -ne 1 -or $null -eq $state.Entries) { throw 'Invalid official shortcut restoration state.' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in @($state.Entries)) {
    if (-not [IO.Path]::IsPathRooted($entry.Path) -or [IO.Path]::GetExtension($entry.Path) -ine '.lnk' -or
        $entry.BackupName -notmatch '\A[0-9a-f]{32}\.lnk\z' -or $entry.OriginalHash -notmatch '\A[0-9A-Fa-f]{64}\z' -or
        $entry.InstalledHash -notmatch '\A[0-9A-Fa-f]{64}\z' -or -not $entry.IdList -or -not $entry.AppId -or -not $seen.Add([IO.Path]::GetFullPath($entry.Path))) {
      throw 'Invalid official shortcut restoration entry.'
    }
    [void][DateTime]::Parse($entry.OriginalWriteTimeUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    $entry
  }
}

function Save-CodexOfficialShortcutState {
  param([string]$StatePath, [object[]]$Entries, [string]$ExpectedHash)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes((@{Version=1; Entries=@($Entries)} | ConvertTo-Json -Depth 5))
  if ($ExpectedHash) { [CodexUsageCard.OfficialShortcut]::WriteChecked($StatePath, $bytes, $ExpectedHash) }
  else {
    $temporary = $StatePath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try { [IO.File]::WriteAllBytes($temporary,$bytes); [IO.File]::Move($temporary,$StatePath) }
    finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
  }
  [CodexUsageCard.OfficialShortcut]::Hash($bytes)
}

function Undo-CodexOfficialShortcutInstall {
  param([Parameter(Mandatory=$true)]$Transaction)
  if ($Transaction.RolledBack) { return }
  if (-not $Transaction.Changes.Count -and -not $Transaction.CreatedBackups.Count -and -not $Transaction.StateAfterHash) { return }
  Initialize-CodexOfficialShortcutApi
  $failures = @()
  foreach ($change in @($Transaction.Changes.ToArray()) | Sort-Object Index -Descending) {
    try {
      $currentHash = [CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($change.Path))
      if ($currentHash -ceq $change.BeforeHash) { continue }
      $bytes = [IO.File]::ReadAllBytes($change.BeforeBackup)
      if ([CodexUsageCard.OfficialShortcut]::Hash($bytes) -cne $change.BeforeHash) { throw 'Original shortcut backup changed.' }
      [CodexUsageCard.OfficialShortcut]::WriteChecked($change.Path, $bytes, $change.AfterHash)
      [IO.File]::SetLastWriteTimeUtc($change.Path, $change.BeforeWriteTimeUtc)
    } catch { $failures += ('{0}: {1}' -f $change.Path, $_.Exception.Message) }
  }
  if ($failures.Count) { throw ('Official shortcut rollback refused changed files; backups retained. ' + ($failures -join '; ')) }
  if ($Transaction.StateAfterHash) {
    if ($Transaction.StateBeforeBackup) {
      $bytes = [IO.File]::ReadAllBytes($Transaction.StateBeforeBackup)
      if ([CodexUsageCard.OfficialShortcut]::Hash($bytes) -cne $Transaction.StateBeforeHash) { throw 'Shortcut state backup changed.' }
      [CodexUsageCard.OfficialShortcut]::WriteChecked($Transaction.StatePath, $bytes, $Transaction.StateAfterHash)
    } else {
      if ([CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($Transaction.StatePath)) -cne $Transaction.StateAfterHash) { throw 'Shortcut state changed during rollback.' }
      [IO.File]::Delete($Transaction.StatePath)
    }
  }
  foreach ($backup in $Transaction.CreatedBackups) {
    if ([IO.File]::Exists($backup.Path) -and [CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($backup.Path)) -ceq $backup.Hash) { [IO.File]::Delete($backup.Path) }
  }
  $Transaction.RolledBack = $true
}

function Install-CodexOfficialShortcuts {
  param([Parameter(Mandatory=$true)][string]$InstallRoot, [Parameter(Mandatory=$true)][string]$BackupDirectory)
  $stateDirectory = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'official-shortcuts'
  $transaction = [pscustomobject]@{Status='PackageNotFound'; ConfiguredCount=0; AlreadyConfiguredCount=0; Paths=@(); Changes=(New-Object 'System.Collections.Generic.List[object]'); CreatedBackups=(New-Object 'System.Collections.Generic.List[object]'); StatePath=(Join-Path $stateDirectory 'state.json'); StateBeforeBackup=$null; StateBeforeHash=$null; StateAfterHash=$null; RolledBack=$false}
  $appId = Get-CodexOfficialAppId
  if (-not $appId) { return $transaction }
  Initialize-CodexOfficialShortcutApi
  $stateBytes = if ([IO.File]::Exists($transaction.StatePath)) { [IO.File]::ReadAllBytes($transaction.StatePath) } else { $null }
  if ($null -ne $stateBytes) { $transaction.StateBeforeHash = [CodexUsageCard.OfficialShortcut]::Hash($stateBytes) }
  $entries = New-Object 'System.Collections.Generic.List[object]'
  foreach ($entry in @(Read-CodexOfficialShortcutState $transaction.StatePath)) { $entries.Add($entry) }
  $transaction.Status = 'NotFound'
  try {
    foreach ($path in @(Get-CodexOfficialShortcutCandidates | Select-Object -Unique)) {
      $path = [IO.Path]::GetFullPath($path)
      if (-not [IO.File]::Exists($path) -or [IO.Path]::GetExtension($path) -ine '.lnk' -or ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint)) { continue }
      try { $before = [CodexUsageCard.OfficialShortcut]::Read($path) }
      catch { Write-Warning ('Could not inspect shortcut; unchanged: {0}' -f $path); continue }
      if (-not [CodexUsageCard.OfficialShortcut]::IsPackageTarget($before,$appId)) { continue }
      $transaction.Paths += $path
      $arguments = [CodexUsageCard.OfficialShortcut]::MergeArguments($before.Arguments)
      if ($arguments -ceq $before.Arguments) { $transaction.AlreadyConfiguredCount++; continue }
      $bytes = [IO.File]::ReadAllBytes($path)
      $beforeHash = [CodexUsageCard.OfficialShortcut]::Hash($bytes)
      $writeTime = [IO.File]::GetLastWriteTimeUtc($path)
      $owned = @($entries | Where-Object { $_.Path -ieq $path })
      if ($owned.Count -and $owned[0].InstalledHash -cne $beforeHash) { throw ('Official shortcut changed since installation; unchanged: {0}' -f $path) }
      [void][IO.Directory]::CreateDirectory($BackupDirectory)
      [void][IO.Directory]::CreateDirectory($stateDirectory)
      if (-not $transaction.Changes.Count -and $null -ne $stateBytes) {
        $transaction.StateBeforeBackup = Join-Path $BackupDirectory 'official-shortcut-state.json'
        [IO.File]::WriteAllBytes($transaction.StateBeforeBackup,$stateBytes)
      }
      $index = $transaction.Changes.Count
      $original = Join-Path $BackupDirectory ('official-before-{0}.lnk' -f $index)
      $staged = Join-Path $BackupDirectory ('official-after-{0}.lnk' -f $index)
      [IO.File]::WriteAllBytes($original,$bytes); [IO.File]::WriteAllBytes($staged,$bytes)
      $stagedBefore = [CodexUsageCard.OfficialShortcut]::Read($staged)
      if ($stagedBefore.IdList -cne $before.IdList -or $stagedBefore.Arguments -cne $before.Arguments) { throw 'Official shortcut changed while preparing update.' }
      [CodexUsageCard.OfficialShortcut]::SetArguments($staged,$arguments)
      $after = [CodexUsageCard.OfficialShortcut]::Read($staged)
      foreach ($property in @('TargetPath','TargetParsingPath','IdList','WorkingDirectory','Description','IconPath','IconIndex','ShowCommand','Hotkey')) {
        if ($before.$property -cne $after.$property) { throw ('Official shortcut metadata changed: ' + $property) }
      }
      if ($after.Arguments -cne $arguments) { throw 'Official shortcut arguments were not saved.' }
      $updated = [IO.File]::ReadAllBytes($staged)
      $afterHash = [CodexUsageCard.OfficialShortcut]::Hash($updated)
      if (-not $owned.Count) {
        $backupName = [Guid]::NewGuid().ToString('N') + '.lnk'
        $backupPath = Join-Path $stateDirectory $backupName
        [IO.File]::WriteAllBytes($backupPath,$bytes)
        $transaction.CreatedBackups.Add(@{Path=$backupPath;Hash=$beforeHash})
        $entries.Add([pscustomobject]@{Path=$path;BackupName=$backupName;OriginalHash=$beforeHash;InstalledHash=$afterHash;IdList=$before.IdList;AppId=$appId;OriginalWriteTimeUtc=$writeTime.ToString('o')})
      } else { $owned[0].InstalledHash=$afterHash }
      [CodexUsageCard.OfficialShortcut]::WriteChecked($path,$updated,$beforeHash)
      $transaction.Changes.Add([pscustomobject]@{Index=$index;Path=$path;BeforeBackup=$original;BeforeHash=$beforeHash;AfterHash=$afterHash;BeforeWriteTimeUtc=$writeTime})
      $transaction.ConfiguredCount++
    }
    if ($transaction.ConfiguredCount) {
      $transaction.StateAfterHash = Save-CodexOfficialShortcutState $transaction.StatePath $entries.ToArray() $transaction.StateBeforeHash
      $transaction.Status='Configured'
    } elseif ($transaction.AlreadyConfiguredCount) { $transaction.Status='AlreadyConfigured' }
    return $transaction
  } catch {
    $failure = $_
    try { Undo-CodexOfficialShortcutInstall $transaction }
    catch { throw ('Official shortcut configuration failed: {0}. Rollback also failed: {1}. Backup: {2}' -f $failure.Exception.Message,$_.Exception.Message,$BackupDirectory) }
    throw $failure
  }
}

function Restore-CodexOfficialShortcuts {
  param([Parameter(Mandatory=$true)][string]$InstallRoot)
  $directory = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'official-shortcuts'
  $statePath = Join-Path $directory 'state.json'
  $result = [pscustomobject]@{Status='NotFound';RestoredCount=0;SkippedCount=0;Paths=@()}
  if (-not [IO.File]::Exists($statePath)) { return $result }
  Initialize-CodexOfficialShortcutApi
  $stateHash = [CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($statePath))
  $entries = @(Read-CodexOfficialShortcutState $statePath)
  $remaining = New-Object 'System.Collections.Generic.List[object]'
  foreach ($entry in $entries) {
    try {
      if (-not [IO.File]::Exists($entry.Path) -or ([IO.File]::GetAttributes($entry.Path) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Shortcut is missing or replaced.' }
      $current = [CodexUsageCard.OfficialShortcut]::Read($entry.Path)
      if ($current.IdList -cne $entry.IdList -or -not [CodexUsageCard.OfficialShortcut]::IsPackageTarget($current,$entry.AppId)) { throw 'Shortcut target changed.' }
      $bytes = [IO.File]::ReadAllBytes((Join-Path $directory $entry.BackupName))
      if ([CodexUsageCard.OfficialShortcut]::Hash($bytes) -cne $entry.OriginalHash) { throw 'Original shortcut backup changed.' }
      $hash = [CodexUsageCard.OfficialShortcut]::Hash([IO.File]::ReadAllBytes($entry.Path))
      if ($hash -cne $entry.OriginalHash) { [CodexUsageCard.OfficialShortcut]::WriteChecked($entry.Path,$bytes,$entry.InstalledHash) }
      [IO.File]::SetLastWriteTimeUtc($entry.Path,[DateTime]::Parse($entry.OriginalWriteTimeUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind))
      $result.RestoredCount++; $result.Paths += $entry.Path
    } catch {
      $remaining.Add($entry); $result.SkippedCount++
      Write-Warning ('Official shortcut not restored; current file and backup retained: {0}. {1}' -f $entry.Path,$_.Exception.Message)
    }
  }
  if ($result.RestoredCount) { [void](Save-CodexOfficialShortcutState $statePath $remaining.ToArray() $stateHash) }
  $result.Status = if ($result.SkippedCount) { 'ChangedShortcutsRetained' } elseif ($result.RestoredCount) { 'Restored' } else { 'NotFound' }
  return $result
}
