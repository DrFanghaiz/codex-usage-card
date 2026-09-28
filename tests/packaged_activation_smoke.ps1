# Windows PowerShell 5.1. Real package activation; requires an already open debug client.
param([string]$HelperPath = (Join-Path $PSScriptRoot '..\native-patch\CodexNativeQuotaPatch.next.exe'))
$ErrorActionPreference = 'Stop'
function CodexRoots {
    @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {
        $_.ExecutablePath -like '*\OpenAI.Codex_*\app\ChatGPT.exe' -and $_.CommandLine -notmatch '(?:^|\s)--type='
    })
}
$before = @(CodexRoots)
if ($before.Count -ne 1 -or $before[0].CommandLine -notmatch '--remote-debugging-port=') {
    throw 'This smoke test requires one existing debug client; it never closes or cold-starts Codex.'
}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class PackageIdentityProbe {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder name);
    public static string Read(int id) {
        using (var process = Process.GetProcessById(id)) {
            uint length = 0;
            int result = GetPackageFullName(process.Handle, ref length, null);
            if (result != 122) throw new Win32Exception(result, "GetPackageFullName size query failed: " + result);
            var name = new StringBuilder(checked((int)length));
            result = GetPackageFullName(process.Handle, ref length, name);
            if (result != 0) throw new Win32Exception(result, "GetPackageFullName failed: " + result);
            return name.ToString();
        }
    }
}
'@
$package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
$assembly = [Reflection.Assembly]::LoadFile([IO.Path]::GetFullPath($HelperPath))
$helper = $assembly.GetType('CodexNativeQuotaPatch', $true)
$flags = [Reflection.BindingFlags]'Static,NonPublic'
$appId = $helper.GetMethod('FindInstalledCodexAppId', $flags).Invoke($null, @())
$port = $helper.GetMethod('FindAvailableLoopbackPort', $flags).Invoke($null, @())
$activatedPid = $helper.GetMethod('LaunchWithDebugging', $flags).Invoke($null, @($appId, $port))
$identity = [PackageIdentityProbe]::Read([int]$activatedPid)
if ($identity -cne $package.PackageFullName) { throw 'Activation did not retain the registered package identity.' }
Start-Sleep -Seconds 1
$after = @(CodexRoots)
$preserved = @($after | Where-Object { $_.ProcessId -eq $before[0].ProcessId -and $_.CreationDate -eq $before[0].CreationDate }).Count -eq 1
if (-not $preserved) { throw 'Existing client was not preserved.' }
[pscustomobject]@{ ActivationPid=$activatedPid; AppId=$appId; PackageFullName=$identity; OriginalPid=$before[0].ProcessId; OriginalPreserved=$preserved }
