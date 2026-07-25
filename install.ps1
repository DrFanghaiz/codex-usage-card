[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexBar'),
  [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'
$releaseTag = 'v1.0.0'
$archiveName = 'codex-quota-card-repair.skill.zip'
$expectedSha256 = 'DF50B2AB4BC9A19CD96EC3B5C1432D0AE0EA723CA06F13E82059C51FF4903A3C'
$archiveUrl = 'https://github.com/DrFanghaiz/Codex-bar/releases/download/{0}/{1}' -f $releaseTag, $archiveName

if ($env:OS -ne 'Windows_NT') {
  throw 'Codex Bar supports Windows only.'
}

if ([String]::IsNullOrWhiteSpace($SkillRoot)) {
  $codexHome = if ([String]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'
  } else {
    $env:CODEX_HOME
  }
  $SkillRoot = Join-Path $codexHome 'skills\codex-quota-card-repair'
}

$SkillRoot = [IO.Path]::GetFullPath($SkillRoot)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-bar-' + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $stagingRoot $archiveName
$extractRoot = Join-Path $stagingRoot 'expanded'
$relativeFiles = @(
  'SKILL.md',
  'agents\openai.yaml',
  'scripts\install.ps1',
  'scripts\uninstall.ps1',
  'assets\native-patch\CodexNativeQuotaPatch.cs',
  'assets\native-patch\CodexNativeQuotaPatch.next.exe',
  'assets\native-patch\native_patch.js'
)

try {
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath

  $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if (-not [String]::Equals($actualSha256, $expectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('Release archive hash mismatch. Expected {0}, received {1}.' -f $expectedSha256, $actualSha256)
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
  $sourceRoot = Join-Path $extractRoot 'codex-quota-card-repair'
  foreach ($relativePath in $relativeFiles) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw ('Release archive is missing: {0}' -f $relativePath)
    }
  }

  foreach ($relativePath in $relativeFiles) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    $destinationPath = Join-Path $SkillRoot $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Unblock-File -LiteralPath $sourcePath
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }

  & (Join-Path $SkillRoot 'scripts\install.ps1') `
    -InstallRoot $InstallRoot `
    -SkipTaskRegistration:$SkipTaskRegistration
} finally {
  if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
    if (-not $resolvedStaging.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove a staging directory outside the system temp directory.'
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
