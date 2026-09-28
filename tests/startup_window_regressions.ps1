# Real user32 events in the current desktop; never starts, closes, or reads Codex.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $root ('.runtime-test\startup-window-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'native-patch\CodexNativeQuotaPatch.cs')
function SourceBlock($Start, $End) {
    $from = $source.IndexOf($Start)
    if ($from -lt 0) { throw "Missing production boundary: $Start" }
    $to = $source.IndexOf($End, $from)
    if ($to -le $from) { throw "Missing production boundary: $End" }
    $source.Substring($from, $to - $from)
}
$waiter = (SourceBlock '    private static void WaitForCodexWindow()' '    private static bool InspectCodexStartup()').Replace('"ChatGPT"', '"QuotaWindowProbe"')
$nativeStart = $source.LastIndexOf('    [StructLayout(LayoutKind.Sequential)]', $source.IndexOf('    private struct NativeMessage'))
$nativeEnd = $source.LastIndexOf('    [DllImport("user32.dll")]', $source.IndexOf('    private static extern bool IsIconic('))
if ($nativeStart -lt 0 -or $nativeEnd -le $nativeStart) { throw 'Missing production user32 boundaries.' }
$native = $source.Substring($nativeStart, $nativeEnd - $nativeStart)
if ($waiter -notmatch '(?s)finally\s*\{\s*if \(shownHook != IntPtr.Zero\) UnhookWinEvent\(shownHook\);\s*if \(foregroundHook != IntPtr.Zero\) UnhookWinEvent\(foregroundHook\);\s*callbackHandle.Free\(\);') {
    throw 'Both hooks and the callback handle must be released in finally.'
}
$harness = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
internal static class StartupWindowHarness
{
    private static string Root, Mode;
    private static int Calls;
    [STAThread]
    private static void Main(string[] args)
    {
        Root = args[0]; Mode = args[1];
        try
        {
            var owner = GetCurrentThreadId();
            if (Mode == "quit")
            {
                var stop = new Thread(() => {
                    while (!File.Exists(Path.Combine(Root, "stop"))) Thread.Sleep(20);
                    if (!PostThreadMessage(owner, 0x0012, UIntPtr.Zero, IntPtr.Zero))
                        File.WriteAllText(Path.Combine(Root, "error"), "WM_QUIT could not be posted");
                });
                stop.IsBackground = true;
                stop.Start();
            }
            WaitForCodexWindow();
            GC.Collect(); GC.WaitForPendingFinalizers();
            File.WriteAllText(Path.Combine(Root, "done"), Calls.ToString());
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(Root, "error"), error.ToString());
            Environment.ExitCode = 1;
        }
    }
    private static bool InspectCodexStartup()
    {
        Calls++;
        File.AppendAllText(Path.Combine(Root, "calls"), DateTime.UtcNow.Ticks + Environment.NewLine);
        if (Calls == 1)
        {
            File.WriteAllText(Path.Combine(Root, "ready"), "1");
            if (Mode == "race")
            {
                var deadline = Stopwatch.StartNew();
                while (!File.Exists(Path.Combine(Root, "release")))
                {
                    if (deadline.ElapsedMilliseconds > 12000) throw new TimeoutException("Initial inspection was not released");
                    Thread.Sleep(10);
                }
            }
        }
        return Mode == "initial" || (Mode != "quit" && Calls == 2);
    }
__WAITER__
__NATIVE__
}
'@
$probe = @'
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
internal sealed class QuotaWindowProbe : Form
{
    private readonly string Root;
    private readonly Timer Lifetime = new Timer();
    private QuotaWindowProbe(string root)
    {
        Root = root;
        Opacity = 0; ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual; Location = new Point(-32000, -32000); Size = new Size(1, 1);
        Lifetime.Interval = 4500; Lifetime.Tick += (s, e) => { Lifetime.Stop(); Close(); Application.ExitThread(); };
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams
    {
        get { var value = base.CreateParams; value.ExStyle |= 0x08000000 | 0x00000080; return value; }
    }
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (GetForegroundWindow() == Handle || Opacity != 0 || ShowInTaskbar)
            File.WriteAllText(Path.Combine(Root, "probe-error"), "Probe must remain transparent and inactive");
        File.WriteAllText(Path.Combine(Root, "shown"), DateTime.UtcNow.Ticks.ToString());
        Lifetime.Start();
    }
    [STAThread]
    private static void Main(string[] args)
    {
        using (var form = new QuotaWindowProbe(args[0]))
        using (var show = new Timer())
        {
            // Show after startup so STARTF_USESHOWWINDOW=SW_HIDE cannot consume the only SHOW event.
            show.Interval = 200; show.Tick += (s, e) => { show.Stop(); form.Show(); };
            show.Start(); Application.Run();
        }
    }
}
'@
$encoding = New-Object Text.UTF8Encoding($false)
$harnessFile = Join-Path $testRoot 'StartupWindowHarness.cs'
$probeFile = Join-Path $testRoot 'QuotaWindowProbe.cs'
[IO.File]::WriteAllText($harnessFile, $harness.Replace('__WAITER__', $waiter).Replace('__NATIVE__', $native), $encoding)
[IO.File]::WriteAllText($probeFile, $probe, $encoding)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$harnessExe = Join-Path $testRoot 'StartupWindowHarness.exe'
$probeExe = Join-Path $testRoot 'QuotaWindowProbe.exe'
& $compiler /nologo /target:winexe "/out:$harnessExe" $harnessFile
if ($LASTEXITCODE -ne 0) { throw 'Startup watcher harness compilation failed.' }
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$probeExe" $probeFile
if ($LASTEXITCODE -ne 0) { throw 'Invisible window probe compilation failed.' }
function AwaitFile($Path, $Process) {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $Path)) {
        if ($Process.HasExited -or $deadline.ElapsedMilliseconds -gt 15000) {
            $failure = Join-Path (Split-Path -Parent $Path) 'error'
            if (Test-Path -LiteralPath $failure) { throw (Get-Content -Raw -LiteralPath $failure) }
            throw "Timed out waiting for $Path (process exited: $($Process.HasExited))."
        }
        Start-Sleep -Milliseconds 25
    }
}
$passed = 0
foreach ($mode in @('initial', 'race', 'idle', 'quit')) {
    $case = Join-Path $testRoot $mode
    New-Item -ItemType Directory -Path $case | Out-Null
    $watcher = $null; $window = $null
    try {
        $watcher = Start-Process -FilePath $harnessExe -ArgumentList @(('"' + $case + '"'), $mode) -WindowStyle Hidden -PassThru
        AwaitFile (Join-Path $case 'ready') $watcher
        if ($mode -eq 'idle' -or $mode -eq 'quit') {
            Start-Sleep -Milliseconds 2600
            if (@(Get-Content -LiteralPath (Join-Path $case 'calls')).Count -ne 1 -or $watcher.HasExited) {
                throw 'An idle watcher must block without repeating the initial inspection.'
            }
        }
        if ($mode -eq 'race' -or $mode -eq 'idle') {
            $window = Start-Process -FilePath $probeExe -ArgumentList ('"' + $case + '"') -WindowStyle Hidden -PassThru
            AwaitFile (Join-Path $case 'shown') $window
            $eventTicks = [long](Get-Content -Raw -LiteralPath (Join-Path $case 'shown'))
            if ($mode -eq 'race') {
                if (@(Get-Content -LiteralPath (Join-Path $case 'calls')).Count -ne 1) { throw 'Race probe did not run during the initial inspection.' }
                $eventTicks = [DateTime]::UtcNow.Ticks
                [IO.File]::WriteAllText((Join-Path $case 'release'), '1')
            }
        }
        if ($mode -eq 'quit') { [IO.File]::WriteAllText((Join-Path $case 'stop'), '1') }
        AwaitFile (Join-Path $case 'done') $watcher
        if (-not $watcher.WaitForExit(3000) -or $watcher.ExitCode -ne 0) { throw 'Watcher did not exit cleanly.' }
        $calls = @(Get-Content -LiteralPath (Join-Path $case 'calls'))
        $expected = if ($mode -eq 'race' -or $mode -eq 'idle') { 2 } else { 1 }
        if ($calls.Count -ne $expected) { throw "Unexpected inspection count for ${mode}: $($calls.Count)." }
        if ($expected -eq 2) {
            $grace = ([long]$calls[1] - $eventTicks) / [TimeSpan]::TicksPerMillisecond
            if ($grace -lt 1900 -or $grace -gt 10000) { throw "Startup grace was not respected: $grace ms." }
            if (-not $window.WaitForExit(6000) -or $window.ExitCode -ne 0) { throw 'Invisible probe did not exit cleanly.' }
            if (Test-Path -LiteralPath (Join-Path $case 'probe-error')) { throw (Get-Content -Raw -LiteralPath (Join-Path $case 'probe-error')) }
        }
        Write-Output "PASS startup window: $mode ($($calls.Count) inspections)"
        $passed++
    }
    finally {
        foreach ($owned in @($watcher, $window)) {
            if ($null -ne $owned) {
                if (-not $owned.HasExited) { Stop-Process -Id $owned.Id -Force }
                $owned.Dispose()
            }
        }
    }
}
Write-Output "PASS startup window regressions: $passed real-event scenarios; production finally releases both hooks and callback. Artifacts: $testRoot"
