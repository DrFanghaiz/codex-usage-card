# Run with Windows PowerShell 5.1 to test the helper's .NET Framework runtime.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')

# Keep production method bodies; replace only discovery and login test boundaries.
$start = $source.IndexOf('    private static async Task<List<CdpTarget>> FindTargetsAsync()')
$end = $source.IndexOf('    private static async Task<HashSet<int>> FindListeningPortsAsync', $start)
$discovery = $source.Substring($start, $end - $start).Replace('Process.GetProcessesByName("ChatGPT")', 'new[] { Process.GetCurrentProcess() }')
$start = $source.IndexOf('    private static FileSystemWatcher WatchLoginConfiguration(')
$end = $source.IndexOf('    private static bool SameApiConfiguration(', $start)
$watcher = $source.Substring($start, $end - $start).Replace(
    'Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex")', 'TestRoot'
).Replace('new FileSystemWatcher(root)', 'LastWatcher = new FileSystemWatcher(root)')
$start = $source.IndexOf('    private static bool IsConsoleRequest(')
$end = $source.IndexOf('    private static void PublishDiagnosis(', $start)
$payloadMethods = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static CdpTarget TargetFromEvent(')
$end = $source.IndexOf('    private sealed class PageSessions', $start)
$targetEvents = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static Dictionary<string, object> SharedPayload(')
$end = $source.IndexOf('    private static ApiConfiguration LoadApiConfiguration()', $start)
$sharedPayload = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private sealed class PageSessions')
$end = $source.IndexOf('    private sealed class ApiConfiguration', $start)
$pageSessions = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static Dictionary<string, object> SendCommand(')
$end = $source.IndexOf('    private static Dictionary<string, object> Evaluate(', $start)
$sendCommand = $source.Substring($start, $end - $start)
$backoff = [regex]::Match($source, 'retrySeconds = Math\.Min\(retrySeconds \* 2, \d+\);').Value
if (-not $backoff -or $source -notmatch 'if \(await sessions\.Ready\.Task\) retrySeconds = 1;') {
    throw 'Missing bounded backoff or successful-connect reset.'
}

$harness = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class NativeHelperRegressions
{
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static int NextCommandId;
    private static readonly IOException LoginError = new IOException("Synthetic configuration read failure");
    private static string TestRoot;
    private static FileSystemWatcher LastWatcher;
    private static int TestPort;
    private static string SessionScope = "test-session";
    private static int SessionGeneration;
    private static int CachedPayloadGeneration;
    private sealed class ApiConfiguration { }
    private sealed class OfficialConfiguration { }
    private static readonly object PayloadGate = new object();
    private static string CachedPayloadScope;
    private static bool CachedPayloadOfficial;
    private static Dictionary<string, object> CachedPayload;
    private static DateTimeOffset CachedPayloadExpiresAt;
    private static int FetchCount;
    private static bool FetchLimited;
    private static OfficialConfiguration LoadOfficialConfiguration() { return new OfficialConfiguration(); }
    private static Dictionary<string, object> FetchOfficialPayload(OfficialConfiguration ignored) { return FetchApiPayload(null); }
    private static Dictionary<string, object> FetchApiPayload(ApiConfiguration ignored)
    {
        Interlocked.Increment(ref FetchCount);
        Thread.Sleep(50);
        return FetchLimited
            ? new Dictionary<string, object> { { "errorCode", "RATE_LIMITED" }, { "retryAfterSeconds", 60 } }
            : new Dictionary<string, object> { { "value", 42 } };
    }
    private static readonly ManualResetEventSlim ReleasePages = new ManualResetEventSlim();
    private static readonly ManualResetEventSlim BothPages = new ManualResetEventSlim();
    private static int ConnectedPages;
    private sealed class CdpSocket : IDisposable
    {
        public readonly string Url;
        public string RequestEvent;
        public readonly Queue<string> PendingEvents = new Queue<string>();
        private readonly Queue<string> replies = new Queue<string>();
        public void SendText(string request)
        {
            var value = Json.DeserializeObject(request) as Dictionary<string, object>;
            if (RequestEvent != null) replies.Enqueue(RequestEvent);
            replies.Enqueue(Json.Serialize(new Dictionary<string, object> { { "id", value["id"] } }));
        }
        public string ReceiveText() { return replies.Dequeue(); }
        public Action<string> OnEvent;
        public CdpSocket(string url) { Url = url; }
        public void Connect() { if (Interlocked.Increment(ref ConnectedPages) == 2) BothPages.Set(); }
        public void Close() { ReleasePages.Set(); }
        public void Dispose() { }
    }
    private static void ResetPageSession(CdpSocket socket) { }
__SEND_COMMAND__
    private static void InstallForCurrentAndFuturePages(CdpSocket socket, string mode) { }
    private static bool PageDataRequested(CdpSocket socket, string name) { return false; }
    private static void PublishOfficialPayload(CdpSocket socket) { throw new Exception("No page quota request expected"); }
    private static void PublishApiPayload(CdpSocket socket, ApiConfiguration api) { throw new Exception("No page quota request expected"); }
    private static void KeepSessionOpen(CdpSocket socket, ApiConfiguration api, bool official)
    {
        if (socket.Url.EndsWith("/first"))
        {
            var created = Json.Serialize(new Dictionary<string, object> {
                { "method", "Target.targetCreated" },
                { "params", new Dictionary<string, object> { { "targetInfo", new Dictionary<string, object> {
                    { "targetId", "second" }, { "title", "Codex" }, { "type", "page" }, { "url", "app://-/index.html" }
                } } } }
            });
            socket.OnEvent(created);
            socket.OnEvent(created);
        }
        ReleasePages.Wait();
    }
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
                    if (mode == "multiple") body = body.Substring(0, body.Length - 1) + "," + body.Substring(1).Replace("/test", "/second");
                    var length = mode == "body" ? 999 : Encoding.UTF8.GetByteCount(body);
                    var bytes = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + length + "\r\nConnection: close\r\n\r\n" + body);
                    peer.GetStream().Write(bytes, 0, bytes.Length);
                }
                release.Wait();
            }
        });
        var timer = Stopwatch.StartNew();
        var discovery = Task.Run(() => FindTargetsAsync());
        try
        {
            Task.WhenAny(discovery, Task.Delay(7000)).GetAwaiter().GetResult();
            Check(discovery.IsCompleted, mode + ": discovery did not time out");
            try
            {
                var target = discovery.GetAwaiter().GetResult();
                Check((mode == "success" || mode == "multiple") && target[0].Title == "Codex", mode + ": unexpected success");
                Check(target.Count == (mode == "multiple" ? 2 : 1), "All Codex windows must be discovered");
            }
            catch (InvalidOperationException error)
            {
                Check(mode != "success" && mode != "multiple" && error.Message == "Codex page target is unavailable", mode + ": wrong failure");
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
        var now = new DateTimeOffset(2026, 9, 8, 0, 0, 0, TimeSpan.Zero);
        Check((string)HttpErrorPayload(401, null, now)["errorCode"] == "AUTH_REQUIRED", "401 must require login");
        Check((string)HttpErrorPayload(403, null, now)["errorCode"] == "AUTH_REQUIRED", "403 must require login");
        Check((string)HttpErrorPayload(500, "30", now)["errorCode"] == "NETWORK_ERROR", "500 classification");
        Check((int)HttpErrorPayload(429, "30", now)["retryAfterSeconds"] == 30, "Retry-After seconds");
        Check((int)HttpErrorPayload(429, now.AddSeconds(45).ToString("r"), now)["retryAfterSeconds"] == 45, "Retry-After date");
        Check((int)HttpErrorPayload(429, "0", now)["retryAfterSeconds"] == 1, "Retry-After zero must not spin");
        Check(!HttpErrorPayload(429, "-9", now).ContainsKey("retryAfterSeconds"), "Negative retry rejected");
        Check(!HttpErrorPayload(429, "secret", now).ContainsKey("retryAfterSeconds"), "Invalid retry rejected");
        Check(!HttpErrorPayload(429, now.AddSeconds(-1).ToString("r"), now).ContainsKey("retryAfterSeconds"), "Past retry date rejected");
        var consoleEvent = "{\"method\":\"Runtime.consoleAPICalled\",\"params\":{\"args\":[{\"type\":\"string\",\"value\":\"__codexQuotaDoctorRequest__\"}]}}";
        Check(IsConsoleRequest(consoleEvent, "__codexQuotaDoctorRequest__"), "Doctor request recognized");
        Check(!IsConsoleRequest(consoleEvent.Replace("Runtime.consoleAPICalled", "Runtime.exceptionThrown"), "__codexQuotaDoctorRequest__"), "Only console events trigger diagnosis");
        Check(!IsConsoleRequest(consoleEvent.Replace("__codexQuotaDoctorRequest__", "prefix__codexQuotaDoctorRequest__"), "__codexQuotaDoctorRequest__"), "Exact console marker required");
        using (var replay = new CdpSocket("synthetic"))
        {
            replay.RequestEvent = consoleEvent;
            SendCommand(replay, "Runtime.enable", new Dictionary<string, object>());
            Check(replay.PendingEvents.Count == 0, "Runtime.enable must not replay historical requests");
            SendCommand(replay, "Runtime.evaluate", new Dictionary<string, object>());
            Check(replay.PendingEvents.Count == 1 && replay.PendingEvents.Dequeue() == consoleEvent,
                "Live requests during commands must remain queued");
        }
        var diagnosis = new Dictionary<string, object> {
            { "Installed", true }, { "TaskFound", true }, { "TaskActionMatches", true }, { "HelperFilePresent", true },
            { "HelperWindowless", true }, { "CodexRunning", true }, { "CdpEndpointFound", true }, { "MainPageFound", true },
            { "CardVisible", true }, { "HelperProcessCount", 1 }, { "ActivationState", "Active" }, { "CardKind", "Api" },
            { "TaskState", "Running" }, { "WindowCount", 2 }, { "VisibleCardCount", 1 }, { "UninspectedWindowCount", 0 }, { "StageCodes", new object[] { "CARD_NOT_VISIBLE", "secret" } }, { "token", "secret" }
        };
        var safe = SanitizeDiagnosis(diagnosis);
        Check((string)safe["ActivationState"] == "Active" && (int)safe["HelperProcessCount"] == 1, "Doctor valid values preserved");
        Check(!Json.Serialize(safe).Contains("secret"), "Doctor must not expose arbitrary values");
        diagnosis["ActivationState"] = "secret";
        diagnosis["CardKind"] = "secret";
        Check(!Json.Serialize(SanitizeDiagnosis(diagnosis)).Contains("secret"), "Doctor string fields are allowlisted");
        diagnosis["Installed"] = "secret";
        try { SanitizeDiagnosis(diagnosis); throw new Exception("Non-boolean diagnosis accepted"); }
        catch (InvalidOperationException) { }
        var targetEvent = "{\"method\":\"Target.targetCreated\",\"params\":{\"targetInfo\":{\"targetId\":\"ABC123\",\"type\":\"page\",\"title\":\"Codex\",\"url\":\"app://-/index.html\"}}}";
        Check(TargetFromEvent(targetEvent, "ws://127.0.0.1:123/devtools/page/first").WebSocketDebuggerUrl == "ws://127.0.0.1:123/devtools/page/ABC123", "New Codex window event");
        Check(TargetFromEvent(targetEvent.Replace("app://-/index.html", "https://example.com"), "ws://127.0.0.1:123/devtools/page/first") == null, "Unrelated target ignored");
        Check(TargetFromEvent(targetEvent.Replace("ABC123", "../unsafe"), "ws://127.0.0.1:123/devtools/page/first") == null, "Unsafe target ID ignored");
        var fetches = new List<Task>();
        for (int i = 0; i < 8; i++) fetches.Add(Task.Run(() => Check((int)SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration)["value"] == 42, "Shared fetch result")));
        Task.WaitAll(fetches.ToArray());
        Check(FetchCount == 1, "Concurrent windows must share one HTTP request");
        SessionScope = "new-login";
        SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        Check(FetchCount == 2, "Login scope invalidates cached quota");
        try { SharedPayload(new ApiConfiguration(), false, "previous-login", SessionGeneration); throw new Exception("Old session fetched with new scope"); }
        catch (IOException) { }
        SessionGeneration++;
        try { SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration - 1); throw new Exception("Stale generation fetched quota"); }
        catch (IOException) { }
        FetchLimited = true;
        SessionScope = "rate-limited-login";
        SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        CachedPayloadExpiresAt = DateTimeOffset.UtcNow.AddSeconds(30);
        var retry = SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        Check(FetchCount == 3 && (int)retry["retryAfterSeconds"] <= 30, "Shared cooldown must not refetch or extend Retry-After");
        SessionGeneration++;
        retry = SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        Check(FetchCount == 3 && (int)retry["retryAfterSeconds"] <= 30,
            "Same-account configuration changes must preserve active Retry-After");
        FetchLimited = false;
        CachedPayloadExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        SessionGeneration++;
        SharedPayload(new ApiConfiguration(), false, SessionScope, SessionGeneration);
        Check(FetchCount == 5, "Successful payloads must remain generation-isolated");
        using (var pages = new PageSessions(new ApiConfiguration(), false))
        {
            pages.Start(new CdpTarget { WebSocketDebuggerUrl = "ws://127.0.0.1:123/devtools/page/first" });
            Check(pages.Ready.Task.Wait(3000), "Initial page must attach");
            Check(BothPages.Wait(3000), "Created page must attach without polling");
            Check(ConnectedPages == 2, "Repeated target events must not duplicate connections");
            pages.Close();
            try { pages.Completion.Task.GetAwaiter().GetResult(); throw new Exception("Closed page group did not trigger rediscovery"); }
            catch (IOException) { }
        }
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
            try { WatchLoginConfiguration(() => { }, null, false); throw new Exception("Login error was swallowed"); }
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
        CheckDiscovery("multiple");
        CheckDiscovery("headers");
        CheckDiscovery("body");
    }
__DISCOVERY__
__WATCHER__
__PAYLOAD_METHODS__
__TARGET_EVENTS__
__SHARED_PAYLOAD__
__PAGE_SESSIONS__
}
'@
$harness = $harness.Replace('__BACKOFF__', $backoff).Replace('__DISCOVERY__', $discovery).Replace('__WATCHER__', $watcher).Replace('__PAYLOAD_METHODS__', $payloadMethods).Replace('__TARGET_EVENTS__', $targetEvents).Replace('__SHARED_PAYLOAD__', $sharedPayload).Replace('__PAGE_SESSIONS__', $pageSessions).Replace('__SEND_COMMAND__', $sendCommand)
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll, System.Core.dll, System.Web.Extensions.dll
[NativeHelperRegressions]::Run()
'Native helper regressions: 14 groups passed, 0 failed (backoff, watcher cleanup, 4 discovery cases, HTTP errors, console requests, diagnosis sanitization, invalid diagnosis, new window events, shared fetch/cache/cooldown, page session scheduling, console history replay)'
