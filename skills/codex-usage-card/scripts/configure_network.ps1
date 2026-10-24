[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard'),
  [Parameter(Mandatory=$true)][ValidateSet('System', 'Proxy')][string]$Mode,
  [string]$ProxyUri
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Codex Usage Card supports Windows only.' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$directory = Join-Path $InstallRoot 'native-patch'
if (-not (Test-Path -LiteralPath (Join-Path $directory 'CodexNativeQuotaPatch.next.exe') -PathType Leaf)) {
  throw 'The requested Codex Usage Card installation was not found.'
}
$settings = [ordered]@{version=1; mode=$Mode.ToLowerInvariant(); source='explicit'}
$endpoint = $null
if ($Mode -eq 'Proxy') {
  $uri = $null
  if ([String]::IsNullOrWhiteSpace($ProxyUri) -or -not [Uri]::TryCreate($ProxyUri, [UriKind]::Absolute, [ref]$uri) -or
      $uri.Scheme -ne 'http' -or -not $uri.Host -or $uri.Port -le 0 -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) {
    throw 'Specify an http:// proxy URI without a path, query or fragment. HTTPS destinations still use an encrypted CONNECT tunnel.'
  }
  Add-Type -AssemblyName System.Security
  $plain = [Text.Encoding]::UTF8.GetBytes($ProxyUri)
  try {
    $settings.proxyProtected = [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
  } finally { [Array]::Clear($plain, 0, $plain.Length) }
  $endpoint = '{0}://{1}:{2}' -f $uri.Scheme, $uri.DnsSafeHost, $uri.Port
  if ($uri.HostNameType -eq [UriHostNameType]::IPv6) { $endpoint = '{0}://[{1}]:{2}' -f $uri.Scheme, $uri.DnsSafeHost.Trim('[',']'), $uri.Port }
} elseif ($PSBoundParameters.ContainsKey('ProxyUri')) {
  throw 'System mode does not accept a proxy URI.'
}
$path = Join-Path $directory 'network-settings.json'
$temporary = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
$backup = $null
try {
  [IO.File]::WriteAllText($temporary, ($settings | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  if ([IO.File]::Exists($path)) {
    $backupDirectory = Join-Path $InstallRoot ('backups\network-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($backupDirectory)
    $backup = Join-Path $backupDirectory 'network-settings.json'
    [IO.File]::Replace($temporary, $path, $backup)
  } else {
    [IO.File]::Move($temporary, $path)
  }
} finally {
  if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
[pscustomobject]@{
  NetworkMode = $settings.mode
  ProxySource = $settings.source
  ProxyEndpoint = $endpoint
  AppliesOn = 'Next quota request (existing retry limits remain in effect)'
  BackupPath = $backup
}
