using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class CodexNativeQuotaPatch
{
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static string NativeScript;
    private static int NextCommandId;
    private const int IoDeadlineMilliseconds = 15000;
    private static volatile string SessionScope = Guid.NewGuid().ToString("N");
    private static string LoginFingerprint;
    private static int SessionGeneration;
    private static int CachedPayloadGeneration;
    private static readonly object PayloadGate = new object();
    private static string CachedPayloadScope;
    private static Dictionary<string, object> CachedPayload;
    private static DateTimeOffset CachedPayloadExpiresAt;
    private static readonly HashSet<string> ObservedCodexRoots = new HashSet<string>();

    private static void Main(string[] args)
    {
        var launchRequested = args.Length == 1 && args[0] == "--launch";
        try
        {
            if (launchRequested)
            {
                if (!WithLauncherLock(LaunchCodex))
                {
                    // A concurrent launcher must not block bringing the existing client back.
                    var roots = FindCodexRootProcesses();
                    if (roots.Count > 0) FocusCodexWindow(roots[0].ProcessId);
                }
                return;
            }
            if (args.Length != 0) { Environment.ExitCode = 2; return; }
            bool firstInstance;
            using (var instance = new Mutex(true, @"Local\CodexUsageCard.Helper", out firstInstance))
            {
                if (!firstInstance) return;
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                NativeScript = File.ReadAllText(
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native_patch.js"),
                    Encoding.UTF8);
                MainAsync().GetAwaiter().GetResult();
            }
        }
        catch (Exception error)
        {
            // Background retries stay silent; explicit startup errors are shown to the user.
            if (launchRequested)
            {
                LogStartup("manual-launch-failed", 0, error);
                MessageBox(IntPtr.Zero, "无法启动 Codex。请确认当前用户已安装 Codex，并可从原入口正常打开。", "Codex（额度卡）", 0x10);
            }
            Environment.ExitCode = 1;
        }
    }

    private static async Task MainAsync()
    {
        // Preserve clients already open when the helper starts, as in v1.9.
        foreach (var process in FindCodexRootProcesses())
            ObservedCodexRoots.Add(process.Identity);
        var retrySeconds = 1;
        while (true)
        {
            try
            {
                if (!IsDebuggableCodexRunning())
                {
                    await WaitForCodexStartAsync();
                    continue;
                }
                var targets = await FindTargetsAsync();
                if (!TryLoadLoginConfiguration())
                {
                    foreach (var target in targets)
                    using (var socket = new CdpSocket(target.WebSocketDebuggerUrl))
                    {
                        socket.Connect();
                        ResetPageSession(socket);
                    }
                    await WaitForLoginConfigurationChangeAsync();
                    continue;
                }
                using (var sessions = new PageSessions())
                using (var loginWatcher = WatchLoginConfiguration(sessions.Close))
                {
                    foreach (var target in targets) sessions.Start(target);
                    if (await sessions.Ready.Task) retrySeconds = 1;
                    await sessions.Completion.Task;
                }
            }
            catch
            {
                // Retry only after an exceptional failure; normal idle states use event watchers.
                await Task.Delay(TimeSpan.FromSeconds(retrySeconds));
                retrySeconds = Math.Min(retrySeconds * 2, 15);
            }
        }
    }

    private static void InstallForCurrentAndFuturePages(CdpSocket socket)
    {
        var initialization = "globalThis.__codexQuotaSessionScope=" + Json.Serialize(SessionScope) +
            ";globalThis.__codexQuotaMode=" + Json.Serialize("account") + ";";
        SendCommand(socket, "Page.enable", new Dictionary<string, object>());
        SendCommand(socket, "Runtime.enable", new Dictionary<string, object>());
        SendCommand(socket, "Page.addScriptToEvaluateOnNewDocument", new Dictionary<string, object>
        {
            { "source", initialization }
        });
        SendCommand(socket, "Page.addScriptToEvaluateOnNewDocument", new Dictionary<string, object>
        {
            { "source", NativeScript }
        });
        Evaluate(socket, initialization);
        Evaluate(socket, NativeScript);
    }

    private static void ResetPageSession(CdpSocket socket)
    {
        Evaluate(socket, @"if (typeof globalThis.__codexQuotaResetSession === 'function') {
            globalThis.__codexQuotaResetSession();
        } else {
            for (const mode of ['Api', 'Official']) {
                for (const suffix of ['Payload', 'Error', 'ErrorCode', 'LastSuccessAt', 'NextAutoAttemptAt',
                    'CooldownUntil', 'UsageFingerprint', 'NeedsData', 'Loaded']) {
                    delete globalThis['__codexQuota' + mode + suffix];
                }
            }
            document.getElementById('codex-api-usage-host')?.remove();
            document.getElementById('codex-official-usage-host')?.remove();
        }");
    }

    private static string ConfigurationRoot()
    {
        var configured = Environment.GetEnvironmentVariable("CODEX_HOME");
        var root = Path.GetFullPath(String.IsNullOrWhiteSpace(configured)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex")
            : configured);
        return root.Length > Path.GetPathRoot(root).Length
            ? root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : root;
    }

    private static async Task WaitForLoginConfigurationChangeAsync()
    {
        var root = ConfigurationRoot();
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!Directory.Exists(root))
        {
            using (var watcher = new FileSystemWatcher(Path.GetDirectoryName(root)))
            {
                watcher.NotifyFilter = NotifyFilters.DirectoryName;
                FileSystemEventHandler created = (sender, change) =>
                {
                    if (String.Equals(Path.GetFileName(change.FullPath), Path.GetFileName(root), StringComparison.OrdinalIgnoreCase))
                        completion.TrySetResult(true);
                };
                RenamedEventHandler renamed = (sender, change) => created(sender, change);
                watcher.Created += created;
                watcher.Renamed += renamed;
                watcher.Error += (sender, error) => completion.TrySetException(error.GetException());
                watcher.EnableRaisingEvents = true;
                if (Directory.Exists(root)) return;
                await completion.Task;
                return;
            }
        }
        using (var watcher = new FileSystemWatcher(root))
        {
            watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size;
            FileSystemEventHandler changed = (sender, change) =>
            {
                if (IsLoginConfigurationChange(change)) completion.TrySetResult(true);
            };
            RenamedEventHandler renamed = (sender, change) => changed(sender, change);
            watcher.Changed += changed;
            watcher.Created += changed;
            watcher.Deleted += changed;
            watcher.Renamed += renamed;
            watcher.Error += (sender, error) => completion.TrySetException(error.GetException());
            watcher.EnableRaisingEvents = true;

            // Close the gap between the caller's first check and watcher startup.
            if (TryLoadLoginConfiguration()) return;
            await completion.Task;
        }
    }

    private static bool TryLoadLoginConfiguration()
    {
        try
        {
            var account = LoadOfficialConfiguration();
            if (account == null) return false;
            // The credential fingerprint stays in the helper; pages receive only a random scope.
            var fingerprint = AccountFingerprint(account);
            if (LoginFingerprint != null && LoginFingerprint != fingerprint)
            {
                SessionScope = Guid.NewGuid().ToString("N");
                Interlocked.Increment(ref SessionGeneration);
            }
            LoginFingerprint = fingerprint;
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static string AccountFingerprint(OfficialConfiguration account)
    {
        using (var hash = SHA256.Create())
            return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(
                Json.Serialize(new[] { "account", account.AccountId }))));
    }

    private static FileSystemWatcher WatchLoginConfiguration(Action close)
    {
        var generation = Volatile.Read(ref SessionGeneration);
        var root = ConfigurationRoot();
        if (!Directory.Exists(root)) { close(); return null; }
        var watcher = new FileSystemWatcher(root)
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler changed = (sender, change) =>
        {
            if (IsLoginConfigurationChange(change))
            {
                Interlocked.Increment(ref SessionGeneration);
                close();
            }
        };
        RenamedEventHandler renamed = (sender, change) => changed(sender, change);
        watcher.Changed += changed;
        watcher.Created += changed;
        watcher.Deleted += changed;
        watcher.Renamed += renamed;
        watcher.Error += (sender, error) => close();
        try
        {
            watcher.EnableRaisingEvents = true;

            // Recheck after the watcher starts so a config write cannot fall into the setup gap.
            if (!TryLoadLoginConfiguration() ||
                Volatile.Read(ref SessionGeneration) != generation)
            {
                Interlocked.Increment(ref SessionGeneration);
                close();
            }
            return watcher;
        }
        catch
        {
            watcher.Dispose();
            throw;
        }
    }

    private static bool IsLoginConfigurationChange(FileSystemEventArgs change)
    {
        var renamed = change as RenamedEventArgs;
        foreach (var path in new[] { change.FullPath, renamed == null ? null : renamed.OldFullPath })
        {
            var name = Path.GetFileName(path);
            if (String.Equals(name, "auth.json", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "config.toml", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void KeepSessionOpen(CdpSocket socket)
    {
        while (true)
        {
            // Page events are consumed so they cannot build up in the local socket buffer.
            var message = socket.PendingEvents.Count > 0 ? socket.PendingEvents.Dequeue() : socket.ReceiveText();
            if (socket.OnEvent != null) socket.OnEvent(message);
            string requestId;
            if (IsConsoleRequest(message, "__codexQuotaDoctorRequest__"))
                PublishDiagnosis(socket);
            else if (TryConsoleRequest(message, "__codexQuotaOfficialRequest__", out requestId))
                PublishOfficialPayload(socket, requestId);
        }
    }

    private static bool IsConsoleRequest(string message, string name)
    {
        string requestId;
        return TryConsoleRequest(message, name, out requestId);
    }

    private static bool ValidRequestId(string value)
    {
        return value != null && value.Length <= 80 && Regex.IsMatch(value, "\\A[A-Za-z0-9-]+\\z");
    }

    private static bool TryConsoleRequest(string message, string name, out string requestId)
    {
        requestId = null;
        if (name != "__codexQuotaOfficialRequest__" && name != "__codexQuotaDoctorRequest__") return false;
        var root = Json.DeserializeObject(message) as Dictionary<string, object>;
        if (root == null || StringValue(root, "method") != "Runtime.consoleAPICalled") return false;
        var parameters = root.ContainsKey("params") ? root["params"] as Dictionary<string, object> : null;
        var args = parameters != null && parameters.ContainsKey("args") ? parameters["args"] as object[] : null;
        var argument = args != null && (args.Length == 1 || args.Length == 2) ? args[0] as Dictionary<string, object> : null;
        if (argument == null || StringValue(argument, "type") != "string" || StringValue(argument, "value") != name) return false;
        if (args.Length == 1) return true; // Previous helpers/pages used a single marker.
        if (name != "__codexQuotaOfficialRequest__") return false;
        var id = args[1] as Dictionary<string, object>;
        if (id == null || StringValue(id, "type") != "string" || !ValidRequestId(StringValue(id, "value"))) return false;
        requestId = StringValue(id, "value");
        return true;
    }

    private static Dictionary<string, object> HttpErrorPayload(int statusCode, string retryAfter, DateTimeOffset now)
    {
        var payload = new Dictionary<string, object> {
            { "errorCode", statusCode == 401 || statusCode == 403 ? "AUTH_REQUIRED" :
                statusCode == 429 ? "RATE_LIMITED" : "NETWORK_ERROR" }
        };
        if (statusCode == 429)
        {
            int seconds;
            DateTimeOffset date;
            if (Int32.TryParse(retryAfter, NumberStyles.None, CultureInfo.InvariantCulture, out seconds) && seconds >= 0)
                payload["retryAfterSeconds"] = Math.Max(1, seconds);
            else if (DateTimeOffset.TryParseExact(retryAfter, "r", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal, out date) && date > now)
                payload["retryAfterSeconds"] = (int)Math.Min(Int32.MaxValue, Math.Ceiling((date - now).TotalSeconds));
        }
        return payload;
    }

    private static Dictionary<string, object> WebErrorPayload(WebException exception)
    {
        if (exception.Status == WebExceptionStatus.Timeout)
            return new Dictionary<string, object> { { "errorCode", "REQUEST_TIMEOUT" } };
        using (var response = exception.Response as HttpWebResponse)
            return HttpErrorPayload(response == null ? 0 : (int)response.StatusCode,
                response == null ? null : response.Headers["Retry-After"], DateTimeOffset.UtcNow);
    }

    private static Dictionary<string, object> SanitizeDiagnosis(Dictionary<string, object> raw)
    {
        if (raw == null) throw new InvalidOperationException("Invalid diagnosis");
        var result = new Dictionary<string, object>();
        foreach (var key in new[] { "Installed", "TaskFound", "TaskActionMatches", "HelperFilePresent", "HelperWindowless",
            "CodexRunning", "CdpEndpointFound", "MainPageFound", "CardVisible" })
        {
            object value;
            if (!raw.TryGetValue(key, out value) || (value != null && !(value is bool)))
                throw new InvalidOperationException("Invalid diagnosis status");
            result[key] = value;
        }
        foreach (var key in new[] { "HelperProcessCount", "WindowCount", "VisibleCardCount", "UninspectedWindowCount" })
        {
            object count;
            if (raw.TryGetValue(key, out count) && (count == null || (count is int && (int)count >= 0)))
                result[key] = count;
        }
        object startupPrompt;
        if (raw.TryGetValue("StartupPromptVisible", out startupPrompt))
        {
            if (!(startupPrompt is bool)) throw new InvalidOperationException("Invalid startup prompt status");
            result["StartupPromptVisible"] = startupPrompt;
        }
        foreach (var entry in new[] {
            new[] { "ActivationState", "InspectionFailed", "NotInstalled", "TaskActionMismatch", "HelperMissing", "TaskNotRunning",
                "HelperNotRunning", "HelperMultipleProcesses", "HelperWindowVisible", "InstalledWaitingForCodex",
                "InstalledWaitingForDebugPort", "InstalledWaitingForMainPage", "AwaitingStartupDecision", "Active", "InstalledCardMissing" },
            new[] { "TaskState", "Unknown", "Disabled", "Queued", "Ready", "Running" },
            new[] { "CardKind", "Api", "Official", "Mixed" }
        })
        {
            var value = StringValue(raw, entry[0]);
            result[entry[0]] = Array.IndexOf(entry, value, 1) >= 1 ? value : null;
        }
        var allowedCodes = new HashSet<string>(new[] { "TASK_INSPECTION_FAILED", "TASK_NOT_FOUND", "TASK_ACTION_MISMATCH",
            "TASK_NOT_RUNNING", "HELPER_FILE_NOT_FOUND", "HELPER_INSPECTION_FAILED", "HELPER_NOT_RUNNING",
            "HELPER_MULTIPLE_PROCESSES", "HELPER_WINDOW_VISIBLE", "CODEX_INSPECTION_FAILED", "CODEX_NOT_RUNNING",
            "CDP_PORT_UNAVAILABLE", "CDP_ENDPOINT_UNAVAILABLE", "CDP_MAIN_PAGE_UNAVAILABLE", "CDP_MAIN_PAGE_AMBIGUOUS",
            "CARD_NOT_VISIBLE", "CARD_INSPECTION_FAILED", "CDP_INSPECTION_FAILED", "STARTUP_CONFIRMATION_PENDING" });
        var codes = raw.ContainsKey("StageCodes") ? raw["StageCodes"] as object[] : null;
        var safeCodes = new List<string>();
        if (codes != null) foreach (var code in codes)
            if (code is string && allowedCodes.Contains((string)code)) safeCodes.Add((string)code);
        result["StageCodes"] = safeCodes;
        return result;
    }

    private static void PublishDiagnosis(CdpSocket socket)
    {
        Dictionary<string, object> payload;
        try
        {
            var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            var script = Path.Combine(root, "scripts", "doctor.ps1");
            if (!File.Exists(script)) script = Path.Combine(root, "scripts", "doctor_usage_card.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException();
            var command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; & '" +
                script.Replace("'", "''") + "' -InstallRoot '" + root.Replace("'", "''") + "' | ConvertTo-Json -Compress -Depth 4";
            var startInfo = new ProcessStartInfo {
                // Doctor uses the PowerShell 7 runtime required by the installer.
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    @"PowerShell\7\pwsh.exe"),
                Arguments = "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)),
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
            };
            using (var process = Process.Start(startInfo))
            {
                if (process == null) throw new InvalidOperationException();
                var output = process.StandardOutput.ReadToEndAsync();
                process.ErrorDataReceived += (sender, line) => { }; // Drain, never log raw diagnostic errors.
                process.BeginErrorReadLine();
                if (!process.WaitForExit(15000))
                {
                    process.Kill();
                    payload = new Dictionary<string, object> { { "errorCode", "DIAGNOSIS_TIMEOUT" } };
                }
                else
                {
                    if (process.ExitCode != 0) throw new InvalidOperationException();
                    payload = SanitizeDiagnosis(Json.DeserializeObject(output.GetAwaiter().GetResult()) as Dictionary<string, object>);
                }
            }
        }
        catch
        {
            // Never publish process output, exception messages, file paths, or account data.
            payload = new Dictionary<string, object> { { "errorCode", "DIAGNOSIS_UNAVAILABLE" } };
        }
        Evaluate(socket, "globalThis.__codexQuotaUpdateDiagnosis(" + Json.Serialize(payload) + ")");
    }

    private static bool PageDataRequested(CdpSocket socket, out string requestId)
    {
        requestId = null;
        const string prefix = "__codexQuotaOfficial";
        var result = Evaluate(socket, "({needsData:globalThis[" + Json.Serialize(prefix + "NeedsData") + "]===true,id:globalThis[" +
            Json.Serialize(prefix + "RequestId") + "]??null})");
        var remote = result.ContainsKey("result") ? result["result"] as Dictionary<string, object> : null;
        var value = remote != null && remote.ContainsKey("value") ? remote["value"] as Dictionary<string, object> : null;
        if (value == null || !value.ContainsKey("needsData") || !(value["needsData"] is bool) || !(bool)value["needsData"]) return false;
        object id;
        if (value.TryGetValue("id", out id) && id != null)
        {
            if (!(id is string) || !ValidRequestId((string)id)) return false;
            requestId = (string)id;
        }
        return true;
    }

    private static void PublishOfficialPayload(CdpSocket socket, string requestId = null)
    {
        Evaluate(socket, "globalThis.__codexQuotaUpdateOfficial(" + Json.Serialize(SharedPayload(socket.Scope, socket.Generation)) + "," + Json.Serialize(requestId) + ")");
    }

    private static Dictionary<string, object> SharedPayload(string scope, int generation)
    {
        // ponytail: one fetch lock per helper; split by account only if concurrent accounts are supported.
        lock (PayloadGate)
        {
            if (scope != SessionScope || generation != Volatile.Read(ref SessionGeneration)) throw new IOException("Login session changed");
            var now = DateTimeOffset.UtcNow;
            if (CachedPayload != null && CachedPayloadScope == scope && now < CachedPayloadExpiresAt &&
                (CachedPayloadGeneration == generation || StringValue(CachedPayload, "errorCode") == "RATE_LIMITED"))
            {
                var cached = new Dictionary<string, object>(CachedPayload);
                if (StringValue(cached, "errorCode") == "RATE_LIMITED")
                    cached["retryAfterSeconds"] = Math.Max(1, (int)Math.Ceiling((CachedPayloadExpiresAt - now).TotalSeconds));
                return cached;
            }
            Dictionary<string, object> payload;
            try
            {
                var account = LoadOfficialConfiguration();
                // File watcher delivery may lag the credential write; never fetch a new account for an old scope.
                if (account != null && AccountFingerprint(account) != LoginFingerprint)
                    throw new InvalidOperationException();
                payload = account == null
                    ? new Dictionary<string, object> { { "errorCode", "AUTH_REQUIRED" } }
                    : FetchOfficialPayload(account);
            }
            catch (WebException exception) { payload = WebErrorPayload(exception); }
            catch { payload = new Dictionary<string, object> { { "errorCode", "INVALID_RESPONSE" } }; }
            var seconds = StringValue(payload, "errorCode") == "RATE_LIMITED"
                ? (payload.ContainsKey("retryAfterSeconds") ? (int)payload["retryAfterSeconds"] : 30) : 5;
            CachedPayload = payload;
            CachedPayloadScope = scope;
            CachedPayloadGeneration = generation;
            CachedPayloadExpiresAt = DateTimeOffset.UtcNow.AddSeconds(seconds);
            // Keep same-account Retry-After across a token rewrite, but never reply to the stale page session.
            if (scope != SessionScope || generation != Volatile.Read(ref SessionGeneration))
                throw new IOException("Login session changed");
            return new Dictionary<string, object>(payload);
        }
    }

    private static OfficialConfiguration LoadOfficialConfiguration()
    {
        var path = Path.Combine(ConfigurationRoot(), "auth.json");
        if (!File.Exists(path)) return null;
        var auth = Json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
        if (auth == null || !auth.ContainsKey("tokens") || auth["tokens"] == null) return null;
        var mode = StringValue(auth, "auth_mode");
        if (String.Equals(mode, "api", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(mode, "apikey", StringComparison.OrdinalIgnoreCase)) return null;
        var tokens = auth["tokens"] as Dictionary<string, object>;
        if (tokens == null) throw new InvalidOperationException();
        if (!tokens.ContainsKey("access_token") && !tokens.ContainsKey("account_id")) return null;
        var accessToken = tokens.ContainsKey("access_token") ? tokens["access_token"] as string : null;
        var accountId = tokens.ContainsKey("account_id") ? tokens["account_id"] as string : null;
        if (String.IsNullOrWhiteSpace(accessToken) || String.IsNullOrWhiteSpace(accountId))
            throw new InvalidOperationException();
        return new OfficialConfiguration
        {
            Url = "https://chatgpt.com/backend-api/wham/usage",
            AccessToken = accessToken,
            AccountId = accountId,
        };
    }

    private static Dictionary<string, object> FetchOfficialPayload(OfficialConfiguration official)
    {
        var request = (HttpWebRequest)WebRequest.Create(official.Url);
        request.Method = "GET";
        request.Proxy = QuotaProxy();
        request.Timeout = 10000;
        request.ReadWriteTimeout = 10000;
        request.Accept = "application/json";
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + official.AccessToken;
        request.Headers["ChatGPT-Account-ID"] = official.AccountId;
        var response = ReadQuotaResponse(request);
        var planName = response != null && response.ContainsKey("plan_type") ? response["plan_type"] as string : null;
        var rateLimit = response != null && response.ContainsKey("rate_limit")
            ? response["rate_limit"] as Dictionary<string, object>
            : null;
        bool allowed, limitReached;
        if (String.IsNullOrWhiteSpace(planName) || rateLimit == null ||
            !BooleanValue(rateLimit, "allowed", out allowed) ||
            !BooleanValue(rateLimit, "limit_reached", out limitReached))
            throw new InvalidOperationException();
        var windows = new List<object>();
        var primary = OfficialWindowPayload(rateLimit, "primary_window", true);
        var secondary = OfficialWindowPayload(rateLimit, "secondary_window", false);
        if (primary != null) windows.Add(primary);
        if (secondary != null) windows.Add(secondary);
        return new Dictionary<string, object> { { "planName", planName }, { "windows", windows } };
    }

    private static Dictionary<string, object> ReadQuotaResponse(HttpWebRequest request)
    {
        using (var deadline = new CancellationTokenSource(IoDeadlineMilliseconds))
        using (deadline.Token.Register(request.Abort))
        {
            try
            {
                using (var http = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(http.GetResponseStream()))
                    return Json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
            }
            catch (Exception error)
            {
                // Only our elapsed deadline turns an aborted request/body read into a timeout.
                var webError = error as WebException;
                if (!deadline.IsCancellationRequested || !(error is IOException ||
                    (webError != null && webError.Status == WebExceptionStatus.RequestCanceled))) throw;
                throw new WebException("Quota request timed out", error, WebExceptionStatus.Timeout, null);
            }
        }
    }

    private static Dictionary<string, object> OfficialWindowPayload(
        Dictionary<string, object> rateLimit,
        string name,
        bool required)
    {
        object raw;
        if (!rateLimit.TryGetValue(name, out raw) || raw == null)
        {
            if (required) throw new InvalidOperationException();
            return null;
        }
        var window = raw as Dictionary<string, object>;
        if (window == null) throw new InvalidOperationException();
        double used, seconds, resetAt;
        if (!NumberValue(window, "used_percent", out used) || used < 0 || used > 100 ||
            !NumberValue(window, "limit_window_seconds", out seconds) || seconds <= 0 ||
            !NumberValue(window, "reset_at", out resetAt) || resetAt < 0)
            throw new InvalidOperationException();
        var label = Math.Abs(seconds - 18000) < 0.5
            ? "5h"
            : Math.Abs(seconds - 604800) < 0.5 ? "Weekly" : (seconds / 60).ToString("0") + " min";
        return new Dictionary<string, object>
        {
            { "label", label }, { "usedPercent", used }, { "resetAt", resetAt }
        };
    }

    private static IWebProxy QuotaProxy()
    {
        var value = Environment.GetEnvironmentVariable("HTTPS_PROXY");
        if (String.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable("HTTPS_PROXY", EnvironmentVariableTarget.User);
        if (String.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable("HTTP_PROXY");
        if (String.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable("HTTP_PROXY", EnvironmentVariableTarget.User);
        if (String.IsNullOrWhiteSpace(value))
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "api-proxy.dat");
            if (File.Exists(path))
            {
                var encrypted = File.ReadAllBytes(path);
                value = Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser));
            }
        }
        if (String.IsNullOrWhiteSpace(value)) return WebRequest.DefaultWebProxy;
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) throw new InvalidOperationException();
        return new WebProxy(uri);
    }

    private static bool NumberValue(Dictionary<string, object> values, string key, out double value)
    {
        value = 0;
        object raw;
        if (!values.TryGetValue(key, out raw) || !(raw is int || raw is long || raw is decimal || raw is double || raw is float)) return false;
        value = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
        return !Double.IsNaN(value) && !Double.IsInfinity(value);
    }

    private static bool BooleanValue(Dictionary<string, object> values, string key, out bool value)
    {
        value = false;
        if (!values.ContainsKey(key) || !(values[key] is bool)) return false;
        value = (bool)values[key];
        return true;
    }

    private static void LogStartup(string stage, int processId, Exception error = null)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexUsageCard");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "startup.log");
            // Keep diagnostics bounded and limited to startup; never log account data or command lines.
            if (File.Exists(path) && new FileInfo(path).Length > 65536) File.WriteAllText(path, "");
            var message = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + " " + stage + " pid=" + processId;
            if (error != null) message += " " + error.GetType().Name + " HRESULT=0x" + error.HResult.ToString("X8") + " " + error.Message;
            File.AppendAllText(path, message + Environment.NewLine, Encoding.UTF8);
        }
        catch (IOException) { /* Diagnostic storage must not prevent the user's app from starting. */ }
        catch (UnauthorizedAccessException) { /* The startup error still propagates to its caller. */ }
    }

    private static void LaunchCodex()
    {
        var processes = FindCodexRootProcesses();
        if (processes.Count > 0)
        {
            FocusCodexWindow(processes[0].ProcessId);
            return;
        }

        var appId = FindInstalledCodexAppId();
        LaunchWithDebugging(appId, FindAvailableLoopbackPort());
    }

    private static bool WithLauncherLock(Action action)
    {
        bool firstLauncher;
        using (var launcher = new Mutex(true, @"Local\CodexUsageCard.Launcher", out firstLauncher))
        {
            if (!firstLauncher) return false;
            action();
            return true;
        }
    }

    private static uint LaunchWithDebugging(string appId, int port)
    {
        var portText = port.ToString(CultureInfo.InvariantCulture);
        return LaunchRegisteredApp(appId,
            "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + portText +
            " --remote-allow-origins=http://127.0.0.1:" + portText);
    }

    private static void RelaunchWithRemoteDebugging(CodexProcessInfo expected)
    {
        var current = FindMatchingCodexRoot(expected);
        if (current == null || HasRemoteDebuggingPort(current.CommandLine)) return;
        // Resolve a viable replacement before touching this newly observed client.
        var appId = FindInstalledCodexAppId();
        var port = FindAvailableLoopbackPort();
        using (var process = Process.GetProcessById(current.ProcessId))
        {
            if (process.Handle == IntPtr.Zero) throw new InvalidOperationException("Codex process handle is unavailable");
            var expectedTicks = ManagementDateTimeConverter.ToDateTime(current.CreationDate).ToUniversalTime().Ticks;
            // Hold the handle and reject PID reuse; WMI has microsecond precision.
            if (process.StartTime.ToUniversalTime().Ticks / 10 != expectedTicks / 10 ||
                !String.Equals(Path.GetFullPath(process.MainModule.FileName), Path.GetFullPath(current.ExecutablePath), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Codex process identity changed before relaunch");
            process.Kill();
            if (!process.WaitForExit(5000)) throw new TimeoutException("Codex did not exit before debug relaunch");
        }
        // A concurrent root may only be a short-lived single-instance forwarder.
        // Always submit the replacement launch after exit; Codex owns its instance lock.
        LaunchWithDebugging(appId, port);
    }

    private static CodexProcessInfo FindMatchingCodexRoot(CodexProcessInfo expected)
    {
        foreach (var current in FindCodexRootProcesses())
            if (current.Identity == expected.Identity && String.Equals(current.ExecutablePath, expected.ExecutablePath, StringComparison.OrdinalIgnoreCase))
                return current;
        return null;
    }

    private static string FindInstalledCodexAppId()
    {
        // Resolve the registered app identity, including its manifest application ID.
        var command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
            "$package=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; " +
            "if (-not $package) { throw 'Codex is not installed for the current user' }; " +
            "$apps=@((Get-AppxPackageManifest -Package $package.PackageFullName).Package.Applications.Application | " +
            "Where-Object { $_.Executable.Replace([char]92,[char]47) -ieq 'app/ChatGPT.exe' }); " +
            "if ($apps.Count -ne 1) { throw 'Registered Codex application is ambiguous' }; " +
            "[Console]::Write($package.PackageFamilyName + '!' + $apps[0].Id)";
        var startInfo = new ProcessStartInfo {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
            Arguments = "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)),
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
        };
        using (var query = Process.Start(startInfo))
        {
            if (query == null) throw new InvalidOperationException("Package query failed");
            var output = query.StandardOutput.ReadToEndAsync();
            query.ErrorDataReceived += (sender, line) => { }; // Only the package location is consumed.
            query.BeginErrorReadLine();
            if (!query.WaitForExit(15000))
            {
                query.Kill();
                throw new TimeoutException("Package query timed out");
            }
            if (query.ExitCode != 0) throw new InvalidOperationException("Package query failed");
            var appId = output.GetAwaiter().GetResult().Trim();
            if (!Regex.IsMatch(appId, @"\AOpenAI\.Codex_[A-Za-z0-9]+![A-Za-z0-9._-]+\z"))
                throw new InvalidOperationException("Invalid registered Codex application ID");
            return appId;
        }
    }

    private static void FocusCodexWindow(int processId)
    {
        using (var process = Process.GetProcessById(processId))
        {
            var window = process.MainWindowHandle;
            if (window == IntPtr.Zero) return;
            if (IsIconic(window)) ShowWindowAsync(window, 9);
            SetForegroundWindow(window);
        }
    }

    private static List<CodexProcessInfo> FindCodexRootProcesses()
    {
        var processes = new List<CodexProcessInfo>();
        using (var searcher = new ManagementObjectSearcher(
            "SELECT ProcessId, CreationDate, ExecutablePath, CommandLine FROM Win32_Process WHERE Name='ChatGPT.exe' AND SessionId=" + Process.GetCurrentProcess().SessionId))
        using (var matches = searcher.Get())
        {
            foreach (ManagementObject match in matches)
            {
                var executablePath = Convert.ToString(match["ExecutablePath"]);
                var commandLine = Convert.ToString(match["CommandLine"]);
                var creationDate = Convert.ToString(match["CreationDate"]);
                if (match["ProcessId"] == null || String.IsNullOrWhiteSpace(creationDate) ||
                    !IsCodexRootProcess(executablePath, commandLine)) continue;
                var processId = Convert.ToInt32(match["ProcessId"]);
                processes.Add(new CodexProcessInfo
                {
                    ProcessId = processId,
                    CreationDate = creationDate,
                    ExecutablePath = executablePath,
                    CommandLine = commandLine
                });
            }
        }
        return processes;
    }

    private static bool IsCodexRootProcess(string executablePath, string commandLine)
    {
        if (String.IsNullOrWhiteSpace(executablePath) || String.IsNullOrWhiteSpace(commandLine) ||
            !String.Equals(Path.GetFileName(executablePath), "ChatGPT.exe", StringComparison.OrdinalIgnoreCase) ||
            Regex.IsMatch(commandLine, "(?:^|\\s)--type=", RegexOptions.IgnoreCase)) return false;
        var appDirectory = Path.GetDirectoryName(executablePath);
        var packageDirectory = Path.GetDirectoryName(appDirectory);
        if (String.IsNullOrWhiteSpace(appDirectory) || String.IsNullOrWhiteSpace(packageDirectory)) return false;
        return String.Equals(Path.GetFileName(appDirectory), "app", StringComparison.OrdinalIgnoreCase) &&
            Path.GetFileName(packageDirectory).StartsWith("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasRemoteDebuggingPort(string commandLine)
    {
        return Regex.IsMatch(commandLine ?? "", "(?:^|\\s)--remote-debugging-port(?:=|\\s)", RegexOptions.IgnoreCase);
    }

    private static uint LaunchRegisteredApp(string appId, string arguments)
    {
        // MSIX activation supplies package identity; raw CreateProcess with an Explorer parent does not.
        var initialized = CoInitializeEx(IntPtr.Zero, 0); // COINIT_MULTITHREADED
        if (initialized < 0 && initialized != unchecked((int)0x80010106)) // RPC_E_CHANGED_MODE: already initialized.
            Marshal.ThrowExceptionForHR(initialized);
        IApplicationActivationManager activation = null;
        try
        {
            var classId = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
            var interfaceId = typeof(IApplicationActivationManager).GUID;
            // The out-of-process server keeps activation arguments alive after a short-lived --launch exits.
            Marshal.ThrowExceptionForHR(CoCreateInstance(ref classId, IntPtr.Zero, 4, ref interfaceId, out activation)); // CLSCTX_LOCAL_SERVER
            uint processId;
            Marshal.ThrowExceptionForHR(activation.ActivateApplication(appId, arguments, 0, out processId)); // AO_NONE
            if (processId == 0) throw new InvalidOperationException("Codex activation returned no process");
            LogStartup("activation-returned", checked((int)processId));
            return processId;
        }
        finally
        {
            if (activation != null) Marshal.ReleaseComObject(activation);
            if (initialized >= 0) CoUninitialize();
        }
    }

    private static int FindAvailableLoopbackPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        try
        {
            listener.Start();
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static bool IsDebuggableCodexRunning()
    {
        foreach (var process in FindCodexRootProcesses())
            if (HasRemoteDebuggingPort(process.CommandLine)) return true;
        return false;
    }

    private static Task WaitForCodexStartAsync()
    {
        return Task.Run(() => WaitForCodexWindow());
    }

    private static void WaitForCodexWindow()
    {
        // Window events work in the limited user session; kernel process-trace subscriptions may not.
        var ownerThread = GetCurrentThreadId();
        NativeMessage message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create the queue before callbacks can post to it.
        var pending = true;
        var startupGrace = false;
        Exception callbackError = null;
        WinEventCallback callback = (hook, kind, window, objectId, childId, thread, time) =>
        {
            try
            {
                if (window == IntPtr.Zero || objectId != 0 || childId != 0 || !IsCodexWindow(window)) return;
                if (!pending)
                {
                    pending = true;
                    startupGrace = true;
                    if (!PostThreadMessage(ownerThread, 0x8001, UIntPtr.Zero, IntPtr.Zero))
                        callbackError = new Win32Exception(Marshal.GetLastWin32Error());
                }
            }
            catch (Exception error)
            {
                // Never throw across the native callback boundary.
                callbackError = error;
                PostThreadMessage(ownerThread, 0x8001, UIntPtr.Zero, IntPtr.Zero);
            }
        };
        var callbackHandle = GCHandle.Alloc(callback);
        var foregroundHook = IntPtr.Zero;
        var shownHook = IntPtr.Zero;
        try
        {
            // WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS: no DLL injection, no self-dialog loop.
            foregroundHook = SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, callback, 0, 0, 2);
            shownHook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, 0, 0, 2);
            if (foregroundHook == IntPtr.Zero || shownHook == IntPtr.Zero)
                throw new InvalidOperationException("Codex window observation could not start");
            while (true)
            {
                if (callbackError != null) throw new IOException("Codex window observation failed", callbackError);
                if (pending)
                {
                    pending = false;
                    if (startupGrace) Thread.Sleep(2000); // One coalesced startup delay, before process discovery.
                    startupGrace = false;
                    if (InspectCodexStartup()) return;
                    continue;
                }
                var received = GetMessage(out message, IntPtr.Zero, 0, 0);
                if (received == 0) return;
                if (received < 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }
        finally
        {
            if (shownHook != IntPtr.Zero) UnhookWinEvent(shownHook);
            if (foregroundHook != IntPtr.Zero) UnhookWinEvent(foregroundHook);
            callbackHandle.Free();
        }
    }

    private static bool IsCodexWindow(IntPtr window)
    {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        if (processId == 0) return false;
        try
        {
            using (var process = Process.GetProcessById((int)processId))
                return String.Equals(process.ProcessName, "ChatGPT", StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException) { return false; } // A short-lived window may already have closed.
        catch (InvalidOperationException) { return false; }
        catch (Win32Exception) { return false; }
    }

    private static bool InspectCodexStartup()
    {
        var roots = FindCodexRootProcesses();
        foreach (var root in roots)
            if (HasRemoteDebuggingPort(root.CommandLine)) return true;
        foreach (var root in roots)
        {
            if (ObservedCodexRoots.Contains(root.Identity)) continue;
            WithLauncherLock(() =>
            {
                // Claim each new identity once, and only after obtaining the launcher lock.
                if (!ObservedCodexRoots.Add(root.Identity)) return;
                LogStartup("relaunch-requested", root.ProcessId);
                try
                {
                    RelaunchWithRemoteDebugging(root);
                    LogStartup("relaunch-returned", root.ProcessId);
                }
                catch (Exception error)
                {
                    LogStartup("relaunch-failed", root.ProcessId, error);
                    throw;
                }
            });
        }
        return IsDebuggableCodexRunning();
    }

    private static async Task<List<CdpTarget>> FindTargetsAsync()
    {
        var processIds = new HashSet<int>();
        foreach (var process in Process.GetProcessesByName("ChatGPT"))
        {
            try { processIds.Add(process.Id); } catch { }
            process.Dispose();
        }
        if (processIds.Count == 0) throw new InvalidOperationException("Codex is not running");

        var ports = await FindListeningPortsAsync(processIds);
        var matches = new List<CdpTarget>();
        foreach (var port in ports)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(
                    "http://127.0.0.1:" + port + "/json/list");
                request.Proxy = null;
                request.Timeout = 3000;
                request.ReadWriteTimeout = 3000;
                using (var deadline = new CancellationTokenSource(3000))
                using (deadline.Token.Register(request.Abort))
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    var values = Json.DeserializeObject(reader.ReadToEnd()) as object[];
                    if (values == null) continue;
                    var pages = new List<CdpTarget>();
                    foreach (var value in values)
                    {
                        var item = value as Dictionary<string, object>;
                        if (item == null) continue;
                        var target = new CdpTarget
                        {
                            Type = StringValue(item, "type"),
                            Title = StringValue(item, "title"),
                            Url = StringValue(item, "url"),
                            WebSocketDebuggerUrl = StringValue(item, "webSocketDebuggerUrl")
                        };
                        if (target.Type == "page" &&
                            String.Equals(target.Url, "app://-/index.html", StringComparison.OrdinalIgnoreCase) &&
                            !String.IsNullOrWhiteSpace(target.WebSocketDebuggerUrl))
                        {
                            pages.Add(target);
                        }
                    }
                    matches.AddRange(pages);
                }
            }
            catch
            {
                // Ignore unrelated local listeners and ports that are closing.
            }
        }
        if (matches.Count == 0) throw new InvalidOperationException("Codex page target is unavailable");
        return matches;
    }

    private static async Task<HashSet<int>> FindListeningPortsAsync(HashSet<int> processIds)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "netstat.exe",
            Arguments = "-ano -p tcp",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (var process = Process.Start(startInfo))
        {
            if (process == null) throw new InvalidOperationException("netstat failed");
            var output = await Task.Run(() => process.StandardOutput.ReadToEnd());
            process.WaitForExit();
            var ports = new HashSet<int>();
            foreach (var line in output.Split('\n'))
            {
                var parts = Regex.Split(line.Trim(), "\\s+");
                if (parts.Length < 5 || parts[0] != "TCP" || parts[3] != "LISTENING") continue;
                int pid;
                if (!Int32.TryParse(parts[4], out pid) || !processIds.Contains(pid)) continue;
                var match = Regex.Match(parts[1], "^(?:127\\.0\\.0\\.1|\\[::1\\]):(\\d+)$");
                int port;
                if (match.Success && Int32.TryParse(match.Groups[1].Value, out port)) ports.Add(port);
            }
            return ports;
        }
    }

    private static Dictionary<string, object> SendCommand(
        CdpSocket socket,
        string method,
        Dictionary<string, object> parameters)
    {
        var id = Interlocked.Increment(ref NextCommandId);
        var request = new Dictionary<string, object>
        {
            { "id", id },
            { "method", method },
            { "params", parameters }
        };
        // Bound active commands, while idle page event listeners stay blocking and timer-free.
        using (var deadline = new CancellationTokenSource(IoDeadlineMilliseconds))
        using (deadline.Token.Register(socket.Close))
        {
            socket.SendText(Json.Serialize(request));

            while (true)
            {
                var message = socket.ReceiveText();
                var root = Json.DeserializeObject(message) as Dictionary<string, object>;
                if (root == null || !root.ContainsKey("id"))
                {
                    if (socket.OnEvent != null) socket.OnEvent(message);
                    // Runtime.enable replays console history; only queue requests from the live session.
                    if (method != "Runtime.enable" && (IsConsoleRequest(message, "__codexQuotaDoctorRequest__") ||
                        IsConsoleRequest(message, "__codexQuotaOfficialRequest__")))
                        socket.PendingEvents.Enqueue(message);
                    continue;
                }
                if (Convert.ToInt32(root["id"]) != id) continue;
                if (root.ContainsKey("error")) throw new InvalidOperationException("CDP command failed");
                return root.ContainsKey("result")
                    ? root["result"] as Dictionary<string, object> ?? new Dictionary<string, object>()
                    : new Dictionary<string, object>();
            }
        }
    }

    private static Dictionary<string, object> Evaluate(
        CdpSocket socket,
        string expression)
    {
        var result = SendCommand(socket, "Runtime.evaluate", new Dictionary<string, object>
        {
            { "expression", expression },
            { "returnByValue", true }
        });
        var value = result.ContainsKey("result")
            ? result["result"] as Dictionary<string, object>
            : null;
        if (value != null && value.ContainsKey("subtype") && StringValue(value, "subtype") == "error")
            throw new InvalidOperationException("Runtime evaluation failed");
        return result;
    }

    private static string StringValue(Dictionary<string, object> values, string key)
    {
        return values.ContainsKey(key) && values[key] != null ? Convert.ToString(values[key]) : "";
    }

    private static CdpTarget TargetFromEvent(string message, string sourceUrl)
    {
        var root = Json.DeserializeObject(message) as Dictionary<string, object>;
        if (root == null) return null;
        var method = StringValue(root, "method");
        if (method != "Target.targetCreated" && method != "Target.targetInfoChanged") return null;
        var parameters = root.ContainsKey("params") ? root["params"] as Dictionary<string, object> : null;
        var info = parameters != null && parameters.ContainsKey("targetInfo")
            ? parameters["targetInfo"] as Dictionary<string, object> : null;
        if (info == null || StringValue(info, "type") != "page" ||
            !String.Equals(StringValue(info, "url"), "app://-/index.html", StringComparison.OrdinalIgnoreCase)) return null;
        var id = StringValue(info, "targetId");
        if (!Regex.IsMatch(id, "^[A-Za-z0-9_-]+$")) return null;
        var source = new Uri(sourceUrl);
        return new CdpTarget { Type = "page", Title = StringValue(info, "title"), Url = StringValue(info, "url"),
            WebSocketDebuggerUrl = source.GetLeftPart(UriPartial.Authority) + "/devtools/page/" + id };
    }

    private sealed class PageSessions : IDisposable
    {
        private readonly object gate = new object();
        private readonly Dictionary<string, CdpSocket> sockets = new Dictionary<string, CdpSocket>();
        private bool closed;
        public readonly TaskCompletionSource<bool> Ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource<bool> Completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Start(CdpTarget target)
        {
            lock (gate)
            {
                if (closed || sockets.ContainsKey(target.WebSocketDebuggerUrl)) return;
                var socket = new CdpSocket(target.WebSocketDebuggerUrl);
                sockets.Add(target.WebSocketDebuggerUrl, socket);
                socket.OnEvent = message => {
                    var created = TargetFromEvent(message, target.WebSocketDebuggerUrl);
                    if (created != null) Start(created);
                };
                Task.Run(() => {
                    try
                    {
                        using (socket)
                        {
                            socket.Connect();
                            lock (gate) { if (closed) return; }
                            ResetPageSession(socket);
                            SendCommand(socket, "Target.setDiscoverTargets", new Dictionary<string, object> { { "discover", true } });
                            InstallForCurrentAndFuturePages(socket);
                            string requestId;
                            if (PageDataRequested(socket, out requestId))
                                PublishOfficialPayload(socket, requestId);
                            Ready.TrySetResult(true);
                            KeepSessionOpen(socket);
                        }
                    }
                    catch { Close(); }
                });
            }
        }

        public void Close()
        {
            lock (gate)
            {
                if (closed) return;
                closed = true;
                foreach (var socket in sockets.Values) socket.Close();
                // A closed renderer restarts discovery for all current windows, preserving notification scope.
                Ready.TrySetResult(false);
                Completion.TrySetException(new IOException("Codex page session ended"));
            }
        }

        public void Dispose() { Close(); }
    }

    private sealed class CodexProcessInfo
    {
        public int ProcessId;
        public string CreationDate;
        public string Identity { get { return ProcessId + "|" + CreationDate; } }
        public string ExecutablePath;
        public string CommandLine;
    }

    private sealed class OfficialConfiguration
    {
        public string Url;
        public string AccessToken;
        public string AccountId;
    }

    [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    }

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved, uint options);

    [DllImport("ole32.dll")]
    private static extern void CoUninitialize();

    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context,
        ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IApplicationActivationManager activation);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X, Y;
        public uint Private;
    }

    private delegate void WinEventCallback(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint minimum, uint maximum, IntPtr module, WinEventCallback callback, uint process, uint thread, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PeekMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum, uint remove);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref NativeMessage message);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr DispatchMessage(ref NativeMessage message);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBox(IntPtr window, string text, string caption, uint type);

    // A small CDP WebSocket client avoids the .NET Framework ClientWebSocket
    // crash that occurs when Electron reloads its renderer.
    private sealed class CdpSocket : IDisposable
    {
        private readonly Uri uri;
        public readonly string Scope = SessionScope;
        public readonly int Generation = Volatile.Read(ref SessionGeneration);
        public Action<string> OnEvent;
        public readonly Queue<string> PendingEvents = new Queue<string>();
        private TcpClient client;
        private NetworkStream stream;
        private readonly Random random = new Random();

        public CdpSocket(string url)
        {
            uri = new Uri(url);
        }

        public void Connect()
        {
            client = new TcpClient();
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            client.Connect(uri.Host, uri.Port);
            stream = client.GetStream();
            stream.ReadTimeout = 5000;
            stream.WriteTimeout = 5000;
            var key = Convert.ToBase64String(Guid.NewGuid().ToByteArray());
            var request =
                "GET " + uri.PathAndQuery + " HTTP/1.1\r\n" +
                "Host: " + uri.Host + ":" + uri.Port + "\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Key: " + key + "\r\n" +
                "Sec-WebSocket-Version: 13\r\n\r\n";
            var bytes = Encoding.ASCII.GetBytes(request);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
            var response = ReadHeaders();
            if (!response.StartsWith("HTTP/1.1 101", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("CDP WebSocket handshake failed");
            client.ReceiveTimeout = 0;
            stream.ReadTimeout = Timeout.Infinite;
        }

        public void SendText(string text)
        {
            SendFrame(0x1, Encoding.UTF8.GetBytes(text));
        }

        public string ReceiveText()
        {
            using (var message = new MemoryStream())
            {
                var started = false;
                while (true)
                {
                    var frame = ReceiveFrame();
                    if (frame.Opcode == 0x8)
                        throw new IOException("CDP WebSocket closed");
                    if (frame.Opcode == 0x9)
                    {
                        SendFrame(0xA, frame.Payload);
                        continue;
                    }
                    if (frame.Opcode == 0x1)
                    {
                        started = true;
                        message.Write(frame.Payload, 0, frame.Payload.Length);
                    }
                    else if (frame.Opcode == 0x0 && started)
                    {
                        message.Write(frame.Payload, 0, frame.Payload.Length);
                    }
                    else
                    {
                        continue;
                    }
                    if (frame.Fin)
                        return Encoding.UTF8.GetString(message.ToArray());
                }
            }
        }

        public void Dispose()
        {
            try { if (stream != null) stream.Close(); } catch { }
            try { if (client != null) client.Close(); } catch { }
        }

        public void Close()
        {
            Dispose();
        }

        private void SendFrame(byte opcode, byte[] payload)
        {
            if (payload.Length > Int32.MaxValue - 16)
                throw new InvalidOperationException("CDP frame is too large");
            var mask = new byte[4];
            random.NextBytes(mask);
            var header = new MemoryStream();
            header.WriteByte((byte)(0x80 | opcode));
            if (payload.Length < 126)
            {
                header.WriteByte((byte)(0x80 | payload.Length));
            }
            else if (payload.Length <= UInt16.MaxValue)
            {
                header.WriteByte(0xFE);
                header.WriteByte((byte)(payload.Length >> 8));
                header.WriteByte((byte)payload.Length);
            }
            else
            {
                header.WriteByte(0xFF);
                var length = (ulong)payload.Length;
                for (var shift = 56; shift >= 0; shift -= 8)
                    header.WriteByte((byte)(length >> shift));
            }
            header.Write(mask, 0, mask.Length);
            var masked = new byte[payload.Length];
            for (var index = 0; index < payload.Length; index++)
                masked[index] = (byte)(payload[index] ^ mask[index % 4]);
            var prefix = header.ToArray();
            stream.Write(prefix, 0, prefix.Length);
            stream.Write(masked, 0, masked.Length);
            stream.Flush();
        }

        private Frame ReceiveFrame()
        {
            var first = ReadByte();
            var second = ReadByte();
            var length = (ulong)(second & 0x7F);
            if (length == 126)
                length = ReadUInt16();
            else if (length == 127)
                length = ReadUInt64();
            if (length > Int32.MaxValue)
                throw new InvalidOperationException("CDP frame is too large");
            var masked = (second & 0x80) != 0;
            var mask = masked ? ReadExact(4) : null;
            var payload = ReadExact((int)length);
            if (masked)
                for (var index = 0; index < payload.Length; index++)
                    payload[index] = (byte)(payload[index] ^ mask[index % 4]);
            return new Frame((byte)(first & 0x0F), (first & 0x80) != 0, payload);
        }

        private string ReadHeaders()
        {
            var bytes = new MemoryStream();
            while (bytes.Length < 32768)
            {
                var value = ReadByte();
                bytes.WriteByte(value);
                var data = bytes.ToArray();
                var count = data.Length;
                if (count >= 4 && data[count - 4] == '\r' && data[count - 3] == '\n' &&
                    data[count - 2] == '\r' && data[count - 1] == '\n')
                    return Encoding.ASCII.GetString(data);
            }
            throw new InvalidOperationException("CDP WebSocket response headers are too large");
        }

        private byte ReadByte()
        {
            var value = stream.ReadByte();
            if (value < 0) throw new EndOfStreamException("CDP WebSocket closed");
            return (byte)value;
        }

        private byte[] ReadExact(int count)
        {
            var result = new byte[count];
            var offset = 0;
            while (offset < count)
            {
                var read = stream.Read(result, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException("CDP WebSocket closed");
                offset += read;
            }
            return result;
        }

        private ushort ReadUInt16()
        {
            var bytes = ReadExact(2);
            return (ushort)((bytes[0] << 8) | bytes[1]);
        }

        private ulong ReadUInt64()
        {
            var bytes = ReadExact(8);
            ulong value = 0;
            for (var index = 0; index < bytes.Length; index++)
                value = (value << 8) | bytes[index];
            return value;
        }

        private sealed class Frame
        {
            public readonly byte Opcode;
            public readonly bool Fin;
            public readonly byte[] Payload;

            public Frame(byte opcode, bool fin, byte[] payload)
            {
                Opcode = opcode;
                Fin = fin;
                Payload = payload;
            }
        }
    }

    private sealed class CdpTarget
    {
        public string Title;
        public string Type;
        public string Url;
        public string WebSocketDebuggerUrl;
    }
}
