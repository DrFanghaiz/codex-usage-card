# Isolated .NET Framework tests; production GitHub and login data are never accessed.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static class ReleaseUpdates')
$end = $source.IndexOf('    private static void PublishLocalUsage(', $start)
$methods = $source.Substring($start, $end - $start)
$version = [regex]::Match($source, 'private const string ProductVersion = "([^"]+)";').Groups[1].Value
$installer = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\install.ps1')
$installVersion = [regex]::Match($installer, '\$releaseTag = ''v([^'']+)''').Groups[1].Value
if (-not $version -or $version -ne $installVersion) { throw 'Helper version and pinned release installer disagree' }
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public static class ReleaseUpdateRegressions
{
    private const string ProductVersion = "__VERSION__";
    private const int IoDeadlineMilliseconds = 500;
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private sealed class NetworkConfigurationException : Exception { }
    private static Dictionary<string, object> ReadNetworkSettings() { return new Dictionary<string, object>(); }
    private static IWebProxy SettingsProxy(Dictionary<string, object> settings, Dictionary<string, object> diagnosis) { return null; }
    private static string StringValue(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value as string : null; }
    private static void Check(bool ok, string label) { if (!ok) throw new Exception(label); }
    private static Dictionary<string, object> Release(string version) { return new Dictionary<string, object> { {"tag_name","v"+version},{"draft",false},{"prerelease",false},{"html_url","https://github.com/DrFanghaiz/codex-usage-card/releases/tag/v"+version} }; }
    public static void Run(string root)
    {
        var now = new DateTimeOffset(2026,10,28,3,0,0,TimeSpan.Zero); int calls=0;
        Func<Dictionary<string, object>> fetch=()=>{calls++;return Release("2.10.0");};
        foreach(var text in new[]{"0.1.0","2.5.1","2.10.0","10.0.0"}) Check(ReleaseUpdates.ValidVersion(text),"Stable version accepted");
        foreach(var text in new[]{"2.5","02.5.1","2.5.1.0","2.5.1-beta","v2.5.1","2147483648.0.0","2.5.1\n","2.5.1+build"}) Check(!ReleaseUpdates.ValidVersion(text),"Ambiguous version rejected");
        Console.WriteLine("PASS stable version validation");
        foreach(var key in new[]{"draft","prerelease","tag_name","html_url"}) {
            var bad=Release("2.10.0");bad[key]=key=="draft"||key=="prerelease"?(object)true:key=="tag_name"?(object)"v2.10.0-rc.1":(object)"https://example.com/update";
            bool rejected=false;try{ReleaseUpdates.Parse(bad);}catch(InvalidDataException){rejected=true;}Check(rejected,"Untrusted release rejected");
        }
        Console.WriteLine("PASS stable release and URL boundary");
        var state=ReleaseUpdates.Check(root,now,fetch);
        Check(calls==1 && (string)state["latestVersion"]=="2.10.0" && state["errorCode"]==null,"First success: calls="+calls+" state="+Json.Serialize(state));
        Check((string)state["currentVersion"]==ProductVersion && (string)state["nextCheckAt"]==now.AddDays(1).ToString("o"),"Installed version and daily deadline");
        var path=Path.Combine(root,"release-state.json");Check(File.Exists(path),"Attempt and success persisted");
        ReleaseUpdates.Check(root,now.AddHours(23),fetch);Check(calls==1,"Repeated pages reuse durable cache");
        ReleaseUpdates.Check(root,now.AddDays(1),fetch);Check(calls==2,"Daily deadline permits one new check");
        Console.WriteLine("PASS durable daily rate limit");
        var oldSuccess=(string)state["lastSuccessAt"];
        state=ReleaseUpdates.Check(root,now.AddDays(2),()=>{calls++;throw new WebException("fixture offline");});
        Check((string)state["latestVersion"]=="2.10.0" && state["lastSuccessAt"]!=null && (string)state["errorCode"]=="UPDATE_CHECK_FAILED","Offline preserves confirmed release");
        var failedCalls=calls;ReleaseUpdates.Check(root,now.AddDays(2).AddHours(1),fetch);Check(calls==failedCalls,"Failures cannot bypass daily limit");
        Console.WriteLine("PASS failure cache and no fake latest");
        var first=Path.Combine(root,"first-failure");Directory.CreateDirectory(first);
        state=ReleaseUpdates.Check(first,now,()=>{throw new WebException("fixture offline");});
        Check(state["latestVersion"]==null && state["lastSuccessAt"]==null && (string)state["errorCode"]=="UPDATE_CHECK_FAILED","Unknown remains unknown");
        File.WriteAllText(Path.Combine(first,"release-state.json"),"{broken");
        state=ReleaseUpdates.Check(first,now,fetch);Check((string)state["latestVersion"]=="2.10.0","Corrupt disposable cache recovers");
        Console.WriteLine("PASS first failure and corrupt cache recovery");
        var malformedProxy=Path.Combine(root,"malformed-proxy");Directory.CreateDirectory(malformedProxy);
        state=ReleaseUpdates.Check(malformedProxy,now,()=>{throw new FormatException("Invalid protected proxy fixture");});
        Check((string)state["errorCode"]=="UPDATE_CHECK_FAILED" && state["latestVersion"]==null,"Malformed proxy produces a stable failure reply");
        Console.WriteLine("PASS malformed proxy failure reply");
        int deniedCalls=0;
        state=ReleaseUpdates.Check(Path.Combine(root,"missing","directory"),now,()=>{deniedCalls++;return Release("2.10.0");});
        Check(deniedCalls==0 && (string)state["errorCode"]=="UPDATE_CHECK_FAILED","No HTTP when attempt cannot be persisted");
        Console.WriteLine("PASS persist-before-network limit");
        var parallel=Path.Combine(root,"parallel");Directory.CreateDirectory(parallel);int parallelCalls=0;
        Func<Dictionary<string,object>> concurrent=()=>{Interlocked.Increment(ref parallelCalls);Thread.Sleep(40);return Release("2.10.0");};
        var tasks=new Task[6];for(int i=0;i<tasks.Length;i++)tasks[i]=Task.Run(()=>ReleaseUpdates.Check(parallel,now,concurrent));Task.WaitAll(tasks);
        Check(parallelCalls==1,"Multi-window checks share one request");
        state=ReleaseUpdates.Check(parallel,now.AddDays(-4),concurrent);Check(parallelCalls==2,"Clock reversal does not block forever");
        Console.WriteLine("PASS concurrent pages and clock changes");
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
        TestEndpoint="http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port+"/release";
        string headers=null;
        var server=Task.Run(()=>{using(var client=listener.AcceptTcpClient())using(var stream=client.GetStream()){
            var text=new StringBuilder();while(true){int b=stream.ReadByte();if(b<0)throw new IOException("Fixture closed");text.Append((char)b);if(text.ToString().EndsWith("\r\n\r\n"))break;}
            headers=text.ToString();var body=Encoding.UTF8.GetBytes(Json.Serialize(Release("2.10.0")));var head=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\n\r\n");stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);
        }});
        try {Check((string)ReleaseUpdates.Parse(ReleaseUpdates.Fetch())["latestVersion"]=="2.10.0","Actual bounded HTTP path");server.Wait();}
        finally {listener.Stop();}
        Check(headers.Contains("CodexUsageCard/"+ProductVersion) && !headers.ToLowerInvariant().Contains("authorization:") && !headers.ToLowerInvariant().Contains("cookie:"),"GitHub requests carry no login tokens or cookies");
        Console.WriteLine("PASS anonymous HTTP transport");
        listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
        TestEndpoint="http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port+"/slow";
        server=Task.Run(()=>{using(var client=listener.AcceptTcpClient())using(var stream=client.GetStream()){
            var reader=new StreamReader(stream);while(!String.IsNullOrEmpty(reader.ReadLine())){}
            var head=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{");stream.Write(head,0,head.Length);stream.Flush();Thread.Sleep(900);
        }});
        bool timedOut=false;var clock=System.Diagnostics.Stopwatch.StartNew();
        try {ReleaseUpdates.Fetch();}catch(WebException){timedOut=true;}catch(IOException){timedOut=true;}
        finally {server.Wait();listener.Stop();}
        Check(timedOut && clock.ElapsedMilliseconds<2000,"Whole response deadline aborts stalled bodies");
        Console.WriteLine("PASS whole-body HTTP deadline");
    }
    private static string TestEndpoint;
__METHODS__
}
'@
$harness = $harness.Replace('__VERSION__', $version).Replace('__METHODS__', $methods.Replace('WebRequest.Create(Endpoint)', 'WebRequest.Create(TestEndpoint)'))
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll,System.Security.dll
$root = Join-Path ([IO.Path]::GetTempPath()) ('quota-release-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try { [ReleaseUpdateRegressions]::Run($root) }
finally { Remove-Item -LiteralPath $root -Recurse -Force }
