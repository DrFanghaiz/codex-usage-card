# Run with Windows PowerShell 5.1 to test the helper's .NET Framework runtime.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')

# Keep production method bodies; replace only discovery and login test boundaries.
$start = $source.IndexOf('    private static async Task<List<CdpTarget>> FindTargetsAsync()')
$end = $source.IndexOf('    private static async Task<HashSet<int>> FindListeningPortsAsync', $start)
$discovery = $source.Substring($start, $end - $start).Replace('Process.GetProcessesByName("ChatGPT")', 'new[] { Process.GetCurrentProcess() }')
$start = $source.IndexOf('    private static string ConfigurationRoot()')
$end = $source.IndexOf('    private static async Task WaitForLoginConfigurationChangeAsync()', $start)
$configRoot = $source.Substring($start, $end - $start).Replace(
    'Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)', 'TestUserProfile'
)
$start = $source.IndexOf('    private static OfficialConfiguration LoadOfficialConfiguration()')
$end = $source.IndexOf('    private static Dictionary<string, object> FetchOfficialPayload(', $start)
$configLoaders = $source.Substring($start, $end - $start).Replace('LoadOfficialConfiguration()', 'LoadOfficialConfigurationReal()')
$start = $source.IndexOf('    private static bool TryLoadLoginConfiguration()')
$end = $source.IndexOf('    private static FileSystemWatcher WatchLoginConfiguration(', $start)
$loginSelector = $source.Substring($start, $end - $start).Replace('TryLoadLoginConfiguration()', 'TryLoadLoginConfigurationReal()').Replace('LoadOfficialConfiguration()', 'LoadOfficialConfigurationReal()')
$start = $source.IndexOf('    private static async Task WaitForLoginConfigurationChangeAsync()')
$end = $source.IndexOf('    private static bool TryLoadLoginConfiguration(', $start)
$loginWait = $source.Substring($start, $end - $start).Replace(
    'ConfigurationRoot()', 'TestRoot'
)
$start = $source.IndexOf('    private static FileSystemWatcher WatchLoginConfiguration(')
$end = $source.IndexOf('    private static void KeepSessionOpen(', $start)
$watcher = $source.Substring($start, $end - $start).Replace(
    'ConfigurationRoot()', 'TestRoot'
).Replace('new FileSystemWatcher(root)', 'LastWatcher = new FileSystemWatcher(root)')
$start = $source.IndexOf('    private static bool IsConsoleRequest(')
$end = $source.IndexOf('    private static void PublishDiagnosis(', $start)
$payloadMethods = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static CdpTarget TargetFromEvent(')
$end = $source.IndexOf('    private sealed class PageSessions', $start)
$targetEvents = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static Dictionary<string, object> SharedPayload(')
$end = $source.IndexOf('    private static OfficialConfiguration LoadOfficialConfiguration()', $start)
$sharedPayload = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private sealed class PageSessions')
$end = $source.IndexOf('    private sealed class CodexProcessInfo', $start)
$pageSessions = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static Dictionary<string, object> SendCommand(')
$end = $source.IndexOf('    private static Dictionary<string, object> Evaluate(', $start)
$sendCommand = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static bool PageDataRequested(')
$end = $source.IndexOf('    private static Dictionary<string, object> SharedPayload(', $start)
$publishMethods = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static Dictionary<string, object> FetchOfficialPayload(')
$end = $source.IndexOf('    private static IWebProxy QuotaProxy()', $start)
$httpMethods = $source.Substring($start, $end - $start).Replace('FetchOfficialPayload(', 'FetchOfficialPayloadReal(')
$start = $source.IndexOf('    private static bool NumberValue(')
$end = $source.IndexOf('    private static void LaunchCodex()', $start)
$httpMethods += $source.Substring($start, $end - $start)
if ($source -notmatch 'private const int IoDeadlineMilliseconds = 15000;') { throw 'Production I/O deadline changed; review test timing.' }
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
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class NativeHelperRegressions
{
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static int NextCommandId;
    private static int IoDeadlineMilliseconds = 150;
    private static readonly IOException LoginError = new IOException("Synthetic configuration read failure");
    private static string TestRoot, TestUserProfile;
    private static FileSystemWatcher LastWatcher;
    private static bool ThrowLoginError = true, LoginAvailable;
    private static int TestPort;
    private static string SessionScope = "test-session";
    private static string LoginFingerprint;
    private static int SessionGeneration;
    private static int CachedPayloadGeneration;
    private sealed class OfficialConfiguration { public string Url, AccessToken, AccountId; }
    private static readonly object PayloadGate = new object();
    private static string CachedPayloadScope;
    private static Dictionary<string, object> CachedPayload;
    private static DateTimeOffset CachedPayloadExpiresAt;
    private static int FetchCount;
    private static bool FetchLimited;
    private static string CurrentAccountId = "account-a";
    private static Action DuringFetch;
    private static OfficialConfiguration LoadOfficialConfiguration() { return new OfficialConfiguration { AccountId = CurrentAccountId }; }
    private static Dictionary<string, object> FetchOfficialPayload(OfficialConfiguration ignored)
    {
        Interlocked.Increment(ref FetchCount);
        if (DuringFetch != null) DuringFetch();
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
        public readonly string Scope = SessionScope;
        public readonly int Generation = SessionGeneration;
        public Dictionary<string, object> PageState;
        public string LastExpression;
        public bool Stall;
        public bool Closed;
        private readonly ManualResetEventSlim closedSignal = new ManualResetEventSlim();
        public readonly Queue<string> PendingEvents = new Queue<string>();
        private readonly Queue<string> replies = new Queue<string>();
        public void SendText(string request)
        {
            var value = Json.DeserializeObject(request) as Dictionary<string, object>;
            if (RequestEvent != null) replies.Enqueue(RequestEvent);
            replies.Enqueue(Json.Serialize(new Dictionary<string, object> { { "id", value["id"] } }));
        }
        public string ReceiveText() { if (Stall) { closedSignal.Wait(); throw new IOException("Synthetic command timeout"); } return replies.Dequeue(); }
        public Action<string> OnEvent;
        public CdpSocket(string url) { Url = url; }
        public void Connect() { if (Interlocked.Increment(ref ConnectedPages) == 2) BothPages.Set(); }
        public void Close() { Closed = true; closedSignal.Set(); ReleasePages.Set(); }
        public void Dispose() { }
    }
    private static void ResetPageSession(CdpSocket socket) { }
__SEND_COMMAND__
    private static void InstallForCurrentAndFuturePages(CdpSocket socket) { }
__PUBLISH_METHODS__
    private static Dictionary<string, object> Evaluate(CdpSocket socket, string expression)
    {
        socket.LastExpression = expression;
        return new Dictionary<string, object> { { "result", new Dictionary<string, object> { { "value", socket.PageState } } } };
    }
    private static IWebProxy QuotaProxy() { return null; }
__HTTP_METHODS__
    private static void CheckSlowBody()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
        var server = Task.Run(() => {
            try { using (var peer = listener.AcceptTcpClient()) {
                var stream = peer.GetStream();
                var headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n");
                stream.Write(headers, 0, headers.Length);
                for (var i = 0; i < 30; i++) { Thread.Sleep(20); stream.WriteByte(32); stream.Flush(); }
            } } catch (IOException) { }
        });
        var clock = Stopwatch.StartNew();
        try {
            try {
                FetchOfficialPayloadReal(new OfficialConfiguration { Url = url, AccessToken = "synthetic", AccountId = "synthetic" });
                throw new Exception("Slow response did not time out");
            } catch (WebException error) {
                Check((string)WebErrorPayload(error)["errorCode"] == "REQUEST_TIMEOUT", "Elapsed body deadline must report a retryable timeout");
            }
            Check(clock.ElapsedMilliseconds >= 100 && clock.ElapsedMilliseconds < 1000, "Whole-body deadline must bound drip-fed responses");
        } finally { server.GetAwaiter().GetResult(); listener.Stop(); }
    }
    private static void CheckOfficialPlanTypes()
    {
        // Shape validation is not a timing probe; allow local server startup under load.
        IoDeadlineMilliseconds = 1500;
        try { foreach (var plan in new object[] { "plus", 42, true })
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
            var body = Json.Serialize(new Dictionary<string, object> {
                { "plan_type", plan }, { "rate_limit", new Dictionary<string, object> {
                    { "allowed", true }, { "limit_reached", false },
                    { "primary_window", new Dictionary<string, object> {
                        { "used_percent", 12 }, { "limit_window_seconds", 604800 }, { "reset_at", 1900000000 }
                    } }
                } }
            });
            var server = Task.Run(() => {
                using (var peer = listener.AcceptTcpClient()) {
                    var reader = new StreamReader(peer.GetStream());
                    while (!String.IsNullOrEmpty(reader.ReadLine())) { }
                    var bytes = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\nConnection: close\r\n\r\n" + body);
                    peer.GetStream().Write(bytes, 0, bytes.Length);
                }
            });
            try {
                Dictionary<string, object> payload = null;
                try { payload = FetchOfficialPayloadReal(new OfficialConfiguration { Url = url, AccessToken = "synthetic", AccountId = "synthetic" }); }
                catch (InvalidOperationException) { if (plan is string) throw; }
                Check(plan is string ? payload != null && (string)payload["planName"] == "plus" : payload == null,
                    "Non-string plan type must not become a displayed membership label");
            }
            finally { server.GetAwaiter().GetResult(); listener.Stop(); }
        } } finally { IoDeadlineMilliseconds = 150; }
    }
    private static void KeepSessionOpen(CdpSocket socket)
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
    private static bool TryLoadLoginConfiguration()
    {
        if (ThrowLoginError) throw LoginError;
        return LoginAvailable;
    }
    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }
    private static void CheckConfigurationRoot()
    {
        var previous = Environment.GetEnvironmentVariable("CODEX_HOME");
        TestUserProfile = TestRoot;
        var fallback = Path.Combine(TestRoot, ".codex");
        var configured = Path.Combine(TestRoot, "custom-home");
        try
        {
            foreach (var path in new[] { fallback, configured })
            {
                Directory.CreateDirectory(path);
                var name = path == fallback ? "default-account" : "configured-account";
                File.WriteAllText(Path.Combine(path, "auth.json"), Json.Serialize(new Dictionary<string, object> {
                    { "OPENAI_API_KEY", "synthetic-only" }, { "tokens", new Dictionary<string, object> {
                        { "access_token", "synthetic-only" }, { "account_id", name }
                    } }
                }));
                File.WriteAllText(Path.Combine(path, "config.toml"), "model_provider=\"synthetic\"\n[model_providers.synthetic]\nbase_url=\"https://" + name + ".example.invalid\"\n");
            }
            foreach (var path in new[] { configured, configured + Path.DirectorySeparatorChar })
            {
                Environment.SetEnvironmentVariable("CODEX_HOME", path);
                Check(ConfigurationRoot() == configured, "Configured root must normalize its trailing separator");
                Check(LoadOfficialConfigurationReal().AccountId == "configured-account", "Official credentials must honor CODEX_HOME");
            }
            Environment.SetEnvironmentVariable("CODEX_HOME", configured);
            var authPath = Path.Combine(configured, "auth.json");
            File.WriteAllText(authPath, "{\"OPENAI_API_KEY\":\"synthetic-only\"}");
            var requestsBefore = FetchCount;
            Check(!TryLoadLoginConfigurationReal(), "API-only login must wait instead of creating a quota session");
            File.WriteAllText(authPath, "{\"tokens\":{\"access_token\":\"synthetic-only\"}}");
            Check(!TryLoadLoginConfigurationReal(), "Partial official tokens must wait");
            foreach (var mode in new[] { "api", "apikey", "APIKEY" })
            {
                File.WriteAllText(authPath, Json.Serialize(new Dictionary<string, object> {
                    { "auth_mode", mode }, { "tokens", new Dictionary<string, object> {
                        { "access_token", "synthetic-only" }, { "account_id", "old-account" }
                    } }
                }));
                Check(!TryLoadLoginConfigurationReal(), "Explicit API login must not revive stale official tokens");
            }
            Check(FetchCount == requestsBefore, "Unsupported login must not fetch quota");
            foreach (var account in new[] { "account-a", "account-b" })
            {
                File.WriteAllText(authPath, Json.Serialize(new Dictionary<string, object> {
                    { "auth_mode", "chatgpt" }, { "tokens", new Dictionary<string, object> {
                        { "access_token", "synthetic-only" }, { "account_id", account }
                    } }
                }));
                var previousScope = SessionScope;
                Check(TryLoadLoginConfigurationReal(), "Complete official login remains supported");
                if (account == "account-b") Check(SessionScope != previousScope, "Changed official account must rotate the session scope");
            }
            Environment.SetEnvironmentVariable("CODEX_HOME", Path.Combine(TestRoot, "missing-home"));
            Check(LoadOfficialConfigurationReal() == null,
                "A missing configured root must not read the default account");
            foreach (var empty in new[] { null, "", "   " })
            {
                Environment.SetEnvironmentVariable("CODEX_HOME", empty);
                Check(ConfigurationRoot() == fallback && LoadOfficialConfigurationReal().AccountId == "default-account",
                    "Unset or blank CODEX_HOME must retain the default root");
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("CODEX_HOME", previous);
            foreach (var path in new[] { fallback, configured })
            {
                File.Delete(Path.Combine(path, "auth.json"));
                File.Delete(Path.Combine(path, "config.toml"));
                Directory.Delete(path);
            }
        }
        var parent = TestRoot;
        ThrowLoginError = false;
        LoginAvailable = false;
        try
        {
            foreach (var rename in new[] { false, true })
            {
                TestRoot = Path.Combine(parent, "custom-home");
                var other = Path.Combine(parent, "unrelated-home");
                var waiting = WaitForLoginConfigurationChangeAsync();
                Directory.CreateDirectory(other);
                Check(!waiting.Wait(100), "Unrelated directory creation must not wake the login waiter");
                if (rename) Directory.Move(other, TestRoot);
                else Directory.CreateDirectory(TestRoot);
                Check(waiting.Wait(2000), "Custom root creation and rename must wake the login waiter");
                Directory.Delete(TestRoot);
                if (Directory.Exists(other)) Directory.Delete(other);
            }
        }
        finally { TestRoot = parent; ThrowLoginError = true; }
    }
    private static void CheckLoginRenames()
    {
        ThrowLoginError = false;
        foreach (var active in new[] { true, false })
        foreach (var names in new[] {
            new[] { "auth.json", "auth.backup" }, new[] { "auth.backup", "auth.json" },
            new[] { "config.toml", "config.backup" }, new[] { "config.backup", "config.toml" },
            new[] { "auth.json", "config.toml" }, new[] { "unrelated.tmp", "unrelated.backup" }
        })
        {
            var oldPath = Path.Combine(TestRoot, names[0]);
            var newPath = Path.Combine(TestRoot, names[1]);
            File.WriteAllText(oldPath, "synthetic");
            var unrelated = names[0] == "unrelated.tmp";
            var calls = 0;
            var generation = SessionGeneration;
            LoginAvailable = active;
            using (var signaled = new ManualResetEventSlim())
            using (var watcher = active ? WatchLoginConfiguration(() => { Interlocked.Increment(ref calls); signaled.Set(); }) : null)
            {
                var waiting = active ? null : WaitForLoginConfigurationChangeAsync();
                File.Move(oldPath, newPath);
                if (unrelated)
                {
                    Check(active ? !signaled.Wait(100) : !waiting.Wait(100), "Unrelated renames must not invalidate login");
                    File.Move(newPath, oldPath = Path.Combine(TestRoot, "auth.json"));
                }
                Check(active ? signaled.Wait(2000) : waiting.Wait(2000), "Both sides of a login rename must wake the helper");
                if (active)
                {
                    Thread.Sleep(30);
                    Check(calls == 1 && SessionGeneration == generation + 1, "A rename matching both names invalidates the session once");
                }
            }
            if (File.Exists(oldPath)) File.Delete(oldPath);
            if (File.Exists(newPath)) File.Delete(newPath);
        }
        ThrowLoginError = true;
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
                    var body = mode == "body" || mode == "drip" ? "[" :
                        "[{\"type\":\"page\",\"title\":\"Task title changed\",\"url\":\"app://-/index.html\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1/test\"}]";
                    if (mode == "multiple") body = body.Substring(0, body.Length - 1) + "," + body.Substring(1).Replace("/test", "/second");
                    if (mode != "body" && mode != "drip") body = body.Substring(0, body.Length - 1) +
                        ",{\"type\":\"page\",\"title\":\"Codex\",\"url\":\"app://-/index.html?initialRoute=overlay\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1/overlay\"}," +
                        "{\"type\":\"page\",\"title\":\"Codex\",\"url\":\"app://-/detached-window.html?initialRoute=task\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1/detached\"}]";
                    var length = mode == "body" || mode == "drip" ? 999 : Encoding.UTF8.GetByteCount(body);
                    var bytes = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: " + length + "\r\nConnection: close\r\n\r\n" + body);
                    peer.GetStream().Write(bytes, 0, bytes.Length);
                    if (mode == "drip") {
                        try { while (!release.Wait(100)) { peer.GetStream().WriteByte(32); peer.GetStream().Flush(); } }
                        catch (IOException) { }
                    }
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
                Check((mode == "success" || mode == "multiple") && target[0].Title == "Task title changed", mode + ": unexpected success");
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
        var window = new Dictionary<string, object> { { "used_percent", 12 }, { "limit_window_seconds", 604800 }, { "reset_at", 1900000000 } };
        var limits = new Dictionary<string, object> { { "primary_window", window }, { "secondary_window", null } };
        foreach (var field in new[] { "used_percent", "limit_window_seconds", "reset_at" }) {
            var original = window[field];
            foreach (var invalid in new object[] { true, "12", Double.NaN, Double.PositiveInfinity }) {
                window[field] = invalid;
                try { OfficialWindowPayload(limits, "primary_window", true); throw new Exception("Invalid quota numeric type accepted: " + field); }
                catch (InvalidOperationException) { }
            }
            window[field] = original;
        }
        foreach (var number in new object[] { 0, 12L, 12.5m, 12.5d }) {
            window["used_percent"] = number;
            Check((double)OfficialWindowPayload(limits, "primary_window", true)["usedPercent"] == Convert.ToDouble(number), "Finite JSON numbers stay supported");
        }
        Check(OfficialWindowPayload(limits, "secondary_window", false) == null, "Absent optional window remains valid");
        foreach (var invalid in new object[] { false, "bad", new object[0] }) {
            limits["secondary_window"] = invalid;
            try { OfficialWindowPayload(limits, "secondary_window", false); throw new Exception("Malformed secondary window accepted"); }
            catch (InvalidOperationException) { }
        }
        var now = new DateTimeOffset(2026, 9, 8, 0, 0, 0, TimeSpan.Zero);
        Check((string)HttpErrorPayload(401, null, now)["errorCode"] == "AUTH_REQUIRED", "401 must require login");
        Check((string)HttpErrorPayload(403, null, now)["errorCode"] == "AUTH_REQUIRED", "403 must require login");
        Check((string)HttpErrorPayload(500, "30", now)["errorCode"] == "NETWORK_ERROR", "500 classification");
        Check((string)WebErrorPayload(new WebException("synthetic", WebExceptionStatus.Timeout))["errorCode"] == "REQUEST_TIMEOUT", "Transport timeout classification");
        Check((string)WebErrorPayload(new WebException("synthetic", WebExceptionStatus.RequestCanceled))["errorCode"] == "NETWORK_ERROR", "Unrelated cancellation is not a timeout");
        Check((string)WebErrorPayload(new WebException("synthetic", WebExceptionStatus.ConnectFailure))["errorCode"] == "NETWORK_ERROR", "Connection failure is not a timeout");
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
        string requestId;
        var quotaEvent = consoleEvent.Replace("__codexQuotaDoctorRequest__", "__codexQuotaOfficialRequest__");
        var correlated = quotaEvent.Replace("}]", "},{\"type\":\"string\",\"value\":\"nonce-7\"}]");
        Check(TryConsoleRequest(correlated, "__codexQuotaOfficialRequest__", out requestId) && requestId == "nonce-7", "Quota event preserves original request ID");
        foreach (var invalid in new[] { "", "unsafe_id", "nonce-7\n", new string('a', 81) })
            Check(!TryConsoleRequest(correlated.Replace("nonce-7", invalid.Replace("\n", "\\n")), "__codexQuotaOfficialRequest__", out requestId), "Invalid request ID rejected");
        Check(!TryConsoleRequest(correlated.Replace("__codexQuotaOfficialRequest__", "__codexQuotaDoctorRequest__"), "__codexQuotaDoctorRequest__", out requestId), "Doctor remains single-argument");
        Check(TryConsoleRequest(quotaEvent, "__codexQuotaOfficialRequest__", out requestId) && requestId == null, "Legacy marker remains supported");
        var apiEvent = quotaEvent.Replace("__codexQuotaOfficialRequest__", "__codexQuotaApiRequest__");
        Check(!TryConsoleRequest(apiEvent, "__codexQuotaApiRequest__", out requestId), "Removed API request marker must be rejected");
        using (var ignoredApi = new CdpSocket("synthetic") { RequestEvent = apiEvent }) {
            SendCommand(ignoredApi, "Runtime.evaluate", new Dictionary<string, object>());
            Check(ignoredApi.PendingEvents.Count == 0, "API requests must not enter the session queue");
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
        diagnosis["StartupPromptVisible"] = true;
        diagnosis["ActivationState"] = "AwaitingStartupDecision";
        diagnosis["StageCodes"] = new object[] { "STARTUP_CONFIRMATION_PENDING", "secret" };
        safe = SanitizeDiagnosis(diagnosis);
        Check((bool)safe["StartupPromptVisible"] && (string)safe["ActivationState"] == "AwaitingStartupDecision" &&
            Json.Serialize(safe["StageCodes"]) == "[\"STARTUP_CONFIRMATION_PENDING\"]", "Expected startup interaction survives diagnosis sanitization");
        diagnosis["StartupPromptVisible"] = "secret";
        try { SanitizeDiagnosis(diagnosis); throw new Exception("Non-boolean startup prompt accepted"); }
        catch (InvalidOperationException) { }
        diagnosis.Remove("StartupPromptVisible");
        diagnosis["ActivationState"] = "secret";
        diagnosis["CardKind"] = "secret";
        Check(!Json.Serialize(SanitizeDiagnosis(diagnosis)).Contains("secret"), "Doctor string fields are allowlisted");
        diagnosis["Installed"] = "secret";
        try { SanitizeDiagnosis(diagnosis); throw new Exception("Non-boolean diagnosis accepted"); }
        catch (InvalidOperationException) { }
        var targetEvent = "{\"method\":\"Target.targetCreated\",\"params\":{\"targetInfo\":{\"targetId\":\"ABC123\",\"type\":\"page\",\"title\":\"Task title changed\",\"url\":\"app://-/index.html\"}}}";
        Check(TargetFromEvent(targetEvent, "ws://127.0.0.1:123/devtools/page/first").WebSocketDebuggerUrl == "ws://127.0.0.1:123/devtools/page/ABC123", "New Codex window event");
        Check(TargetFromEvent(targetEvent.Replace("app://-/index.html", "app://-/index.html?initialRoute=overlay"), "ws://127.0.0.1:123/devtools/page/first") == null, "Overlay target ignored");
        Check(TargetFromEvent(targetEvent.Replace("app://-/index.html", "app://-/detached-window.html?initialRoute=task"), "ws://127.0.0.1:123/devtools/page/first") == null, "Detached target ignored");
        Check(TargetFromEvent(targetEvent.Replace("app://-/index.html", "https://example.com"), "ws://127.0.0.1:123/devtools/page/first") == null, "Unrelated target ignored");
        Check(TargetFromEvent(targetEvent.Replace("ABC123", "../unsafe"), "ws://127.0.0.1:123/devtools/page/first") == null, "Unsafe target ID ignored");
        LoginFingerprint = AccountFingerprint(LoadOfficialConfiguration());
        var fetches = new List<Task>();
        for (int i = 0; i < 8; i++) fetches.Add(Task.Run(() => Check((int)SharedPayload(SessionScope, SessionGeneration)["value"] == 42, "Shared fetch result")));
        Task.WaitAll(fetches.ToArray());
        Check(FetchCount == 1, "Concurrent windows must share one HTTP request");
        SessionScope = "new-login";
        SharedPayload(SessionScope, SessionGeneration);
        Check(FetchCount == 2, "Login scope invalidates cached quota");
        try { SharedPayload("previous-login", SessionGeneration); throw new Exception("Old session fetched with new scope"); }
        catch (IOException) { }
        SessionGeneration++;
        try { SharedPayload(SessionScope, SessionGeneration - 1); throw new Exception("Stale generation fetched quota"); }
        catch (IOException) { }
        FetchLimited = true;
        SessionScope = "rate-limited-login";
        SharedPayload(SessionScope, SessionGeneration);
        CachedPayloadExpiresAt = DateTimeOffset.UtcNow.AddSeconds(30);
        var retry = SharedPayload(SessionScope, SessionGeneration);
        Check(FetchCount == 3 && (int)retry["retryAfterSeconds"] <= 30, "Shared cooldown must not refetch or extend Retry-After");
        SessionGeneration++;
        retry = SharedPayload(SessionScope, SessionGeneration);
        Check(FetchCount == 3 && (int)retry["retryAfterSeconds"] <= 30,
            "Same-account configuration changes must preserve active Retry-After");
        FetchLimited = false;
        CachedPayloadExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1);
        SharedPayload(SessionScope, SessionGeneration);
        SessionGeneration++;
        SharedPayload(SessionScope, SessionGeneration);
        Check(FetchCount == 5, "Successful payloads must remain generation-isolated");
        CachedPayload = null;
        var beforeAccountChange = FetchCount;
        CurrentAccountId = "account-b";
        Check((string)SharedPayload(SessionScope, SessionGeneration)["errorCode"] == "INVALID_RESPONSE" && FetchCount == beforeAccountChange,
            "Config changed before watcher dispatch must not fetch a different account under the old scope");
        CurrentAccountId = "account-a";
        CachedPayload = null;
        DuringFetch = () => Interlocked.Increment(ref SessionGeneration);
        try { SharedPayload(SessionScope, SessionGeneration); throw new Exception("Stale in-flight response was published"); }
        catch (IOException) { }
        DuringFetch = null;
        var afterStaleSuccess = FetchCount;
        SharedPayload(SessionScope, SessionGeneration);
        Check(FetchCount == afterStaleSuccess + 1, "New session must not reuse a stale in-flight success");
        CachedPayload = null;
        FetchLimited = true;
        DuringFetch = () => Interlocked.Increment(ref SessionGeneration);
        try { SharedPayload(SessionScope, SessionGeneration); throw new Exception("Stale in-flight cooldown was published"); }
        catch (IOException) { }
        DuringFetch = null;
        var afterStaleLimit = FetchCount;
        Check((string)SharedPayload(SessionScope, SessionGeneration)["errorCode"] == "RATE_LIMITED" && FetchCount == afterStaleLimit,
            "Same-account token rewrite during request must preserve Retry-After without another fetch");
        FetchLimited = false;
        CachedPayload = null;
        using (var pages = new PageSessions())
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
            try { WatchLoginConfiguration(() => { }); throw new Exception("Login error was swallowed"); }
            catch (IOException error) { Check(Object.ReferenceEquals(error, LoginError), "Login error was replaced"); }
            try { LastWatcher.EnableRaisingEvents = true; throw new Exception("Watcher was not disposed"); }
            catch (ObjectDisposedException) { }
            CheckLoginRenames();
            CheckConfigurationRoot();
            var parentRoot = TestRoot;
            TestRoot = Path.Combine(parentRoot, "removed-before-watch");
            var closedWithoutRoot = false;
            using (var absent = WatchLoginConfiguration(() => closedWithoutRoot = true))
                Check(absent == null && closedWithoutRoot, "Removed config directory during watcher setup must close the unwatched session");
            TestRoot = parentRoot;
        }
        finally
        {
            if (LastWatcher != null) LastWatcher.Dispose();
            Directory.Delete(TestRoot);
        }
        using (var socket = new CdpSocket("synthetic")) {
            socket.PageState = new Dictionary<string, object> { { "needsData", true }, { "id", "nonce-7" } };
            Check(PageDataRequested(socket, out requestId) && requestId == "nonce-7", "Bootstrap preserves pending ID");
            socket.PageState["id"] = "nonce-8";
            PublishOfficialPayload(socket, requestId);
            Check(socket.LastExpression.EndsWith(",\"nonce-7\")"), "Late official reply must echo original ID");
            socket.PageState["id"] = "invalid_id";
            Check(!PageDataRequested(socket, out requestId), "Bootstrap rejects malformed ID");
            socket.PageState["id"] = null;
            Check(PageDataRequested(socket, out requestId) && requestId == null, "Legacy bootstrap supported");
            SendCommand(socket, "Runtime.evaluate", new Dictionary<string, object>());
            Thread.Sleep(IoDeadlineMilliseconds * 2);
            Check(!socket.Closed, "Completed command must cancel deadline");
            socket.Stall = true;
            var clock = Stopwatch.StartNew();
            try { SendCommand(socket, "Runtime.evaluate", new Dictionary<string, object>()); throw new Exception("Stalled command succeeded"); }
            catch (IOException) { }
            Check(socket.Closed && clock.ElapsedMilliseconds >= 100 && clock.ElapsedMilliseconds < 1000, "Stalled command closes socket within deadline");
        }
        CheckOfficialPlanTypes();
        CheckSlowBody();
        CheckDiscovery("success");
        CheckDiscovery("multiple");
        CheckDiscovery("headers");
        CheckDiscovery("body");
        CheckDiscovery("drip");
    }
__DISCOVERY__
__WATCHER__
__LOGIN_WAIT__
__CONFIG_ROOT__
__CONFIG_LOADERS__
__LOGIN_SELECTOR__
__PAYLOAD_METHODS__
__TARGET_EVENTS__
__SHARED_PAYLOAD__
__PAGE_SESSIONS__
}
'@
$harness = $harness.Replace('__BACKOFF__', $backoff).Replace('__DISCOVERY__', $discovery).Replace('__WATCHER__', $watcher).Replace('__LOGIN_WAIT__', $loginWait).Replace('__CONFIG_ROOT__', $configRoot).Replace('__CONFIG_LOADERS__', $configLoaders).Replace('__LOGIN_SELECTOR__', $loginSelector).Replace('__PAYLOAD_METHODS__', $payloadMethods).Replace('__TARGET_EVENTS__', $targetEvents).Replace('__SHARED_PAYLOAD__', $sharedPayload).Replace('__PAGE_SESSIONS__', $pageSessions).Replace('__SEND_COMMAND__', $sendCommand).Replace('__PUBLISH_METHODS__', $publishMethods).Replace('__HTTP_METHODS__', $httpMethods)
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll, System.Core.dll, System.Web.Extensions.dll
[NativeHelperRegressions]::Run()
'Native helper regressions: 24 groups passed, 0 failed (backoff, watcher cleanup, login rename boundaries, CODEX_HOME isolation and directory events, official-only login and obsolete API markers, 5 discovery cases, HTTP errors, console requests, diagnosis sanitization, invalid diagnosis, new window events, shared fetch/cache/cooldown, account change race and in-flight invalidation, strict quota number/window types, page session scheduling, console history replay, request IDs, bootstrap and reply correlation, CDP deadline, HTTP whole-body deadlines)'
