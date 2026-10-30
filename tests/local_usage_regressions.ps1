$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static class LocalUsage')
$end = $source.IndexOf('    private static async Task MainAsync()', $start)
$methods = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static string StringValue(')
$end = $source.IndexOf('    private static CdpTarget TargetFromEvent(', $start)
$strings = $source.Substring($start, $end - $start)
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
public static class LocalUsageRegressions
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Check(bool ok, string label) { if (!ok) throw new Exception(label); }
    private static string Stamp(int day, int minute) { return new DateTime(2026, 9, day, 12, minute, 0, DateTimeKind.Local).ToUniversalTime().ToString("o"); }
    private static Dictionary<string, object> C(long input, long cache, long output) { return new Dictionary<string, object> { { "input_tokens", input }, { "cached_input_tokens", cache }, { "output_tokens", output }, { "total_tokens", input + output }, { "reasoning_output_tokens", output } }; }
    private static string E(int day, int minute, Dictionary<string, object> total, Dictionary<string, object> last, string plan)
    {
        return Json.Serialize(new { type="event_msg", timestamp=Stamp(day, minute), payload=new { type="token_count", info=new { total_token_usage=total, last_token_usage=last }, rate_limits=new { plan_type=plan } } }) + "\n";
    }
    private static string Meta(string provider) { return Json.Serialize(new { type="session_meta", payload=new { model_provider=provider } }) + "\n"; }
    private static string Model(string model) { return Json.Serialize(new { type="turn_context", payload=new { model=model } }) + "\n"; }
    private static Dictionary<string, object> CW(long input, long cache, long written, long output)
    {
        var result=C(input,cache,output); result["cache_write_input_tokens"]=written; return result;
    }
    private static int IssueCount(Dictionary<string, object> result, string code)
    {
        foreach(var issue in (List<Dictionary<string, object>>)result["issues"]) if ((string)issue["code"]==code) return (int)issue["count"];
        return 0;
    }
    private static string OfficialWithoutPlan(string text)
    {
        return text.Replace("\"plan_type\":null", "\"plan_type\":null,\"limit_id\":\"codex\",\"primary\":{\"used_percent\":4,\"window_minutes\":10080,\"resets_at\":1793196413}");
    }
    private static List<Dictionary<string, object>> Daily(Dictionary<string, object> result)
    {
        return (List<Dictionary<string, object>>)result["daily"];
    }
    private static Dictionary<string, object> Day(Dictionary<string, object> result, string date)
    {
        foreach (var day in Daily(result)) if ((string)day["date"]==date) return day;
        throw new Exception("Missing requested daily bucket: "+date);
    }
    private static void DailyMatches(Dictionary<string, object> result)
    {
        var sums=new Dictionary<string,long[]>();
        var events=0;
        var keys=new[] {"inputTokens","cachedInputTokens","cacheWriteInputTokens","outputTokens","totalTokens"};
        var previous="";
        foreach(var day in Daily(result))
        {
            var date=(string)day["date"];
            Check(String.CompareOrdinal(date,previous)>0 && String.CompareOrdinal(date,(string)result["start"])>=0 && String.CompareOrdinal(date,(string)result["end"])<=0,"Daily dates are ordered, unique and inside inclusive range");
            previous=date; events+=(int)day["eventCount"];
            foreach(var row in (List<Dictionary<string,object>>)day["models"])
            {
                var model=(string)row["model"];long[] sum;
                if (!sums.TryGetValue(model,out sum)){sum=new long[keys.Length];sums[model]=sum;}
                for(var index=0;index<keys.Length;index++)sum[index]+=Convert.ToInt64(row[keys[index]]);
            }
        }
        Check(events==(int)result["eventCount"],"Daily event totals equal interval count");
        foreach(var row in (List<Dictionary<string,object>>)result["models"])
        {
            var model=(string)row["model"];Check(sums.ContainsKey(model),"Each interval model exists in daily buckets");
            for(var index=0;index<keys.Length;index++)Check(sums[model][index]==Convert.ToInt64(row[keys[index]]),"Daily token fields equal interval model totals");
            sums.Remove(model);
        }
        Check(sums.Count==0,"Daily buckets contain no extra models");
    }
    private static string Startup(string id, string parent, int ordinal=5)
    {
        return Json.Serialize(new {type="session_meta",payload=new {model_provider="openai",session_id=id,parent_thread_id=parent,
            source=new {subagent=new {other="review"}},subagent_history_start_ordinal=ordinal,timestamp=Stamp(2,0)}})+"\n"+
            "{\"type\":\"compacted\",\"payload\":{}}\n{\"type\":\"world_state\",\"payload\":{}}\n"+Model("gpt-6-astra");
    }
    private static string Dir(string parent, string child) { var path=Path.Combine(parent,child); Directory.CreateDirectory(path); return path; }
    private static Dictionary<string, object> Read(string root, string start="2026-09-01", string end="2026-09-02") { return LocalUsage.Read(root,start,end); }
    private static long Total(Dictionary<string, object> result)
    {
        long total=0;
        foreach(var row in (List<Dictionary<string, object>>)result["models"]) total+=(long)row["totalTokens"];
        return total;
    }
    private static void BadRange(string root, string start, string end)
    {
        try { Read(root,start,end); throw new Exception("Invalid date range accepted"); }
        catch(ArgumentException) { }
    }
    public static void Run(string root)
    {
        Directory.CreateDirectory(root);
        var sessions=Dir(root,"sessions");
        var a=E(1,0,C(100,80,10),C(100,80,10),"pro");
        var b=E(2,0,C(150,110,30),C(50,30,20),"pro");
        var text=Meta("openai")+Model("gpt-6.1-sol")+a+a+b+b;
        var file=Path.Combine(sessions,"a.jsonl");
        File.WriteAllText(file,text,new UTF8Encoding(false));
        var result=Read(root);
        Check(Total(result)==180 && (int)result["eventCount"]==2,"Cumulative snapshots deduplicate repeats");
        Check(Total(Read(root,"2026-09-02","2026-09-02"))==70,"Daily counts use event date and incremental delta");
        Check(!(bool)result["partial"],"Complete log not marked partial");
        var archive=Dir(root,"archived_sessions");
        File.WriteAllText(Path.Combine(archive,"copy.jsonl"),text,new UTF8Encoding(false));
        Check(Total(Read(root))==180,"Archived copies are deduplicated");
        var branch=text+E(2,1,C(180,120,35),C(30,10,5),"pro");
        File.WriteAllText(Path.Combine(sessions,"fork.jsonl"),branch,new UTF8Encoding(false));
        Check(Total(Read(root))==215,"Forked history counts only its new events");
        File.AppendAllText(file,E(2,2,C(190,140,40),C(40,30,10),"pro"),new UTF8Encoding(false));
        Check(Total(Read(root))==265,"Append scan preserves prior rows and adds only delta");
        var rows=(List<Dictionary<string, object>>)Read(root)["models"];
        Check((long)rows[0]["inputTokens"]==220 && (long)rows[0]["cachedInputTokens"]==150 && (long)rows[0]["outputTokens"]==45,"Cache and reasoning are subsets, not additional tokens");
        File.WriteAllText(file,Meta("openai")+Model("gpt-6-astra")+E(2,3,C(5,0,2),C(5,0,2),"pro"),new UTF8Encoding(false));
        Check(Total(Read(root))==222,"Truncated log invalidates its cached records");
        var cases=Dir(root,"isolated");
        var caseSessions=Dir(cases,"sessions");
        var caseFile=Path.Combine(caseSessions,"case.jsonl");
        File.WriteAllText(caseFile,Meta("openai")+E(1,4,C(10,4,2),C(10,4,2),"pro"),new UTF8Encoding(false));
        result=Read(cases);
        Check(((List<Dictionary<string, object>>)result["models"])[0]["model"].ToString()=="unknown", "Missing model is included as unknown, never claimed excluded");
        File.WriteAllText(caseFile,Meta("openai")+Model("gpt-6-astra")+E(1,5,C(1000,900,100),C(10,4,2),"pro"),new UTF8Encoding(false));
        result=Read(cases);
        Check(Total(result)==12 && (bool)result["partial"],"Inherited cumulative baseline is not assigned to current date");
        File.WriteAllText(caseFile,Meta("custom-api")+Model("gpt-6-astra")+E(1,6,C(10,4,2),C(10,4,2),"pro"),new UTF8Encoding(false));
        Check(Total(Read(cases))==0,"API provider excluded");
        File.WriteAllText(caseFile,Meta("openai")+Model("gpt-6-astra")+E(1,7,C(10,4,2),C(10,4,2),"api"),new UTF8Encoding(false));
        Check(Total(Read(cases))==0,"API-auth plan excluded");
        File.WriteAllText(caseFile,Model("gpt-6-astra")+E(1,8,C(10,4,2),C(10,4,2),"pro"),new UTF8Encoding(false));
        result=Read(cases);
        Check(Total(result)==0 && (bool)result["partial"],"Missing provider does not silently count as official");
        File.WriteAllText(caseFile,Meta("openai")+Model("gpt-6-astra")+"{\"timestamp\":\""+Stamp(1,9)+"\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",broken}\n"+E(1,9,C(10,4,2),C(10,4,2),"pro"),new UTF8Encoding(false));
        result=Read(cases);
        Check(Total(result)==12 && (bool)result["partial"],"Malformed event marks partial and retains valid counts");
        var tail=E(1,10,C(20,8,4),C(20,8,4),"pro");
        File.WriteAllText(caseFile,Meta("openai")+Model("gpt-6-astra")+tail.Substring(0,tail.Length-1),new UTF8Encoding(false));
        Check((bool)Read(cases)["partial"],"Unfinished line is not parsed as a full event");
        File.AppendAllText(caseFile,"\n",new UTF8Encoding(false));
        result=Read(cases);
        Check(Total(result)==24 && !(bool)result["partial"],"Completed tail is retried exactly once");
        Check(Total(Read(cases))==24,"Unchanged EOF preserves cached records");
        var originalWrite=File.GetLastWriteTimeUtc(caseFile);
        File.WriteAllText(caseFile,Meta("openai")+Model("gpt-6-astra")+E(1,10,C(20,8,5),C(20,8,5),"pro"),new UTF8Encoding(false));
        File.SetLastWriteTimeUtc(caseFile,originalWrite);
        Check(Total(Read(cases))==25,"EOF shortcut still validates the tail anchor when size and write time are unchanged");
        var oversized=Dir(root,"oversized");var oversizedSessions=Dir(oversized,"sessions");var oversizedFile=Path.Combine(oversizedSessions,"tail.jsonl");
        File.WriteAllText(oversizedFile,Meta("openai")+Model("gpt-6-astra")+"{\"timestamp\":\""+Stamp(1,11)+"\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":\""+new string('x',16777217),new UTF8Encoding(false));
        result=Read(oversized);
        Check((bool)result["partial"] && IssueCount(result,"INVALID_TOKEN_EVENT")==1,"An oversized unfinished token record stays explicitly incomplete");
        File.AppendAllText(oversizedFile,"\n",new UTF8Encoding(false));result=Read(oversized);
        Check((bool)result["partial"] && IssueCount(result,"INVALID_TOKEN_EVENT")==1,"Completing an oversized invalid tail does not duplicate its issue");
        var collisions=Dir(root,"collisions");var collisionSessions=Dir(collisions,"sessions");
        var collisionEvent=E(1,12,CW(100,20,0,10),CW(100,20,0,10),"pro");
        var identityA=Json.Serialize(new {type="session_meta",payload=new {model_provider="openai",session_id="independent-a",id="independent-a"}})+"\n";
        var identityB=identityA.Replace("independent-a","independent-b");
        File.WriteAllText(Path.Combine(collisionSessions,"a.jsonl"),identityA+Model("gpt-6-astra")+collisionEvent,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(collisionSessions,"b.jsonl"),identityB+Model("gpt-6.1-sol")+collisionEvent,new UTF8Encoding(false));
        result=Read(collisions);
        Check(Total(result)==220 && (int)result["eventCount"]==2 && ((List<Dictionary<string,object>>)result["models"]).Count==2,"Independent identified threads with equal counters at one timestamp both count");DailyMatches(result);
        var collisionArchive=Dir(collisions,"archived_sessions");File.Copy(Path.Combine(collisionSessions,"a.jsonl"),Path.Combine(collisionArchive,"copy.jsonl"));
        Check(Total(Read(collisions))==220,"An identified thread's archived copy is still counted once");
        File.WriteAllText(Path.Combine(collisionSessions,"b.jsonl"),identityB.Replace("\"session_id\":\"independent-b\"","\"session_id\":\"independent-a\"")+Model("gpt-6-astra")+collisionEvent,new UTF8Encoding(false));
        Check(Total(Read(collisions))==220,"Distinct thread ids take priority over shared guardian session ids");
        var historyRoot=Dir(root,"declared-history");var historySessions=Dir(historyRoot,"sessions");
        var historyA=E(1,13,CW(100,20,10,10),CW(100,20,10,10),"pro");
        var historyB=E(1,14,CW(150,30,20,20),CW(50,10,10,10),"pro");
        var childDelta=E(2,1,CW(175,35,25,25),CW(25,5,5,5),"pro");
        File.WriteAllText(Path.Combine(historySessions,"parent.jsonl"),identityA.Replace("independent-a","history-parent")+Model("gpt-6-astra")+historyA+historyB,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(historySessions,"child.jsonl"),Startup("history-child","history-parent",6)+historyA+historyB+childDelta,new UTF8Encoding(false));
        Check(Total(Read(historyRoot))==200,"An explicit pre-birth history boundary deduplicates every copied parent event, retaining the child's delta");
        var parentHistory=File.ReadAllText(Path.Combine(historySessions,"parent.jsonl"));File.Delete(Path.Combine(historySessions,"parent.jsonl"));
        Check(Total(Read(historyRoot))==200,"A declared history copy still contributes when its original parent file is absent");
        File.WriteAllText(Path.Combine(historySessions,"parent.jsonl"),parentHistory,new UTF8Encoding(false));
        Check(Total(Read(historyRoot))==200,"Restoring the original parent does not duplicate the previously available history copy");
        File.WriteAllText(Path.Combine(historySessions,"grandchild.jsonl"),Startup("history-grandchild","history-child",7).Replace(Stamp(2,0),Stamp(2,2))+historyA+historyB+childDelta+E(2,3,CW(200,40,30,30),CW(25,5,5,5),"pro"),new UTF8Encoding(false));
        result=Read(historyRoot);
        Check(Total(result)==230 && Total(Read(historyRoot,"2026-09-01","2026-09-01"))==170,"Nested explicit history resolves to its original parent without excluding the parent's real consumption");DailyMatches(result);
        var importFile=Path.Combine(historySessions,"independent-import.jsonl");
        File.WriteAllText(importFile,identityB+Model("gpt-6-astra")+historyA+historyB,new UTF8Encoding(false));
        Check(Total(Read(historyRoot))==400,"Different identified logs without ancestry are never merged from coincident numbers");File.Delete(importFile);
        File.WriteAllText(importFile,Startup("unbounded-history","history-parent",0)+historyA+historyB,new UTF8Encoding(false));
        Check(Total(Read(historyRoot))==400,"An absent history boundary cannot establish parent ownership");File.Delete(importFile);
        var sameTime=Dir(root,"same-time-parent");var sameTimeSessions=Dir(sameTime,"sessions");
        var simultaneous=E(2,0,CW(100,20,0,10),CW(100,20,0,10),"pro");
        File.WriteAllText(Path.Combine(sameTimeSessions,"parent.jsonl"),identityA.Replace("independent-a","same-time-parent")+Model("gpt-6-astra")+simultaneous,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(sameTimeSessions,"child.jsonl"),Startup("same-time-child","same-time-parent")+simultaneous,new UTF8Encoding(false));
        Check(Total(Read(sameTime))==220,"An event at the child's creation time is not pre-birth history and cannot remove real parent usage");
        var cycle=Dir(root,"cyclic-history");var cycleSessions=Dir(cycle,"sessions");
        File.WriteAllText(Path.Combine(cycleSessions,"a.jsonl"),Startup("cycle-a","cycle-b")+historyA,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(cycleSessions,"b.jsonl"),Startup("cycle-b","cycle-a")+historyA,new UTF8Encoding(false));
        Check(Total(Read(cycle))==220,"Cyclic history pointers terminate and preserve separate identities");
        var copiedStartup=Dir(root,"copied-startup");var copiedStartupSessions=Dir(copiedStartup,"sessions");
        File.WriteAllText(Path.Combine(copiedStartupSessions,"parent.jsonl"),identityA.Replace("independent-a","startup-parent")+Model("gpt-6-astra")+historyA,new UTF8Encoding(false));
        var startupEvent=E(2,0,CW(100,20,10,10),CW(100,20,10,10),"pro");
        File.WriteAllText(Path.Combine(copiedStartupSessions,"child.jsonl"),Startup("startup-child","startup-parent")+startupEvent,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(copiedStartupSessions,"grandchild.jsonl"),Startup("startup-grandchild","startup-child").Replace(Stamp(2,0),Stamp(2,2))+startupEvent,new UTF8Encoding(false));
        Check(Total(Read(copiedStartup))==110,"Copying a known inherited startup snapshot cannot reintroduce its totals or drop original parent consumption");
        var order=Dir(root,"order");
        var orderSessions=Dir(order,"sessions");
        var last=E(2,15,C(300,200,50),C(10,4,2),"pro");
        File.WriteAllText(Path.Combine(orderSessions,"first-fallback.jsonl"),Meta("openai")+Model("gpt-6-astra")+last,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(orderSessions,"later-complete.jsonl"),Meta("openai")+Model("gpt-6-astra")+E(1,15,C(100,80,10),C(100,80,10),"pro")+last,new UTF8Encoding(false));
        Check(Total(Read(order,"2026-09-02","2026-09-02"))==240,"Known cumulative baseline wins over first encountered copied fallback");
        var empty=Dir(root,"empty");
        result=Read(empty);
        Check(Total(result)==0 && !(bool)result["hasLogs"] && (int)result["eventCount"]==0,"Empty directory distinguished from observed zero");
        BadRange(root,"2026-9-01","2026-09-02"); BadRange(root,"2026-02-30","2026-09-02");
        BadRange(root,"2026-09-02","2026-09-01"); BadRange(root,"2021-12-31","2026-09-02");
        BadRange(root,"2026-09-01","2999-01-01");
        var recovery=Dir(root,"recovery");
        var recoverySessions=Dir(recovery,"sessions");
        var recoverFile=Path.Combine(recoverySessions,"source.jsonl");
        var count=CW(100,20,30,10);
        var eventWithoutPlan=E(1,20,count,count,null);
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+OfficialWithoutPlan(eventWithoutPlan),new UTF8Encoding(false));
        result=Read(recovery);
        Check(Total(result)==110 && !(bool)result["partial"] && IssueCount(result,"SOURCE_UNCONFIRMED")==0,"Explicit Codex weekly window recovers nullable plan without account guessing");
        var priced=((List<Dictionary<string, object>>)result["models"])[0];
        Check((long)priced["cacheWriteInputTokens"]==30 && (bool)priced["cacheWriteKnown"] && (long)priced["totalTokens"]==110,"Read and write caches are input subsets");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+eventWithoutPlan,new UTF8Encoding(false));
        result=Read(recovery);
        Check(Total(result)==0 && (bool)result["partial"] && IssueCount(result,"SOURCE_UNCONFIRMED")==1,"Nullable plan without quota evidence stays excluded");
        Check(!(bool)Read(recovery,"2026-09-02","2026-09-02")["partial"],"Source issue outside requested dates does not contaminate range");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+OfficialWithoutPlan(eventWithoutPlan).Replace("10080","10081"),new UTF8Encoding(false));
        Check(Total(Read(recovery))==0,"Nonstandard window is not guessed to be subscription quota");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+OfficialWithoutPlan(eventWithoutPlan).Replace("\"plan_type\":null","\"plan_type\":\"api\""),new UTF8Encoding(false));
        Check(Total(Read(recovery))==0 && !(bool)Read(recovery)["partial"],"Explicit API classification wins over stale quota-shaped fields");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+E(1,21,C(1000,100,30),C(10,1,2),"pro"),new UTF8Encoding(false));
        Check(IssueCount(Read(recovery),"BASELINE_MISSING")==1 && !(bool)Read(recovery,"2026-09-02","2026-09-02")["partial"],"Missing historical baseline never marks later days incomplete");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+E(1,22,C(10,1,2),C(10,1,2),"pro")+"{\"type\":\"response_item\",\"payload\":{",new UTF8Encoding(false));
        Check(!(bool)Read(recovery)["partial"],"Unfinished chat/tool record cannot create token incompleteness");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+E(1,23,C(10,1,2),C(10,1,2),"pro")+"{\"type\":\"response_item\",\"payload\":\""+new string('x',16777217)+"\"}\n",new UTF8Encoding(false));
        Check(!(bool)Read(recovery)["partial"],"Oversized ordinary chat line is ignored without a false missing-token flag");
        File.WriteAllText(recoverFile,Meta("openai")+E(1,24,C(10,1,2),C(10,1,2),"pro"),new UTF8Encoding(false));
        result=Read(recovery);
        Check(Total(result)==12 && !(bool)result["partial"] && IssueCount(result,"CACHE_WRITE_UNRECORDED")==1,"Unknown model and missing write-cache field do not mean missing total tokens");
        var firstWrite=CW(100,20,30,10); var secondWrite=CW(150,30,50,20);
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+E(1,25,firstWrite,firstWrite,"pro")+E(2,25,secondWrite,null,"pro"),new UTF8Encoding(false));
        result=Read(recovery);
        Check(Total(result)==170 && !(bool)result["partial"] && IssueCount(result,"INVALID_TOKEN_EVENT")==0,"Known cumulative baseline recovers missing last usage");
        priced=((List<Dictionary<string, object>>)result["models"])[0];
        Check((long)priced["cacheWriteInputTokens"]==50 && (bool)priced["cacheWriteKnown"],"Write cache is differenced across snapshots");
        File.WriteAllText(recoverFile,Meta("openai")+Model("gpt-6-astra")+E(1,26,C(100,20,10),C(100,20,10),"pro")+E(2,26,CW(150,30,50,20),CW(50,10,20,10),"pro"),new UTF8Encoding(false));
        result=Read(recovery,"2026-09-02","2026-09-02");
        priced=((List<Dictionary<string, object>>)result["models"])[0];
        Check((long)priced["cacheWriteInputTokens"]==20 && (bool)priced["cacheWriteKnown"],"Matching per-event write field recovers missing prior write baseline");
        var continuation=Dir(root,"continuation");var continuationSessions=Dir(continuation,"sessions");
        var metaSame=Json.Serialize(new {type="session_meta",payload=new {model_provider="openai",session_id="same-session"}})+"\n";
        File.WriteAllText(Path.Combine(continuationSessions,"first.jsonl"),metaSame+Model("gpt-6-astra")+E(1,27,CW(100,20,30,10),CW(100,20,30,10),"pro"),new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(continuationSessions,"second.jsonl"),metaSame+Model("gpt-6-astra")+E(2,27,CW(150,30,50,20),CW(50,10,20,10),"pro"),new UTF8Encoding(false));
        result=Read(continuation);
        Check(Total(result)==170 && !(bool)result["partial"],"Exact same-session predecessor resolves continued-log baseline without adding inherited totals");
        File.WriteAllText(Path.Combine(continuationSessions,"second.jsonl"),metaSame.Replace("same-session","other-session")+Model("gpt-6-astra")+E(2,27,CW(150,30,50,20),CW(50,10,20,10),"pro"),new UTF8Encoding(false));
        Check((bool)Read(continuation)["partial"],"Matching counts from an unrelated session never resolve missing history");
        var duplicates=Dir(root,"duplicates");var duplicateSessions=Dir(duplicates,"sessions");
        File.WriteAllText(Path.Combine(duplicateSessions,"unknown.jsonl"),Meta("openai")+Model("gpt-6-astra")+eventWithoutPlan,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(duplicateSessions,"known.jsonl"),Meta("openai")+Model("gpt-6-astra")+OfficialWithoutPlan(eventWithoutPlan),new UTF8Encoding(false));
        result=Read(duplicates);
        Check(Total(result)==110 && !(bool)result["partial"],"Known official copy resolves only the identical unclassified event");
        var brokenRoot=Dir(root,"broken-independent");var brokenSessions=Dir(brokenRoot,"sessions");
        var broken=Meta("openai")+"{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{}}}\n";
        File.WriteAllText(Path.Combine(brokenSessions,"a.jsonl"),broken,new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(brokenSessions,"b.jsonl"),broken,new UTF8Encoding(false));
        result=Read(brokenRoot);
        Check(IssueCount(result,"INVALID_TOKEN_EVENT")==2,"Independent malformed logs cannot deduplicate solely by line number and missing timestamp");
        var bootstrap=Dir(root,"bootstrap");var bootstrapSessions=Dir(bootstrap,"sessions");
        var ancestorMeta=Json.Serialize(new {type="session_meta",payload=new {model_provider="openai",session_id="ancestor"}})+"\n";
        var inheritedCount=CW(100,20,30,10);
        File.WriteAllText(Path.Combine(bootstrapSessions,"ancestor.jsonl"),ancestorMeta+Model("gpt-6-astra")+E(1,30,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(bootstrapSessions,"child-unknown.jsonl"),Startup("child-unknown","ancestor")+E(2,0,inheritedCount,inheritedCount,null)+E(2,1,CW(150,30,50,20),CW(50,10,20,10),"pro"),new UTF8Encoding(false));
        result=Read(bootstrap);
        Check(Total(result)==170 && !(bool)result["partial"] && IssueCount(result,"SOURCE_UNCONFIRMED")==0,"Exact startup state is not an unknown new charge; its actual delta is still counted");
        File.WriteAllText(Path.Combine(bootstrapSessions,"child-official.jsonl"),Startup("child-official","ancestor")+E(2,2,inheritedCount,inheritedCount,"pro")+E(2,3,CW(150,30,50,20),CW(50,10,20,10),"pro"),new UTF8Encoding(false));
        result=Read(bootstrap);
        Check(Total(result)==230 && (int)result["eventCount"]==3,"Official startup state is excluded too, while independent equal-sized subagent requests both count");
        Check(Total(Read(bootstrap,"2026-09-02","2026-09-02"))==120,"Cross-day inheritance does not charge previous usage to today");
        File.WriteAllText(Path.Combine(bootstrapSessions,"empty-child.jsonl"),Startup("empty-child","ancestor")+E(2,4,inheritedCount,inheritedCount,null),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==230 && !(bool)Read(bootstrap)["partial"],"A child with only an inherited snapshot has no new consumption or missing data");
        File.WriteAllText(Path.Combine(bootstrapSessions,"no-parent.jsonl"),Startup("no-parent",null)+E(2,5,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"Coincident counters without an explicit parent are never deduplicated as inherited");
        File.Delete(Path.Combine(bootstrapSessions,"no-parent.jsonl"));
        File.WriteAllText(Path.Combine(bootstrapSessions,"no-boundary.jsonl"),Startup("no-boundary","ancestor",0)+E(2,6,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"Missing history boundary never hides a potentially real first request");
        File.Delete(Path.Combine(bootstrapSessions,"no-boundary.jsonl"));
        File.WriteAllText(Path.Combine(bootstrapSessions,"no-match.jsonl"),Startup("no-match","ancestor")+E(2,7,CW(101,20,30,10),CW(101,20,30,10),"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==341,"No exact known predecessor means an official first request stays counted");
        File.Delete(Path.Combine(bootstrapSessions,"no-match.jsonl"));
        File.WriteAllText(Path.Combine(bootstrapSessions,"unknown-no-match.jsonl"),Startup("unknown-no-match","ancestor")+E(2,8,CW(101,20,30,10),CW(101,20,30,10),null),new UTF8Encoding(false));
        result=Read(bootstrap);
        Check(Total(result)==230 && (bool)result["partial"] && IssueCount(result,"SOURCE_UNCONFIRMED")==1,"Unmatched initial state remains explicitly uncertain instead of assuming inheritance");
        File.Delete(Path.Combine(bootstrapSessions,"unknown-no-match.jsonl"));
        File.WriteAllText(Path.Combine(bootstrapSessions,"other-family.jsonl"),Startup("other-family","unrelated")+E(2,9,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"Matching counters from an unrelated family are independent consumption");
        File.Delete(Path.Combine(bootstrapSessions,"other-family.jsonl"));
        var newTask=Json.Serialize(new {type="event_msg",timestamp=Stamp(2,10),payload=new {type="task_started"}})+"\n";
        File.WriteAllText(Path.Combine(bootstrapSessions,"new-request.jsonl"),Startup("new-request","ancestor",8)+newTask+E(2,11,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"Fresh task-start evidence prevents first-request consumption from being hidden");
        File.Delete(Path.Combine(bootstrapSessions,"new-request.jsonl"));
        var aliasMeta=Startup("alias-session","ancestor").Replace("\"session_id\":\"alias-session\"", "\"id\":\"alias-thread\",\"session_id\":\"ancestor\"");
        File.WriteAllText(Path.Combine(bootstrapSessions,"session-alias.jsonl"),aliasMeta+E(2,12,inheritedCount,inheritedCount,null),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==230 && !(bool)Read(bootstrap)["partial"],"Guardian session_id may equal parent; actual child id establishes distinct thread identity");
        File.WriteAllText(Path.Combine(bootstrapSessions,"self-parent.jsonl"),Startup("ancestor","ancestor")+E(2,13,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"A self-parent reference is never inheritance evidence");
        File.Delete(Path.Combine(bootstrapSessions,"self-parent.jsonl"));
        var differentReasoning=CW(100,20,30,10);differentReasoning["reasoning_output_tokens"]=9;
        File.WriteAllText(Path.Combine(bootstrapSessions,"different-detail.jsonl"),Startup("different-detail","ancestor")+E(2,14,differentReasoning,differentReasoning,"pro"),new UTF8Encoding(false));
        Check(Total(Read(bootstrap))==340,"Every total and last counter must match, including reasoning and write-cache subsets");
        File.Delete(Path.Combine(bootstrapSessions,"different-detail.jsonl"));
        var predated=Dir(root,"bootstrap-predated");var predatedSessions=Dir(predated,"sessions");
        File.WriteAllText(Path.Combine(predatedSessions,"child.jsonl"),Startup("predated-child","ancestor")+E(2,0,inheritedCount,inheritedCount,null),new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(predatedSessions,"late-parent.jsonl"),ancestorMeta+Model("gpt-6-astra")+E(2,1,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        Check((bool)Read(predated)["partial"],"A later matching record cannot prove an earlier unknown charge was inherited");
        var dailyRoot=Dir(root,"daily");var dailySessions=Dir(dailyRoot,"sessions");var dailyFile=Path.Combine(dailySessions,"daily.jsonl");
        var dayOne=CW(100,20,30,10);var dayTwo=CW(150,30,50,20);var dayTwoLast=CW(50,10,20,10);
        var dailyText=Meta("openai")+Model("gpt-6-astra")+E(1,40,dayOne,dayOne,"pro")+Model("gpt-6.1-sol")+E(2,40,dayTwo,dayTwoLast,"pro");
        File.WriteAllText(dailyFile,dailyText,new UTF8Encoding(false));
        result=Read(dailyRoot);
        Check(Daily(result).Count==2 && Total(Day(result,"2026-09-01"))==110 && Total(Day(result,"2026-09-02"))==60,"Daily counts retain dates and per-day model breakdown");
        DailyMatches(result);
        var dailyArchive=Dir(dailyRoot,"archived_sessions");File.WriteAllText(Path.Combine(dailyArchive,"copy.jsonl"),dailyText,new UTF8Encoding(false));
        result=Read(dailyRoot);
        Check(Daily(result).Count==2 && Total(result)==170,"Daily aggregation runs after archived-copy deduplication");DailyMatches(result);
        Check(Daily(Read(dailyRoot,"2022-01-01","2026-09-02")).Count==2,"Long ranges stay sparse and never add fictitious zero-use days");
        File.Delete(Path.Combine(dailyArchive,"copy.jsonl"));
        File.WriteAllText(dailyFile,Meta("openai")+Model("gpt-6-astra")+E(1,41,dayOne,dayOne,null)+E(2,41,dayTwo,dayTwoLast,"pro"),new UTF8Encoding(false));
        result=Read(dailyRoot);
        var issueOnly=Day(result,"2026-09-01");
        Check(Total(issueOnly)==0 && (int)issueOnly["eventCount"]==0 && (bool)issueOnly["partial"] && IssueCount(issueOnly,"SOURCE_UNCONFIRMED")==1,"Issue-only date is explicitly incomplete, never a confirmed zero-consumption day");
        Check(!(bool)Day(result,"2026-09-02")["partial"] && (bool)result["partial"],"Dated source uncertainty does not contaminate a different daily bucket");DailyMatches(result);
        result=Read(dailyRoot,"2026-09-02","2026-09-02");
        Check(Daily(result).Count==1 && !(bool)result["partial"] && Total(result)==60,"Single-date boundary excludes outside issues and records");DailyMatches(result);
        var badStamp=E(1,42,dayOne,dayOne,"pro").Replace(Stamp(1,42),"invalid-timestamp");
        File.WriteAllText(dailyFile,Meta("openai")+Model("gpt-6-astra")+badStamp+E(2,42,dayTwo,dayTwoLast,"pro"),new UTF8Encoding(false));
        result=Read(dailyRoot);
        Check(Daily(result).Count==2 && (bool)Day(result,"2026-09-01")["partial"] && (bool)Day(result,"2026-09-02")["partial"] && IssueCount(Day(result,"2026-09-01"),"INVALID_TIMESTAMP")==1,"Unknown-date missing data conservatively marks every possibly affected query day");DailyMatches(result);
        File.WriteAllText(dailyFile,Meta("openai")+Model("gpt-6-astra")+E(2,43,CW(1000,200,300,100),CW(10,2,3,1),"pro"),new UTF8Encoding(false));
        result=Read(dailyRoot);
        Check(Daily(result).Count==2 && Total(Day(result,"2026-09-01"))==0 && (bool)Day(result,"2026-09-01")["partial"] && Total(Day(result,"2026-09-02"))==11 && (bool)Day(result,"2026-09-02")["partial"],"Historical baseline ambiguity populates issue-only earlier dates without assigning inherited tokens");DailyMatches(result);
        File.WriteAllText(dailyFile,Meta("openai")+Model("gpt-6-astra")+E(1,44,C(100,20,10),C(100,20,10),"pro")+E(2,44,dayTwo,dayTwoLast,"pro"),new UTF8Encoding(false));
        result=Read(dailyRoot);
        Check(!(bool)Day(result,"2026-09-01")["partial"] && IssueCount(Day(result,"2026-09-01"),"CACHE_WRITE_UNRECORDED")==1 && IssueCount(Day(result,"2026-09-02"),"CACHE_WRITE_UNRECORDED")==0,"Write-cache availability remains local to its day and does not mean missing total tokens");DailyMatches(result);
        var late=E(1,45,dayOne,dayOne,"pro").Replace(Stamp(1,45),new DateTime(2026,9,1,23,59,59,DateTimeKind.Local).ToUniversalTime().ToString("o"));
        var early=E(2,45,dayTwo,dayTwoLast,"pro").Replace(Stamp(2,45),new DateTime(2026,9,2,0,0,0,DateTimeKind.Local).ToUniversalTime().ToString("o"));
        File.WriteAllText(dailyFile,Meta("openai")+Model("gpt-6-astra")+late+early,new UTF8Encoding(false));
        Check(Total(Day(Read(dailyRoot),"2026-09-01"))==110 && Total(Day(Read(dailyRoot),"2026-09-02"))==60,"Daily boundaries use machine local dates across midnight");
        var inheritedDays=Read(bootstrap);
        Check(Total(Day(inheritedDays,"2026-09-02"))==120 && (int)Day(inheritedDays,"2026-09-02")["eventCount"]==2 && !(bool)Day(inheritedDays,"2026-09-02")["partial"],"Daily buckets retain actual independent subagent deltas while suppressing startup copies");DailyMatches(inheritedDays);
        var onlyStartup=Dir(root,"daily-startup-only");var onlyStartupSessions=Dir(onlyStartup,"sessions");
        File.WriteAllText(Path.Combine(onlyStartupSessions,"ancestor.jsonl"),ancestorMeta+Model("gpt-6-astra")+E(1,46,inheritedCount,inheritedCount,"pro"),new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(onlyStartupSessions,"child.jsonl"),Startup("only-child","ancestor")+E(2,46,inheritedCount,inheritedCount,null),new UTF8Encoding(false));
        result=Read(onlyStartup,"2026-09-02","2026-09-02");
        Check(Daily(result).Count==0 && Total(result)==0 && !(bool)result["partial"],"Inherited-only query day is omitted, with no invented consumption or warning");DailyMatches(result);
        Check(Daily(Read(empty)).Count==0,"A range without records or issues returns an empty sparse daily array");
        Check(!Json.Serialize(result).Contains(root),"Response excludes local paths");
        var recentRoot=Dir(root,"recent");var recentSessions=Dir(recentRoot,"sessions");
        var recentFile=Path.Combine(recentSessions,"events.jsonl");
        var recentNow=new DateTimeOffset(2026,9,2,0,5,0,TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026,9,2,0,5,0)));
        Func<int,long,string> recentEvent=(offset,recentCount)=>E(2,47,CW(recentCount,0,0,0),CW(recentCount,0,0,0),"pro")
            .Replace(Stamp(2,47),recentNow.AddMinutes(offset).ToString("o"));
        var recentText=Meta("openai")+Model("gpt-6-astra")+recentEvent(-181,1)+recentEvent(-180,10)+recentEvent(-61,100)+
            recentEvent(-60,1000)+recentEvent(-11,10000)+recentEvent(-10,100000)+recentEvent(-1,1000000)+recentEvent(1,10000000);
        File.WriteAllText(recentFile,recentText,new UTF8Encoding(false));
        result=LocalUsage.Read(recentRoot,"2026-09-02","2026-09-02",recentNow);
        Check(!result.ContainsKey("interval") && !result.ContainsKey("recent"),"Ordinary daily requests do not compute or return arbitrary fixed windows");
        var ordinaryTotal=Total(result);
        var intervalStart=recentNow.AddMinutes(-10).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);
        var intervalEnd=recentNow.AddMinutes(-1).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);
        result=LocalUsage.Read(recentRoot,"2026-09-02","2026-09-02",recentNow,intervalStart,intervalEnd);
        var interval=(Dictionary<string,object>)result["interval"];
        Check((string)interval["start"]==intervalStart && (string)interval["end"]==intervalEnd && Total((Dictionary<string,object>)interval["local"])==900000,"Arbitrary interval echoes JS ISO endpoints exactly and uses left-open/right-closed event boundaries");
        Check(Total(result)==ordinaryTotal,"Selecting a precise interval does not truncate the independent inclusive day range");DailyMatches(result);
        result=LocalUsage.Read(recentRoot,"2026-09-02","2026-09-02",recentNow,recentNow.AddMinutes(-17).ToString("o"),recentNow.AddMinutes(-2).ToString("o"));
        Check(Total((Dictionary<string,object>)((Dictionary<string,object>)result["interval"])["local"])==99000,"Nonpreset historical endpoints select only events inside their exact time span");
        result=LocalUsage.Read(recentRoot,"2026-09-02","2026-09-02",recentNow,recentNow.AddMinutes(-182).ToString("o"),recentNow.AddMinutes(-180).ToString("o"));
        Check(Total((Dictionary<string,object>)((Dictionary<string,object>)result["interval"])["local"])==10,"Local custom intervals can reach earlier than the old three-hour window and across local midnight");
        result=LocalUsage.Read(recentRoot,"2026-09-02","2026-09-02",recentNow,recentNow.AddMinutes(-10).AddMilliseconds(-1).ToString("o"),recentNow.AddMinutes(-1).AddMilliseconds(-1).ToString("o"));
        Check(Total((Dictionary<string,object>)((Dictionary<string,object>)result["interval"])["local"])==90000,"Subsecond endpoints preserve exact boundary selection without rounding");
        File.WriteAllText(Path.Combine(recentSessions,"copy.jsonl"),recentText,new UTF8Encoding(false));
        result=LocalUsage.Read(recentRoot,"2026-09-01","2026-09-01",recentNow,intervalStart,intervalEnd);
        interval=(Dictionary<string,object>)result["interval"];
        Check(Total((Dictionary<string,object>)interval["local"])==900000,"Interval aggregation uses shared deduplicated entries even when queried dates are historical");
        File.AppendAllText(recentFile,"{\"timestamp\":\""+recentNow.AddMinutes(-2).ToString("o")+"\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",broken}\n",new UTF8Encoding(false));
        result=LocalUsage.Read(recentRoot,"2026-09-01","2026-09-01",recentNow,intervalStart,intervalEnd);
        interval=(Dictionary<string,object>)result["interval"];
        Check((bool)((Dictionary<string,object>)interval["local"])["partial"],"Malformed interval records retain counts and mark partial coverage outside the main date selection");
        result=LocalUsage.Read(empty,"2026-09-01","2026-09-01",recentNow,intervalStart,intervalEnd);
        interval=(Dictionary<string,object>)result["interval"];
        Check(!(bool)((Dictionary<string,object>)interval["local"])["hasLogs"],"No local logs remains explicitly unavailable for a selected interval");
        foreach(var pair in new[]{new[]{intervalStart,(string)null},new[]{intervalEnd,intervalStart},new[]{intervalStart,intervalStart},
            new[]{"2026-09-01T12:00:00",intervalEnd},new[]{"2026-02-30T00:00:00Z",intervalEnd},new[]{intervalStart,recentNow.AddSeconds(1).ToString("o")}})
        {
            bool rejected=false;try{LocalUsage.Read(recentRoot,"2026-09-01","2026-09-01",recentNow,pair[0],pair[1]);}catch(ArgumentException){rejected=true;}
            Check(rejected,"Malformed, incomplete, unzoned, reverse, equal or future intervals cannot fall back to fixed windows");
        }
    }
__LOCAL_USAGE__
__STRING_VALUE__
}
'@
$harness = $harness.Replace('__LOCAL_USAGE__', $methods).Replace('__STRING_VALUE__', $strings)
Add-Type -TypeDefinition $harness -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll
$root=Join-Path ([IO.Path]::GetTempPath()) ('codex-local-usage-test-'+[Guid]::NewGuid().ToString('N'))
try {
    [LocalUsageRegressions]::Run($root)
    'Local usage regressions: 91 groups passed (cumulative, date range, identified copies, independent threads, nested fork history, missing/restored ancestors, cyclic ancestry, warm EOF, append, subsets, truncation, unknown model/provider, inherited baseline, API exclusion, malformed/oversized tails, arbitrary precise intervals, unchanged day buckets, interval validation, response privacy).'
} finally {
    $resolved=[IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('codex-local-usage-test-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
