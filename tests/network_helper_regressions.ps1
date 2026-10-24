# Run under Windows PowerShell 5.1: production .NET Framework methods, synthetic settings only.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static IWebProxy QuotaProxy()')
$end = $source.IndexOf('    private static bool NumberValue(', $start)
$methods = $source.Substring($start, $end - $start).
    Replace('AppDomain.CurrentDomain.BaseDirectory', 'TestRoot').
    Replace('Environment.GetEnvironmentVariable(variable, target)', 'TestEnvironment(variable, target)').
    Replace('WebRequest.DefaultWebProxy', 'TestSystemProxy')
$start = $source.IndexOf('    private static Dictionary<string, object> HttpErrorPayload(')
$end = $source.IndexOf('    private static Dictionary<string, object> SanitizeDiagnosis(', $start)
$errors = $source.Substring($start, $end - $start)
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class NetworkHelperRegressions
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly string TestRoot = Path.Combine(Path.GetTempPath(), "codex-network-test-" + Guid.NewGuid().ToString("N"));
    private static readonly string SettingsPath = Path.Combine(TestRoot, "network-settings.json");
    private static readonly IWebProxy TestSystemProxy = new WebProxy("http://127.0.0.1:9");
    private static readonly Dictionary<string, string> EnvironmentValues = new Dictionary<string, string>();
    private static int EnvironmentReads, Checks;
    private static string StringValue(Dictionary<string, object> value, string key)
    { return value.ContainsKey(key) && value[key] != null ? Convert.ToString(value[key]) : ""; }
    private static string TestEnvironment(string name, EnvironmentVariableTarget target)
    {
        System.Threading.Interlocked.Increment(ref EnvironmentReads);
        string result;
        return EnvironmentValues.TryGetValue(target + ":" + name, out result) ? result : null;
    }
    private static void Check(bool value, string message)
    { if (!value) throw new Exception(message); Checks++; }
    private static string Encrypted(string value)
    { return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser)); }
    private static void WriteSettings(string mode, string source, string proxy)
    {
        var value = new Dictionary<string, object> { { "version", 1 }, { "mode", mode }, { "source", source } };
        if (proxy != null) value["proxyProtected"] = Encrypted(proxy);
        File.WriteAllText(SettingsPath, Json.Serialize(value));
    }
    private static void Reset()
    {
        foreach (var file in Directory.GetFiles(TestRoot)) File.Delete(file);
        EnvironmentValues.Clear(); EnvironmentReads = 0;
    }
    private static void ExpectConfigError(string code)
    {
        try { QuotaProxy(); throw new Exception("Invalid configuration silently selected another route"); }
        catch (NetworkConfigurationException error) { Check(error.Code == code, "Wrong configuration error: " + error.Code); }
    }
    private static void CheckProxyAuthentication()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var server = Task.Run(() => {
            using (var client = listener.AcceptTcpClient())
            {
                client.ReceiveTimeout = 2000;
                var stream = client.GetStream();
                var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                var firstLine = reader.ReadLine();
                while (!String.IsNullOrEmpty(reader.ReadLine())) { }
                var bytes = Encoding.ASCII.GetBytes("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=synthetic\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                stream.Write(bytes, 0, bytes.Length);
                return firstLine;
            }
        });
        try
        {
            WriteSettings("proxy", "explicit", "http://127.0.0.1:" + port);
            var request = (HttpWebRequest)WebRequest.Create("https://quota.invalid/");
            request.Proxy = QuotaProxy();
            request.Timeout = 2000;
            try { using (request.GetResponse()) { } throw new Exception("Proxy authentication unexpectedly succeeded"); }
            catch (WebException error) { Check((string)WebErrorPayload(error)["errorCode"] == "PROXY_AUTH_REQUIRED", "Real HTTPS CONNECT 407 classification"); }
            Check(server.Wait(3000) && server.Result == "CONNECT quota.invalid:443 HTTP/1.1", "HTTPS request uses only the configured local proxy");
        }
        finally { listener.Stop(); }
    }
    public static int Run()
    {
        Directory.CreateDirectory(TestRoot);
        try
        {
            WriteSettings("system", "default", null);
            EnvironmentValues["Process:HTTPS_PROXY"] = "invalid legacy proxy";
            File.WriteAllBytes(Path.Combine(TestRoot, "api-proxy.dat"), new byte[] { 1, 2 });
            Check(Object.ReferenceEquals(QuotaProxy(), TestSystemProxy), "Fresh installation follows system proxy");
            Check(EnvironmentReads == 0 && (string)CurrentNetworkDiagnosis["ProxySource"] == "default", "Explicit file ignores every legacy source");
            Check(CurrentNetworkDiagnosis["ProxyEndpoint"] == null && ((string)CurrentNetworkDiagnosis["NetworkCheckedAt"]).EndsWith("Z"), "System mode has safe UTC metadata without proxy probing");

            WriteSettings("proxy", "explicit", "http://test%40name:secret%3Avalue@[::1]:7890/");
            var proxy = (WebProxy)QuotaProxy();
            var credentials = (NetworkCredential)proxy.Credentials;
            Check(proxy.Address == new Uri("http://[::1]:7890") && credentials.UserName == "test@name" && credentials.Password == "secret:value", "Proxy credentials are decoded separately from its address");
            Check(new Uri((string)CurrentNetworkDiagnosis["ProxyEndpoint"]) == new Uri("http://[::1]:7890"), "IPv6 endpoint retains its port without credentials");
            Check(!File.ReadAllText(SettingsPath).Contains("secret") && !Json.Serialize(CurrentNetworkDiagnosis).Contains("secret"), "Proxy credentials stay encrypted and out of diagnosis");
            WriteSettings("system", "explicit", null);
            Check(Object.ReferenceEquals(QuotaProxy(), TestSystemProxy) && EnvironmentReads == 0, "Next request reads changed settings without environment fallback");

            var legacyKeys = new[] { "Process:HTTPS_PROXY", "User:HTTPS_PROXY", "Process:HTTP_PROXY", "User:HTTP_PROXY" };
            var legacySources = new[] { "legacy-process-https", "legacy-user-https", "legacy-process-http", "legacy-user-http" };
            for (int first = 0; first < legacyKeys.Length; first++)
            {
                Reset();
                for (int next = first; next < legacyKeys.Length; next++) EnvironmentValues[legacyKeys[next]] = "http://127.0.0.1:" + (8000 + next);
                proxy = (WebProxy)QuotaProxy();
                Check(proxy.Address.Port == 8000 + first && (string)CurrentNetworkDiagnosis["ProxySource"] == legacySources[first], "Legacy precedence/source " + legacyKeys[first]);
                var reads = EnvironmentReads;
                EnvironmentValues.Clear();
                Check(((WebProxy)QuotaProxy()).Address.Port == 8000 + first && EnvironmentReads == reads, "Migrated selection stops consulting environment");
            }

            Reset();
            File.WriteAllBytes(Path.Combine(TestRoot, "api-proxy.dat"), Convert.FromBase64String(Encrypted("http://127.0.0.1:8100")));
            Check(((WebProxy)QuotaProxy()).Address.Port == 8100 && (string)CurrentNetworkDiagnosis["ProxySource"] == "legacy-file", "Encrypted legacy file migrates");
            Check(File.Exists(Path.Combine(TestRoot, "api-proxy.dat")), "Legacy file remains available for downgrade");
            Reset();
            Check(Object.ReferenceEquals(QuotaProxy(), TestSystemProxy) && (string)CurrentNetworkDiagnosis["ProxySource"] == "legacy-default", "Absent legacy sources migrate to Windows default");
            Check(File.Exists(SettingsPath), "System migration is persisted too");

            foreach (var invalid in new[] { "https://127.0.0.1:7890", "socks5://127.0.0.1:7890", "http://host:0", "http://host/path", "http://host/?token=secret", "http://host/#secret", "missing-scheme", "" })
            {
                WriteSettings("proxy", "explicit", invalid);
                ExpectConfigError("NETWORK_CONFIG_INVALID");
            }
            foreach (var invalid in new[] { "{", "null", "{}", "{\"version\":2,\"mode\":\"system\",\"source\":\"default\"}",
                "{\"version\":1,\"mode\":\"system\",\"source\":\"secret\"}", "{\"version\":1,\"mode\":\"direct\",\"source\":\"explicit\"}",
                "{\"version\":1,\"mode\":\"system\",\"source\":\"default\",\"proxyProtected\":\"secret\"}",
                "{\"version\":1,\"mode\":\"proxy\",\"source\":\"explicit\",\"proxyProtected\":\"invalid\"}",
                "{\"version\":1,\"mode\":\"proxy\",\"source\":\"explicit\",\"proxyProtected\":\"AQID\"}" })
            {
                File.WriteAllText(SettingsPath, invalid);
                ExpectConfigError("NETWORK_CONFIG_INVALID");
            }
            WriteSettings("system", "default", null);
            using (var held = new FileStream(SettingsPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) ExpectConfigError("NETWORK_CONFIG_UNREADABLE");
            Reset(); Directory.CreateDirectory(SettingsPath);
            try { ExpectConfigError("NETWORK_CONFIG_UNREADABLE"); }
            finally { Directory.Delete(SettingsPath); }
            File.WriteAllBytes(Path.Combine(TestRoot, "api-proxy.dat"), new byte[] { 1, 2, 3 });
            ExpectConfigError("NETWORK_CONFIG_INVALID");
            Check(!File.Exists(SettingsPath), "Unreadable legacy cipher cannot become a system fallback");
            Reset();
            EnvironmentValues["Process:HTTPS_PROXY"] = "invalid-proxy";
            EnvironmentValues["User:HTTPS_PROXY"] = "http://127.0.0.1:8111";
            ExpectConfigError("NETWORK_CONFIG_INVALID");
            Check(!File.Exists(SettingsPath), "Invalid preferred legacy source cannot fall through");

            Reset();
            var migrations = new List<Task<Dictionary<string, object>>>();
            for (var i = 0; i < 8; i++) migrations.Add(Task.Run(() => ReadNetworkSettings()));
            Task.WaitAll(migrations.ToArray());
            Check((string)ValidateNetworkSettings(File.ReadAllText(SettingsPath))["mode"] == "system", "Concurrent migration publishes complete JSON atomically");
            Check(Directory.GetFiles(TestRoot).Length == 1, "Concurrent migration cleans temporary files");

            var diagnostic = new Dictionary<string, object> { { "NetworkMode", "system" }, { "ProxySource", "default" },
                { "ProxyEndpoint", "http://127.0.0.1:7890" }, { "LastRequestError", "secret" }, { "NetworkCheckedAt", "2026-10-22T10:00:00+08:00" } };
            var safe = SanitizeNetworkDiagnosis(diagnostic);
            Check(safe["ProxyEndpoint"] == null && safe["LastRequestError"] == null && safe["NetworkCheckedAt"] == null, "System diagnosis removes endpoint and rejects arbitrary errors/non-UTC time");
            diagnostic["NetworkMode"] = "proxy";
            foreach (var endpoint in new[] { "http://user:secret@host:80", "http://host/path", "http://host/?secret", "https://host:80", "http://host/#secret" })
            {
                diagnostic["ProxyEndpoint"] = endpoint;
                Check(SanitizeNetworkDiagnosis(diagnostic)["ProxyEndpoint"] == null, "Diagnostic endpoint is strictly redacted");
            }
            CheckProxyAuthentication();
            return Checks;
        }
        finally { Reset(); Directory.Delete(TestRoot); }
    }
__METHODS__
__ERRORS__
}
'@
Add-Type -TypeDefinition $harness.Replace('__METHODS__', $methods).Replace('__ERRORS__', $errors) -ReferencedAssemblies System.dll, System.Core.dll, System.Security.dll, System.Web.Extensions.dll
$checks = [NetworkHelperRegressions]::Run()
"Network helper regressions: $checks checks passed, 0 failed (synthetic files, DPAPI, fake environment/system proxy; no official HTTP requests)."
