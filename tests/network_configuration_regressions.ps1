# Isolated configuration files only; no real installation, proxy, network request or task is used.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $workspace ('.runtime-test\network-configuration-' + [Guid]::NewGuid().ToString('N'))
$runtime = Join-Path $testRoot 'native-patch'
[void][IO.Directory]::CreateDirectory($runtime)
[IO.File]::WriteAllBytes((Join-Path $runtime 'CodexNativeQuotaPatch.next.exe'), [byte[]]@(0))
$configure = Join-Path $workspace 'scripts\configure_network.ps1'
$config = Join-Path $runtime 'network-settings.json'
$passed = 0
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action) {
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $true }
  Assert $failed 'An invalid configuration was accepted.'
}
function Config-Text { [IO.File]::ReadAllText($config) }

$result = & $configure -InstallRoot $testRoot -Mode System
$systemText = Config-Text
$settings = $systemText | ConvertFrom-Json
Assert ($settings.version -eq 1 -and $settings.mode -ceq 'system' -and $settings.source -ceq 'explicit') 'System mode was not saved explicitly.'
Assert (-not $settings.PSObject.Properties['proxyProtected']) 'System mode retained proxy data.'
Assert ($result.NetworkMode -ceq 'system' -and $result.ProxySource -ceq 'explicit' -and -not $result.ProxyEndpoint -and -not $result.BackupPath) 'Fresh system configuration returned incorrect metadata.'
$passed++

$fixtureUri = 'http://fixture-user:fixture-password@127.0.0.1:61823'
$result = & $configure -InstallRoot $testRoot -Mode Proxy -ProxyUri $fixtureUri
$proxyText = Config-Text
$settings = $proxyText | ConvertFrom-Json
Assert ($settings.mode -ceq 'proxy' -and $settings.source -ceq 'explicit' -and $settings.proxyProtected) 'Proxy mode was not saved explicitly.'
Add-Type -AssemblyName System.Security
$decrypted = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($settings.proxyProtected), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try { Assert ([Text.Encoding]::UTF8.GetString($decrypted) -ceq $fixtureUri) 'Encrypted proxy did not round-trip under the current user.' }
finally { [Array]::Clear($decrypted, 0, $decrypted.Length) }
$outputText = $result | ConvertTo-Json -Compress
Assert ($result.ProxyEndpoint -ceq 'http://127.0.0.1:61823') 'Proxy endpoint was not redacted.'
Assert ($proxyText -notmatch 'fixture-user|fixture-password|127\.0\.0\.1' -and $outputText -notmatch 'fixture-user|fixture-password') 'Proxy credentials escaped encrypted storage or redacted output.'
Assert ($result.BackupPath -and [IO.File]::ReadAllText($result.BackupPath) -ceq $systemText) 'Overwriting configuration did not preserve the previous file.'
$passed++

foreach ($invalid in @('', 'not-a-uri', 'socks5://localhost:1080', 'https://localhost:8443', 'http://localhost:0', 'http://localhost:8080/path', 'http://localhost:8080/?key=value', 'http://localhost:8080/#fragment')) {
  Expect-Failure { & $configure -InstallRoot $testRoot -Mode Proxy -ProxyUri $invalid }
  Assert ((Config-Text) -ceq $proxyText) 'Rejected proxy configuration changed the existing file.'
  $passed++
}
Expect-Failure { & $configure -InstallRoot $testRoot -Mode System -ProxyUri $fixtureUri }
Assert ((Config-Text) -ceq $proxyText) 'Rejected System/ProxyUri combination changed the existing file.'
$passed++

$result = & $configure -InstallRoot $testRoot -Mode Proxy -ProxyUri 'http://[::1]:61823'
$ipv6Endpoint = [Uri]$result.ProxyEndpoint
Assert ($ipv6Endpoint.IsLoopback -and $ipv6Endpoint.Port -eq 61823 -and $result.ProxyEndpoint -cmatch '\Ahttp://\[[0-9a-f:]+\]:61823\z') 'IPv6 proxy endpoint lost its brackets or port.'
Assert ([IO.File]::ReadAllText($result.BackupPath) -ceq $proxyText) 'Proxy update did not back up the prior encrypted configuration.'
$passed++

$previousText = Config-Text
$result = & $configure -InstallRoot $testRoot -Mode System
$settings = (Config-Text) | ConvertFrom-Json
Assert ($settings.mode -ceq 'system' -and -not $settings.PSObject.Properties['proxyProtected'] -and -not $result.ProxyEndpoint) 'Switching back to system mode retained proxy configuration.'
Assert ([IO.File]::ReadAllText($result.BackupPath) -ceq $previousText) 'Switching to system mode lost the prior configuration.'
Assert (@(Get-ChildItem -LiteralPath $runtime -Filter '*.tmp' -File).Count -eq 0) 'Configuration writes left temporary files behind.'
$passed++

$missingInstall = Join-Path $testRoot 'not-installed'
Expect-Failure { & $configure -InstallRoot $missingInstall -Mode System }
Assert (-not (Test-Path -LiteralPath $missingInstall)) 'Missing installation was mutated.'
$passed++

$skillConfigure = Join-Path $workspace 'skills\codex-usage-card\scripts\configure_network.ps1'
Assert ((Get-FileHash -LiteralPath $configure).Hash -ceq (Get-FileHash -LiteralPath $skillConfigure).Hash) 'Developer and packaged configuration scripts differ.'
$passed++
Write-Output ('PASS: {0} network configuration regression groups (PowerShell {1}).' -f $passed, $PSVersionTable.PSVersion)
