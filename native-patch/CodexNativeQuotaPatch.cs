using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
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
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint ProcessCreateProcess = 0x0080;
    private static readonly IntPtr ProcThreadAttributeParentProcess = new IntPtr(0x00020000);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static string NativeScript;
    private static int NextCommandId;

    private static void Main()
    {
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            NativeScript = File.ReadAllText(
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "native_patch.js"),
                Encoding.UTF8);
            MainAsync().GetAwaiter().GetResult();
        }
        catch
        {
            // WinExe: never open a console or surface a dialog for a background helper.
            Environment.ExitCode = 1;
        }
    }

    private static async Task MainAsync()
    {
        var observedCodexProcesses = new HashSet<string>();
        foreach (var process in FindCodexRootProcesses())
            observedCodexProcesses.Add(process.Identity);

        while (true)
        {
            try
            {
                if (RelaunchNewDirectCodexProcess(observedCodexProcesses))
                    continue;
                if (!IsCodexRunning())
                {
                    await WaitForCodexStartAsync();
                    continue;
                }
                var target = await FindTargetAsync();
                ApiConfiguration api;
                bool official;
                if (!TryLoadLoginConfiguration(out api, out official))
                {
                    await WaitForLoginConfigurationChangeAsync();
                    continue;
                }
                using (var socket = new CdpSocket(target.WebSocketDebuggerUrl))
                {
                    socket.Connect();
                    using (var loginWatcher = WatchLoginConfiguration(socket, api, official))
                    {
                        InstallForCurrentAndFuturePages(socket, official ? "account" : "api");
                        if (official && PageDataRequested(socket, "__codexQuotaOfficialNeedsData"))
                            PublishOfficialPayload(socket);
                        if (!official && PageDataRequested(socket, "__codexQuotaApiNeedsData"))
                            PublishApiPayload(socket, api);
                        KeepSessionOpen(socket, api, official);
                    }
                }
            }
            catch
            {
                // Retry only after an exceptional failure; normal idle states use event watchers.
                await Task.Delay(TimeSpan.FromSeconds(1));
            }
        }
    }

    private static void InstallForCurrentAndFuturePages(CdpSocket socket, string mode)
    {
        SendCommand(socket, "Page.enable", new Dictionary<string, object>());
        SendCommand(socket, "Runtime.enable", new Dictionary<string, object>());
        SendCommand(socket, "Page.addScriptToEvaluateOnNewDocument", new Dictionary<string, object>
        {
            { "source", "globalThis.__codexQuotaMode=" + Json.Serialize(mode) + ";" }
        });
        SendCommand(socket, "Page.addScriptToEvaluateOnNewDocument", new Dictionary<string, object>
        {
            { "source", NativeScript }
        });
        Evaluate(socket, "globalThis.__codexQuotaMode=" + Json.Serialize(mode) + ";");
        Evaluate(socket, NativeScript);
    }

    private static async Task WaitForLoginConfigurationChangeAsync()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!Directory.Exists(root))
        {
            using (var watcher = new FileSystemWatcher(Path.GetDirectoryName(root)))
            {
                watcher.NotifyFilter = NotifyFilters.DirectoryName;
                FileSystemEventHandler created = (sender, change) =>
                {
                    if (String.Equals(Path.GetFileName(change.FullPath), ".codex", StringComparison.OrdinalIgnoreCase))
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
                var name = Path.GetFileName(change.FullPath);
                if (String.Equals(name, "auth.json", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(name, "config.toml", StringComparison.OrdinalIgnoreCase)) completion.TrySetResult(true);
            };
            RenamedEventHandler renamed = (sender, change) => changed(sender, change);
            watcher.Changed += changed;
            watcher.Created += changed;
            watcher.Deleted += changed;
            watcher.Renamed += renamed;
            watcher.Error += (sender, error) => completion.TrySetException(error.GetException());
            watcher.EnableRaisingEvents = true;

            // Close the gap between the caller's first check and watcher startup.
            ApiConfiguration api;
            bool official;
            if (TryLoadLoginConfiguration(out api, out official)) return;
            await completion.Task;
        }
    }

    private static bool TryLoadLoginConfiguration(out ApiConfiguration api, out bool official)
    {
        api = null;
        official = false;
        try
        {
            official = HasOfficialAccount();
            if (official) return true;
            api = LoadApiConfiguration();
            return api != null;
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

    private static FileSystemWatcher WatchLoginConfiguration(
        CdpSocket socket,
        ApiConfiguration activeApi,
        bool activeOfficial)
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        if (!Directory.Exists(root)) return null;
        var watcher = new FileSystemWatcher(root)
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler changed = (sender, change) =>
        {
            var name = Path.GetFileName(change.FullPath);
            if (String.Equals(name, "auth.json", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(name, "config.toml", StringComparison.OrdinalIgnoreCase)) socket.Close();
        };
        RenamedEventHandler renamed = (sender, change) => changed(sender, change);
        watcher.Changed += changed;
        watcher.Created += changed;
        watcher.Deleted += changed;
        watcher.Renamed += renamed;
        watcher.Error += (sender, error) => socket.Close();
        watcher.EnableRaisingEvents = true;

        // Recheck after the watcher starts so a config write cannot fall into the setup gap.
        ApiConfiguration currentApi;
        bool currentOfficial;
        if (!TryLoadLoginConfiguration(out currentApi, out currentOfficial) ||
            currentOfficial != activeOfficial ||
            !SameApiConfiguration(currentApi, activeApi)) socket.Close();
        return watcher;
    }

    private static bool SameApiConfiguration(ApiConfiguration left, ApiConfiguration right)
    {
        if (left == null || right == null) return left == null && right == null;
        return String.Equals(left.Url, right.Url, StringComparison.Ordinal) &&
            String.Equals(left.ApiKey, right.ApiKey, StringComparison.Ordinal);
    }

    private static void KeepSessionOpen(CdpSocket socket, ApiConfiguration api, bool official)
    {
        while (true)
        {
            // Page events are consumed so they cannot build up in the local socket buffer.
            var message = socket.ReceiveText();
            if (official && message.IndexOf("__codexQuotaOfficialRequest__", StringComparison.Ordinal) >= 0)
                PublishOfficialPayload(socket);
            else if (!official && message.IndexOf("__codexQuotaApiRequest__", StringComparison.Ordinal) >= 0)
                PublishApiPayload(socket, api);
        }
    }

    private static bool PageDataRequested(CdpSocket socket, string name)
    {
        var result = Evaluate(socket, "globalThis[" + Json.Serialize(name) + "] === true");
        var value = result.ContainsKey("result") ? result["result"] as Dictionary<string, object> : null;
        return value != null && value.ContainsKey("value") && value["value"] is bool && (bool)value["value"];
    }

    private static void PublishOfficialPayload(CdpSocket socket)
    {
        Dictionary<string, object> payload;
        try
        {
            var official = LoadOfficialConfiguration();
            if (official == null) throw new InvalidOperationException();
            payload = FetchOfficialPayload(official);
        }
        catch (WebException exception)
        {
            payload = new Dictionary<string, object> { { "errorCode", "NETWORK_ERROR" } };
            var response = exception.Response as HttpWebResponse;
            if (response != null && (int)response.StatusCode == 429)
            {
                int retryAfter;
                if (Int32.TryParse(response.Headers["Retry-After"], out retryAfter) && retryAfter > 0)
                    payload["retryAfterSeconds"] = retryAfter;
            }
        }
        catch
        {
            payload = new Dictionary<string, object> { { "errorCode", "INVALID_RESPONSE" } };
        }
        Evaluate(socket, "globalThis.__codexQuotaUpdateOfficial(" + Json.Serialize(payload) + ")");
    }

    private static void PublishApiPayload(CdpSocket socket, ApiConfiguration api)
    {
        Dictionary<string, object> payload;
        try
        {
            if (api == null) throw new InvalidOperationException();
            payload = FetchApiPayload(api);
        }
        catch (WebException exception)
        {
            payload = new Dictionary<string, object> { { "errorCode", "NETWORK_ERROR" } };
            var response = exception.Response as HttpWebResponse;
            if (response != null && (int)response.StatusCode == 429)
            {
                int retryAfter;
                if (Int32.TryParse(response.Headers["Retry-After"], out retryAfter) && retryAfter > 0)
                    payload["retryAfterSeconds"] = retryAfter;
            }
        }
        catch
        {
            payload = new Dictionary<string, object> { { "errorCode", "INVALID_RESPONSE" } };
        }
        Evaluate(socket, "globalThis.__codexQuotaUpdateApi(" + Json.Serialize(payload) + ")");
    }

    private static ApiConfiguration LoadApiConfiguration()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        var authPath = Path.Combine(root, "auth.json");
        var configPath = Path.Combine(root, "config.toml");
        if (!File.Exists(authPath) || !File.Exists(configPath)) return null;
        var auth = Json.DeserializeObject(File.ReadAllText(authPath, Encoding.UTF8)) as Dictionary<string, object>;
        var apiKey = auth != null && auth.ContainsKey("OPENAI_API_KEY") ? auth["OPENAI_API_KEY"] as string : null;
        if (String.IsNullOrWhiteSpace(apiKey)) return null;
        var config = File.ReadAllText(configPath, Encoding.UTF8);
        var providerMatch = Regex.Match(config, "^\\s*model_provider\\s*=\\s*\\\"([^\\\"]+)\\\"\\s*$", RegexOptions.Multiline);
        if (!providerMatch.Success) return null;
        var sectionMatch = Regex.Match(
            config,
            "^\\s*\\[model_providers\\." + Regex.Escape(providerMatch.Groups[1].Value) + "\\]\\s*$",
            RegexOptions.Multiline);
        if (!sectionMatch.Success) return null;
        var remainder = config.Substring(sectionMatch.Index + sectionMatch.Length);
        var nextSection = Regex.Match(remainder, "^\\s*\\[", RegexOptions.Multiline);
        if (nextSection.Success) remainder = remainder.Substring(0, nextSection.Index);
        var baseMatch = Regex.Match(remainder, "^\\s*base_url\\s*=\\s*\\\"([^\\\"]+)\\\"\\s*$", RegexOptions.Multiline);
        if (!baseMatch.Success) return null;
        Uri baseUri;
        if (!Uri.TryCreate(baseMatch.Groups[1].Value.TrimEnd('/'), UriKind.Absolute, out baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps)) return null;
        var baseUrl = baseUri.AbsoluteUri.TrimEnd('/');
        return new ApiConfiguration
        {
            Url = baseUrl + (baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? "/usage" : "/v1/usage"),
            ApiKey = apiKey
        };
    }

    private static bool HasOfficialAccount()
    {
        return LoadOfficialConfiguration() != null;
    }

    private static OfficialConfiguration LoadOfficialConfiguration()
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex", "auth.json");
        if (!File.Exists(path)) return null;
        var auth = Json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
        if (auth == null || !auth.ContainsKey("tokens") || auth["tokens"] == null) return null;
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

    private static Dictionary<string, object> FetchApiPayload(ApiConfiguration api)
    {
        var request = (HttpWebRequest)WebRequest.Create(api.Url);
        request.Method = "GET";
        request.Proxy = ApiProxy();
        request.Timeout = 10000;
        request.ReadWriteTimeout = 10000;
        request.Accept = "application/json";
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + api.ApiKey;
        Dictionary<string, object> response;
        using (var http = (HttpWebResponse)request.GetResponse())
        using (var reader = new StreamReader(http.GetResponseStream()))
            response = Json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
        if (response == null || !BooleanValue(response, "isValid")) throw new InvalidOperationException();
        var planName = StringValue(response, "planName");
        var unit = StringValue(response, "unit");
        var subscription = response.ContainsKey("subscription") ? response["subscription"] as Dictionary<string, object> : null;
        double remaining, used, total;
        if (String.IsNullOrWhiteSpace(planName) || String.IsNullOrWhiteSpace(unit) ||
            !NumberValue(response, "remaining", out remaining)) throw new InvalidOperationException();
        if (subscription != null)
        {
            if (!NumberValue(subscription, "daily_usage_usd", out used) ||
                !NumberValue(subscription, "daily_limit_usd", out total)) throw new InvalidOperationException();
        }
        else
        {
            var usage = response.ContainsKey("usage") ? response["usage"] as Dictionary<string, object> : null;
            var today = usage != null && usage.ContainsKey("today") ? usage["today"] as Dictionary<string, object> : null;
            if (today == null || !NumberValue(today, "cost", out used)) throw new InvalidOperationException();
            total = 0;
        }
        if (remaining < 0 || used < 0 || total < 0 || (total > 0 && used > total)) throw new InvalidOperationException();
        return new Dictionary<string, object>
        {
            { "planName", planName }, { "unit", unit }, { "remaining", remaining }, { "used", used },
            { "total", total == 0 ? null : (object)total }
        };
    }

    private static Dictionary<string, object> FetchOfficialPayload(OfficialConfiguration official)
    {
        var request = (HttpWebRequest)WebRequest.Create(official.Url);
        request.Method = "GET";
        request.Proxy = ApiProxy();
        request.Timeout = 10000;
        request.ReadWriteTimeout = 10000;
        request.Accept = "application/json";
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + official.AccessToken;
        request.Headers["ChatGPT-Account-ID"] = official.AccountId;
        Dictionary<string, object> response;
        using (var http = (HttpWebResponse)request.GetResponse())
        using (var reader = new StreamReader(http.GetResponseStream()))
            response = Json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
        var planName = response == null ? "" : StringValue(response, "plan_type");
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

    private static Dictionary<string, object> OfficialWindowPayload(
        Dictionary<string, object> rateLimit,
        string name,
        bool required)
    {
        var window = rateLimit.ContainsKey(name) ? rateLimit[name] as Dictionary<string, object> : null;
        if (window == null)
        {
            if (required) throw new InvalidOperationException();
            return null;
        }
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

    private static IWebProxy ApiProxy()
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
        if (!values.ContainsKey(key) || values[key] == null) return false;
        try { value = Convert.ToDouble(values[key]); }
        catch { return false; }
        return !Double.IsNaN(value) && !Double.IsInfinity(value);
    }

    private static bool BooleanValue(Dictionary<string, object> values, string key)
    {
        return values.ContainsKey(key) && values[key] is bool && (bool)values[key];
    }

    private static bool BooleanValue(Dictionary<string, object> values, string key, out bool value)
    {
        value = false;
        if (!values.ContainsKey(key) || !(values[key] is bool)) return false;
        value = (bool)values[key];
        return true;
    }

    private static bool RelaunchNewDirectCodexProcess(HashSet<string> observedProcesses)
    {
        var processes = FindCodexRootProcesses();
        foreach (var process in processes)
        {
            if (!observedProcesses.Add(process.Identity) || HasRemoteDebuggingPort(process.CommandLine))
                continue;
            RelaunchWithRemoteDebugging(process);
            return true;
        }
        return false;
    }

    private static List<CodexProcessInfo> FindCodexRootProcesses()
    {
        var processes = new List<CodexProcessInfo>();
        using (var searcher = new ManagementObjectSearcher(
            "SELECT ProcessId, CreationDate, ExecutablePath, CommandLine FROM Win32_Process WHERE Name='ChatGPT.exe'"))
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
                    Identity = processId + "|" + creationDate,
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

    private static void RelaunchWithRemoteDebugging(CodexProcessInfo processInfo)
    {
        var port = FindAvailableLoopbackPort();
        using (var process = Process.GetProcessById(processInfo.ProcessId))
        {
            var actualPath = Path.GetFullPath(process.MainModule.FileName);
            var expectedPath = Path.GetFullPath(processInfo.ExecutablePath);
            if (!String.Equals(actualPath, expectedPath, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Codex process identity changed before relaunch");
            process.Kill();
            if (!process.WaitForExit(5000))
                throw new InvalidOperationException("Codex did not exit before debug relaunch");
        }

        var portText = port.ToString();
        LaunchWithShellParent(
            processInfo.ExecutablePath,
            "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + portText +
                " --remote-allow-origins=http://127.0.0.1:" + portText);
    }

    private static void LaunchWithShellParent(string executablePath, string arguments)
    {
        using (var shell = FindShellProcess())
        {
            var shellHandle = OpenProcess(ProcessCreateProcess, false, shell.Id);
            if (shellHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

            var attributeList = IntPtr.Zero;
            var attributeListInitialized = false;
            var parentValue = IntPtr.Zero;
            var processInformation = new ProcessInformation();
            try
            {
                var attributeListSize = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
                if (attributeListSize == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                attributeList = Marshal.AllocHGlobal(attributeListSize);
                if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                attributeListInitialized = true;

                parentValue = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(parentValue, shellHandle);
                if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    ProcThreadAttributeParentProcess,
                    parentValue,
                    new IntPtr(IntPtr.Size),
                    IntPtr.Zero,
                    IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());

                var startupInfo = new StartupInfoEx();
                startupInfo.StartupInfo.Size = Marshal.SizeOf(typeof(StartupInfoEx));
                startupInfo.AttributeList = attributeList;
                var commandLine = new StringBuilder("\"" + executablePath + "\" " + arguments);
                if (!CreateProcess(
                    executablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    ExtendedStartupInfoPresent,
                    IntPtr.Zero,
                    Path.GetDirectoryName(executablePath),
                    ref startupInfo,
                    out processInformation)) throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            finally
            {
                if (processInformation.Process != IntPtr.Zero) CloseHandle(processInformation.Process);
                if (processInformation.Thread != IntPtr.Zero) CloseHandle(processInformation.Thread);
                if (attributeListInitialized) DeleteProcThreadAttributeList(attributeList);
                if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
                if (parentValue != IntPtr.Zero) Marshal.FreeHGlobal(parentValue);
                CloseHandle(shellHandle);
            }
        }
    }

    private static Process FindShellProcess()
    {
        var sessionId = Process.GetCurrentProcess().SessionId;
        foreach (var shell in Process.GetProcessesByName("explorer"))
        {
            if (shell.SessionId == sessionId) return shell;
            shell.Dispose();
        }
        throw new InvalidOperationException("Explorer is not running in the current session");
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

    private static bool IsCodexRunning()
    {
        var processes = Process.GetProcessesByName("ChatGPT");
        try
        {
            return processes.Length > 0;
        }
        finally
        {
            foreach (var process in processes) process.Dispose();
        }
    }

    private static Task WaitForCodexStartAsync()
    {
        return Task.Run(() =>
        {
            using (var watcher = new ManagementEventWatcher(
                new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace")))
            {
                watcher.Start();
                try
                {
                    if (IsCodexRunning()) return;
                    while (true)
                    {
                        var change = watcher.WaitForNextEvent();
                        var name = Convert.ToString(change["ProcessName"]);
                        if (String.Equals(name, "ChatGPT.exe", StringComparison.OrdinalIgnoreCase)) return;
                    }
                }
                finally
                {
                    watcher.Stop();
                }
            }
        });
    }

    private static async Task<CdpTarget> FindTargetAsync()
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
                using (var response = (HttpWebResponse)await request.GetResponseAsync())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    var values = Json.DeserializeObject(await reader.ReadToEndAsync()) as object[];
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
                            Regex.IsMatch(target.Title ?? "", "^(ChatGPT|Codex)$", RegexOptions.IgnoreCase) &&
                            String.Equals(target.Url, "app://-/index.html", StringComparison.OrdinalIgnoreCase) &&
                            !String.IsNullOrWhiteSpace(target.WebSocketDebuggerUrl))
                        {
                            pages.Add(target);
                        }
                    }
                    if (pages.Count == 1) matches.Add(pages[0]);
                }
            }
            catch
            {
                // Ignore unrelated local listeners and ports that are closing.
            }
        }
        if (matches.Count != 1) throw new InvalidOperationException("Codex page target is not unique");
        return matches[0];
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
        socket.SendText(Json.Serialize(request));

        while (true)
        {
            var message = socket.ReceiveText();
            var root = Json.DeserializeObject(message) as Dictionary<string, object>;
            if (root == null || !root.ContainsKey("id")) continue;
            if (Convert.ToInt32(root["id"]) != id) continue;
            if (root.ContainsKey("error")) throw new InvalidOperationException("CDP command failed");
            return root.ContainsKey("result")
                ? root["result"] as Dictionary<string, object> ?? new Dictionary<string, object>()
                : new Dictionary<string, object>();
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

    private sealed class ApiConfiguration
    {
        public string Url;
        public string ApiKey;
    }

    private sealed class CodexProcessInfo
    {
        public int ProcessId;
        public string Identity;
        public string ExecutablePath;
        public string CommandLine;
    }

    private sealed class OfficialConfiguration
    {
        public string Url;
        public string AccessToken;
        public string AccountId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public int ProcessId;
        public int ThreadId;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string Reserved;
        public string Desktop;
        public string Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short ReservedSize;
        public IntPtr ReservedPointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    // A small CDP WebSocket client avoids the .NET Framework ClientWebSocket
    // crash that occurs when Electron reloads its renderer.
    private sealed class CdpSocket : IDisposable
    {
        private readonly Uri uri;
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
