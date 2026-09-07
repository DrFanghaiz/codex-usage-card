# Run with Windows PowerShell 5.1 to test the helper's .NET Framework runtime.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')

# Keep production method bodies; replace only discovery and login test boundaries.
$start = $source.IndexOf('    private static async Task<CdpTarget> FindTargetAsync()')
$end = $source.IndexOf('    private static async Task<HashSet<int>> FindListeningPortsAsync', $start)
$discovery = $source.Substring($start, $end - $start).Replace('Process.GetProcessesByName("ChatGPT")', 'new[] { Process.GetCurrentProcess() }')
$start = $source.IndexOf('    private static FileSystemWatcher WatchLoginConfiguration(')
$end = $source.IndexOf('    private static bool SameApiConfiguration(', $start)
$watcher = $source.Substring($start, $end - $start).Replace(
    'Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex")', 'TestRoot'
).Replace('new FileSystemWatcher(root)', 'LastWatcher = new FileSystemWatcher(root)')
$backoff = [regex]::Match($source, 'retrySeconds = Math\.Min\(retrySeconds \* 2, \d+\);').Value
if (-not $backoff -or $source -notmatch 'socket\.Connect\(\);\s+retrySeconds = 1;') {
    throw 'Missing bounded backoff or successful-connect reset.'
}

$harness = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class NativeHelperRegressions
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly IOException LoginError = new IOException("Synthetic configuration read failure");
    private static string TestRoot;
    private static FileSystemWatcher LastWatcher;
    private static int TestPort;
    private sealed class ApiConfiguration { }
    private sealed class CdpSocket { public void Close() { } }
    private sealed class CdpTarget { public string Type, Title, Url, WebSocketDebuggerUrl; }
    private static string StringValue(Dictionary<string, object> value, string key)
    {
        return value.ContainsKey(key) && value[key] != null ? Convert.ToString(value[key]) : "";
    }
    private static Task<HashSet<int>> FindListeningPortsAsync(HashSet<int> ignored)
    {
        return Task.FromResult(new HashSet<int> { TestPort });
    }
    private static bool TryLoadLoginConfiguration(out ApiConfiguration api, out bool official)
    {
        api = null;
        official = false;
        throw LoginError;
    }
    private static bool SameApiConfiguration(ApiConfiguration left, ApiConfiguration right) { return true; }
    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }
    private static int NextRetry(int retrySeconds) { __BACKOFF__ return retrySeconds; }

    private static void CheckDiscovery(string mode)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        var release = new ManualResetEventSlim();
        listener.Start();
        TestPort = ((IPEndPoint)listener.LocalEndpoint).Port;
        var server = Task.Run(() =>
        {
            using (var peer = listener.AcceptTcpClient())
            {
                if (mode != "headers")
                {
                    var body = mode == "body" ? "[" :
                        "[{\"type\":\"page\",\"title\":\"Codex\",\"url\":\"app://-/index.html\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1/test\"}]";
                    var length = mode == "body" ? 999 : Encoding.UTF8.GetByteCount(body);
                    var bytes = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + length + "\r\nConnection: close\r\n\r\n" + body);
                    peer.GetStream().Write(bytes, 0, bytes.Length);
                }
                release.Wait();
            }
        });
        var timer = Stopwatch.StartNew();
        var discovery = Task.Run(() => FindTargetAsync());
        try
        {
            Task.WhenAny(discovery, Task.Delay(7000)).GetAwaiter().GetResult();
            Check(discovery.IsCompleted, mode + ": discovery did not time out");
            try
            {
                var target = discovery.GetAwaiter().GetResult();
                Check(mode == "success" && target.Title == "Codex", mode + ": unexpected success");
            }
            catch (InvalidOperationException error)
            {
                Check(mode != "success" && error.Message == "Codex page target is not unique", mode + ": wrong failure");
                Check(timer.ElapsedMilliseconds >= 2500 && timer.ElapsedMilliseconds < 6500, mode + ": wrong timeout");
            }
        }
        finally
        {
            release.Set();
            server.GetAwaiter().GetResult();
            listener.Stop();
            release.Dispose();
        }
    }

    public static void Run()
    {
        var delay = 1;
        foreach (var expected in new[] { 2, 4, 8, 15, 15, 15 })
        {
            delay = NextRetry(delay);
            Check(delay == expected, "Retry backoff is not bounded");
        }
        TestRoot = Path.Combine(Path.GetTempPath(), "codex-native-regression-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(TestRoot);
        try
        {
            try { WatchLoginConfiguration(new CdpSocket(), null, false); throw new Exception("Login error was swallowed"); }
            catch (IOException error) { Check(Object.ReferenceEquals(error, LoginError), "Login error was replaced"); }
            try { LastWatcher.EnableRaisingEvents = true; throw new Exception("Watcher was not disposed"); }
            catch (ObjectDisposedException) { }
        }
        finally
        {
            if (LastWatcher != null) LastWatcher.Dispose();
            Directory.Delete(TestRoot);
        }
        CheckDiscovery("success");
        CheckDiscovery("headers");
        CheckDiscovery("body");
    }
__DISCOVERY__
__WATCHER__
}
'@
$harness = $harness.Replace('__BACKOFF__', $backoff).Replace('__DISCOVERY__', $discovery).Replace('__WATCHER__', $watcher)
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll, System.Core.dll, System.Web.Extensions.dll
[NativeHelperRegressions]::Run()
'Native helper regressions: 5 passed, 0 failed'
