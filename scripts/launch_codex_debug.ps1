[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-patch\CodexNativeQuotaPatch.next.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Codex Usage Card helper was not found.' }
# The native launcher resolves the current registered package and preserves any existing Codex window.
Start-Process -FilePath $helper -ArgumentList '--launch' -WorkingDirectory (Split-Path -Parent $helper) -WindowStyle Hidden
