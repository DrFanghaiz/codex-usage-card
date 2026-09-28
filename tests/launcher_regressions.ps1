# Windows PowerShell 5.1. Execute production startup decisions with fake OS boundaries.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
function MethodBlock($Start, $End) {
    $from = $source.IndexOf($Start)
    if ($from -lt 0) { throw "Missing launcher boundary: $Start" }
    $to = $source.IndexOf($End, $from)
    if ($to -le $from) { throw "Missing launcher boundary: $End" }
    $source.Substring($from, $to - $from)
}
$main = (MethodBlock '    private static void Main(' '    private static async Task MainAsync()').Replace('private static void Main(', 'private static void RunMain(')
$initialize = (MethodBlock '    private static async Task MainAsync()' '        var retrySeconds = 1;').Replace('private static async Task MainAsync()', 'private static void RememberExistingRoots()') + "    }`r`n"
$launch = MethodBlock '    private static void LaunchCodex()' '    private static string FindInstalledCodexAppId()'
$filter = MethodBlock '    private static bool IsCodexRootProcess(' '    private static uint LaunchRegisteredApp('
$port = MethodBlock '    private static int FindAvailableLoopbackPort()' '    private static Task WaitForCodexStartAsync()'
$inspect = MethodBlock '    private static bool InspectCodexStartup()' '    private static async Task<List<CdpTarget>> FindTargetsAsync()'
$identity = MethodBlock '    private sealed class CodexProcessInfo' '    private sealed class OfficialConfiguration'
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
public static class LauncherRegressions
{
    private static string NativeScript, LastArguments, LastAppId, ProcessPath;
    private static int Launches, Focuses, Messages, Queries, Opens, Kills, Waits, FailureLogs;
    private static bool QueryFails, KillFails, LaunchFails, ExitAllowed, HandleAvailable;
    private static DateTime ProcessStart;
    private static Action OnExit;
    private static readonly List<CodexProcessInfo> Roots = new List<CodexProcessInfo>();
    private static readonly HashSet<string> ObservedCodexRoots = new HashSet<string>();
    private static List<CodexProcessInfo> FindCodexRootProcesses() { return new List<CodexProcessInfo>(Roots); }
    private static void FocusCodexWindow(int id) { Focuses++; }
    private static int MessageBox(IntPtr w, string text, string caption, uint type) { Messages++; return 0; }
    private static string FindInstalledCodexAppId()
    {
        Queries++;
        if (QueryFails) throw new InvalidOperationException("Synthetic query failure");
        return "OpenAI.Codex_publisher!App";
    }
    private static uint LaunchRegisteredApp(string path, string args)
    {
        Launches++; LastAppId = path; LastArguments = args;
        if (LaunchFails) throw new InvalidOperationException("Synthetic launch failure");
        return 43;
    }
    private static void LogStartup(string stage, int processId, Exception error = null)
    {
        if (error != null) { Check(stage.EndsWith("-failed"), "Startup failure must be labelled"); FailureLogs++; }
    }
    private static Task MainAsync() { throw new Exception("Explicit launcher entered the background service"); }
    // No real process is opened or killed: the actual production method resolves this nested fake.
    private sealed class Process : IDisposable
    {
        public static Process GetProcessById(int id) { Opens++; Check(id == Roots[0].ProcessId, "Wrong process opened"); return new Process(); }
        public IntPtr Handle { get { return HandleAvailable ? new IntPtr(1) : IntPtr.Zero; } }
        public DateTime StartTime { get { return ProcessStart; } }
        public Module MainModule { get { return new Module { FileName = ProcessPath }; } }
        public void Kill() { Kills++; if (KillFails) throw new InvalidOperationException("Synthetic stop failure"); }
        public bool WaitForExit(int timeout)
        {
            Waits++;
            Check(timeout == 5000, "Legacy exit deadline changed");
            if (ExitAllowed) { Roots.Clear(); if (OnExit != null) OnExit(); }
            return ExitAllowed;
        }
        public void Dispose() { }
    }
    private sealed class Module { public string FileName; }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void ExpectFailure(Action action)
    {
        try { action(); } catch (InvalidOperationException) { return; } catch (TimeoutException) { return; }
        throw new Exception("Expected startup failure was swallowed");
    }
    private static void Reset()
    {
        Roots.Clear(); ObservedCodexRoots.Clear();
        Launches = Focuses = Messages = Queries = Opens = Kills = Waits = FailureLogs = 0;
        QueryFails = KillFails = LaunchFails = false; ExitAllowed = HandleAvailable = true;
        OnExit = null; Environment.ExitCode = 0;
    }
    private static CodexProcessInfo OrdinaryRoot()
    {
        var created = new DateTime(2026, 9, 26, 10, 0, 0, DateTimeKind.Utc);
        var root = new CodexProcessInfo {
            ProcessId = 43, CreationDate = ManagementDateTimeConverter.ToDmtfDateTime(created),
            ExecutablePath = @"C:\Packages\OpenAI.Codex_1\app\ChatGPT.exe", CommandLine = "ChatGPT.exe"
        };
        Roots.Add(root); ProcessStart = created.AddTicks(9); ProcessPath = root.ExecutablePath;
        return root;
    }
    public static int Test()
    {
        int passed = 0;
        Reset(); RunMain(new[] { "--launch" });
        Check(Launches == 1 && Queries == 1 && Kills == 0 && Messages == 0, "Cold launch must start once without a prompt");
        Check(LastAppId == "OpenAI.Codex_publisher!App", "Registered application identity must be used");
        var match = Regex.Match(LastArguments, @"^--remote-debugging-address=127\.0\.0\.1 --remote-debugging-port=(\d+) --remote-allow-origins=http://127\.0\.0\.1:\1$");
        Check(match.Success && int.Parse(match.Groups[1].Value) > 0 && int.Parse(match.Groups[1].Value) <= 65535, "Dynamic loopback arguments must agree"); passed++;

        Reset(); OrdinaryRoot(); RunMain(new[] { "--launch" });
        Check(Focuses == 1 && Kills == 0 && Queries == 0 && Messages == 0 && Launches == 0, "Manual launch preserves an existing client"); passed++;

        Reset(); OrdinaryRoot(); RememberExistingRoots();
        Check(!InspectCodexStartup() && !InspectCodexStartup(), "Preexisting client must remain untouched");
        Check(Kills == 0 && Queries == 0 && Opens == 0 && Launches == 0, "Helper upgrade cannot restart an existing session"); passed++;

        Reset(); RememberExistingRoots(); OrdinaryRoot(); InspectCodexStartup(); InspectCodexStartup();
        Check(Kills == 1 && Waits == 1 && Queries == 1 && Launches == 1 && Messages == 0, "New official startup must be relaunched exactly once without asking"); passed++;

        Reset(); OrdinaryRoot().CommandLine += " --remote-debugging-port=50001";
        Check(InspectCodexStartup(), "Existing debug session must be ready");
        Check(Kills == 0 && Queries == 0 && Launches == 0, "Existing CDP startup must be passed through"); passed++;

        for (int change = 0; change < 3; change++) {
            Reset(); var expected = OrdinaryRoot(); Roots.Clear(); var current = OrdinaryRoot();
            if (change == 0) current.ProcessId++;
            if (change == 1) current.CreationDate = ManagementDateTimeConverter.ToDmtfDateTime(ProcessStart.AddMinutes(1));
            if (change == 2) current.ExecutablePath = @"C:\Packages\OpenAI.Codex_3\app\ChatGPT.exe";
            RelaunchWithRemoteDebugging(expected);
            Check(Queries == 0 && Opens == 0 && Kills == 0 && Launches == 0, "Stale discovered identity cannot kill a replacement");
        } passed++;

        for (int change = 0; change < 3; change++) {
            Reset(); OrdinaryRoot();
            if (change == 0) ProcessStart = ProcessStart.AddTicks(10);
            if (change == 1) ProcessPath = @"C:\Packages\OpenAI.Codex_3\app\ChatGPT.exe";
            if (change == 2) HandleAvailable = false;
            ExpectFailure(() => InspectCodexStartup());
            Check(Opens == 1 && Kills == 0 && Launches == 0, "Actual process handle, time and path must match before stopping");
        } passed++;

        Reset(); OrdinaryRoot(); QueryFails = true; ExpectFailure(() => InspectCodexStartup());
        Check(Queries == 1 && Opens == 0 && Kills == 0 && Launches == 0, "Package resolution failure must happen before stop"); passed++;

        foreach (bool killFails in new[] { true, false }) {
            Reset(); OrdinaryRoot(); KillFails = killFails; ExitAllowed = false;
            ExpectFailure(() => InspectCodexStartup()); InspectCodexStartup();
            Check(Kills == 1 && Waits == (killFails ? 0 : 1) && Launches == 0 && Roots.Count == 1, "Failed stop or timeout cannot launch or repeatedly kill the same identity");
        } passed++;

        Reset(); var pending = OrdinaryRoot();
        using (var busy = new Mutex(true, @"Local\CodexUsageCard.Launcher")) {
            RunMain(new[] { "--launch" }); InspectCodexStartup();
            Check(Focuses == 1 && Kills == 0 && Queries == 0 && !ObservedCodexRoots.Contains(pending.Identity), "Busy launcher must not claim or stop the root");
        }
        InspectCodexStartup(); Check(Kills == 1 && Launches == 1, "Root stays eligible after lock contention"); passed++;

        Reset(); OrdinaryRoot(); OnExit = () => { OrdinaryRoot().ProcessId = 44; };
        InspectCodexStartup();
        Check(Kills == 1 && Waits == 1 && Launches == 1 && Focuses == 0, "A temporary forwarding root must not cancel the replacement launch"); passed++;

        Reset(); OrdinaryRoot(); LaunchFails = true;
        ExpectFailure(() => InspectCodexStartup());
        Check(Kills == 1 && Waits == 1 && Launches == 1 && FailureLogs == 1, "Failed replacement must preserve the real startup error in diagnostics"); passed++;

        Reset(); OrdinaryRoot(); RememberExistingRoots(); Roots.Clear(); var reused = OrdinaryRoot();
        reused.CreationDate = ManagementDateTimeConverter.ToDmtfDateTime(ProcessStart.AddMinutes(1));
        ProcessStart = ManagementDateTimeConverter.ToDateTime(reused.CreationDate).ToUniversalTime();
        InspectCodexStartup(); Check(Kills == 1 && Launches == 1, "PID reuse with a new creation time is a new startup"); passed++;

        Reset(); using (var busy = new Mutex(true, @"Local\CodexUsageCard.Launcher")) RunMain(new[] { "--launch" });
        Check(Launches == 0 && Queries == 0 && Messages == 0, "Competing cold launcher must not duplicate startup"); passed++;

        Reset(); RunMain(new[] { "--unknown" });
        Check(Launches == 0 && Queries == 0 && Messages == 0 && Environment.ExitCode == 2, "Unknown arguments cannot start client or service"); passed++;

        Reset();
        Check(IsCodexRootProcess(@"C:\Packages\OpenAI.Codex_3\app\ChatGPT.exe", "ChatGPT.exe"), "Official root rejected");
        Check(!IsCodexRootProcess(@"C:\Packages\OpenAI.Codex_3\app\ChatGPT.exe", "ChatGPT.exe --type=renderer"), "Renderer accepted");
        Check(!IsCodexRootProcess(@"C:\Packages\OpenAI.ChatGPT_3\app\ChatGPT.exe", "ChatGPT.exe"), "Other package accepted");
        Check(!HasRemoteDebuggingPort("ChatGPT.exe --remote-debugging-port-extra=2"), "Wrong switch accepted");
        Check(!InspectCodexStartup() && Kills == 0, "No root must keep the helper waiting"); passed++;

        Reset(); QueryFails = true; RunMain(new[] { "--launch" });
        Check(Environment.ExitCode == 1 && Messages == 1 && Kills == 0 && Launches == 0, "Manual startup errors must remain visible"); passed++;
        return passed;
    }
__MAIN__
__INITIALIZE__
__LAUNCH__
__FILTER__
__PORT__
__INSPECT__
__IDENTITY__
}
'@
$harness = $harness.Replace('__MAIN__', $main).Replace('__INITIALIZE__', $initialize).Replace('__LAUNCH__', $launch).Replace('__FILTER__', $filter).Replace('__PORT__', $port).Replace('__INSPECT__', $inspect).Replace('__IDENTITY__', $identity)
$harness = $harness.Replace('Local\CodexUsageCard.', ('Local\CodexUsageCard.Test.' + [Guid]::NewGuid().ToString('N') + '.'))
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll,System.Core.dll,System.Management.dll -WarningAction SilentlyContinue
$passed = [LauncherRegressions]::Test()
Write-Output "Launcher regression groups passed: $passed; 0 failed (synthetic processes only)."
