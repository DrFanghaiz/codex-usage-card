# Synthetic durable-history fixtures only; no login data, real accounts or production HTTP.
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static class RecentUsage')
$end = $source.IndexOf('    private static Dictionary<string, object> ReadQuotaResponse', $start)
$recent = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static string StringValue(')
$end = $source.IndexOf('    private static CdpTarget TargetFromEvent(', $start)
$strings = $source.Substring($start, $end - $start)
$start = $source.IndexOf('    private static bool NumberValue(')
$end = $source.IndexOf('    private static bool BooleanValue(', $start)
$numbers = $source.Substring($start, $end - $start)
$harness = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
public static class RecentUsageRegressions
{
    private static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static DateTimeOffset Now = new DateTimeOffset(2026,10,29,12,0,0,TimeSpan.Zero);
    private static double Reset = (Now.AddDays(2)-new DateTimeOffset(1970,1,1,0,0,0,TimeSpan.Zero)).TotalSeconds;
    private static string Root;
    private static int Groups;
    private static void Check(bool ok,string text) { if(!ok)throw new Exception(text); }
    private static void Pass(string text) { Groups++;Console.WriteLine("PASS "+text); }
    private static string Key(string account) { using(var hash=SHA256.Create())return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(account))); }
    private static string Folder(string account) { return Path.Combine(Root,"account-usage-history",Key(account).Replace('+','-').Replace('/','_').TrimEnd('=')); }
    private static string Day(string account,DateTimeOffset at) { return Path.Combine(Folder(account),at.UtcDateTime.ToString("yyyy-MM-dd")+".jsonl"); }
    private static void Sample(string account,string scope,DateTimeOffset at,double used,double reset) {
        RecentUsage.Record(Root,Key(account),scope,new Dictionary<string,object>{{"windows",new List<object>{new Dictionary<string,object>{{"label","Weekly"},{"usedPercent",used},{"resetAt",reset}}}}},at);
    }
    private static void S(string account,int minutes,double used) {Sample(account,account+"-session",Now.AddMinutes(minutes),used,Reset);}
    private static Dictionary<string,object> Read(string account,DateTimeOffset from,DateTimeOffset to) {return RecentUsage.Read(Root,Key(account),from,to);}
    public static void Main(string[] args) {try{Root=args[0];if(args.Length>1)Restart(args[1]);else Run();}catch(Exception error){Console.WriteLine(error.GetType().Name+": "+error.Message);Environment.ExitCode=1;}}
    private static void Restart(string phase) {
        if(phase=="seed") {S("restart",-300,10);S("restart",0,14);S("cold-locked",-10,1);Check(File.Exists(Day("restart",Now)),"Seed is durable");Console.WriteLine("PASS separate-process seed");return;}
        var saved=Read("restart",Now.AddMinutes(-300),Now);Check((double)saved["usedPercent"]==4 && (string)saved["status"]=="ok","Fresh process restores more than four hours without credentials/network");
        Sample("restart","new-helper-session",Now.AddMinutes(1),15,Reset);
        var across=Read("restart",Now.AddMinutes(-300),Now.AddMinutes(1));Check((double)across["usedPercent"]==5 && (bool)across["hasGaps"] && (string)across["status"]=="partial","Restart boundary is explicitly incomplete");
        var coldPath=Day("cold-locked",Now);var original=File.ReadAllBytes(coldPath);
        using(var held=new FileStream(coldPath,FileMode.Open,FileAccess.Read,FileShare.Write)) {
            S("cold-locked",0,2);
            Check(held.Length==original.Length,"Failed first tail read must not append or initialize an unknown tail");
        }
        S("cold-locked",-20,99);Check(File.ReadAllBytes(coldPath).Length==original.Length,"Retry must reload the durable tail before rejecting an older timestamp");
        S("cold-locked",1,3);var recovered=Read("cold-locked",Now.AddMinutes(-10),Now.AddMinutes(1));
        Check((double)recovered["usedPercent"]==2 && (bool)recovered["hasGaps"] && recovered["historyError"]==null,"Unlocked cold tail must be read again before appending");
        Console.WriteLine("PASS separate-process restore and append without truncation");
        Console.WriteLine("PASS cold tail read failure retries after a real share lock is released");
    }
    public static void Run() {
        var unknown=Read("empty",Now.AddDays(-1),Now);Check(unknown["usedPercent"]==null && (string)unknown["status"]=="insufficient_history" && !Directory.Exists(Folder("empty")),"Unknown stays unknown and reads do not create history");Pass("empty history is read-only and unavailable");
        S("a",-180,1);S("a",-60,3);S("a",-10,5);S("a",0,6);
        var a=Read("a",Now.AddMinutes(-60),Now.AddMinutes(-10));Check((double)a["usedPercent"]==2 && (bool)a["fullWindow"],"Exact selected endpoints");Pass("precise arbitrary historical endpoints");
        S("b",-60,30);S("b",-10,40);Check((double)Read("b",Now.AddMinutes(-60),Now.AddMinutes(-10))["usedPercent"]==10 && (double)Read("a",Now.AddMinutes(-60),Now.AddMinutes(-10))["usedPercent"]==2,"Stable account isolation");Pass("account A/B separation and return to A");
        Sample("a","a-returned",Now.AddMinutes(1),7,Reset);var returned=Read("a",Now.AddMinutes(-10),Now.AddMinutes(1));Check((double)returned["usedPercent"]==2 && (bool)returned["hasGaps"] && !(bool)returned["fullWindow"],"Account return marks gap");Pass("account-switch continuity is not invented");
        S("old",-900,1);S("old",0,3);Check((double)Read("old",Now.AddMinutes(-900),Now)["usedPercent"]==2,"No four-hour pruning");Pass("history older than four hours retained");
        var dayStart=Now.AddDays(-5);Sample("days","days-session",dayStart,1,Reset);Sample("days","days-session",dayStart.AddDays(1),4,Reset);Sample("days","days-session",dayStart.AddDays(2),8,Reset);
        Check((double)Read("days",dayStart.AddDays(1),dayStart.AddDays(2))["usedPercent"]==4,"Multi-day range");Pass("daily partitions and multi-day selected history");
        var offsetStart=new DateTimeOffset(2026,10,29,7,59,0,TimeSpan.FromHours(8));var offsetEnd=offsetStart.AddMinutes(2);
        Sample("timezone","timezone-session",offsetStart,1,Reset);Sample("timezone","timezone-session",offsetEnd,2,Reset);
        Check((double)Read("timezone",offsetStart.ToUniversalTime(),offsetEnd.ToUniversalTime())["usedPercent"]==1 && Directory.GetFiles(Folder("timezone"),"*.jsonl").Length==2,"Offset timestamps use UTC file dates while retaining exact instants");Pass("local timezone intervals cross UTC partitions correctly");
        S("partial",-9,30);S("partial",0,32);var p=Read("partial",Now.AddMinutes(-13),Now);Check((double)p["usedPercent"]==2 && (string)p["status"]=="partial" && (double)p["coveredSeconds"]==540,"Partial endpoints");Pass("partial coverage exposes actual sample interval");
        S("outside",-12,30);S("outside",-2,32);var outside=Read("outside",Now.AddMinutes(-10),Now);Check(outside["usedPercent"]==null && outside["coverageStartAt"]!=null,"Outside samples excluded");Pass("no borrowing samples outside selected bounds");
        Sample("reset","reset-session",Now.AddMinutes(-10),95,Reset);Sample("reset","reset-session",Now,2,Reset+604800);
        Check((string)Read("reset",Now.AddMinutes(-10),Now)["status"]=="reset" && Read("reset",Now.AddMinutes(-10),Now)["usedPercent"]==null,"No cross reset subtraction");Pass("cross-reset intervals remain unknown");
        var epoch=new DateTimeOffset(1970,1,1,0,0,0,TimeSpan.Zero);var boundary=(Now.AddMinutes(-5)-epoch).TotalSeconds;
        Sample("cross","cross-session",Now.AddMinutes(-20),10,boundary);Sample("cross","cross-session",Now.AddMinutes(-10),14,boundary);
        Sample("cross","cross-session",Now.AddMinutes(-4),2,boundary+604800);Sample("cross","cross-session",Now,6,boundary+604800);
        var cross=Read("cross",Now.AddMinutes(-20),Now);var crossSegments=(List<Dictionary<string,object>>)cross["segments"];
        Check((double)cross["usedPercent"]==8 && (string)cross["status"]=="partial" && (bool)cross["crossReset"] && !(bool)cross["fullWindow"] && crossSegments.Count==2,"Only measured within-cycle changes are summed");
        Check((double)cross["coveredSeconds"]==840 && (string)cross["sampledStartAt"]==Now.AddMinutes(-20).ToString("o") && (string)cross["sampledEndAt"]==Now.ToString("o"),"Disjoint sampled durations exclude the reset gap");Pass("cross-reset observed segments do not invent boundary consumption");
        var clipped=Read("cross",Now.AddMinutes(-15),Now);Check((double)clipped["usedPercent"]==4 && ((List<Dictionary<string,object>>)clipped["segments"]).Count==1 && (string)clipped["sampledStartAt"]==Now.AddMinutes(-4).ToString("o"),"A selected interval cannot borrow an earlier sample");Pass("cross-reset segments respect the selected range");
        Sample("cross-singles","cross-singles-session",Now.AddMinutes(-10),95,boundary);Sample("cross-singles","cross-singles-session",Now.AddMinutes(-4),2,boundary+604800);
        var singles=Read("cross-singles",Now.AddMinutes(-10),Now);Check((bool)singles["crossReset"] && singles["usedPercent"]==null && (string)singles["status"]=="reset","One sample per cycle is not a zero measurement");Pass("single samples across a reset remain unavailable");
        Sample("cross-gap","cross-gap-session",Now.AddMinutes(-20),10,boundary);RecentUsage.Break("cross-gap-session");Sample("cross-gap","cross-gap-session",Now.AddMinutes(-10),14,boundary);
        Sample("cross-gap","cross-gap-session",Now.AddMinutes(-4),2,boundary+604800);Sample("cross-gap","cross-gap-session",Now,6,boundary+604800);
        var crossGap=Read("cross-gap",Now.AddMinutes(-20),Now);Check((double)crossGap["usedPercent"]==8 && (bool)crossGap["hasGaps"] && (string)crossGap["status"]=="partial","Request interruptions remain visible across reset");Pass("cross-reset sampling interruptions remain explicit");
        Sample("cross-zero","cross-zero-session",Now.AddMinutes(-20),80,boundary);Sample("cross-zero","cross-zero-session",Now.AddMinutes(-10),80,boundary);
        Sample("cross-zero","cross-zero-session",Now.AddMinutes(-4),2,boundary+604800);Sample("cross-zero","cross-zero-session",Now,2,boundary+604800);
        Check((double)Read("cross-zero",Now.AddMinutes(-20),Now)["usedPercent"]==0,"Observed zero across cycles is distinct from missing samples");Pass("cross-reset measured zero");
        Sample("one-pair","one-pair-session",Now.AddMinutes(-20),7,boundary);Sample("one-pair","one-pair-session",Now.AddMinutes(-4),2,boundary+604800);Sample("one-pair","one-pair-session",Now,6,boundary+604800);
        var onePair=Read("one-pair",Now.AddMinutes(-20),Now);Check((double)onePair["usedPercent"]==4 && ((List<Dictionary<string,object>>)onePair["segments"]).Count==1 && (string)onePair["sampledStartAt"]==Now.AddMinutes(-4).ToString("o"),"Single-point cycles are not counted as measured coverage");Pass("unpaired cycle remains uncovered");
        var boundary1=(Now.AddMinutes(-15)-epoch).TotalSeconds;var boundary2=(Now.AddMinutes(-5)-epoch).TotalSeconds;
        Sample("multiple","multiple-session",Now.AddMinutes(-25),10,boundary1);Sample("multiple","multiple-session",Now.AddMinutes(-20),95,boundary1);
        Sample("multiple","multiple-session",Now.AddMinutes(-14),2,boundary2);Sample("multiple","multiple-session",Now.AddMinutes(-10),90,boundary2);
        Sample("multiple","multiple-session",Now.AddMinutes(-4),1,boundary2+604800);Sample("multiple","multiple-session",Now,5,boundary2+604800);
        var multiple=Read("multiple",Now.AddMinutes(-25),Now);Check((double)multiple["usedPercent"]==177 && ((List<Dictionary<string,object>>)multiple["segments"]).Count==3,"Cross-cycle percentage points may exceed 100");Pass("multiple cycles and values over 100");
        Sample("shift","shift-session",Now.AddMinutes(-20),3,Reset);Sample("shift","shift-session",Now.AddMinutes(-10),6,Reset);
        Sample("shift","shift-session",Now.AddMinutes(-4),8,Reset+30);Sample("shift","shift-session",Now,10,Reset+30);
        var shifted=Read("shift",Now.AddMinutes(-20),Now);Check((double)shifted["usedPercent"]==5 && (bool)shifted["resetAdjusted"],"An early change of reset time is not declared a confirmed reset");Pass("reset-time adjustment is reported separately");
        Sample("shift-down","shift-down-session",Now.AddMinutes(-20),80,Reset);Sample("shift-down","shift-down-session",Now.AddMinutes(-10),90,Reset);
        Sample("shift-down","shift-down-session",Now.AddMinutes(-4),2,Reset+30);Sample("shift-down","shift-down-session",Now,6,Reset+30);
        var shiftDown=Read("shift-down",Now.AddMinutes(-20),Now);Check(shiftDown["usedPercent"]==null && (string)shiftDown["status"]=="reset" && ((List<Dictionary<string,object>>)shiftDown["segments"]).Count==2,"A decrease before the previous reset may be a correction; retain individual measured segments without a total");Pass("ambiguous early decrease exposes segments without combining them");
        Sample("cross-correction","cross-correction-session",Now.AddMinutes(-20),80,boundary);Sample("cross-correction","cross-correction-session",Now.AddMinutes(-10),90,boundary);
        Sample("cross-correction","cross-correction-session",Now.AddMinutes(-4),5,boundary+604800);Sample("cross-correction","cross-correction-session",Now.AddMinutes(-2),4,boundary+604800);
        Check((string)Read("cross-correction",Now.AddMinutes(-20),Now)["status"]=="counter_decreased" && Read("cross-correction",Now.AddMinutes(-20),Now)["usedPercent"]==null,"Corrections inside a cycle cannot be summed");Pass("cross-reset correction is not counted as consumption");
        S("rollback",-10,80);S("rollback",-5,90);S("rollback",0,85);Check((string)Read("rollback",Now.AddMinutes(-10),Now)["status"]=="counter_decreased","Intermediate correction");Pass("counter corrections remain unknown");
        S("zero",-10,10);S("zero",0,10);Check((double)Read("zero",Now.AddMinutes(-10),Now)["usedPercent"]==0,"Real zero");Pass("measured zero remains distinct from missing data");
        S("failure",-10,1);RecentUsage.Break("failure-session");S("failure",0,2);var gap=Read("failure",Now.AddMinutes(-10),Now);Check((double)gap["usedPercent"]==1 && (bool)gap["hasGaps"] && (string)gap["status"]=="partial","Failure interrupts segment");Pass("request failures create visible sampling gaps without extra requests");
        S("ordered",-10,1);S("ordered",0,2);S("ordered",-5,80);Check((double)Read("ordered",Now.AddMinutes(-10),Now)["usedPercent"]==1,"Old response cannot append out of order");Pass("out-of-order samples do not corrupt append history");
        var before=File.ReadAllBytes(Day("a",Now));for(int i=0;i<8;i++)Read("a",Now.AddMinutes(-60),Now);Check(Convert.ToBase64String(before)==Convert.ToBase64String(File.ReadAllBytes(Day("a",Now))),"Read must not append");
        var json=File.ReadAllText(Day("a",Now));Check(!json.Contains(Key("a")) && !json.Contains("account_id") && !json.Contains("token") && !json.Contains("AccountId"),"Only allowlisted sample fields are persisted");Pass("read-only queries and private allowlisted records");
        S("corrupt",-10,1);File.AppendAllText(Day("corrupt",Now),"{broken}\n",new UTF8Encoding(false));S("corrupt",0,2);
        var corrupt=Read("corrupt",Now.AddMinutes(-10),Now);Check(corrupt["usedPercent"]==null && (string)corrupt["status"]=="unavailable" && (string)corrupt["historyError"]=="HISTORY_CORRUPT","Corrupt data cannot silently disappear");Pass("corrupt selected data is reported without fabricated totals");
        S("torn",-10,1);var prefix=File.ReadAllText(Day("torn",Now));File.AppendAllText(Day("torn",Now),"{partial",new UTF8Encoding(false));S("torn",0,2);
        var torn=File.ReadAllText(Day("torn",Now));Check(torn.StartsWith(prefix+"{partial\n") && torn.Contains("\"used\":2") && torn.EndsWith("\n"),"Append must preserve earlier bytes and separate torn tail");
        Check((string)Read("torn",Now.AddMinutes(-10),Now)["historyError"]=="HISTORY_CORRUPT","Torn record remains explicit");Pass("torn final records preserve old data and do not destroy the next append");
        S("locked",-10,1);S("locked",0,2);using(var held=new FileStream(Day("locked",Now),FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
            var locked=Read("locked",Now.AddMinutes(-10),Now);Check((string)locked["historyError"]=="HISTORY_READ_FAILED" && locked["usedPercent"]==null,"Unreadable selected history");
        }Check((double)Read("locked",Now.AddMinutes(-10),Now)["usedPercent"]==1,"Read can recover after file unlock");Pass("read failures remain explicit and recoverable");
        Directory.CreateDirectory(Day("write",Now));S("write",-1,1);var write=Read("write",Now.AddMinutes(-10),Now);Check((string)write["historyError"]=="HISTORY_WRITE_FAILED" && (string)write["status"]=="unavailable","Storage failure cannot be fake success");
        Check(Read("other",Now.AddMinutes(-10),Now)["historyError"]==null,"A's write failure cannot contaminate B");
        Directory.Delete(Day("write",Now));S("write",0,2);S("write",1,3);Check(Read("write",Now,Now.AddMinutes(1))["historyError"]==null,"Successful append recovers write state");Pass("write failures do not break official data or leak across accounts");
        var oldest=Now.AddDays(-8);var selected=Now.AddDays(-4);var newest=Now.AddDays(-1);
        Sample("seek","seek-session",oldest,1,Reset);Sample("seek","seek-session",selected,3,Reset);Sample("seek","seek-session",selected.AddMinutes(2),4,Reset);Sample("seek","seek-session",newest,5,Reset);
        File.WriteAllText(Day("seek",Now.AddDays(-6)),"unrelated corrupt history\n",new UTF8Encoding(false));
        Check((double)Read("seek",selected,selected.AddMinutes(2))["usedPercent"]==1 && Read("seek",selected,selected.AddMinutes(2))["historyError"]==null,"Unselected interior date is not read");Pass("queries read selected dates and necessary edge files only");
        Console.WriteLine("Durable account history regressions: "+Groups+" groups passed.");
    }
__RECENT__
__STRINGS__
__NUMBERS__
}
'@
$harness = $harness.Replace('__RECENT__',$recent).Replace('__STRINGS__',$strings).Replace('__NUMBERS__',$numbers)
$root = Join-Path (Join-Path $PSScriptRoot '..\.runtime-test') ('account-history-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$code = Join-Path $root 'history.cs'
$exe = Join-Path $root 'history.exe'
[IO.File]::WriteAllText($code,$harness,(New-Object Text.UTF8Encoding $false))
& 'D:\VSTUDIO\MSBuild\Current\Bin\Roslyn\csc.exe' /nologo /codepage:65001 /target:exe "/out:$exe" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll $code
if($LASTEXITCODE -ne 0){throw 'Account history harness failed to compile'}
& $exe $root seed
if($LASTEXITCODE -ne 0){throw 'Account history seed failed'}
& $exe $root restore
if($LASTEXITCODE -ne 0){throw 'Account history fresh-process restore failed'}
& $exe $root
if($LASTEXITCODE -ne 0){throw 'Account history regressions failed'}
