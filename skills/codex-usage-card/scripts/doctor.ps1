[CmdletBinding()]
param(
  [string]$TaskName = 'Codex Usage Card',
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexUsageCard')
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'Codex Usage Card supports Windows only.'
}

Add-Type -AssemblyName System.Net.Http

$jsonReadOptions = @{}
if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
  $jsonReadOptions.DateKind = 'String'
}

function Select-NetworkDiagnosis($Current, $Candidate) {
  $sources = @('default', 'explicit', 'legacy-process-https', 'legacy-user-https', 'legacy-process-http', 'legacy-user-http', 'legacy-file', 'legacy-default', 'unknown')
  $errors = @('NETWORK_CONFIG_INVALID', 'NETWORK_CONFIG_UNREADABLE', 'PROXY_CONNECTION_FAILED', 'PROXY_AUTH_REQUIRED', 'CONNECTION_FAILED', 'DNS_FAILED', 'TLS_FAILED', 'ACCESS_DENIED', 'REQUEST_TIMEOUT', 'AUTH_REQUIRED', 'RATE_LIMITED', 'NETWORK_ERROR', 'INVALID_RESPONSE')
  if ($null -eq $Candidate -or $Candidate.NetworkMode -isnot [string] -or @('system', 'proxy', 'unknown') -cnotcontains $Candidate.NetworkMode -or
      $Candidate.ProxySource -isnot [string] -or $sources -cnotcontains $Candidate.ProxySource -or
      ($null -ne $Candidate.LastRequestError -and ($Candidate.LastRequestError -isnot [string] -or $errors -cnotcontains $Candidate.LastRequestError)) -or
      $Candidate.NetworkCheckedAt -isnot [string] -or
      $Candidate.NetworkCheckedAt -cnotmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$') { return $Current }
  $checkedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($Candidate.NetworkCheckedAt, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None, [ref]$checkedAt)) { return $Current }
  $endpoint = $null
  if ($Candidate.NetworkMode -ceq 'proxy') {
    if ($Candidate.PSObject.Properties.Name -cnotcontains 'ProxyEndpoint') { return $Current }
    if ($null -ne $Candidate.ProxyEndpoint) {
      $endpointUri = $null
      if ($Candidate.ProxyEndpoint -isnot [string] -or
          -not [Uri]::TryCreate($Candidate.ProxyEndpoint, [UriKind]::Absolute, [ref]$endpointUri) -or
          $endpointUri.Scheme -cne 'http' -or [string]::IsNullOrEmpty($endpointUri.Host)) { return $Current }
      $endpoint = '{0}://{1}:{2}' -f $endpointUri.Scheme, $endpointUri.Host, $endpointUri.Port
    }
  }
  if ($Current.NetworkCheckedAt -and $checkedAt -le [DateTimeOffset]::Parse($Current.NetworkCheckedAt, [Globalization.CultureInfo]::InvariantCulture)) { return $Current }
  [pscustomobject]@{
    NetworkMode = $Candidate.NetworkMode
    ProxySource = $Candidate.ProxySource
    ProxyEndpoint = $endpoint
    LastRequestError = $Candidate.LastRequestError
    NetworkCheckedAt = $checkedAt.UtcDateTime.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
  }
}

function Test-StartupPromptWindow([int]$ProcessId) {
  if (-not ('CodexUsageCard.DoctorWindowProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace CodexUsageCard {
  public static class DoctorWindowProbe {
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
    public static bool HasStartupPrompt(int processId) {
      bool found = false;
      if (!EnumWindows(delegate(IntPtr window, IntPtr parameter) {
        uint ownerProcessId;
        GetWindowThreadProcessId(window, out ownerProcessId);
        if (ownerProcessId == processId && IsWindowVisible(window)) {
          var title = new StringBuilder(128);
          GetWindowText(window, title, title.Capacity);
          found |= title.ToString() == "\u52a0\u8f7d Codex \u989d\u5ea6\u5361";
        }
        return true;
      }, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
      return found;
    }
  }
}
'@
  }
  [CodexUsageCard.DoctorWindowProbe]::HasStartupPrompt($ProcessId)
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDirectory = Join-Path $InstallRoot 'native-patch'
$executable = Join-Path $installDirectory 'CodexNativeQuotaPatch.next.exe'
$stageCodes = @()
$taskFound = $false
$taskActionMatches = $null
$taskState = $null
$helperFilePresent = Test-Path -LiteralPath $executable -PathType Leaf
$helperProcessCount = $null
$helperWindowless = $null
$helperStartupPromptVisible = $false
$startupPromptVisible = $false
$codexRunning = $false
$cdpEndpointFound = $false
$mainPageFound = $false
$cardVisible = $null
$cardKind = $null
$windowCount = 0
$visibleCardCount = 0
$uninspectedWindowCount = 0
$inspectedWindowCount = 0
$cardKinds = @()
$inspectionFailed = $false
$taskInspectionFailed = $false
$codexInspectionFailed = $false
$networkDiagnosis = [pscustomobject]@{ NetworkMode = 'unknown'; ProxySource = 'unknown'; ProxyEndpoint = $null; LastRequestError = $null; NetworkCheckedAt = $null }

try {
  $task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    $taskFound = $true
    $taskState = [string]$task.State
    if ($task.Actions.Count -eq 1) {
      $action = $task.Actions[0]
      $actualExecutable = [IO.Path]::GetFullPath($action.Execute)
      $actualWorkingDirectory = if ([String]::IsNullOrWhiteSpace($action.WorkingDirectory)) {
        $null
      } else {
        [IO.Path]::GetFullPath($action.WorkingDirectory)
      }
      $taskActionMatches =
        [String]::Equals($actualExecutable, $executable, [StringComparison]::OrdinalIgnoreCase) -and
        [String]::Equals($actualWorkingDirectory, $installDirectory, [StringComparison]::OrdinalIgnoreCase) -and
        [String]::IsNullOrWhiteSpace($action.Arguments)
    } else {
      $taskActionMatches = $false
    }
  }
} catch {
  $inspectionFailed = $true
  $taskInspectionFailed = $true
  $stageCodes += 'TASK_INSPECTION_FAILED'
}

if (-not $taskInspectionFailed -and -not $taskFound) {
  $stageCodes += 'TASK_NOT_FOUND'
} elseif (-not $taskInspectionFailed -and $taskActionMatches -ne $true) {
  $stageCodes += 'TASK_ACTION_MISMATCH'
} elseif (-not $taskInspectionFailed -and $taskState -ne 'Running') {
  $stageCodes += 'TASK_NOT_RUNNING'
}
if (-not $helperFilePresent) {
  $stageCodes += 'HELPER_FILE_NOT_FOUND'
}

try {
  $matchingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    [String]::Equals(
      [IO.Path]::GetFullPath($_.ExecutablePath),
      $executable,
      [StringComparison]::OrdinalIgnoreCase)
  })
  $launcherProcesses = @($matchingProcesses | Where-Object { $_.CommandLine -cmatch '(?:^|\s)(?:--launch|"--launch")\s*\z' })
  $helperProcesses = @($matchingProcesses | Where-Object { $_.CommandLine -cnotmatch '(?:^|\s)(?:--launch|"--launch")\s*\z' })
  $helperProcessCount = $helperProcesses.Count
  if ($helperProcessCount -eq 1) {
    $helperProcess = $null
    try {
      $helperProcess = Get-Process -Id $helperProcesses[0].ProcessId -ErrorAction Stop
    } catch {
      $helperProcessCount = 0
      $helperWindowless = $null
    }
    if ($helperProcess) {
      $helperWindowless = $helperProcess.MainWindowHandle -eq 0
      $helperStartupPromptVisible = -not $helperWindowless -and $helperProcess.MainWindowTitle -cmatch '\A\u52a0\u8f7d Codex \u989d\u5ea6\u5361\z'
      if ($helperWindowless -and (Test-StartupPromptWindow $helperProcesses[0].ProcessId)) {
        $helperWindowless = $false
        $helperStartupPromptVisible = $true
      }
      $startupPromptVisible = $helperStartupPromptVisible
    }
  }
  foreach ($launcher in $launcherProcesses) {
    try {
      $launcherProcess = Get-Process -Id $launcher.ProcessId -ErrorAction Stop
    } catch { continue } # The explicit launcher may exit during this read-only inspection.
    if (($launcherProcess.MainWindowHandle -ne 0 -and $launcherProcess.MainWindowTitle -cmatch '\A\u52a0\u8f7d Codex \u989d\u5ea6\u5361\z') -or
        (Test-StartupPromptWindow $launcher.ProcessId)) {
      $startupPromptVisible = $true
    }
  }
} catch {
  $inspectionFailed = $true
  $stageCodes += 'HELPER_INSPECTION_FAILED'
}

if ($helperProcessCount -eq 0) {
  $stageCodes += 'HELPER_NOT_RUNNING'
} elseif ($helperProcessCount -gt 1) {
  $stageCodes += 'HELPER_MULTIPLE_PROCESSES'
} elseif ($helperWindowless -eq $false -and -not $helperStartupPromptVisible) {
  $stageCodes += 'HELPER_WINDOW_VISIBLE'
} elseif ($startupPromptVisible) {
  $stageCodes += 'STARTUP_CONFIRMATION_PENDING'
}

$codexProcessIds = @()
try {
  $codexProcesses = @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
  $codexProcessIds = @($codexProcesses | ForEach-Object { $_.Id })
  $codexRunning = $codexProcessIds.Count -gt 0
} catch {
  $inspectionFailed = $true
  $codexInspectionFailed = $true
  $stageCodes += 'CODEX_INSPECTION_FAILED'
}

if (-not $codexInspectionFailed -and -not $codexRunning) {
  $stageCodes += 'CODEX_NOT_RUNNING'
} elseif (-not $codexInspectionFailed) {
  try {
    $netstatOutput = @(netstat.exe -ano -p tcp)
    if ($LASTEXITCODE -ne 0) {
      throw 'Unable to inspect local TCP listeners.'
    }
    $ports = @($netstatOutput | ForEach-Object {
      $parts = $_.Trim() -split '\s+'
      if ($parts.Count -ge 5 -and
          $parts[0] -eq 'TCP' -and
          $parts[3] -eq 'LISTENING' -and
          $parts[4] -match '^\d+$' -and
          [int]$parts[4] -in $codexProcessIds -and
          $parts[1] -match '^(?:127\.0\.0\.1|\[::1\]):(\d+)$') {
        [int]$Matches[1]
      }
    } | Select-Object -Unique)
    if ($ports.Count -eq 0) {
      $stageCodes += 'CDP_PORT_UNAVAILABLE'
    } else {
      $targets = @()
      $handler = [System.Net.Http.HttpClientHandler]::new()
      $handler.UseProxy = $false
      $client = [System.Net.Http.HttpClient]::new($handler)
      $client.Timeout = [TimeSpan]::FromSeconds(2)
      try {
        foreach ($port in $ports) {
          try {
            $json = $client.GetStringAsync('http://127.0.0.1:{0}/json/list' -f $port).GetAwaiter().GetResult()
            $items = @(ConvertFrom-Json -InputObject $json)
            $cdpEndpointFound = $true
            foreach ($item in $items) {
              if ($item.type -eq 'page' -and
                  $item.url -eq 'app://-/index.html' -and
                  -not [String]::IsNullOrWhiteSpace($item.webSocketDebuggerUrl)) {
                $targets += [pscustomobject]@{
                  WebSocketDebuggerUrl = [string]$item.webSocketDebuggerUrl
                }
              }
            }
          } catch {
            # Other loopback listeners owned by Electron are not CDP endpoints.
          }
        }
      } finally {
        $client.Dispose()
        $handler.Dispose()
      }

      if (-not $cdpEndpointFound) {
        $stageCodes += 'CDP_ENDPOINT_UNAVAILABLE'
      } elseif ($targets.Count -eq 0) {
        $stageCodes += 'CDP_MAIN_PAGE_UNAVAILABLE'
      } else {
        $mainPageFound = $true
        $targets = @($targets | Sort-Object WebSocketDebuggerUrl -Unique)
        $windowCount = $targets.Count
        $expression = @'
(() => {
  const result = (visible, kind) => ({visible, kind, network: globalThis.__codexQuotaNetworkDiagnosis || null});
  const trigger = document.getElementById('codex-quota-trigger');
  const triggerVisible = (element) => {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor = element; ancestor instanceof HTMLElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.inert || style.display === 'none' ||
          style.visibility === 'hidden' || style.visibility === 'collapse' ||
          Number(style.opacity) === 0) return false;
      if (ancestor !== element && style.display !== 'contents') {
        const clipX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
        const clipY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
        if (clipX || clipY) {
          const box = ancestor.getBoundingClientRect();
          const scaleX = ancestor.offsetWidth ? box.width / ancestor.offsetWidth : 1;
          const scaleY = ancestor.offsetHeight ? box.height / ancestor.offsetHeight : 1;
          if (clipX) {
            const edge = box.left + ancestor.clientLeft * scaleX;
            left = Math.max(left, edge);
            right = Math.min(right, edge + ancestor.clientWidth * scaleX);
          }
          if (clipY) {
            const edge = box.top + ancestor.clientTop * scaleY;
            top = Math.max(top, edge);
            bottom = Math.min(bottom, edge + ancestor.clientHeight * scaleY);
          }
        }
      }
      if (right <= left || bottom <= top) return false;
    }
    return true;
  };
  if (trigger && trigger instanceof HTMLButtonElement &&
      trigger.getAttribute('aria-controls') === 'codex-quota-popover' &&
      trigger.getAttribute('data-cq-kind') === 'official' && triggerVisible(trigger)) {
    const popover = document.getElementById('codex-quota-popover');
    if (popover instanceof HTMLElement && popover.isConnected) {
      return result(true, 'Official');
    }
  }
  if (trigger) return result(false, null);
  const visible = (element) => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
  const fallback = document.getElementById('codex-official-usage-host');
  if (visible(fallback) && fallback.querySelector('[data-cq-layout="thread-v2"], [data-cq-layout="thread-v2-fallback"], .cq-compact-fallback')) {
    return result(true, 'Official');
  }
  const compact = [...document.querySelectorAll('.codex-native-compact-usage')].find((card) =>
    visible(card) && card.querySelector('[data-cq-layout="thread-v2"]'));
  if (compact) {
    return result(true, 'Official');
  }
  const nativeCards = [...document.querySelectorAll('[role="status"]')].filter((card) =>
    visible(card) &&
    card.classList.contains('rounded-2xl') &&
    Boolean(card.querySelector('progress[max="100"]')) &&
    ((card.classList.contains('border') && card.classList.contains('bg-token-main-surface-primary')) ||
      (card.classList.contains('ring-border') && card.classList.contains('bg-surface/80'))));
  return nativeCards.length === 1
    ? result(true, 'Official')
    : result(false, null);
})()
'@
        foreach ($target in $targets) {
          $socket = [System.Net.WebSockets.ClientWebSocket]::new()
          $socket.Options.Proxy = $null
          $cancellation = [Threading.CancellationTokenSource]::new()
          $cancellation.CancelAfter(3000)
          try {
            [void]$socket.ConnectAsync(
              [Uri]$target.WebSocketDebuggerUrl,
              $cancellation.Token).GetAwaiter().GetResult()
            $requestId = 1
            $request = @{
              id = $requestId
              method = 'Runtime.evaluate'
              params = @{
                expression = $expression
                returnByValue = $true
              }
            } | ConvertTo-Json -Compress -Depth 4
            $requestBytes = [Text.Encoding]::UTF8.GetBytes($request)
            [void]$socket.SendAsync(
              [ArraySegment[byte]]::new($requestBytes),
              [System.Net.WebSockets.WebSocketMessageType]::Text,
              $true,
              $cancellation.Token).GetAwaiter().GetResult()

            $message = $null
            while ($null -eq $message) {
              $stream = [IO.MemoryStream]::new()
              try {
                do {
                  $buffer = [byte[]]::new(16384)
                  $result = $socket.ReceiveAsync(
                    [ArraySegment[byte]]::new($buffer),
                    $cancellation.Token).GetAwaiter().GetResult()
                  if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                    throw 'CDP WebSocket closed before the diagnostic response.'
                  }
                  $stream.Write($buffer, 0, $result.Count)
                } while (-not $result.EndOfMessage)
                $candidate = ConvertFrom-Json @jsonReadOptions -InputObject ([Text.Encoding]::UTF8.GetString($stream.ToArray()))
                if ($candidate.id -eq $requestId) {
                  $message = $candidate
                }
              } finally {
                $stream.Dispose()
              }
            }

            if ($message.error -or $message.result.exceptionDetails) {
              throw 'CDP Runtime.evaluate failed.'
            }
            $value = $message.result.result.value
            if ($value.visible -isnot [bool]) {
              throw 'CDP diagnostic response is invalid.'
            }
            $inspectedWindowCount++
            $networkDiagnosis = Select-NetworkDiagnosis $networkDiagnosis $value.network
            if ($value.visible) {
              $visibleCardCount++
              $cardKinds += [string]$value.kind
            } else {
              $stageCodes += 'CARD_NOT_VISIBLE'
            }
          } catch {
            $uninspectedWindowCount++
            $inspectionFailed = $true
            $stageCodes += 'CARD_INSPECTION_FAILED'
          } finally {
            $socket.Dispose()
            $cancellation.Dispose()
          }
        }
      }
    }
  } catch {
    $inspectionFailed = $true
    $uninspectedWindowCount = $windowCount - $inspectedWindowCount
    $stageCodes += 'CDP_INSPECTION_FAILED'
  }
}

if ($windowCount -gt 0) {
  $cardVisible = if ($visibleCardCount + $uninspectedWindowCount -lt $windowCount) {
    $false
  } elseif ($uninspectedWindowCount -gt 0) {
    $null
  } else {
    $true
  }
  $kinds = @($cardKinds | Select-Object -Unique)
  $cardKind = if ($kinds.Count -eq 1) { $kinds[0] } elseif ($kinds.Count -gt 1) { 'Mixed' } else { $null }
}

$installed = $helperFilePresent -and $taskFound -and $taskActionMatches -eq $true
$activationState = if ($inspectionFailed) {
  'InspectionFailed'
} elseif (-not $taskFound) {
  'NotInstalled'
} elseif ($taskActionMatches -ne $true) {
  'TaskActionMismatch'
} elseif (-not $helperFilePresent) {
  'HelperMissing'
} elseif ($taskState -ne 'Running') {
  'TaskNotRunning'
} elseif ($helperProcessCount -eq 0) {
  'HelperNotRunning'
} elseif ($helperProcessCount -gt 1) {
  'HelperMultipleProcesses'
} elseif ($helperWindowless -eq $false -and -not $helperStartupPromptVisible) {
  'HelperWindowVisible'
} elseif ($startupPromptVisible) {
  'AwaitingStartupDecision'
} elseif (-not $codexRunning) {
  'InstalledWaitingForCodex'
} elseif (-not $cdpEndpointFound) {
  'InstalledWaitingForDebugPort'
} elseif (-not $mainPageFound) {
  'InstalledWaitingForMainPage'
} elseif ($cardVisible -eq $true) {
  'Active'
} else {
  'InstalledCardMissing'
}

[pscustomobject]@{
  Installed = $installed
  ActivationState = $activationState
  StageCodes = [string[]]@($stageCodes | Select-Object -Unique)
  TaskFound = $taskFound
  TaskActionMatches = $taskActionMatches
  TaskState = $taskState
  HelperFilePresent = $helperFilePresent
  HelperProcessCount = $helperProcessCount
  HelperWindowless = $helperWindowless
  StartupPromptVisible = $startupPromptVisible
  CodexRunning = $codexRunning
  CdpEndpointFound = $cdpEndpointFound
  MainPageFound = $mainPageFound
  CardVisible = $cardVisible
  CardKind = $cardKind
  NetworkMode = $networkDiagnosis.NetworkMode
  ProxySource = $networkDiagnosis.ProxySource
  ProxyEndpoint = $networkDiagnosis.ProxyEndpoint
  LastRequestError = $networkDiagnosis.LastRequestError
  NetworkCheckedAt = $networkDiagnosis.NetworkCheckedAt
  WindowCount = $windowCount
  VisibleCardCount = $visibleCardCount
  UninspectedWindowCount = $uninspectedWindowCount
}
