# Synthetic CIM records only; no production processes or network requests.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static HashSet<int> FindUnreportedPorts(')
$end = $source.IndexOf('    private static Dictionary<string, object> SendCommand(', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Could not find production port fallback' }
$method = $source.Substring($start, $end - $start).Replace('ManagementObjectSearcher', 'FixtureSearcher').Replace('ManagementObject row', 'FixtureRow row')
$harness = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Net;

public static class CdpPortDiscoveryRegressions
{
    private static readonly List<FixtureRow> Data = new List<FixtureRow>();
    private sealed class FixtureRow : IDisposable
    {
        private readonly Dictionary<string, object> values;
        public FixtureRow(int owner, object state, string local, string remote, object remotePort, object port)
        {
            values = new Dictionary<string, object> { { "OwningProcess", owner }, { "State", state },
                { "LocalAddress", local }, { "RemoteAddress", remote }, { "RemotePort", remotePort }, { "LocalPort", port } };
        }
        public object this[string key] { get { return values[key]; } }
        public void Dispose() { }
    }
    private sealed class FixtureRows : IEnumerable<FixtureRow>, IDisposable
    {
        public IEnumerator<FixtureRow> GetEnumerator() { return Data.GetEnumerator(); }
        IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); }
        public void Dispose() { }
    }
    private sealed class FixtureSearcher : IDisposable
    {
        public FixtureSearcher(string scope, string query) { }
        public FixtureRows Get() { return new FixtureRows(); }
        public void Dispose() { }
    }
    public static void Run()
    {
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 0, 3101));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 0, 3101));
        Data.Add(new FixtureRow(102, 0, "::1", "::", 0, 3102));
        Data.Add(new FixtureRow(102, 0, "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0", 0, 3110));
        Data.Add(new FixtureRow(999, 0, "127.0.0.1", "0.0.0.0", 0, 3103));
        Data.Add(new FixtureRow(101, 2, "127.0.0.1", "0.0.0.0", 0, 3104));
        Data.Add(new FixtureRow(101, null, "127.0.0.1", "0.0.0.0", 0, 3105));
        Data.Add(new FixtureRow(101, 0, "0.0.0.0", "0.0.0.0", 0, 3106));
        Data.Add(new FixtureRow(101, 0, "127.0.0.2", "0.0.0.0", 0, 3107));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "127.0.0.1", 0, 3108));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 53, 3109));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 0, 0));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 0, 65536));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "0.0.0.0", 0, null));
        Data.Add(new FixtureRow(101, 0, "127.0.0.1", "::", 0, 3111));
        var result = FindUnreportedPorts(new HashSet<int> { 101, 102 });
        if (!result.SetEquals(new[] { 3101, 3102, 3110 })) throw new Exception("Wrong CIM fallback candidates");
        if (FindUnreportedPorts(new HashSet<int>()).Count != 0) throw new Exception("Unowned ports must not be used");
        Console.WriteLine("PASS state-0 discovery restricts candidates to owned loopback sockets and valid ports");
    }
__METHOD__
}
'@
Add-Type -TypeDefinition $harness.Replace('__METHOD__', $method) -ReferencedAssemblies System.dll, System.Core.dll
[CdpPortDiscoveryRegressions]::Run()
