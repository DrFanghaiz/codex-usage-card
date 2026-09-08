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
  $helperProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    [String]::Equals(
      [IO.Path]::GetFullPath($_.ExecutablePath),
      $executable,
      [StringComparison]::OrdinalIgnoreCase)
  })
  $helperProcessCount = $helperProcesses.Count
  if ($helperProcessCount -eq 1) {
    try {
      $helperWindowless = (Get-Process -Id $helperProcesses[0].ProcessId -ErrorAction Stop).MainWindowHandle -eq 0
    } catch {
      $helperProcessCount = 0
      $helperWindowless = $null
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
} elseif ($helperWindowless -eq $false) {
  $stageCodes += 'HELPER_WINDOW_VISIBLE'
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
                  $item.title -match '^(ChatGPT|Codex)$' -and
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
  const visible = (element) => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
  const api = document.getElementById('codex-api-usage-host');
  if (visible(api) && api.querySelector('.codex-native-compact-usage-content')) {
    return {visible: true, kind: 'Api'};
  }
  const fallback = document.getElementById('codex-official-usage-host');
  if (visible(fallback) && fallback.querySelector('[data-cq-layout="thread-v2"], [data-cq-layout="thread-v2-fallback"], .cq-compact-fallback')) {
    return {visible: true, kind: 'Official'};
  }
  const compact = [...document.querySelectorAll('.codex-native-compact-usage')].find((card) =>
    visible(card) && card.querySelector('[data-cq-layout="thread-v2"]'));
  if (compact) {
    return {visible: true, kind: 'Official'};
  }
  const nativeCards = [...document.querySelectorAll('[role="status"]')].filter((card) =>
    visible(card) &&
    card.classList.contains('rounded-2xl') &&
    Boolean(card.querySelector('progress[max="100"]')) &&
    ((card.classList.contains('border') && card.classList.contains('bg-token-main-surface-primary')) ||
      (card.classList.contains('ring-border') && card.classList.contains('bg-surface/80'))));
  return nativeCards.length === 1
    ? {visible: true, kind: 'Official'}
    : {visible: false, kind: null};
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
                $candidate = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($stream.ToArray()))
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
} elseif ($helperWindowless -eq $false) {
  'HelperWindowVisible'
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
  CodexRunning = $codexRunning
  CdpEndpointFound = $cdpEndpointFound
  MainPageFound = $mainPageFound
  CardVisible = $cardVisible
  CardKind = $cardKind
  WindowCount = $windowCount
  VisibleCardCount = $visibleCardCount
  UninspectedWindowCount = $uninspectedWindowCount
}
