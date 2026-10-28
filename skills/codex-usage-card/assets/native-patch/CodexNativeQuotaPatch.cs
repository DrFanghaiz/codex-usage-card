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
    private const string ProductVersion = "2.6.1";
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
                using (var shortcuts = new OfficialShortcutMonitor())
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

    private static void PublishRelease(CdpSocket socket, string requestId)
    {
        if (!ValidRequestId(requestId)) return;
        var target = socket.Endpoint;
        var scope = socket.Scope;
        var generation = socket.Generation;
        Task.Run(() => {
            var payload = ReleaseUpdates.Check(AppDomain.CurrentDomain.BaseDirectory, DateTimeOffset.UtcNow, ReleaseUpdates.Fetch);
            if (scope != SessionScope || generation != Volatile.Read(ref SessionGeneration)) return;
            try
            {
                using (var reply = new CdpSocket(target))
                {
                    reply.Connect();
                    Evaluate(reply, "if(globalThis.__codexQuotaSessionScope===" + Json.Serialize(scope) +
                        " && typeof globalThis.__codexQuotaUpdateRelease==='function') globalThis.__codexQuotaUpdateRelease(" +
                        Json.Serialize(payload) + "," + Json.Serialize(requestId) + ")");
                }
            }
            catch { /* A page may close while the independent release check is running. */ }
        });
    }

    private static class ReleaseUpdates
    {
        private const string ReleaseRoot = "https://github.com/DrFanghaiz/codex-usage-card/releases/tag/v";
        private const string Endpoint = "https://api.github.com/repos/DrFanghaiz/codex-usage-card/releases/latest";
        private const int MaximumResponse = 262144;
        private static readonly object Gate = new object();

        public static bool ValidVersion(string text)
        {
            Version version;
            return text != null && text.Length <= 32 && Regex.IsMatch(text, @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z") &&
                Version.TryParse(text, out version) && version.Revision == -1;
        }

        private static DateTimeOffset? Stamp(object value, DateTimeOffset now)
        {
            DateTimeOffset stamp;
            return value is string && DateTimeOffset.TryParseExact((string)value, "o", CultureInfo.InvariantCulture, DateTimeStyles.None, out stamp) &&
                stamp <= now.AddMinutes(5) ? (DateTimeOffset?)stamp : null;
        }

        private static Dictionary<string, object> Empty()
        {
            return new Dictionary<string, object> { { "currentVersion", ProductVersion }, { "latestVersion", null }, { "releaseUrl", null },
                { "lastSuccessAt", null }, { "lastAttemptAt", null }, { "errorCode", null } };
        }

        private static Dictionary<string, object> Load(string path, DateTimeOffset now)
        {
            var state = Empty();
            if (!File.Exists(path)) return state;
            if (new FileInfo(path).Length > MaximumResponse) return state;
            Dictionary<string, object> saved;
            try { saved = Json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>; }
            catch (ArgumentException) { return state; }
            catch (InvalidOperationException) { return state; }
            if (saved == null) return state;
            foreach (var key in new[] { "lastAttemptAt", "lastSuccessAt" })
            {
                object raw;
                var stamp = saved.TryGetValue(key, out raw) ? Stamp(raw, now) : null;
                if (stamp.HasValue) state[key] = stamp.Value.ToString("o", CultureInfo.InvariantCulture);
            }
            var version = StringValue(saved, "latestVersion");
            if (state["lastSuccessAt"] != null && ValidVersion(version) && StringValue(saved, "releaseUrl") == ReleaseRoot + version)
            {
                state["latestVersion"] = version; state["releaseUrl"] = ReleaseRoot + version;
            }
            else state["lastSuccessAt"] = null;
            if (StringValue(saved, "errorCode") == "UPDATE_CHECK_FAILED") state["errorCode"] = "UPDATE_CHECK_FAILED";
            return state;
        }

        private static void Save(string path, Dictionary<string, object> state)
        {
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, Json.Serialize(state), new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        public static Dictionary<string, object> Parse(Dictionary<string, object> release)
        {
            object draft, prerelease;
            var tag = release == null ? null : StringValue(release, "tag_name");
            var version = tag != null && tag.StartsWith("v", StringComparison.Ordinal) ? tag.Substring(1) : null;
            if (release == null || !release.TryGetValue("draft", out draft) || !(draft is bool) || (bool)draft ||
                !release.TryGetValue("prerelease", out prerelease) || !(prerelease is bool) || (bool)prerelease ||
                !ValidVersion(version) || StringValue(release, "html_url") != ReleaseRoot + version)
                throw new InvalidDataException("Invalid stable release");
            return new Dictionary<string, object> { { "latestVersion", version }, { "releaseUrl", ReleaseRoot + version } };
        }

        public static Dictionary<string, object> Fetch()
        {
            var request = (HttpWebRequest)WebRequest.Create(Endpoint);
            request.Method = "GET"; request.AllowAutoRedirect = false;
            request.Proxy = SettingsProxy(ReadNetworkSettings(), null);
            request.Timeout = 10000; request.ReadWriteTimeout = 10000;
            request.UserAgent = "CodexUsageCard/" + ProductVersion;
            request.Accept = "application/vnd.github+json";
            request.Headers["X-GitHub-Api-Version"] = "2022-11-28";
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using (var deadline = new CancellationTokenSource(IoDeadlineMilliseconds))
            using (deadline.Token.Register(request.Abort))
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException("Release request failed");
                var buffer = new char[4096]; var text = new StringBuilder(); int count;
                while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
                {
                    if (text.Length + count > MaximumResponse) throw new InvalidDataException("Release response too large");
                    text.Append(buffer, 0, count);
                }
                return Json.DeserializeObject(text.ToString()) as Dictionary<string, object>;
            }
        }

        public static Dictionary<string, object> Check(string root, DateTimeOffset now, Func<Dictionary<string, object>> fetch)
        {
            lock (Gate)
            {
                var path = Path.Combine(root, "release-state.json");
                var state = Empty();
                try
                {
                    state = Load(path, now);
                    var attempt = Stamp(state["lastAttemptAt"], now);
                    if (!attempt.HasValue || now >= attempt.Value.AddDays(1))
                    {
                        state["lastAttemptAt"] = now.ToString("o", CultureInfo.InvariantCulture);
                        state["errorCode"] = "UPDATE_CHECK_FAILED";
                        // Persist the attempt before HTTP so restarts and failures cannot bypass the daily limit.
                        Save(path, state);
                        var release = Parse(fetch());
                        var successful = new Dictionary<string, object>(state);
                        successful["latestVersion"] = release["latestVersion"]; successful["releaseUrl"] = release["releaseUrl"];
                        successful["lastSuccessAt"] = now.ToString("o", CultureInfo.InvariantCulture); successful["errorCode"] = null;
                        Save(path, successful); state = successful;
                    }
                }
                catch (Exception error)
                {
                    if (!(error is WebException || error is IOException || error is UnauthorizedAccessException ||
                        error is ArgumentException || error is FormatException || error is InvalidOperationException || error is CryptographicException ||
                        error is System.Security.SecurityException || error is NetworkConfigurationException)) throw;
                    state["errorCode"] = "UPDATE_CHECK_FAILED";
                    if (state["lastAttemptAt"] == null) state["lastAttemptAt"] = now.ToString("o", CultureInfo.InvariantCulture);
                }
                state["nextCheckAt"] = (Stamp(state["lastAttemptAt"], now) ?? now).AddDays(1).ToString("o", CultureInfo.InvariantCulture);
                return state;
            }
        }
    }

    private static void PublishLocalUsage(CdpSocket socket, string requestId)
    {
        if (!ValidRequestId(requestId)) return;
        var response = Evaluate(socket, "globalThis.__codexQuotaLocalUsageRange ?? null");
        var remote = response.ContainsKey("result") ? response["result"] as Dictionary<string, object> : null;
        var range = remote != null && remote.ContainsKey("value") ? remote["value"] as Dictionary<string, object> : null;
        var start = range == null ? null : StringValue(range, "start");
        var end = range == null ? null : StringValue(range, "end");
        var target = socket.Endpoint;
        var scope = socket.Scope;
        var generation = socket.Generation;
        Task.Run(() => {
            Dictionary<string, object> payload;
            try { payload = LocalUsage.Read(ConfigurationRoot(), start, end); }
            catch { payload = new Dictionary<string, object> { { "errorCode", "LOCAL_USAGE_UNAVAILABLE" } }; }
            if (scope != SessionScope || generation != Volatile.Read(ref SessionGeneration)) return;
            try
            {
                // The disk scan and its reply use a separate CDP connection, leaving official requests responsive.
                using (var reply = new CdpSocket(target))
                {
                    reply.Connect();
                    Evaluate(reply, "if(globalThis.__codexQuotaSessionScope===" + Json.Serialize(scope) +
                        " && typeof globalThis.__codexQuotaUpdateLocalUsage==='function') globalThis.__codexQuotaUpdateLocalUsage(" +
                        Json.Serialize(payload) + "," + Json.Serialize(requestId) + ")");
                }
            }
            catch { /* The requesting page may have closed; no disk data or error detail leaves the helper. */ }
        });
    }

    private static class LocalUsage
    {
        private sealed class Counts
        {
            public long Input, Cached, Written, Output;
            public bool WriteKnown = true;
            public long Total { get { return checked(Input + Output); } }
            public static Counts Parse(object raw)
            {
                var value = raw as Dictionary<string, object>;
                if (value == null) return null;
                var result = new Counts();
                if (!Counter(value, "input_tokens", out result.Input) || !Counter(value, "cached_input_tokens", out result.Cached) ||
                    !Counter(value, "output_tokens", out result.Output) || result.Cached > result.Input ||
                    result.Input > 9007199254740991L - result.Output) return null;
                result.WriteKnown = value.ContainsKey("cache_write_input_tokens");
                if (result.WriteKnown && (!Counter(value, "cache_write_input_tokens", out result.Written) || result.Written > result.Input - result.Cached)) return null;
                return result;
            }
            private static bool Counter(Dictionary<string, object> value, string key, out long number)
            {
                number = 0;
                object raw;
                if (!value.TryGetValue(key, out raw) || !(raw is int || raw is long || raw is decimal || raw is double)) return false;
                return Int64.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out number) &&
                    number >= 0 && number <= 9007199254740991L;
            }
            public static string Fingerprint(object raw)
            {
                var data = raw as Dictionary<string, object>;
                if (data == null) return null;
                var builder = new StringBuilder();
                foreach (var field in new[] { "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens" })
                {
                    long count;
                    if (!Counter(data, field, out count)) return null;
                    builder.Append(count.ToString(CultureInfo.InvariantCulture)).Append('/');
                }
                var parsed = Parse(raw);
                long reported, reasoning;
                if (parsed == null || !Counter(data, "total_tokens", out reported) || reported != parsed.Total ||
                    !Counter(data, "reasoning_output_tokens", out reasoning) || reasoning > parsed.Output) return null;
                return builder.ToString();
            }
            public string Key { get { return Input + "/" + Cached + "/" + Output; } }
        }
        private sealed class Entry
        {
            public DateTime Day;
            public string Model, Key;
            public Counts Usage;
            public bool HasBaseline;
        }
        private sealed class Snapshot
        {
            public string Session, Thread, Parent, Key, EventKey, HistoryKey, Fingerprint;
            public DateTimeOffset At;
            public bool Startup, ConfirmedConsumption;
        }
        private sealed class Issue
        {
            public DateTime? Day;
            public string Code, Key, Session, BaselineKey;
            public DateTimeOffset At;
            public long? Missing;
            public bool Before, AffectsTotals = true, NeedsBaseline;
            public int Line;
        }
        private sealed class Log
        {
            public long Offset;
            public byte[] Anchor;
            public DateTime Written, Created;
            public string Model = "unknown", Provider, Session, Thread, Parent, FileKey;
            public int HistoryStart;
            public bool Subagent, SeenCounts, NewRequestSeen;
            public DateTimeOffset? MetadataAt;
            public Counts Previous;
            public int Line;
            public Issue Tail;
            public readonly List<Entry> Entries = new List<Entry>();
            public readonly List<Issue> Issues = new List<Issue>();
            public readonly List<Snapshot> Snapshots = new List<Snapshot>();
        }
        private sealed class Bucket
        {
            private readonly SortedDictionary<string, Counts> models = new SortedDictionary<string, Counts>(StringComparer.Ordinal);
            private readonly SortedDictionary<string, Dictionary<string, object>> issues = new SortedDictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
            private int events;
            private bool partial;
            public void Add(Entry entry)
            {
                Counts sum;
                if (!models.TryGetValue(entry.Model, out sum)) { sum = new Counts(); models[entry.Model] = sum; }
                checked { sum.Input += entry.Usage.Input; sum.Cached += entry.Usage.Cached; sum.Written += entry.Usage.Written; sum.Output += entry.Usage.Output; }
                sum.WriteKnown &= entry.Usage.WriteKnown;
                events++;
            }
            public void Add(Issue issue)
            {
                Dictionary<string, object> row;
                if (!issues.TryGetValue(issue.Code, out row))
                {
                    row = new Dictionary<string, object> { { "code", issue.Code }, { "count", 0 }, { "missingTokens", 0L },
                        { "affectsTotals", issue.AffectsTotals }, { "dateUnknown", false } };
                    issues.Add(issue.Code, row);
                }
                row["count"] = (int)row["count"] + 1;
                if (!issue.Missing.HasValue || issue.Before || !issue.Day.HasValue) row["missingTokens"] = null;
                else if (row["missingTokens"] != null) row["missingTokens"] = checked((long)row["missingTokens"] + issue.Missing.Value);
                row["dateUnknown"] = (bool)row["dateUnknown"] || !issue.Day.HasValue || issue.Before;
                partial |= issue.AffectsTotals;
            }
            public Dictionary<string, object> Payload()
            {
                var rows = new List<Dictionary<string, object>>();
                long grandTotal = 0;
                foreach (var model in models)
                {
                    var count = model.Value;
                    checked { grandTotal += count.Total; }
                    if (grandTotal > 9007199254740991L) throw new InvalidDataException("Usage exceeds safe numeric range");
                    rows.Add(new Dictionary<string, object> { { "model", model.Key }, { "inputTokens", count.Input },
                        { "cachedInputTokens", count.Cached }, { "cacheWriteInputTokens", count.Written }, { "cacheWriteKnown", count.WriteKnown },
                        { "outputTokens", count.Output }, { "totalTokens", count.Total } });
                }
                return new Dictionary<string, object> { { "models", rows }, { "eventCount", events }, { "partial", partial },
                    { "issues", new List<Dictionary<string, object>>(issues.Values) } };
            }
        }
        private static Bucket DayBucket(SortedDictionary<DateTime, Bucket> days, DateTime date)
        {
            Bucket bucket;
            if (!days.TryGetValue(date, out bucket)) { bucket = new Bucket(); days[date] = bucket; }
            return bucket;
        }
        private static readonly object Gate = new object();
        private static string Root;
        private static readonly Dictionary<string, Log> Logs = new Dictionary<string, Log>(StringComparer.OrdinalIgnoreCase);
        private static string OriginalEventKey(Dictionary<string, string> history, string key)
        {
            string parent;
            if (!history.TryGetValue(key, out parent)) return key;
            var visited = new HashSet<string> { key };
            var original = key;
            while (history.TryGetValue(original, out parent))
            {
                if (!visited.Add(parent)) return key;
                original = parent;
            }
            return original;
        }
        private static DateTime Date(string value)
        {
            DateTime result;
            if (value == null || !Regex.IsMatch(value, @"\A\d{4}-\d{2}-\d{2}\z") ||
                !DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out result))
                throw new ArgumentException("Invalid usage date");
            return result;
        }
        public static Dictionary<string, object> Read(string root, string start, string end)
        {
            var first = Date(start);
            var last = Date(end);
            if (last < first || last > DateTime.Today || first.Year < 2022) throw new ArgumentException("Invalid usage range");
            lock (Gate)
            {
                root = Path.GetFullPath(root);
                if (!Directory.Exists(root)) throw new DirectoryNotFoundException();
                if (!String.Equals(Root, root, StringComparison.OrdinalIgnoreCase)) { Logs.Clear(); Root = root; }
                var present = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var queryIssues = new List<Issue>();
                foreach (var directory in new[] { "sessions", "archived_sessions" })
                {
                    var path = Path.Combine(root, directory);
                    if (!Directory.Exists(path)) continue;
                    try
                    {
                        foreach (var file in Directory.EnumerateFiles(path, "*.jsonl", SearchOption.AllDirectories))
                        {
                            present.Add(file);
                            Log log;
                            if (!Logs.TryGetValue(file, out log)) { log = new Log { FileKey = file }; Logs[file] = log; }
                            try { Update(file, log); }
                            catch (IOException) { queryIssues.Add(new Issue { Code = "FILE_UNREADABLE", Key = file }); }
                            catch (UnauthorizedAccessException) { queryIssues.Add(new Issue { Code = "FILE_UNREADABLE", Key = file }); }
                        }
                    }
                    catch (IOException) { queryIssues.Add(new Issue { Code = "FILE_UNREADABLE", Key = path }); }
                    catch (UnauthorizedAccessException) { queryIssues.Add(new Issue { Code = "FILE_UNREADABLE", Key = path }); }
                }
                var removed = new List<string>();
                foreach (var file in Logs.Keys) if (!present.Contains(file)) removed.Add(file);
                foreach (var file in removed) Logs.Remove(file);
                var selected = new Dictionary<string, Entry>();
                var entries = new List<Entry>();
                var snapshots = new Dictionary<string, DateTimeOffset>();
                var allSnapshots = new List<Snapshot>();
                foreach (var file in present)
                {
                    Log log;
                    if (!Logs.TryGetValue(file, out log)) continue;
                    queryIssues.AddRange(log.Issues);
                    allSnapshots.AddRange(log.Snapshots);
                    foreach (var snapshot in log.Snapshots)
                    {
                        if (String.IsNullOrEmpty(snapshot.Session)) continue;
                        var key = snapshot.Session + "/" + snapshot.Key;
                        DateTimeOffset earliest;
                        if (!snapshots.TryGetValue(key, out earliest) || snapshot.At < earliest) snapshots[key] = snapshot.At;
                    }
                    if (log.Tail != null) queryIssues.Add(log.Tail);
                    entries.AddRange(log.Entries);
                }
                var history = new Dictionary<string, string>();
                foreach (var snapshot in allSnapshots)
                    if (snapshot.HistoryKey != null) history[snapshot.EventKey] = snapshot.HistoryKey;
                var confirmed = new Dictionary<string, List<Snapshot>>();
                foreach (var snapshot in allSnapshots)
                {
                    if (!snapshot.ConfirmedConsumption || snapshot.Startup || snapshot.Fingerprint == null) continue;
                    List<Snapshot> matching;
                    if (!confirmed.TryGetValue(snapshot.Fingerprint, out matching)) { matching = new List<Snapshot>(); confirmed[snapshot.Fingerprint] = matching; }
                    matching.Add(snapshot);
                }
                var inherited = new HashSet<string>();
                foreach (var snapshot in allSnapshots)
                {
                    if (!snapshot.Startup || snapshot.HistoryKey != null || snapshot.Fingerprint == null) continue;
                    List<Snapshot> matching;
                    if (!confirmed.TryGetValue(snapshot.Fingerprint, out matching)) continue;
                    foreach (var prior in matching)
                    {
                        if (prior.At < snapshot.At && (prior.Thread == snapshot.Parent || prior.Parent == snapshot.Parent))
                        { inherited.Add(snapshot.EventKey); break; }
                    }
                }
                foreach (var entry in entries)
                {
                    var key = OriginalEventKey(history, entry.Key);
                    if (inherited.Contains(entry.Key) || inherited.Contains(key)) continue;
                    Entry existing;
                    if (!selected.TryGetValue(key, out existing) || (!existing.HasBaseline && entry.HasBaseline) ||
                        (existing.HasBaseline == entry.HasBaseline && existing.Model == "unknown" && entry.Model != "unknown" && existing.Usage.Key == entry.Usage.Key) ||
                        (existing.HasBaseline == entry.HasBaseline && !existing.Usage.WriteKnown && entry.Usage.WriteKnown && existing.Usage.Key == entry.Usage.Key))
                        selected[key] = entry;
                }
                var overall = new Bucket();
                var days = new SortedDictionary<DateTime, Bucket>();
                foreach (var entry in selected.Values)
                {
                    if (entry.Day < first || entry.Day > last) continue;
                    overall.Add(entry);
                    DayBucket(days, entry.Day).Add(entry);
                    if (!entry.Usage.WriteKnown) queryIssues.Add(new Issue { Code = "CACHE_WRITE_UNRECORDED", Key = entry.Key,
                        Day = entry.Day, Missing = 0, AffectsTotals = false });
                }
                var issueKeys = new HashSet<string>();
                foreach (var issue in queryIssues)
                {
                    if (issue.Day.HasValue && (issue.Day.Value < first || (!issue.Before && issue.Day.Value > last))) continue;
                    var key = OriginalEventKey(history, issue.Key);
                    if (inherited.Contains(issue.Key) || inherited.Contains(key)) continue;
                    Entry entry;
                    DateTimeOffset predecessor;
                    if (issue.NeedsBaseline && !String.IsNullOrEmpty(issue.Session) && issue.BaselineKey != null &&
                        snapshots.TryGetValue(issue.Session + "/" + issue.BaselineKey, out predecessor) && predecessor < issue.At) continue;
                    if (issue.NeedsBaseline && selected.TryGetValue(key, out entry) && entry.HasBaseline) continue;
                    if (issue.Code == "SOURCE_UNCONFIRMED" && selected.ContainsKey(key)) continue;
                    if (!issueKeys.Add(issue.Code + "/" + key)) continue;
                    overall.Add(issue);
                    var issueFirst = issue.Day.HasValue && !issue.Before ? issue.Day.Value : first;
                    var issueLast = issue.Day.HasValue ? (issue.Day.Value < last ? issue.Day.Value : last) : last;
                    // Unknown dates affect every possibly covered day; issue-only days are never represented as confirmed zeroes.
                    for (var day = issueFirst; day <= issueLast; day = day.AddDays(1)) DayBucket(days, day).Add(issue);
                }
                var daily = new List<Dictionary<string, object>>();
                foreach (var day in days)
                {
                    var bucket = day.Value.Payload();
                    bucket["date"] = day.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    daily.Add(bucket);
                }
                var payload = overall.Payload();
                payload["start"] = start;
                payload["end"] = end;
                payload["daily"] = daily;
                payload["hasLogs"] = present.Count > 0;
                payload["scannedAt"] = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                return payload;
            }
        }
        private static void Update(string path, Log log)
        {
            var file = new FileInfo(path);
            if (file.Length < log.Offset || !AnchorMatches(path, log) || (log.Offset == file.Length && log.Written != file.LastWriteTimeUtc) ||
                (log.Created != default(DateTime) && log.Created != file.CreationTimeUtc))
            {
                log.Offset = 0; log.Anchor = null; log.Entries.Clear(); log.Issues.Clear(); log.Snapshots.Clear(); log.Previous = null;
                log.Model = "unknown"; log.Provider = null; log.Session = null; log.Thread = null; log.Parent = null; log.HistoryStart = 0; log.Subagent = false; log.SeenCounts = false; log.NewRequestSeen = false; log.MetadataAt = null; log.Line = 0;
            }
            log.Tail = null;
            log.Created = file.CreationTimeUtc;
            log.Written = file.LastWriteTimeUtc;
            if (log.Offset > 0 && log.Offset == file.Length) return;
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                input.Seek(log.Offset, SeekOrigin.Begin);
                var buffer = new byte[65536];
                using (var line = new MemoryStream())
                {
                    int read;
                    long position = log.Offset;
                    var oversized = false;
                    string oversizedPrefix = null;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        var index = 0;
                        while (index < read)
                        {
                            var newline = Array.IndexOf(buffer, (byte)10, index, read - index);
                            var count = (newline < 0 ? read : newline) - index;
                            if (!oversized && line.Length + count > 16777216)
                            {
                                oversized = true;
                                oversizedPrefix = Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)Math.Min(2048, line.Length));
                                line.SetLength(0);
                            }
                            if (!oversized) line.Write(buffer, index, count);
                            position += count;
                            if (newline < 0) break;
                            position++;
                            log.Line++;
                            if (oversized)
                            {
                                if (IsTokenLine(oversizedPrefix)) log.Issues.Add(ParseIssue(oversizedPrefix, log, "INVALID_TOKEN_EVENT"));
                            }
                            else if (line.Length > 0)
                                Consume(Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length).TrimStart('\uFEFF'), log);
                            line.SetLength(0);
                            oversized = false;
                            log.Offset = position;
                            index = newline + 1;
                        }
                    }
                    // Only an unfinished token event affects usage; a chat/tool line cannot change token totals.
                    if (oversized)
                    {
                        if (IsTokenLine(oversizedPrefix)) log.Tail = ParseIssue(oversizedPrefix, log, "INVALID_TOKEN_EVENT");
                    }
                    else if (line.Length != 0)
                    {
                        var text = Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length);
                        if (IsTokenLine(text)) log.Tail = ParseIssue(text, log, "INVALID_TOKEN_EVENT");
                    }
                    log.Anchor = new byte[(int)Math.Min(64, log.Offset)];
                    input.Seek(log.Offset - log.Anchor.Length, SeekOrigin.Begin);
                    if (input.Read(log.Anchor, 0, log.Anchor.Length) != log.Anchor.Length) throw new IOException("Usage file changed during scan");
                }
            }
        }
        private static bool AnchorMatches(string path, Log log)
        {
            if (log.Anchor == null || log.Offset == 0) return true;
            using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (file.Length < log.Offset) return false;
                file.Seek(log.Offset - log.Anchor.Length, SeekOrigin.Begin);
                foreach (var value in log.Anchor) if (file.ReadByte() != value) return false;
                return true;
            }
        }
        private static bool IsTokenLine(string line)
        {
            return line != null && Regex.IsMatch(line, @"\A\s*\{[^\r\n]{0,256}""type""\s*:\s*""event_msg""") &&
                Regex.IsMatch(line, @"""payload""\s*:\s*\{\s*""type""\s*:\s*""token_count""");
        }
        private static DateTime? EventDay(string text)
        {
            DateTimeOffset time;
            return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out time) ? (DateTime?)time.LocalDateTime.Date : null;
        }
        private static Issue ParseIssue(string line, Log log, string code)
        {
            var match = Regex.Match(line ?? "", @"""timestamp""\s*:\s*""([^""]+)""");
            var day = match.Success ? EventDay(match.Groups[1].Value) : null;
            return new Issue { Code = code, Key = (log.Thread ?? log.FileKey) + "/" + log.Line.ToString(CultureInfo.InvariantCulture) + "/" + (match.Success ? match.Groups[1].Value : "unknown"),
                Day = day, Line = log.Line };
        }
        private static bool OfficialWindow(object raw)
        {
            var window = raw as Dictionary<string, object>;
            if (window == null) return false;
            double used, minutes, reset;
            return Number(window, "used_percent", out used) && used >= 0 && used <= 100 &&
                Number(window, "window_minutes", out minutes) && (minutes == 300 || minutes == 10080) &&
                Number(window, "resets_at", out reset) && reset > 0;
        }
        private static bool Number(Dictionary<string, object> data, string key, out double value)
        {
            value = 0;
            object raw;
            if (!data.TryGetValue(key, out raw) || !(raw is int || raw is long || raw is decimal || raw is double)) return false;
            value = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
            return !Double.IsNaN(value) && !Double.IsInfinity(value);
        }
        private static bool OfficialEvent(Log log, Dictionary<string, object> data, out bool excluded)
        {
            excluded = false;
            if (!String.IsNullOrEmpty(log.Provider) && log.Provider != "openai") { excluded = true; return false; }
            if (log.Provider != "openai") return false;
            object raw;
            var limits = data.TryGetValue("rate_limits", out raw) ? raw as Dictionary<string, object> : null;
            var plan = limits == null ? "" : StringValue(limits, "plan_type");
            if (plan == "api" || plan == "apikey") { excluded = true; return false; }
            if (Regex.IsMatch(plan, @"\A(?:free|go|plus|pro|team|business|enterprise|edu)\z")) return true;
            // plan_type can be null while the same event still carries an explicit official Codex quota window.
            if (!String.IsNullOrEmpty(plan) || limits == null || StringValue(limits, "limit_id") != "codex") return false;
            return (limits.TryGetValue("primary", out raw) && OfficialWindow(raw)) ||
                (limits.TryGetValue("secondary", out raw) && OfficialWindow(raw));
        }
        private static void Consume(string line, Log log)
        {
            if (line.IndexOf("\"session_meta\"", StringComparison.Ordinal) < 0 &&
                line.IndexOf("\"turn_context\"", StringComparison.Ordinal) < 0 &&
                line.IndexOf("\"token_count\"", StringComparison.Ordinal) < 0 &&
                (log.SeenCounts || (line.IndexOf("\"task_started\"", StringComparison.Ordinal) < 0 && line.IndexOf("\"turn_started\"", StringComparison.Ordinal) < 0))) return;
            try
            {
                var root = new JavaScriptSerializer { MaxJsonLength = 16777216 }.DeserializeObject(line) as Dictionary<string, object>;
                if (root == null) return;
                object raw;
                var data = root.TryGetValue("payload", out raw) ? raw as Dictionary<string, object> : null;
                if (data == null) return;
                var type = StringValue(root, "type");
                if (type == "session_meta")
                {
                    log.Provider = StringValue(data, "model_provider");
                    DateTimeOffset created;
                    log.MetadataAt = DateTimeOffset.TryParse(StringValue(data, "timestamp"), CultureInfo.InvariantCulture, DateTimeStyles.None, out created) ? (DateTimeOffset?)created : null;
                    var session = StringValue(data, "session_id");
                    if (String.IsNullOrEmpty(session)) session = StringValue(data, "id");
                    log.Session = Regex.IsMatch(session, @"\A[A-Za-z0-9-]{1,80}\z") ? session : null;
                    var thread = StringValue(data, "id");
                    log.Thread = Regex.IsMatch(thread, @"\A[A-Za-z0-9-]{1,80}\z") ? thread : log.Session;
                    var parent = StringValue(data, "parent_thread_id");
                    log.Parent = Regex.IsMatch(parent, @"\A[A-Za-z0-9-]{1,80}\z") ? parent : null;
                    var source = data.TryGetValue("source", out raw) ? raw as Dictionary<string, object> : null;
                    log.Subagent = source != null && source.TryGetValue("subagent", out raw) && (raw is string || raw is Dictionary<string, object>);
                    double ordinal;
                    log.HistoryStart = Number(data, "subagent_history_start_ordinal", out ordinal) && ordinal >= 1 && ordinal <= Int32.MaxValue && ordinal == Math.Truncate(ordinal) ? (int)ordinal : 0;
                    return;
                }
                if (type == "turn_context")
                {
                    var model = StringValue(data, "model");
                    log.Model = Regex.IsMatch(model, @"\A[A-Za-z0-9._:-]{1,100}\z") ? model : "unknown";
                    return;
                }
                if (type == "event_msg" && (StringValue(data, "type") == "task_started" || StringValue(data, "type") == "turn_started"))
                {
                    DateTimeOffset started;
                    if (log.MetadataAt.HasValue && DateTimeOffset.TryParse(StringValue(root, "timestamp"), CultureInfo.InvariantCulture, DateTimeStyles.None, out started) && started >= log.MetadataAt.Value)
                        log.NewRequestSeen = true;
                    return;
                }
                if (type != "event_msg" || StringValue(data, "type") != "token_count") return;
                var info = data.TryGetValue("info", out raw) ? raw as Dictionary<string, object> : null;
                if (info == null) return; // A limit-only update reports no token consumption.
                var day = EventDay(StringValue(root, "timestamp"));
                var total = Counts.Parse(info.TryGetValue("total_token_usage", out raw) ? raw : null);
                var current = Counts.Parse(info.TryGetValue("last_token_usage", out raw) ? raw : null);
                var previous = log.Previous;
                if (total == null) { log.Issues.Add(ParseIssue(line, log, "INVALID_TOKEN_EVENT")); return; }
                DateTimeOffset stamp;
                var hasStamp = DateTimeOffset.TryParse(StringValue(root, "timestamp"), CultureInfo.InvariantCulture, DateTimeStyles.None, out stamp);
                var eventSuffix = StringValue(root, "timestamp") + "/" + total.Key;
                var eventKey = log.Thread == null ? eventSuffix : log.Thread + "/" + eventSuffix;
                // Only declared history from before the child existed belongs to its parent.
                var historyKey = log.Thread != null && log.Parent != null && log.Thread != log.Parent && log.Subagent &&
                    !log.NewRequestSeen && log.HistoryStart >= log.Line && hasStamp && log.MetadataAt.HasValue && stamp < log.MetadataAt.Value
                    ? log.Parent + "/" + eventSuffix : null;
                var fingerprintTotal = Counts.Fingerprint(info.TryGetValue("total_token_usage", out raw) ? raw : null);
                var fingerprintLast = Counts.Fingerprint(info.TryGetValue("last_token_usage", out raw) ? raw : null);
                var snapshot = new Snapshot { Session = log.Session, Thread = log.Thread, Parent = log.Parent, Key = total.Key, At = stamp, EventKey = eventKey, HistoryKey = historyKey,
                    Fingerprint = fingerprintTotal != null && fingerprintLast != null ? fingerprintTotal + fingerprintLast : null,
                    Startup = !log.SeenCounts && !log.NewRequestSeen && log.MetadataAt.HasValue && log.Thread != null && log.Parent != null && log.Parent != log.Thread && log.Subagent && log.HistoryStart >= log.Line };
                log.SeenCounts = true;
                if (hasStamp) log.Snapshots.Add(snapshot);
                log.Previous = total;
                if (previous != null && total.Key == previous.Key) return;
                var hasBaseline = previous != null && total.Input >= previous.Input && total.Cached >= previous.Cached && total.Output >= previous.Output;
                Counts delta;
                if (hasBaseline)
                    delta = new Counts { Input = total.Input - previous.Input, Cached = total.Cached - previous.Cached, Output = total.Output - previous.Output,
                        Written = total.WriteKnown && previous.WriteKnown && total.Written >= previous.Written ? total.Written - previous.Written : 0,
                        WriteKnown = total.WriteKnown && previous.WriteKnown && total.Written >= previous.Written };
                else if (current != null) delta = current;
                else { log.Issues.Add(ParseIssue(line, log, "INVALID_TOKEN_EVENT")); return; }
                if (!delta.WriteKnown && current != null && current.WriteKnown && current.Key == delta.Key)
                { delta.Written = current.Written; delta.WriteKnown = true; }
                if (delta.Cached > delta.Input || delta.Written > delta.Input - delta.Cached) { log.Issues.Add(ParseIssue(line, log, "INVALID_TOKEN_EVENT")); return; }
                if (delta.Total == 0) return;
                var key = eventKey;
                bool excluded;
                if (!OfficialEvent(log, data, out excluded))
                {
                    if (!excluded) log.Issues.Add(new Issue { Code = "SOURCE_UNCONFIRMED", Key = key, Day = day, Missing = delta.Total, Line = log.Line });
                    return;
                }
                if (!day.HasValue) { log.Issues.Add(ParseIssue(line, log, "INVALID_TIMESTAMP")); return; }
                if (!hasBaseline && (current == null || total.Key != current.Key))
                    log.Issues.Add(new Issue { Code = "BASELINE_MISSING", Key = key, Day = day, Before = true, NeedsBaseline = true, Line = log.Line,
                        Missing = current == null ? (long?)null : Math.Max(0, total.Total - current.Total), Session = log.Session, At = stamp,
                        BaselineKey = current != null && total.Input >= current.Input && total.Cached >= current.Cached && total.Output >= current.Output ?
                            new Counts { Input = total.Input - current.Input, Cached = total.Cached - current.Cached, Output = total.Output - current.Output }.Key : null });
                snapshot.ConfirmedConsumption = true;
                log.Entries.Add(new Entry { Day = day.Value, Model = log.Model, Usage = delta, Key = key, HasBaseline = hasBaseline || (current != null && total.Key == current.Key) });
            }
            catch (ArgumentException) { if (IsTokenLine(line)) log.Issues.Add(ParseIssue(line, log, "INVALID_TOKEN_EVENT")); }
            catch (InvalidOperationException) { if (IsTokenLine(line)) log.Issues.Add(ParseIssue(line, log, "INVALID_TOKEN_EVENT")); }
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

    private sealed class OfficialShortcutMonitor : IDisposable
    {
        private readonly object gate = new object();
        private readonly List<FileSystemWatcher> watchers = new List<FileSystemWatcher>();
        private readonly Timer timer;
        private bool disposed, running, pending, retryPending;
        private int retryIndex;
        private static readonly int[] RetryDelays = { 2000, 10000, 30000 };

        public OfficialShortcutMonitor()
        {
            timer = new Timer(Scan, null, Timeout.Infinite, Timeout.Infinite);
            var locations = new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    @"Microsoft\Internet Explorer\Quick Launch")
            };
            foreach (var location in locations)
            {
                if (String.IsNullOrWhiteSpace(location) || !Directory.Exists(location)) continue;
                try
                {
                    var watcher = new FileSystemWatcher(location) {
                        IncludeSubdirectories = location != locations[0],
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                    };
                    FileSystemEventHandler changed = (sender, change) => {
                        if (String.Equals(Path.GetExtension(change.FullPath), ".lnk", StringComparison.OrdinalIgnoreCase) ||
                            Directory.Exists(change.FullPath)) Schedule();
                    };
                    watcher.Changed += changed;
                    watcher.Created += changed;
                    watcher.Deleted += changed;
                    watcher.Renamed += (sender, change) => {
                        if (String.Equals(Path.GetExtension(change.OldFullPath), ".lnk", StringComparison.OrdinalIgnoreCase)) Schedule();
                        else changed(sender, change);
                    };
                    watcher.Error += (sender, error) => Schedule();
                    watchers.Add(watcher);
                    watcher.EnableRaisingEvents = true;
                }
                catch (IOException error) { LogStartup("shortcut-watch-failed", 0, error); }
                catch (UnauthorizedAccessException error) { LogStartup("shortcut-watch-failed", 0, error); }
            }
            Schedule();
        }

        private void Schedule()
        {
            lock (gate)
            {
                if (disposed) return;
                pending = true;
                if (running || retryPending) return;
                retryIndex = 0;
                timer.Change(1000, Timeout.Infinite);
            }
        }

        private void Scan(object unused)
        {
            lock (gate)
            {
                if (disposed || running) return;
                running = true;
                pending = false;
                retryPending = false;
            }
            var retry = false;
            try { retry = RepairOfficialShortcuts(); }
            catch (Exception error) { retry = true; LogStartup("shortcut-repair-failed", 0, error); }
            finally
            {
                lock (gate)
                {
                    running = false;
                    if (!disposed)
                    {
                        // Failed writes/rollback can emit our own events; they must not reset the retry budget.
                        if (retry) {
                            pending = false;
                            if (retryIndex < RetryDelays.Length) {
                                retryPending = true;
                                timer.Change(RetryDelays[retryIndex++], Timeout.Infinite);
                            }
                        } else if (pending) {
                            retryIndex = 0;
                            timer.Change(1000, Timeout.Infinite);
                        }
                    }
                }
            }
        }

        public void Dispose()
        {
            lock (gate) { disposed = true; timer.Dispose(); }
            foreach (var watcher in watchers) watcher.Dispose();
            // An in-flight repair holds the shared maintenance lock; never kill it mid-transaction.
        }
    }

    private static bool RepairOfficialShortcuts()
    {
        var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        var script = Path.Combine(root, "scripts", "official_shortcuts.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("Official shortcut maintenance module is missing.");
        int helperId;
        long helperStart;
        using (var helper = Process.GetCurrentProcess()) { helperId = helper.Id; helperStart = helper.StartTime.ToUniversalTime().Ticks; }
        var command = "$ErrorActionPreference='Stop'; $WarningPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue'; " +
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; . '" + script.Replace("'", "''") + "'; " +
            "$result=Repair-CodexOfficialShortcuts -InstallRoot '" + root.Replace("'", "''") +
            "' -HelperProcessId " + helperId.ToString(CultureInfo.InvariantCulture) +
            " -HelperStartTicks " + helperStart.ToString(CultureInfo.InvariantCulture) + "; " +
            "[Console]::Write(($result | ConvertTo-Json -Compress -Depth 4))";
        var startInfo = new ProcessStartInfo {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
            Arguments = "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)),
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
        };
        using (var process = Process.Start(startInfo))
        {
            if (process == null) throw new InvalidOperationException("Could not start shortcut maintenance.");
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(30000)) {
                LogStartup("shortcut-repair-slow", helperId);
                // Keep one worker until it finishes; aborting a file transaction can break restoration.
                process.WaitForExit();
            }
            errors.GetAwaiter().GetResult();
            if (process.ExitCode != 0) throw new InvalidOperationException("Official shortcut maintenance failed (exit " + process.ExitCode.ToString(CultureInfo.InvariantCulture) + ").");
            var result = Json.Deserialize<Dictionary<string, object>>(output.GetAwaiter().GetResult());
            if (result == null || !result.ContainsKey("Status")) throw new InvalidDataException("Invalid shortcut maintenance result.");
            var retry = result.ContainsKey("RetryNeeded") && result["RetryNeeded"] is bool && (bool)result["RetryNeeded"];
            var stage = Convert.ToInt32(result["ConfiguredCount"], CultureInfo.InvariantCulture) > 0 ? "official-shortcuts-repaired" :
                retry || (string)result["Status"] == "InvalidState" || (string)result["Status"] == "UnsafeStatePath" ? "official-shortcuts-incomplete" : "official-shortcuts-checked";
            LogStartup(stage, helperId);
            return retry;
        }
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
            else if (TryConsoleRequest(message, "__codexQuotaLocalUsageRequest__", out requestId))
                PublishLocalUsage(socket, requestId);
            else if (TryConsoleRequest(message, "__codexQuotaReleaseRequest__", out requestId))
                PublishRelease(socket, requestId);
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
        if (name != "__codexQuotaOfficialRequest__" && name != "__codexQuotaDoctorRequest__" && name != "__codexQuotaLocalUsageRequest__" && name != "__codexQuotaReleaseRequest__") return false;
        var root = Json.DeserializeObject(message) as Dictionary<string, object>;
        if (root == null || StringValue(root, "method") != "Runtime.consoleAPICalled") return false;
        var parameters = root.ContainsKey("params") ? root["params"] as Dictionary<string, object> : null;
        var args = parameters != null && parameters.ContainsKey("args") ? parameters["args"] as object[] : null;
        var argument = args != null && (args.Length == 1 || args.Length == 2) ? args[0] as Dictionary<string, object> : null;
        if (argument == null || StringValue(argument, "type") != "string" || StringValue(argument, "value") != name) return false;
        if (args.Length == 1) return name == "__codexQuotaOfficialRequest__" || name == "__codexQuotaDoctorRequest__"; // Previous helpers/pages used a single marker.
        if (name != "__codexQuotaOfficialRequest__" && name != "__codexQuotaLocalUsageRequest__" && name != "__codexQuotaReleaseRequest__") return false;
        var id = args[1] as Dictionary<string, object>;
        if (id == null || StringValue(id, "type") != "string" || !ValidRequestId(StringValue(id, "value"))) return false;
        requestId = StringValue(id, "value");
        return true;
    }

    private static Dictionary<string, object> HttpErrorPayload(int statusCode, string retryAfter, DateTimeOffset now)
    {
        var payload = new Dictionary<string, object> {
            { "errorCode", statusCode == 401 ? "AUTH_REQUIRED" : statusCode == 403 ? "ACCESS_DENIED" :
                statusCode == 407 ? "PROXY_AUTH_REQUIRED" : statusCode == 429 ? "RATE_LIMITED" : "NETWORK_ERROR" }
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
        using (var response = exception.Response as HttpWebResponse)
        {
            if (response != null)
                return HttpErrorPayload((int)response.StatusCode, response.Headers["Retry-After"], DateTimeOffset.UtcNow);
        }
        string code;
        switch (exception.Status)
        {
            case WebExceptionStatus.Timeout: code = "REQUEST_TIMEOUT"; break;
            case WebExceptionStatus.ProxyNameResolutionFailure: code = "PROXY_CONNECTION_FAILED"; break;
            case WebExceptionStatus.ConnectFailure:
                code = CurrentNetworkDiagnosis != null && StringValue(CurrentNetworkDiagnosis, "NetworkMode") == "proxy"
                    ? "PROXY_CONNECTION_FAILED" : "CONNECTION_FAILED";
                break;
            case WebExceptionStatus.NameResolutionFailure: code = "DNS_FAILED"; break;
            case WebExceptionStatus.TrustFailure:
            case WebExceptionStatus.SecureChannelFailure: code = "TLS_FAILED"; break;
            default: code = "NETWORK_ERROR"; break;
        }
        return new Dictionary<string, object> { { "errorCode", code } };
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
        foreach (var entry in SanitizeNetworkDiagnosis(raw)) result[entry.Key] = entry.Value;
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
            CurrentNetworkDiagnosis = SanitizeNetworkDiagnosis(new Dictionary<string, object>());
            CurrentNetworkDiagnosis["NetworkCheckedAt"] = now.UtcDateTime.ToString("o", CultureInfo.InvariantCulture);
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
            catch (NetworkConfigurationException exception) { payload = new Dictionary<string, object> { { "errorCode", exception.Code } }; }
            catch { payload = new Dictionary<string, object> { { "errorCode", "INVALID_RESPONSE" } }; }
            CurrentNetworkDiagnosis["LastRequestError"] = StringValue(payload, "errorCode");
            payload["network"] = SanitizeNetworkDiagnosis(CurrentNetworkDiagnosis);
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
        CurrentNetworkDiagnosis = SanitizeNetworkDiagnosis(new Dictionary<string, object>());
        CurrentNetworkDiagnosis["NetworkCheckedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        try
        {
            return SettingsProxy(ReadNetworkSettings(), CurrentNetworkDiagnosis);
        }
        catch (NetworkConfigurationException) { throw; }
        catch (UnauthorizedAccessException) { throw new NetworkConfigurationException("NETWORK_CONFIG_UNREADABLE"); }
        catch (IOException) { throw new NetworkConfigurationException("NETWORK_CONFIG_UNREADABLE"); }
        catch (System.Security.SecurityException) { throw new NetworkConfigurationException("NETWORK_CONFIG_UNREADABLE"); }
        catch (CryptographicException) { throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID"); }
        catch (ArgumentException) { throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID"); }
        catch (FormatException) { throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID"); }
        catch (InvalidOperationException) { throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID"); }
    }

    private static IWebProxy SettingsProxy(Dictionary<string, object> settings, Dictionary<string, object> diagnosis)
    {
        var mode = StringValue(settings, "mode");
        if (diagnosis != null)
        {
            diagnosis["NetworkMode"] = mode;
            diagnosis["ProxySource"] = StringValue(settings, "source");
        }
        if (mode == "system") return WebRequest.DefaultWebProxy;
        var uri = NetworkProxyUri(DecryptNetworkProxy(StringValue(settings, "proxyProtected")));
        if (diagnosis != null) diagnosis["ProxyEndpoint"] = ProxyEndpoint(uri);
        var proxy = new WebProxy(new Uri(ProxyEndpoint(uri)));
        if (!String.IsNullOrEmpty(uri.UserInfo))
        {
            var credentials = uri.UserInfo.Split(new[] { ':' }, 2);
            proxy.Credentials = new NetworkCredential(Uri.UnescapeDataString(credentials[0]),
                credentials.Length == 2 ? Uri.UnescapeDataString(credentials[1]) : "");
        }
        return proxy;
    }

    // Quota requests and their diagnostic context are serialized by PayloadGate.
    private static Dictionary<string, object> CurrentNetworkDiagnosis;

    private sealed class NetworkConfigurationException : Exception
    {
        internal readonly string Code;
        internal NetworkConfigurationException(string code) : base(code) { Code = code; }
    }

    private static readonly string[] NetworkSources = { "default", "explicit", "legacy-process-https", "legacy-user-https",
        "legacy-process-http", "legacy-user-http", "legacy-file", "legacy-default" };
    private static readonly string[] NetworkErrors = { "REQUEST_TIMEOUT", "PROXY_CONNECTION_FAILED", "CONNECTION_FAILED",
        "DNS_FAILED", "TLS_FAILED", "PROXY_AUTH_REQUIRED", "AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMITED", "NETWORK_ERROR",
        "NETWORK_CONFIG_INVALID", "NETWORK_CONFIG_UNREADABLE", "INVALID_RESPONSE" };

    private static string ProxyEndpoint(Uri uri)
    {
        return uri.Scheme + "://" + uri.Host + ":" + uri.Port.ToString(CultureInfo.InvariantCulture);
    }

    private static Uri NetworkProxyUri(string value)
    {
        Uri uri;
        // .NET Framework HttpWebRequest supports HTTP proxies (including CONNECT for HTTPS targets), not HTTPS proxies.
        if (String.IsNullOrWhiteSpace(value) || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) ||
            uri.Scheme != "http" || String.IsNullOrEmpty(uri.Host) || uri.Port <= 0 ||
            uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID");
        return uri;
    }

    private static string DecryptNetworkProxy(string encrypted)
    {
        return new UTF8Encoding(false, true).GetString(ProtectedData.Unprotect(Convert.FromBase64String(encrypted),
            null, DataProtectionScope.CurrentUser));
    }

    private static Dictionary<string, object> ValidateNetworkSettings(string json)
    {
        var settings = Json.DeserializeObject(json) as Dictionary<string, object>;
        object version;
        if (settings == null || !settings.TryGetValue("version", out version) || !(version is int) || (int)version != 1)
            throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID");
        var mode = StringValue(settings, "mode");
        var source = StringValue(settings, "source");
        if (Array.IndexOf(NetworkSources, source) < 0 ||
            (mode != "system" && mode != "proxy") ||
            (mode == "system" && source != "default" && source != "explicit" && source != "legacy-default") ||
            (mode == "proxy" && (source == "default" || source == "legacy-default")))
            throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID");
        if (mode == "proxy") NetworkProxyUri(DecryptNetworkProxy(StringValue(settings, "proxyProtected")));
        else if (settings.ContainsKey("proxyProtected")) throw new NetworkConfigurationException("NETWORK_CONFIG_INVALID");
        return settings;
    }

    private static Dictionary<string, object> ReadNetworkSettings()
    {
        var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "network-settings.json");
        try { return ValidateNetworkSettings(File.ReadAllText(path, Encoding.UTF8)); }
        catch (FileNotFoundException) { }
        // Missing settings is an existing installation: preserve its previous selection once, then stop consulting it.
        var settings = MigrateNetworkSettings();
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, Json.Serialize(settings), new UTF8Encoding(false));
            try { File.Move(temporary, path); }
            catch (IOException)
            {
                // Another helper or explicit configuration may have won the race. Its valid settings take precedence.
                return ValidateNetworkSettings(File.ReadAllText(path, Encoding.UTF8));
            }
        }
        finally
        {
            try { File.Delete(temporary); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return settings;
    }

    private static Dictionary<string, object> MigrateNetworkSettings()
    {
        string value = null, source = "legacy-default";
        foreach (var variable in new[] { "HTTPS_PROXY", "HTTP_PROXY" })
        {
            foreach (var target in new[] { EnvironmentVariableTarget.Process, EnvironmentVariableTarget.User })
            {
                value = Environment.GetEnvironmentVariable(variable, target);
                if (!String.IsNullOrWhiteSpace(value))
                {
                    source = "legacy-" + (target == EnvironmentVariableTarget.Process ? "process-" : "user-") +
                        (variable == "HTTPS_PROXY" ? "https" : "http");
                    break;
                }
            }
            if (!String.IsNullOrWhiteSpace(value)) break;
        }
        if (String.IsNullOrWhiteSpace(value))
        {
            try
            {
                value = new UTF8Encoding(false, true).GetString(ProtectedData.Unprotect(
                    File.ReadAllBytes(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "api-proxy.dat")),
                    null, DataProtectionScope.CurrentUser));
                if (!String.IsNullOrWhiteSpace(value)) source = "legacy-file";
            }
            catch (FileNotFoundException) { }
        }
        var settings = new Dictionary<string, object> {
            { "version", 1 }, { "mode", String.IsNullOrWhiteSpace(value) ? "system" : "proxy" }, { "source", source }
        };
        if (!String.IsNullOrWhiteSpace(value))
        {
            NetworkProxyUri(value);
            settings["proxyProtected"] = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value.Trim()),
                null, DataProtectionScope.CurrentUser));
        }
        return settings;
    }

    private static Dictionary<string, object> SanitizeNetworkDiagnosis(Dictionary<string, object> raw)
    {
        var mode = StringValue(raw, "NetworkMode");
        var source = StringValue(raw, "ProxySource");
        var error = StringValue(raw, "LastRequestError");
        string endpoint = null, checkedAt = null;
        Uri uri;
        var rawEndpoint = StringValue(raw, "ProxyEndpoint");
        if (mode == "proxy" && Uri.TryCreate(rawEndpoint, UriKind.Absolute, out uri) && uri.Scheme == "http" &&
            !String.IsNullOrEmpty(uri.Host) && uri.Port > 0 && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" &&
            uri.Query.Length == 0 && uri.Fragment.Length == 0)
            endpoint = ProxyEndpoint(uri);
        DateTimeOffset date;
        if (DateTimeOffset.TryParseExact(StringValue(raw, "NetworkCheckedAt"),
            new[] { "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFzzz" }, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal, out date) && date.Offset == TimeSpan.Zero)
            checkedAt = date.UtcDateTime.ToString("o", CultureInfo.InvariantCulture);
        return new Dictionary<string, object> {
            { "NetworkMode", mode == "system" || mode == "proxy" ? mode : "unknown" },
            { "ProxySource", Array.IndexOf(NetworkSources, source) >= 0 ? source : "unknown" },
            { "ProxyEndpoint", endpoint }, { "LastRequestError", Array.IndexOf(NetworkErrors, error) >= 0 ? error : null },
            { "NetworkCheckedAt", checkedAt }
        };
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
                        IsConsoleRequest(message, "__codexQuotaOfficialRequest__") || IsConsoleRequest(message, "__codexQuotaLocalUsageRequest__") ||
                        IsConsoleRequest(message, "__codexQuotaReleaseRequest__")))
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
        public string Endpoint { get { return uri.ToString(); } }
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
