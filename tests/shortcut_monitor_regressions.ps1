# Run with Windows PowerShell 5.1; only disposable workspace files are watched.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private sealed class OfficialShortcutMonitor : IDisposable')
$end = $source.IndexOf('    private static bool RepairOfficialShortcuts()', $start)
if ($start -lt 0 -or $end -le $start) { throw 'Production shortcut monitor boundary changed.' }
$monitor = $source.Substring($start, $end - $start)
$locations = [regex]::Match($monitor, '(?s)            var locations = new\[\] \{.*?            \};').Value
if (-not $locations -or -not $monitor.Contains('RetryDelays = { 2000, 10000, 30000 }') -or -not $monitor.Contains('timer.Change(1000, Timeout.Infinite)')) { throw 'Review changed production monitor locations or timing before updating the fixture.' }
# Preserve production event/scheduling logic, replacing only paths, repair I/O and elapsed time.
$monitor = $monitor.Replace($locations, '            var locations = TestLocations;').Replace('RetryDelays = { 2000, 10000, 30000 }', 'RetryDelays = { 60, 100, 160 }').Replace('timer.Change(1000, Timeout.Infinite)', 'timer.Change(80, Timeout.Infinite)')
$workerEnd = $source.IndexOf('    private static string ConfigurationRoot()', $end)
if ($workerEnd -le $end) { throw 'Production shortcut worker boundary changed.' }
$worker = $source.Substring($end, $workerEnd - $end).Replace('RepairOfficialShortcuts()', 'RepairOfficialShortcutsReal()')
$workerRoot = 'var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));'
if (-not $worker.Contains($workerRoot)) { throw 'Production shortcut worker root boundary changed.' }
$worker = $worker.Replace($workerRoot, 'var root = TestWorkerRoot;')
$harness = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class ShortcutMonitorRegressions
{
    private static string[] TestLocations;
    private static string TestWorkerRoot;
    private static string lastStage;
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static int calls, active, maximumActive, checks, logged;
    private static volatile bool retry, throwRepair, blockRepair, selfWrite;
    private static readonly ManualResetEvent entered = new ManualResetEvent(false);
    private static readonly ManualResetEvent release = new ManualResetEvent(true);
    private static void LogStartup(string code, int processId, Exception error = null) { lastStage = code; Interlocked.Increment(ref logged); }
    private static bool RepairOfficialShortcuts()
    {
        var concurrent = Interlocked.Increment(ref active);
        if (concurrent > maximumActive) maximumActive = concurrent;
        Interlocked.Increment(ref calls);
        try {
            entered.Set();
            if (blockRepair && !release.WaitOne(3000)) throw new Exception("Fixture repair release timed out.");
            if (selfWrite) {
                File.WriteAllText(Path.Combine(TestLocations[0], "Codex.lnk"), "synthetic repair write " + calls);
                Thread.Sleep(35);
            }
            if (throwRepair) throw new IOException("Synthetic repair failure");
            return retry;
        } finally { Interlocked.Decrement(ref active); }
    }
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        checks++;
    }
    private static void Wait(Func<bool> predicate, string message)
    {
        var deadline = Stopwatch.StartNew();
        while (!predicate()) {
            if (deadline.ElapsedMilliseconds > 3500) throw new Exception(message + "; calls=" + calls + ", active=" + active);
            Thread.Sleep(10);
        }
    }
    private static void Quiet(int expected, string message)
    {
        Thread.Sleep(220);
        Check(calls == expected && active == 0, message);
    }
    private static void Change(string path, string value)
    {
        var previous = calls;
        File.WriteAllText(path, value);
        Wait(() => calls >= previous + 1 && active == 0, "Expected shortcut filesystem event");
        Quiet(previous + 1, "A filesystem burst must produce one repair");
    }
__MONITOR__
__WORKER__
    public static int RunWorker(string root)
    {
        TestWorkerRoot = Path.GetFullPath(root);
        var modeFile = Path.Combine(TestWorkerRoot, "mode.txt");
        File.WriteAllText(modeFile, "success");
        Check(!RepairOfficialShortcutsReal() && lastStage == "official-shortcuts-checked", "Hidden worker must pass a quoted installation root and its real parent identity to the module");
        File.WriteAllText(modeFile, "repaired");
        Check(!RepairOfficialShortcutsReal() && lastStage == "official-shortcuts-repaired", "ConfiguredCount must use the module summary contract");
        File.WriteAllText(modeFile, "retry");
        Check(RepairOfficialShortcutsReal() && lastStage == "official-shortcuts-incomplete", "Worker must preserve RetryNeeded");
        File.WriteAllText(modeFile, "exit");
        var rejected = false;
        try { RepairOfficialShortcutsReal(); } catch (InvalidOperationException error) { rejected = error.Message.Contains("exit 7"); }
        Check(rejected, "Nonzero maintenance exit must be reported");
        File.WriteAllText(modeFile, "invalid");
        rejected = false;
        try { RepairOfficialShortcutsReal(); } catch (InvalidDataException) { rejected = true; }
        Check(rejected, "Invalid maintenance summary must not appear successful");
        File.Delete(Path.Combine(TestWorkerRoot, "scripts", "official_shortcuts.ps1"));
        rejected = false;
        try { RepairOfficialShortcutsReal(); } catch (FileNotFoundException) { rejected = true; }
        Check(rejected, "Missing deployed module must be reported before spawning PowerShell");
        return checks;
    }
    public static int Run(string root)
    {
        root = Path.GetFullPath(root);
        TestLocations = new[] { Path.Combine(root, "Desktop"), Path.Combine(root, "Programs"), Path.Combine(root, "QuickLaunch") };
        foreach (var location in TestLocations) Directory.CreateDirectory(location);
        var nested = Directory.CreateDirectory(Path.Combine(TestLocations[1], "Nested")).FullName;
        var shortcut = Path.Combine(TestLocations[0], "Codex.lnk");
        OfficialShortcutMonitor monitor = null;
        try {
            monitor = new OfficialShortcutMonitor();
            Wait(() => calls == 1 && active == 0, "Startup repair did not run");
            Quiet(1, "Startup should scan once");
            File.WriteAllText(Path.Combine(TestLocations[0], "note.txt"), "unrelated");
            File.WriteAllText(Path.Combine(TestLocations[0], "draft.tmp"), "unrelated");
            File.Delete(Path.Combine(TestLocations[0], "draft.tmp"));
            Quiet(1, "Unrelated file changes must not invoke repair");
            Change(shortcut, "created synthetic shortcut");
            Change(shortcut, "changed synthetic shortcut");
            Change(Path.Combine(nested, "Codex.lnk"), "recursive shortcut");
            Change(Path.Combine(TestLocations[2], "Codex.LNK"), "case-insensitive shortcut");
            var previous = calls;
            var replacement = Path.Combine(TestLocations[0], "replacement.tmp");
            File.WriteAllText(replacement, "replacement shortcut");
            File.Replace(replacement, shortcut, null);
            Wait(() => calls >= previous + 1 && active == 0, "Atomic shortcut replacement was missed");
            Quiet(previous + 1, "Atomic shortcut replacement must be coalesced");
            previous = calls;
            File.WriteAllText(replacement, "renamed shortcut");
            var renamed = Path.Combine(TestLocations[0], "Renamed.lnk");
            File.Move(replacement, renamed);
            Wait(() => calls >= previous + 1 && active == 0, "Rename into .lnk was missed");
            Quiet(previous + 1, "Rename into .lnk must be coalesced");
            previous = calls;
            File.Move(renamed, replacement);
            Wait(() => calls >= previous + 1 && active == 0, "Rename away from .lnk was missed");
            Quiet(previous + 1, "Rename away from .lnk must schedule repair");
            previous = calls;
            for (var i = 0; i < 12; i++) { File.WriteAllText(shortcut, "burst " + i); Thread.Sleep(10); }
            Check(calls == previous, "Continuous events must reset the debounce window");
            Wait(() => calls >= previous + 1 && active == 0, "Debounced event did not run");
            Quiet(previous + 1, "Continuous events must settle into one scan");
            previous = calls;
            blockRepair = true; entered.Reset(); release.Reset();
            File.WriteAllText(shortcut, "block repair");
            Check(entered.WaitOne(2000), "Blocking repair did not start");
            for (var i = 0; i < 12; i++) { File.WriteAllText(shortcut, "while active " + i); Thread.Sleep(10); }
            Thread.Sleep(120);
            Check(calls == previous + 1 && active == 1 && maximumActive == 1, "Filesystem events must not start concurrent workers");
            blockRepair = false; release.Set();
            Wait(() => calls >= previous + 2 && active == 0, "Pending event was lost while worker was active");
            Quiet(previous + 2, "Pending events must produce one follow-up repair");
            previous = calls; retry = true;
            File.WriteAllText(shortcut, "retry needed");
            Wait(() => calls >= previous + 4 && active == 0, "Expected initial attempt and three bounded retries");
            Quiet(previous + 4, "Retry budget must stop after three retries");
            previous = calls; selfWrite = true;
            File.WriteAllText(shortcut, "repair emits its own events");
            Wait(() => calls >= previous + 4 && active == 0, "Self-writing repair did not use its bounded retries");
            Quiet(previous + 4, "A failed repair's own events must not replenish the retry budget");
            selfWrite = false; previous = calls;
            File.WriteAllText(shortcut, "backoff event fixture");
            Wait(() => calls == previous + 1 && active == 0, "Backoff fixture did not begin");
            Thread.Sleep(15);
            for (var i = 0; i < 5; i++) { File.WriteAllText(shortcut, "during backoff " + i); Thread.Sleep(5); }
            Wait(() => calls >= previous + 4 && active == 0, "Backoff event fixture did not exhaust retries");
            Quiet(previous + 4, "Events during retry backoff must not reset or extend its budget");
            previous = calls; retry = false; throwRepair = true;
            File.WriteAllText(shortcut, "repair exception");
            Wait(() => calls >= previous + 4 && active == 0, "New event must reset retry budget after an earlier exhausted budget");
            Quiet(previous + 4, "Exceptions must use the same bounded retry budget");
            Check(logged == 4, "Repair failures must be logged rather than silently ignored");
            throwRepair = false; previous = calls;
            monitor.Dispose(); monitor = null;
            File.WriteAllText(shortcut, "after disposal");
            Quiet(previous, "Disposed filesystem watchers must not revive the worker");
            monitor = new OfficialShortcutMonitor();
            monitor.Dispose(); monitor = null;
            Quiet(previous, "Disposal must cancel a pending startup timer");
            blockRepair = true; entered.Reset(); release.Reset();
            monitor = new OfficialShortcutMonitor();
            Check(entered.WaitOne(2000), "Disposal fixture did not enter the worker");
            File.WriteAllText(shortcut, "pending during disposal"); Thread.Sleep(30);
            previous = calls; monitor.Dispose(); monitor = null;
            blockRepair = false; release.Set();
            Wait(() => active == 0, "In-flight work did not complete after disposal");
            File.WriteAllText(shortcut, "disposed with pending event");
            Quiet(previous, "Disposal during a worker must suppress its pending follow-up");
            Check(maximumActive == 1, "Repair callbacks overlapped");
            return checks;
        } finally {
            blockRepair = false; release.Set();
            if (monitor != null) monitor.Dispose();
            Wait(() => active == 0, "Fixture worker did not drain");
        }
    }
}
'@
Add-Type -TypeDefinition $harness.Replace('__MONITOR__', $monitor).Replace('__WORKER__', $worker) -ReferencedAssemblies System.dll, System.Core.dll, System.Web.Extensions.dll
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\shortcut-monitor-' + [Guid]::NewGuid().ToString('N'))
try {
  $checks = [ShortcutMonitorRegressions]::Run($testRoot)
  $workerRoot = Join-Path $testRoot "worker's isolated root"
  $workerScripts = Join-Path $workerRoot 'scripts'
  New-Item -ItemType Directory -Path $workerScripts -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $workerScripts 'official_shortcuts.ps1') -Encoding UTF8 -Value @'
function Repair-CodexOfficialShortcuts {
  param([string]$InstallRoot, [int]$HelperProcessId, [long]$HelperStartTicks)
  if ($InstallRoot -cne (Split-Path -Parent $PSScriptRoot)) { throw 'Incorrect installation root' }
  $parent = Get-Process -Id $HelperProcessId -ErrorAction Stop
  try {
    if ($parent.StartTime.ToUniversalTime().Ticks -ne $HelperStartTicks) { throw 'Incorrect parent identity' }
  } finally { $parent.Dispose() }
  $mode = [IO.File]::ReadAllText((Join-Path $InstallRoot 'mode.txt'))
  if ($mode -eq 'exit') { exit 7 }
  if ($mode -eq 'invalid') { return [pscustomobject]@{ Unexpected = 'invalid' } }
  [pscustomobject]@{ Status = 'Configured'; ConfiguredCount = [int]($mode -eq 'repaired'); AlreadyConfiguredCount = 1; SkippedCount = 0; RetryNeeded = ($mode -eq 'retry') }
}
'@
  $checks = [ShortcutMonitorRegressions]::RunWorker($workerRoot)
  Write-Output ('Shortcut monitor regressions: {0} checks passed, 0 failed.' -f $checks)
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  if (-not $resolved.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
