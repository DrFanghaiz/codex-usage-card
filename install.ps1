[CmdletBinding()]
param(
  [string]$SkillRoot,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard'),
  [switch]$SkipTaskRegistration
)

$ErrorActionPreference = 'Stop'
$releaseTag = 'v2.1.0'
$archiveName = 'codex-usage-card.skill.zip'
$expectedSha256 = '672883B41765CBB90EC8BA696E92D492C9CB91D7D26982F90778B46C7CC224EB'
$archiveUrl = 'https://github.com/DrFanghaiz/codex-usage-card/releases/download/{0}/{1}' -f $releaseTag, $archiveName

if ($env:OS -ne 'Windows_NT') {
  throw 'Codex Usage Card supports Windows only.'
}

$legacySkillRoot = $null
if ([String]::IsNullOrWhiteSpace($SkillRoot)) {
  $codexHome = if ([String]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'
  } else {
    $env:CODEX_HOME
  }
  $SkillRoot = Join-Path $codexHome 'skills\codex-usage-card'
  $legacySkillRoot = Join-Path $codexHome 'skills\codex-quota-card-repair'
}

$SkillRoot = [IO.Path]::GetFullPath($SkillRoot)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-usage-card-' + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $stagingRoot $archiveName
$extractRoot = Join-Path $stagingRoot 'expanded'
$backupRoot = Join-Path $SkillRoot ('backups\' + [Guid]::NewGuid().ToString('N'))
$filesChanged = $false
$installed = $false
$relativeFiles = @(
  'SKILL.md',
  'agents\openai.yaml',
  'scripts\install.ps1',
  'scripts\doctor.ps1',
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
  $sourceRoot = Join-Path $extractRoot 'codex-usage-card'
  foreach ($relativePath in $relativeFiles) {
    $sourcePath = Join-Path $sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw ('Release archive is missing: {0}' -f $relativePath)
    }
  }

  foreach ($relativePath in $relativeFiles) {
    $destinationPath = Join-Path $SkillRoot $relativePath
    if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
      $savedPath = Join-Path $backupRoot $relativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $savedPath) -Force | Out-Null
      Copy-Item -LiteralPath $destinationPath -Destination $savedPath
    }
  }
  $filesChanged = $true
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
  $installed = $true

  if ($legacySkillRoot -and (Test-Path -LiteralPath $legacySkillRoot -PathType Container)) {
    $legacyManifest = Join-Path $legacySkillRoot 'SKILL.md'
    if (Test-Path -LiteralPath $legacyManifest -PathType Leaf) {
      $legacyText = Get-Content -LiteralPath $legacyManifest -Raw
      if ($legacyText -notmatch '(?m)^name:\s*codex-quota-card-repair\s*$') {
        throw ('Legacy skill identity is unexpected: {0}' -f $legacySkillRoot)
      }
      foreach ($relativePath in $relativeFiles) {
        $legacyPath = Join-Path $legacySkillRoot $relativePath
        if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
          Remove-Item -LiteralPath $legacyPath -Force
        }
      }
      foreach ($relativeDirectory in @('assets\native-patch', 'assets', 'agents', 'scripts', '')) {
        $legacyDirectory = if ($relativeDirectory) {
          Join-Path $legacySkillRoot $relativeDirectory
        } else {
          $legacySkillRoot
        }
        if ((Test-Path -LiteralPath $legacyDirectory -PathType Container) -and
            @(Get-ChildItem -LiteralPath $legacyDirectory -Force).Count -eq 0) {
          Remove-Item -LiteralPath $legacyDirectory -Force
        }
      }
    }
  }
} catch {
  $installFailure = $_
  if ($filesChanged -and -not $installed) {
    try {
      foreach ($relativePath in $relativeFiles) {
        $savedPath = Join-Path $backupRoot $relativePath
        $destinationPath = Join-Path $SkillRoot $relativePath
        if (Test-Path -LiteralPath $savedPath -PathType Leaf) {
          Copy-Item -LiteralPath $savedPath -Destination $destinationPath -Force
        } elseif (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
          Remove-Item -LiteralPath $destinationPath -Force
        }
      }
    } catch {
      throw ('Installation failed: {0}. Skill rollback also failed: {1}. Backup retained at {2}' -f $installFailure, $_, $backupRoot)
    }
  }
  throw $installFailure
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
