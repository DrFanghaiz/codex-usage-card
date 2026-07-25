param(
  [int]$Port = 9222
)

$packageRoots = Get-ChildItem -LiteralPath 'C:\Program Files\WindowsApps' -Directory -Filter 'OpenAI.Codex_*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending
$root = $null
foreach ($candidate in $packageRoots) {
  $manifestPath = Join-Path $candidate.FullName 'AppxManifest.xml'
  $exePath = Join-Path $candidate.FullName 'app\ChatGPT.exe'
  if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $exePath)) { continue }
  try { [xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath } catch { continue }
  if ($manifest.Package.Identity.Name -eq 'OpenAI.Codex') { $root = $candidate.FullName; break }
}
if (-not $root) { throw 'OpenAI.Codex package was not found' }

$exe = Join-Path $root 'app\ChatGPT.exe'
$running = Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
if ($running) { throw 'Close the current Codex window before using the debug launcher' }

$process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList "--remote-debugging-port=$Port" -PassThru
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    Write-Output "Codex debug port ready: $Port"
    exit 0
  }
}
if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
throw "Codex did not open debug port $Port; page injection is unavailable for this launch"
