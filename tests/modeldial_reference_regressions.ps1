# Disposable public-HTML fixtures; no credentials, production HTTP or real state are accessed.
param([string]$ImplementationPath = (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs'), [string]$PublicFixtureRoot)
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $ImplementationPath
$start = $source.IndexOf('    private static class ModelDialReferences')
if ($start -lt 0) { throw 'ModelDialReferences implementation missing' }
$next = [regex]::Match($source.Substring($start + 45), '(?m)^    private static ')
$end = if ($next.Success) { $start + 45 + $next.Index } else { -1 }
# The next top-level member ends the nested class, retaining all class-local members.
$methods = if ($end -lt 0) { $source.Substring($start) } else { $source.Substring($start, $end - $start) }
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public static class ModelDialRegression
{
    private const string ProductVersion="test";
    private const int IoDeadlineMilliseconds=500;
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private sealed class NetworkConfigurationException:Exception {}
    private static Dictionary<string,object> ReadNetworkSettings(){throw new Exception("Production network forbidden");}
    private static IWebProxy SettingsProxy(Dictionary<string,object> settings,Dictionary<string,object> diagnosis){throw new Exception("Production network forbidden");}
    private static string StringValue(Dictionary<string,object> d,string k){object v;return d.TryGetValue(k,out v)?v as string:null;}
    private static bool NumberValue(Dictionary<string,object> d,string k,out double value){object raw;value=0;if(!d.TryGetValue(k,out raw)||!(raw is int||raw is long||raw is double||raw is decimal||raw is float))return false;value=Convert.ToDouble(raw,CultureInfo.InvariantCulture);return !Double.IsNaN(value)&&!Double.IsInfinity(value);}
    private static void Assert(bool ok,string label){if(!ok)throw new Exception(label);}
    private static string Fixture()
    {
        var html=new StringBuilder("<div>Token 单位：亿 · API 等值：USD</div>");
        foreach(var tier in new[]{"plus","pro-5x","pro-200","pro-500"})
        foreach(var model in new[]{"gpt-6-astra","gpt-6.1-sol"})
            html.Append("<a href=\"?calc=remaining&amp;calc_row=openai-"+tier+"-"+model+(tier=="pro-200"||tier=="pro-500"?"-20261005":"")+"&amp;period=week\"><span class=\"subscription-module__quotaNumber\"><small>≈</small>"+(model=="gpt-6-astra"?"4.38":"23.54")+"</span><span class=\"subscription-module__apiValue\">API 等值<!-- --> ≈ $"+(model=="gpt-6-astra"?"669":"481")+"</span></a>");
        html.Append("<a href=\"?calc_row=openai-pro-20x-gpt-6-astra\"><span class=\"x_quotaNumber\">9999</span></a>");
        html.Append("<a href=\"?calc_row=openai-plus-gpt-6-astra\">irrelevant duplicate calculator</a>");
        html.Append("<script>module:[\"/_next/static/chunks/unused.js\",\"/_next/static/chunks/references.js\"],\"SubscriptionPage\"</script>");
        return html.ToString();
    }
    private static string LegacyFixture()
    {
        var rows=new List<object>();
        foreach(var model in new[]{"gpt-6-astra","gpt-6.1-sol"}) rows.Add(new Dictionary<string,object>{
          {"id","openai-pro-20x-"+model},{"provider","openai"},{"plan","Pro 20x"},{"currency","USD"},{"monthly_price",200},{"record_status","historical"},
          {"weekly_tokens",model=="gpt-6-astra"?849560154d:4782528501.084447d},{"weekly_api_equivalent_usd",model=="gpt-6-astra"?1313.419998084d:942.1581147136362d},
          {"tokens",model=="gpt-6-astra"?3681427334d:20724290171.36594d},{"monthly_api_equivalent_usd",model=="gpt-6-astra"?5691.4866583640005d:4082.6851637590903d},
          {"calculation",new Dictionary<string,object>{{"note","braces } and { in strings"}}}});
        return "throw new Error('must never execute');JSON.parse('"+Json.Serialize(rows)+"');";
    }
    public static void Main(string[] args) { try { Run(args); } catch(Exception e) { Console.WriteLine(e.GetType().Name+": "+e.Message); Environment.ExitCode=1; } }
    public static void Run(string[] args)
    {
        var root=args[0];var now=new DateTimeOffset(2026,10,28,4,0,0,TimeSpan.Zero);var html=Fixture();int calls=0;
        if(args.Length>3 && args[2]=="public")
        {
            var publicHtml=File.ReadAllText(Path.Combine(args[3],"public.html"));var publicScript=File.ReadAllText(Path.Combine(args[3],"large-subscription.js"));
            var publicMetadata=File.ReadAllText(Path.Combine(args[3],"asset-1.js"));int publicCandidates=0;
            var sourceUrl="https://modeldial.com/_next/static/chunks/07b0gof4xwdgc.js";
            var state=ModelDialReferences.Check(root,DateTimeOffset.UtcNow,()=>publicHtml,url=>{
                publicCandidates++;Assert(url==(publicCandidates==1?"https://modeldial.com/_next/static/chunks/0yxpyuf_9bsmo.js":sourceUrl),"Preserve the real metadata/data candidate order");
                return publicCandidates==1?publicMetadata:publicScript;
            });
            Assert(publicCandidates==2,"Metadata module must not block the second candidate containing weekly data");
            Assert(state["errorCode"]==null&&state["legacyErrorCode"]==null&&(int)state["failureCount"]==0,"Saved public sources parse independently and reset failure backoff");
            var current=ModelDialReferences.Snapshot("pro","200");var tokens=(Dictionary<string,object>)current["models"];var usd=(Dictionary<string,object>)current["apiModels"];
            Assert((string)current["referenceSourceUrl"]==sourceUrl&&(double)tokens["gpt-6-astra"]==876923076.9230769d&&(double)tokens["gpt-6.1-sol"]==4707692307.692307d,"Public literal weekly values and exact selected asset");
            Assert((double)usd["gpt-6-astra"]==1337.076923076923d&&(double)usd["gpt-6.1-sol"]==961.8461538461538d,"Public literal weekly USD values");
            Console.WriteLine("PASS saved public HTML, real metadata-first candidate order and 770050-character canonical source offline, without HTTP or production state");return;
        }
        if(args.Length>2)
        {
            var phase=args[2];var elapsed=phase=="seed"?TimeSpan.Zero:phase=="early"?TimeSpan.FromMinutes(59):TimeSpan.FromHours(1);int requests=0;
            var state=ModelDialReferences.Check(root,now+elapsed,()=>{requests++;throw new WebException("synthetic offline");});
            Assert(requests==(phase=="early"?0:1),"Restart must preserve the durable retry deadline");
            Assert((int)state["failureCount"]==(phase=="retry"?2:1),"Restart retains the failed attempt count");
            Assert((string)state["nextCheckAt"]==now.AddHours(phase=="retry"?4:1).ToString("o"),"Restart must not shorten failure backoff");
            Console.WriteLine("PASS separate-process failure backoff "+phase);return;
        }
        var plans=ModelDialReferences.Parse(html);
        Assert(plans.Count==4 && (double)((Dictionary<string,object>)plans["200"])["gpt-6-astra"]==438000000,"Visible precision and plan whitelist");
        Console.WriteLine("PASS entity-encoded HTML and exact visible units; historical rows excluded");
        var prices=ModelDialReferences.Parse(html,true);Assert((double)((Dictionary<string,object>)prices["plus"])["gpt-6-astra"]==669,"API USD parsed separately");
        prices=ModelDialReferences.Parse(html.Replace("$669","$1,669.25"),true);Assert((double)((Dictionary<string,object>)prices["plus"])["gpt-6-astra"]==1669.25,"Grouped decimal API USD");
        var emptyPrices=ModelDialReferences.Parse(Regex.Replace(html,@"<span class=""subscription-module__apiValue"">[\s\S]*?</span>",""),true);Assert(((Dictionary<string,object>)emptyPrices["plus"]).Count==0,"Missing price remains absent");
        var cold=ModelDialReferences.Snapshot("pro","200");Assert((string)cold["status"]=="snapshot"&&cold["lastSuccessAt"]==null&&(string)cold["referenceKind"]=="legacy20x","Cold snapshot has no fabricated success");
        Assert((double)((Dictionary<string,object>)cold["models"])["gpt-6-astra"]==849560154,"Explicit weekly fallback, not displayed month total");
        Console.WriteLine("PASS API currency parsing, absent prices and explicit cold legacy weekly snapshot");
        foreach(var invalid in new[]{html.Replace("单位：亿","单位：万"),html.Replace("4.38","-1"),html.Replace("23.54","0"),html.Replace("gpt-6.1-sol","unknown"),html.Replace("period=week","period=month"),html+html})
        {bool rejected=false;try{ModelDialReferences.Parse(invalid);}catch(InvalidDataException){rejected=true;}Assert(rejected,"Malformed source rejected");}
        Console.WriteLine("PASS missing units, missing plans, ambiguous rows and invalid values rejected");
        int assets=0;Func<string,string> fetchAsset=url=>{assets++;Assert(url=="https://modeldial.com/_next/static/chunks/references.js","Same-origin asset selected from last candidate");return LegacyFixture();};
        ModelDialReferences.ReadLegacy(html,fetchAsset);assets=0;
        Func<string> fetch=()=>{calls++;return html;};
        ModelDialReferences.Check(root,now,fetch,fetchAsset);ModelDialReferences.Check(root,now.AddHours(23),fetch,fetchAsset);Assert(calls==1&&assets==1,"Daily durable cache includes legacy assets");
        var snap=ModelDialReferences.Snapshot("pro","200");Assert((string)snap["status"]=="ok"&&(string)snap["selectedPlan"]=="pro200","Selected Pro tier");
        Assert((double)((Dictionary<string,object>)snap["models"])["gpt-6-astra"]==849560154&&Math.Abs((double)((Dictionary<string,object>)snap["apiModels"])["gpt-6.1-sol"]-942.1581147136362)<1e-9,"Legacy weekly pairs never use monthly totals");
        Assert((string)snap["referenceSnapshotAt"]=="2026-10-28"&&(string)snap["lastSuccessAt"]==now.ToString("o"),"Legacy success belongs to actual legacy fetch");
        Assert((string)ModelDialReferences.Snapshot("pro",null)["status"]=="needs_plan","No Pro tier guessed");
        Assert((string)ModelDialReferences.Snapshot("plus","500")["selectedPlan"]=="plus","Plus ignores Pro selection");
        Assert((string)ModelDialReferences.Snapshot("enterprise","200")["status"]=="unavailable","Unsupported plan cannot inherit paid reference");
        Console.WriteLine("PASS persistent daily cache and explicit plan matching");
        ModelDialReferences.Check(root,now.AddDays(1),()=>{calls++;throw new WebException("offline");});
        snap=ModelDialReferences.Snapshot("pro","200");Assert((string)snap["status"]=="stale"&&snap["models"]!=null&&(string)snap["lastSuccessAt"]==now.ToString("o"),"Failure preserves success");
        ModelDialReferences.Check(root,now.AddDays(1).AddMinutes(59),fetch);Assert(calls==2,"Failed attempts limited across reads");
        Console.WriteLine("PASS failed check retains last success until the persistent retry deadline");
        ModelDialReferences.Check(root,now.AddDays(2),()=>"broken");Assert((string)ModelDialReferences.Snapshot("plus",null)["status"]=="stale","Layout drift preserves baseline");
        Console.WriteLine("PASS source layout drift retains confirmed data");
        ModelDialReferences.Check(root,now.AddDays(3),()=>html.Replace("4.38","4.39"),url=>LegacyFixture().Replace("849560154","849560155"));
        Assert((double)((Dictionary<string,object>)ModelDialReferences.Snapshot("pro","100")["models"])["gpt-6-astra"]==439000000,"New modern daily reference applied");
        Assert((double)((Dictionary<string,object>)ModelDialReferences.Snapshot("pro","200")["models"])["gpt-6-astra"]==849560155,"New daily legacy reference applied");
        Console.WriteLine("PASS new daily source values replace prior reference");
        var first=Path.Combine(root,"first");Directory.CreateDirectory(first);
        ModelDialReferences.Check(first,now,()=>{throw new WebException("offline");});
        Assert((string)ModelDialReferences.Snapshot("plus",null)["status"]=="unavailable"&&ModelDialReferences.Snapshot("plus",null)["models"]==null,"First failure cannot fabricate baseline");
        Console.WriteLine("PASS first failure unavailable");
        File.WriteAllText(Path.Combine(first,"modeldial-state.json"),"{broken");ModelDialReferences.Check(first,now,fetch);
        Assert((string)ModelDialReferences.Snapshot("plus",null)["status"]=="ok","Corrupt cache recovers");
        Console.WriteLine("PASS corrupt cache recovery");
        int denied=0;ModelDialReferences.Check(Path.Combine(root,"missing","nested"),now,()=>{denied++;return html;});Assert(denied==0,"Persist attempt before HTTP");
        Console.WriteLine("PASS no network when durable attempt cannot be saved");
        var parallel=Path.Combine(root,"parallel");Directory.CreateDirectory(parallel);int parallelCalls=0;
        var tasks=new Task[4];for(int i=0;i<tasks.Length;i++)tasks[i]=Task.Run(()=>ModelDialReferences.Check(parallel,now,()=>{Interlocked.Increment(ref parallelCalls);Thread.Sleep(20);return html;}));Task.WaitAll(tasks);
        Assert(parallelCalls==1,"One daily request under concurrent callers");
        Console.WriteLine("PASS concurrent checks share one request");
        foreach(var bad in new[]{LegacyFixture().Replace("weekly_tokens","month_only"),LegacyFixture().Replace("849560154","-1"),LegacyFixture().Replace("\"currency\":\"USD\"","\"currency\":\"CNY\""),LegacyFixture()+LegacyFixture()})
        {bool rejected=false;try{ModelDialReferences.ReadLegacy(html,url=>bad);}catch(InvalidDataException){rejected=true;}Assert(rejected,"Legacy wrong units, invalid prices and duplicate objects rejected");}
        int candidates=0;ModelDialReferences.ReadLegacy(html,url=>{candidates++;return candidates==1?"no relevant data":LegacyFixture();});Assert(candidates==2,"Bounded candidates stop at first valid legacy data");
        int external=0;bool unsafeRejected=false;
        try{ModelDialReferences.ReadLegacy(html.Replace("/_next/static/chunks/unused.js","https://evil.test/unused.js").Replace("/_next/static/chunks/references.js","//evil.test/references.js"),url=>{external++;return LegacyFixture();});}catch(InvalidDataException){unsafeRejected=true;}
        Assert(unsafeRejected&&external==0,"External asset links never requested");
        var many=new StringBuilder("[");for(int i=0;i<9;i++)many.Append((i==0?"":",")+"\"/_next/static/chunks/part"+i+".js\"");many.Append("],\"SubscriptionPage\"");
        bool bounded=false;try{ModelDialReferences.ReadLegacy(many.ToString(),url=>{external++;return LegacyFixture();});}catch(InvalidDataException){bounded=true;}Assert(bounded&&external==0,"Asset count bounded before network");
        Console.WriteLine("PASS legacy explicit-week units, JSON boundaries and same-origin bounded source discovery");
        var old=Path.Combine(root,"old");Directory.CreateDirectory(old);int oldCalls=0;
        File.WriteAllText(Path.Combine(old,"modeldial-state.json"),Json.Serialize(new Dictionary<string,object>{{"plans",plans},{"lastAttemptAt",now.ToString("o")},{"lastSuccessAt",now.ToString("o")},{"errorCode",null}}));
        ModelDialReferences.Check(old,now,()=>{oldCalls++;return html;});
        var oldModern=ModelDialReferences.Snapshot("pro","100");var oldLegacy=ModelDialReferences.Snapshot("pro","200");
        Assert(oldCalls==0&&oldModern["apiModels"]==null&&(string)oldModern["status"]=="ok","Old token-only cache and durable limit preserved");
        Assert((string)oldLegacy["status"]=="snapshot"&&oldLegacy["lastSuccessAt"]==null&&(double)((Dictionary<string,object>)oldLegacy["models"])["gpt-6-astra"]==849560154,"Old modern-200 cache never substituted for legacy");
        ModelDialReferences.Check(old,now.AddDays(1),()=>html,fetchAsset);
        ModelDialReferences.Check(old,now.AddDays(2),()=>html,url=>LegacyFixture().Replace("weekly_tokens","month_only"));
        oldLegacy=ModelDialReferences.Snapshot("pro","200");oldModern=ModelDialReferences.Snapshot("pro","100");
        Assert((string)oldLegacy["status"]=="stale"&&(bool)oldLegacy["referenceCheckFailed"]&&(string)oldLegacy["lastSuccessAt"]==now.AddDays(1).ToString("o"),"Failed legacy refresh retains actual legacy success");
        Assert((string)oldModern["status"]=="ok"&&(string)oldModern["lastSuccessAt"]==now.AddDays(2).ToString("o"),"Modern success cannot masquerade as legacy success");
        Console.WriteLine("PASS old cache migration and independent legacy/modern update outcomes");
        var currentHtml=html.Replace("Token 单位：亿","Token：亿").Replace("pro-5x","pro-100");
        Assert(((Dictionary<string,object>)ModelDialReferences.Parse(currentHtml)["100"]).Count==2,"Current Pro 100 IDs and shortened token caption");
        bool wrongUnit=false;try{ModelDialReferences.Parse(currentHtml.Replace("Token：亿","Token：万"));}catch(InvalidDataException){wrongUnit=true;}
        Assert(wrongUnit,"Current caption still rejects wrong units");
        Console.WriteLine("PASS current and previous captions and Pro 100 row IDs remain strict");
        var canonical=File.ReadAllText(args[1]);
        var migrated=ModelDialReferences.ReadLegacy(currentHtml,url=>canonical);
        var migratedTokens=(Dictionary<string,object>)migrated["models"];var migratedUsd=(Dictionary<string,object>)migrated["apiModels"];
        Assert((double)migratedTokens["gpt-6-astra"]==876923076.9230769d&&(double)migratedTokens["gpt-6.1-sol"]==4707692307.692307d,"Use explicit current weekly values, never monthly or a derived replacement");
        Assert((double)migratedUsd["gpt-6-astra"]==1337.076923076923d&&(double)migratedUsd["gpt-6.1-sol"]==961.8461538461538d,"Current weekly USD retains source precision");
        ModelDialReferences.ReadLegacy(currentHtml,url=>canonical+new string(' ',770050-canonical.Length));
        Console.WriteLine("PASS proven 20x migration and identical duplicate literal rows in measured larger assets");
        var metadataOnly="[{\"id\":\"openai-pro-200-gpt-6-astra\",\"group\":\"OpenAI\",\"plan\":\"Pro 200\"},{\"id\":\"openai-pro-200-gpt-6.1-sol\",\"group\":\"OpenAI\",\"plan\":\"Pro 200\"}]";
        int metadataCandidates=0;ModelDialReferences.ReadLegacy(currentHtml,url=>++metadataCandidates==1?metadataOnly:canonical);
        Assert(metadataCandidates==2,"Canonical metadata-only modules are skipped before parsing literal quota records");
        bool dataRejected=false;int invalidCandidates=0;
        try{ModelDialReferences.ReadLegacy(currentHtml,url=>++invalidCandidates==1?canonical.Replace("\"allowance_multiplier\":2","\"allowance_multiplier\":1"):canonical);}catch(InvalidDataException){dataRejected=true;}
        Assert(dataRejected&&invalidCandidates==1,"A real quota data module failing validation must not fall through to another candidate");
        Console.WriteLine("PASS metadata-only canonical IDs do not mask data modules and real data errors are not swallowed");
        foreach(var bad in new[]{canonical.Replace("replace(/^openai-pro-20x-","replace(/^not-a-migration-"),canonical.Replace("OpenAI:Pro 20x","OpenAI:Other"),
            canonical.Replace("\"archive\":false","\"archive\":true"),canonical.Replace("\"conflict\":false","\"conflict\":true"),
            canonical.Replace("\"allowance_multiplier\":2","\"allowance_multiplier\":1"),canonical.Replace("gpt-6-astra-20261005","gpt-6.1-sol-20261005"),
            canonical.Replace("876923076.9230769","438461538.4615384"),canonical.Replace("weekly_tokens","month_only"),
            canonical+canonical.Replace("876923076.9230769","876923077"),canonical+new string(' ',1048577)})
        {bool rejected=false;try{ModelDialReferences.ReadLegacy(currentHtml,url=>bad);}catch(InvalidDataException){rejected=true;}Assert(rejected,"Reject unproven, conflicting, reduced or oversized canonical data");}
        bool htmlBound=false;try{ModelDialReferences.ReadLegacy(new string(' ',524289),url=>{throw new Exception("Oversized HTML must not request assets");});}catch(InvalidDataException){htmlBound=true;}
        Assert(htmlBound,"HTML limit remains 512 KiB while scripts have their measured independent bound");
        Console.WriteLine("PASS migration proof, same-model projection, archive flags, duplicates and independent response limits");
        var independent=Path.Combine(root,"independent");Directory.CreateDirectory(independent);
        ModelDialReferences.Check(independent,now,()=>html,fetchAsset);
        ModelDialReferences.Check(independent,now.AddDays(1),()=>currentHtml.Replace("Token：亿","Token：万"),url=>canonical);
        var currentLegacy=ModelDialReferences.Snapshot("pro","200");var failedModern=ModelDialReferences.Snapshot("pro","100");
        Assert((string)currentLegacy["status"]=="ok"&&(string)currentLegacy["lastSuccessAt"]==now.AddDays(1).ToString("o"),"Modern parsing failure cannot prevent a proven legacy refresh");
        Assert((string)failedModern["status"]=="stale"&&(string)failedModern["lastSuccessAt"]==now.ToString("o"),"Modern failure retains its own success time");
        var independentFailure=ModelDialReferences.Check(independent,now.AddDays(1).AddHours(1),()=>currentHtml,url=>"invalid legacy asset");
        Assert((string)ModelDialReferences.Snapshot("pro","100")["lastSuccessAt"]==now.AddDays(1).AddHours(1).ToString("o"),"Modern refresh does not depend on legacy success");
        Assert((string)ModelDialReferences.Snapshot("pro","200")["lastSuccessAt"]==now.AddDays(1).ToString("o")&&(string)ModelDialReferences.Snapshot("pro","200")["status"]=="stale","Legacy failure retains its independent data and check time");
        Assert((int)independentFailure["failureCount"]==2&&(string)independentFailure["nextCheckAt"]==now.AddDays(1).AddHours(4).ToString("o"),"Either branch failure preserves growing backoff");
        Console.WriteLine("PASS modern and legacy source results and success timestamps are independent in both directions");
        int retryCalls=0;var retryRoot=Path.Combine(root,"retry");Directory.CreateDirectory(retryRoot);
        Func<string> offline=()=>{retryCalls++;throw new WebException("synthetic offline");};
        var retry1=ModelDialReferences.Check(retryRoot,now,offline);
        ModelDialReferences.Check(retryRoot,now.AddMinutes(59),offline);Assert(retryCalls==1,"First failure waits one hour");
        var retry2=ModelDialReferences.Check(retryRoot,now.AddHours(1),offline);
        ModelDialReferences.Check(retryRoot,now.AddHours(4).AddTicks(-1),offline);Assert(retryCalls==2,"Second failure waits three hours");
        var retry3=ModelDialReferences.Check(retryRoot,now.AddHours(4),offline);
        ModelDialReferences.Check(retryRoot,now.AddHours(10).AddTicks(-1),offline);Assert(retryCalls==3,"Third failure waits six hours");
        var retry4=ModelDialReferences.Check(retryRoot,now.AddHours(10),offline);Assert((int)retry4["failureCount"]==3&&(string)retry4["nextCheckAt"]==now.AddHours(16).ToString("o"),"Failure retry caps at six hours");
        var recovered=ModelDialReferences.Check(retryRoot,now.AddHours(16),()=>currentHtml,url=>canonical);
        Assert((int)recovered["failureCount"]==0&&(string)recovered["nextCheckAt"]==now.AddHours(40).ToString("o"),"Both-source success restores daily checks");
        var persisted=(Dictionary<string,object>)Json.DeserializeObject(File.ReadAllText(Path.Combine(retryRoot,"modeldial-state.json")));
        Assert((int)persisted["failureCount"]==0,"Success reset persists");
        Console.WriteLine("PASS persistent 1/3/6-hour failure retries and 24-hour success cadence");
        var migrationRoot=Path.Combine(root,"failed-old-cache");Directory.CreateDirectory(migrationRoot);
        File.WriteAllText(Path.Combine(migrationRoot,"modeldial-state.json"),Json.Serialize(new Dictionary<string,object>{{"lastAttemptAt",now.ToString("o")},{"errorCode","REFERENCE_CHECK_FAILED"}}));
        int migratedCalls=0;var migratedState=ModelDialReferences.Check(migrationRoot,now.AddMinutes(59),()=>{migratedCalls++;return currentHtml;},url=>canonical);
        Assert(migratedCalls==0&&(int)migratedState["failureCount"]==1&&(string)migratedState["nextCheckAt"]==now.AddHours(1).ToString("o"),"Old failures migrate without erasing or moving the attempt timestamp");
        ModelDialReferences.Check(migrationRoot,now.AddHours(1),()=>{migratedCalls++;return currentHtml;},url=>canonical);Assert(migratedCalls==1,"Migrated old failure retries when due");
        Console.WriteLine("PASS old failed caches acquire a bounded retry without fake timestamps or deletion");
    }
__METHODS__
}
'@
$root = Join-Path (Join-Path $PSScriptRoot '..\.runtime-test') ('modeldial-regressions-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$codePath = Join-Path $root 'regressions.cs'
$exePath = Join-Path $root 'regressions.exe'
[IO.File]::WriteAllText($codePath, $harness.Replace('__METHODS__', $methods), (New-Object Text.UTF8Encoding $false))
& 'D:\VSTUDIO\MSBuild\Current\Bin\Roslyn\csc.exe' /nologo /codepage:65001 /target:exe "/out:$exePath" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll $codePath
if ($LASTEXITCODE -ne 0) { throw 'ModelDial fixture compilation failed' }
& $exePath $root (Join-Path $PSScriptRoot 'fixtures\modeldial-pro200-migration-20261103.js')
if ($LASTEXITCODE -ne 0) { throw 'ModelDial regression failed' }
$restartRoot=Join-Path $root 'restart';New-Item -ItemType Directory -Path $restartRoot | Out-Null
foreach($phase in @('seed','early','retry')) {
    & $exePath $restartRoot (Join-Path $PSScriptRoot 'fixtures\modeldial-pro200-migration-20261103.js') $phase
    if($LASTEXITCODE -ne 0){throw ('ModelDial restart regression failed: '+$phase)}
}
if($PublicFixtureRoot) {
    $publicRoot=Join-Path $root 'public';New-Item -ItemType Directory -Path $publicRoot | Out-Null
    & $exePath $publicRoot (Join-Path $PSScriptRoot 'fixtures\modeldial-pro200-migration-20261103.js') public ([IO.Path]::GetFullPath($PublicFixtureRoot))
    if($LASTEXITCODE -ne 0){throw 'Saved public-source offline regression failed'}
}
