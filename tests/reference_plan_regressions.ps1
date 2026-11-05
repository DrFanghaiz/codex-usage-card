param([string]$TestRoot = '', [switch]$VerifyAfterRestart)
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.cs')
$start = $source.IndexOf('    private static class ReferencePlans')
$end = $source.IndexOf('    private static class RecentUsage', $start)
$implementation = $source.Substring($start, $end - $start)
$harness = @'
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
public static class ReferencePlanRegressions {
__IMPLEMENTATION__
    private static string A = new string('A', 43) + "=";
    private static string B = new string('B', 43) + "=";
    private static void Check(bool condition) { if (!condition) throw new Exception("Reference-plan regression"); }
    public static void Write(string root) {
        Check(ReferencePlans.Read(root, A) == "" && ReferencePlans.Read(root, B) == "");
        ReferencePlans.Write(root, A, "pro200");
        ReferencePlans.Write(root, B, "pro100");
        Check(ReferencePlans.Read(root, A) == "pro200" && ReferencePlans.Read(root, B) == "pro100");
        try { ReferencePlans.Write(root, A, "../pro500"); throw new Exception("Invalid tier accepted"); }
        catch (ArgumentException) { }
    }
    public static void Verify(string root) {
        Check(ReferencePlans.Read(root, A) == "pro200" && ReferencePlans.Read(root, B) == "pro100");
        ReferencePlans.Write(root, A, "");
        Check(ReferencePlans.Read(root, A) == "" && ReferencePlans.Read(root, B) == "pro100");
        File.WriteAllText(Path.Combine(root, "account-reference-plans", new string('A',43) + ".txt"), "corrupt");
        Check(ReferencePlans.Read(root, A) == "" && ReferencePlans.Read(root, B) == "pro100");
    }
}
'@
Add-Type -TypeDefinition $harness.Replace('__IMPLEMENTATION__', $implementation)
if ($VerifyAfterRestart) { [ReferencePlanRegressions]::Verify($TestRoot); exit }
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('quota-reference-test-' + [Guid]::NewGuid().ToString('N'))
try {
    [ReferencePlanRegressions]::Write($TestRoot)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -TestRoot $TestRoot -VerifyAfterRestart
    if ($LASTEXITCODE -ne 0) { throw 'Restart verification failed' }
    Write-Output 'Reference plan regressions passed: restart, account isolation, invalid and cleared choices.'
} finally {
    if (Test-Path -LiteralPath $TestRoot) {
        $resolved = (Resolve-Path -LiteralPath $TestRoot).Path
        $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not ([IO.Path]::GetFileName($resolved) -match '^quota-reference-test-[a-f0-9]{32}$')) { throw 'Unsafe test cleanup path' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
