param(
  [int]$Port = 0,
  [switch]$Watch,
  [double]$Interval = 2.0,
  [switch]$Wait,
  [double]$Timeout = 120.0,
  [string]$Python = 'python',
  [string]$Helper = ''
)

$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
  if ($Watch) {
    if (-not $Helper) {
      $Helper = Join-Path $project 'native-patch\CodexNativeQuotaPatch.next.exe'
    }
    if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) {
      throw "Native helper was not found: $Helper"
    }
    & $Helper
    exit $LASTEXITCODE
  }

  $arguments = @('-m', 'codex_quota.repair')
  if ($Port -ne 0) {
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be 0 (auto) or between 1 and 65535' }
    $arguments += @('--port', "$Port")
  }
  if ($Wait) {
    if ($Timeout -le 0 -or $Interval -le 0) { throw 'Timeout and Interval must be positive' }
    $arguments += @('--wait', '--timeout', "$Timeout", '--interval', "$Interval")
  } else {
    $arguments += '--repair'
  }
  & $Python @arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
