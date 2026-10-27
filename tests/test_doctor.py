import unittest
import base64
import json
import ipaddress
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import MagicMock, patch

from codex_quota.page_injector import card_present


ROOT = Path(__file__).resolve().parents[1]
ROOT_DOCTOR = (ROOT / "scripts" / "doctor_usage_card.ps1").read_text(encoding="utf-8")
SKILL_DOCTOR = (
    ROOT / "skills" / "codex-usage-card" / "scripts" / "doctor.ps1"
).read_text(encoding="utf-8")
INSTALLER = (
    ROOT / "skills" / "codex-usage-card" / "scripts" / "install.ps1"
).read_text(encoding="utf-8")


class DoctorContractTests(unittest.TestCase):
    def test_doctor_checks_every_unique_window_and_reports_counts(self):
        self.assertIn('foreach ($target in $targets)', ROOT_DOCTOR)
        self.assertIn('Sort-Object WebSocketDebuggerUrl -Unique', ROOT_DOCTOR)
        self.assertNotIn('$targets[0]', ROOT_DOCTOR)
        self.assertNotIn('CDP_MAIN_PAGE_AMBIGUOUS', ROOT_DOCTOR)
        for field in ('WindowCount', 'VisibleCardCount', 'UninspectedWindowCount'):
            self.assertIn(field + ' = $', ROOT_DOCTOR)

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell required')
    def test_multiwindow_visibility_aggregation_preserves_missing_and_unknown(self):
        start = ROOT_DOCTOR.index('if ($windowCount -gt 0) {')
        end = ROOT_DOCTOR.index('$installed = ', start)
        aggregate = ROOT_DOCTOR[start:end]
        command = '''$ErrorActionPreference = 'Stop'
$cases = @(@(2,2,0), @(2,1,0), @(2,1,1), @(2,0,1), @(2,0,2), @(0,0,0))
$results = @(foreach ($case in $cases) {
  $windowCount, $visibleCardCount, $uninspectedWindowCount = $case
  $cardVisible = $null
  $cardKinds = @('Official', 'Official')
  $cardKind = $null
''' + aggregate + '''
  [pscustomobject]@{ visible = $cardVisible; kind = $cardKind }
})
ConvertTo-Json -Compress -InputObject $results
'''
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-Command', command],
            capture_output=True, text=True, check=True, timeout=15,
        )
        values = json.loads(result.stdout)
        self.assertEqual([row['visible'] for row in values], [True, False, None, False, None, None])
        self.assertEqual(values[0]['kind'], 'Official')

    def test_root_and_skill_doctors_are_exact_mirrors(self):
        self.assertEqual(ROOT_DOCTOR, SKILL_DOCTOR)

    @unittest.skipUnless(shutil.which('powershell.exe') and shutil.which('pwsh'), 'Windows PowerShell and PowerShell 7 required')
    def test_cdp_json_roundtrip_preserves_network_timestamp_in_both_powershell_versions(self):
        start = ROOT_DOCTOR.index('$jsonReadOptions = ')
        end = ROOT_DOCTOR.index('function Test-StartupPromptWindow', start)
        selection = ROOT_DOCTOR[start:end]
        decode = next(line.strip() for line in ROOT_DOCTOR.splitlines() if '$candidate = ConvertFrom-Json' in line)
        network = dict(NetworkMode='system', ProxySource='legacy-default', ProxyEndpoint=None,
                       LastRequestError=None, NetworkCheckedAt='2026-10-22T12:23:00.123Z')
        frame = dict(id=1, result=dict(result=dict(value=dict(visible=True, kind='Official', network=network))))
        encoded = base64.b64encode(json.dumps(frame).encode()).decode('ascii')
        command = "$ErrorActionPreference = 'Stop'\n" + selection + '''
$stream = [IO.MemoryStream]::new([Convert]::FromBase64String('__FRAME__'))
try {
  __DECODE__
  $value = $candidate.result.result.value
  $current = [pscustomobject]@{ NetworkMode='unknown'; ProxySource='unknown'; ProxyEndpoint=$null; LastRequestError=$null; NetworkCheckedAt=$null }
  $diagnosis = Select-NetworkDiagnosis $current $value.network
  [pscustomobject]@{ TimestampType=$value.network.NetworkCheckedAt.GetType().FullName; Network=$diagnosis } | ConvertTo-Json -Compress -Depth 4
} finally { $stream.Dispose() }
'''.replace('__FRAME__', encoded).replace('__DECODE__', decode)
        for shell in ('powershell.exe', 'pwsh'):
            with self.subTest(shell=shell):
                result = subprocess.run([shell, '-NoProfile', '-Command', command],
                                        capture_output=True, text=True, check=True, timeout=15)
                value = json.loads(result.stdout)
                self.assertEqual(value['TimestampType'], 'System.String')
                self.assertEqual(value['Network']['NetworkMode'], 'system')
                self.assertEqual(value['Network']['ProxySource'], 'legacy-default')
                self.assertEqual(value['Network']['NetworkCheckedAt'], '2026-10-22T12:23:00.1230000Z')
                self.assertIsNone(value['Network']['LastRequestError'])

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell required')
    def test_network_diagnosis_selects_latest_valid_window_and_redacts_proxy(self):
        start = ROOT_DOCTOR.index('function Select-NetworkDiagnosis')
        end = ROOT_DOCTOR.index('function Test-StartupPromptWindow', start)
        select_network = ROOT_DOCTOR[start:end]
        proxy = dict(NetworkMode='proxy', ProxySource='explicit',
                     ProxyEndpoint='http://private-user:private-pass@proxy.test:8080/private-path?secret=yes#fragment',
                     LastRequestError='PROXY_CONNECTION_FAILED', NetworkCheckedAt='2026-10-22T01:02:03Z')
        system = dict(proxy, NetworkMode='system', ProxySource='default', ProxyEndpoint='private-address',
                      LastRequestError=None, NetworkCheckedAt='2026-10-22T02:02:03.0000000+00:00')
        invalid = [dict(proxy, **change) for change in (
            {'NetworkMode': 'arbitrary'}, {'ProxySource': 'private-source'}, {'ProxySource': ['explicit']},
            {'LastRequestError': 'private-error'}, {'NetworkCheckedAt': '2026-02-30T01:02:03Z'},
            {'NetworkCheckedAt': '2026-10-22T04:02:03+08:00'}, {'ProxyEndpoint': 'https://proxy.test:8080'},
            {'ProxyEndpoint': 'not-a-url'},
        )]
        invalid.append({key: value for key, value in proxy.items() if key != 'ProxyEndpoint'})
        cases = [[proxy], [proxy, system], [system, proxy], [proxy, *invalid], invalid,
                 [dict(proxy, ProxyEndpoint='http://[::1]:7897')],
                 [dict(proxy, ProxyEndpoint='http://proxy.test')],
                 [dict(proxy, ProxyEndpoint=None, LastRequestError='NETWORK_CONFIG_INVALID')],
                 [dict(proxy, NetworkMode='unknown', ProxyEndpoint=None, LastRequestError='AUTH_REQUIRED')]]
        encoded = base64.b64encode(json.dumps(cases).encode()).decode('ascii')
        command = "$ErrorActionPreference = 'Stop'\n" + select_network + '''
$cases = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CASES__')))
$results = @(foreach ($case in $cases) {
  $current = [pscustomobject]@{ NetworkMode='unknown'; ProxySource='unknown'; ProxyEndpoint=$null; LastRequestError=$null; NetworkCheckedAt=$null }
  foreach ($candidate in $case) { $current = Select-NetworkDiagnosis $current $candidate }
  $current
})
ConvertTo-Json -Compress -Depth 4 -InputObject $results
'''.replace('__CASES__', encoded)
        result = subprocess.run(['powershell.exe', '-NoProfile', '-Command', command],
                                capture_output=True, text=True, check=True, timeout=15)
        values = json.loads(result.stdout)
        self.assertEqual(values[0]['ProxyEndpoint'], 'http://proxy.test:8080')
        self.assertEqual(values[0]['LastRequestError'], 'PROXY_CONNECTION_FAILED')
        self.assertEqual(values[1], values[2], 'window enumeration order must not replace a newer record')
        self.assertEqual(values[1]['NetworkMode'], 'system')
        self.assertIsNone(values[1]['ProxyEndpoint'])
        self.assertIsNone(values[1]['LastRequestError'])
        self.assertEqual(values[3], values[0], 'invalid records must not replace the latest verified record')
        self.assertEqual(values[4]['NetworkMode'], 'unknown')
        self.assertIsNone(values[4]['NetworkCheckedAt'])
        ipv6 = urlsplit(values[5]['ProxyEndpoint'])
        self.assertEqual(str(ipaddress.ip_address(ipv6.hostname)), '::1')
        self.assertEqual(ipv6.port, 7897)
        self.assertEqual(values[6]['ProxyEndpoint'], 'http://proxy.test:80')
        self.assertEqual(values[7]['NetworkMode'], 'proxy')
        self.assertIsNone(values[7]['ProxyEndpoint'])
        self.assertEqual(values[7]['LastRequestError'], 'NETWORK_CONFIG_INVALID')
        self.assertEqual(values[8]['NetworkMode'], 'unknown')
        self.assertEqual(values[8]['LastRequestError'], 'AUTH_REQUIRED')
        self.assertNotIn('private-', result.stdout)
        self.assertNotIn('secret', result.stdout)
        self.assertIn('globalThis.__codexQuotaNetworkDiagnosis', ROOT_DOCTOR)
        self.assertIn('$networkDiagnosis = Select-NetworkDiagnosis $networkDiagnosis $value.network', ROOT_DOCTOR)
        for field in proxy:
            self.assertIn(f'{field} = $networkDiagnosis.{field}', ROOT_DOCTOR)

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell required')
    def test_startup_prompt_is_expected_but_other_helper_windows_are_errors(self):
        start = ROOT_DOCTOR.index('function Test-StartupPromptWindow')
        end = ROOT_DOCTOR.index('$InstallRoot = ', start)
        legacy_source = ROOT_DOCTOR[:start] + 'function Test-StartupPromptWindow { param($ProcessId) $false }\n' + ROOT_DOCTOR[end:]
        source = base64.b64encode(legacy_source.encode('utf-8')).decode('ascii')
        command = '''$ErrorActionPreference = 'Stop'
$testRoot = 'C:\\IsolatedDoctorTest'
$testDirectory = Join-Path $testRoot 'native-patch'
$testExecutable = Join-Path $testDirectory 'CodexNativeQuotaPatch.next.exe'
function Test-Path { param($LiteralPath, $PathType) return $true }
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  [pscustomobject]@{ State='Running'; Actions=@([pscustomobject]@{ Execute=$testExecutable; WorkingDirectory=$testDirectory; Arguments='' }) }
}
function Get-CimInstance {
  param($ClassName)
  [pscustomobject]@{ ExecutablePath=$testExecutable; ProcessId=123 }
  if ($testSecondCommand -ne 'absent') {
    [pscustomobject]@{ ExecutablePath=$testExecutable; ProcessId=124; CommandLine=$testSecondCommand }
  }
}
function Get-Process {
  param($Id, $Name, $ErrorAction)
  if ($Name) { return }
  if ($Id -eq 124 -and $testSecondCommand -eq 'exited.exe --launch') { throw 'Launcher already exited' }
  if ($Id -eq 124) { return [pscustomobject]@{ MainWindowHandle=1; MainWindowTitle=$prompt } }
  [pscustomobject]@{ MainWindowHandle=$testHandle; MainWindowTitle=$testTitle }
}
$prompt = [regex]::Unescape('\u52a0\u8f7d Codex \u989d\u5ea6\u5361')
$cases = @(@(0, '', 'absent'), @(1, $prompt, 'absent'), @(1, 'Unexpected window', 'absent'), @(1, ($prompt + ' extra'), 'absent'),
  @(0, '', 'helper.exe --launch'), @(1, 'Unexpected window', 'helper.exe --launch'), @(0, '', ''), @(0, '', 'helper.exe --launch-other'), @(0, '', 'helper.exe "--launch"'), @(0, '', 'exited.exe --launch'))
$results = @(foreach ($case in $cases) {
  $testHandle, $testTitle, $testSecondCommand = $case
  & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__SOURCE__')))) -InstallRoot $testRoot
})
ConvertTo-Json -Compress -Depth 4 -InputObject $results
'''.replace('__SOURCE__', source)
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-Command', command],
            capture_output=True, text=True, check=True, timeout=15,
        )
        values = json.loads(result.stdout)
        self.assertEqual([row['StartupPromptVisible'] for row in values], [False, True, False, False, True, True, False, False, True, False])
        self.assertEqual([row['HelperWindowless'] for row in values[:6]], [True, False, False, False, True, False])
        self.assertEqual(values[1]['ActivationState'], 'AwaitingStartupDecision')
        self.assertIn('STARTUP_CONFIRMATION_PENDING', values[1]['StageCodes'])
        self.assertNotIn('HELPER_WINDOW_VISIBLE', values[1]['StageCodes'])
        for value in (values[2], values[3], values[5]):
            self.assertEqual(value['ActivationState'], 'HelperWindowVisible')
            self.assertIn('HELPER_WINDOW_VISIBLE', value['StageCodes'])
        for value in (values[4], values[8]):
            self.assertEqual(value['HelperProcessCount'], 1)
            self.assertEqual(value['ActivationState'], 'AwaitingStartupDecision')
            self.assertNotIn('HELPER_MULTIPLE_PROCESSES', value['StageCodes'])
        for value in values[6:8]:
            self.assertEqual(value['HelperProcessCount'], 2)
            self.assertEqual(value['ActivationState'], 'HelperMultipleProcesses')
            self.assertIn('HELPER_MULTIPLE_PROCESSES', value['StageCodes'])
        self.assertEqual(values[9]['HelperProcessCount'], 1)
        self.assertTrue(values[9]['HelperWindowless'])
        self.assertEqual(values[9]['ActivationState'], 'InstalledWaitingForCodex')

    @unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell required')
    def test_owned_startup_prompt_is_detected_without_a_main_window(self):
        command = r'''$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
public class DoctorTestWindow : System.Windows.Forms.Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  public DoctorTestWindow() {
    ShowInTaskbar = false;
    StartPosition = System.Windows.Forms.FormStartPosition.Manual;
    Location = new System.Drawing.Point(-32000, -32000);
  }
}
'@ -ReferencedAssemblies System.Windows.Forms, System.Drawing -WarningAction SilentlyContinue
$testRoot = 'C:\IsolatedDoctorTest'
$testDirectory = Join-Path $testRoot 'native-patch'
$testExecutable = Join-Path $testDirectory 'CodexNativeQuotaPatch.next.exe'
function Test-Path { param($LiteralPath, $PathType) return $true }
function Get-ScheduledTask {
  param($TaskPath, $TaskName, $ErrorAction)
  [pscustomobject]@{ State='Running'; Actions=@([pscustomobject]@{ Execute=$testExecutable; WorkingDirectory=$testDirectory; Arguments='' }) }
}
function Get-CimInstance {
  param($ClassName)
  [pscustomobject]@{ ExecutablePath=$testExecutable; ProcessId=$(if ($launcherOnly) { -1 } else { $testProcessId }) }
  if ($launcherOnly) { [pscustomobject]@{ ExecutablePath=$testExecutable; ProcessId=$testProcessId; CommandLine='helper.exe --launch' } }
}
function Get-Process {
  param($Id, $Name, $ErrorAction)
  if ($Name) { return }
  [pscustomobject]@{ MainWindowHandle=0; MainWindowTitle='' }
}
$owner = New-Object DoctorTestWindow
$prompt = New-Object DoctorTestWindow
$promptTitle = [regex]::Unescape('\u52a0\u8f7d Codex \u989d\u5ea6\u5361')
$testProcessId = $PID
try {
  $owner.Show()
  $prompt.Text = $promptTitle
  $prompt.Show($owner)
  $results = @(& '__DOCTOR__' -InstallRoot $testRoot)
  $launcherOnly = $true
  $results += & '__DOCTOR__' -InstallRoot $testRoot
  $launcherOnly = $false
  $prompt.Hide()
  $results += & '__DOCTOR__' -InstallRoot $testRoot
  $prompt.Text = $promptTitle + ' extra'
  $prompt.Show($owner)
  $results += & '__DOCTOR__' -InstallRoot $testRoot
  $prompt.Text = $promptTitle
  $testProcessId = -1
  $results += & '__DOCTOR__' -InstallRoot $testRoot
  ConvertTo-Json -Compress -Depth 4 -InputObject $results
} finally {
  $prompt.Dispose()
  $owner.Dispose()
}
'''.replace('__DOCTOR__', str(ROOT / 'scripts' / 'doctor_usage_card.ps1').replace("'", "''"))
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-STA', '-Command', command],
            capture_output=True, text=True, check=True, timeout=25,
        )
        values = json.loads(result.stdout)
        self.assertEqual([row['StartupPromptVisible'] for row in values], [True, True, False, False, False])
        self.assertEqual([row['HelperWindowless'] for row in values], [False, True, True, True, True])
        for value in values[:2]:
            self.assertEqual(value['ActivationState'], 'AwaitingStartupDecision')
            self.assertEqual(value['HelperProcessCount'], 1)
            self.assertIn('STARTUP_CONFIRMATION_PENDING', value['StageCodes'])
            self.assertNotIn('HELPER_WINDOW_VISIBLE', value['StageCodes'])

    def test_doctor_is_read_only_and_checks_exact_helper_identity(self):
        self.assertIn("Get-ScheduledTask -TaskPath '\\'", ROOT_DOCTOR)
        self.assertIn("[IO.Path]::GetFullPath($_.ExecutablePath)", ROOT_DOCTOR)
        self.assertIn("MainWindowHandle -eq 0", ROOT_DOCTOR)
        for mutation in (
            "Register-ScheduledTask",
            "Unregister-ScheduledTask",
            "Start-ScheduledTask",
            "Stop-ScheduledTask",
            "Stop-Process",
            "Copy-Item",
            "Remove-Item",
        ):
            self.assertNotIn(mutation, ROOT_DOCTOR)

    def test_doctor_checks_the_real_visible_card_over_cdp(self):
        self.assertIn("ClientWebSocket", ROOT_DOCTOR)
        self.assertIn("method = 'Runtime.evaluate'", ROOT_DOCTOR)
        self.assertIn("$item.url -eq 'app://-/index.html'", ROOT_DOCTOR)
        self.assertNotIn("$item.title -match", ROOT_DOCTOR)
        self.assertNotIn("codex-api-usage-host", ROOT_DOCTOR)
        self.assertIn("codex-official-usage-host", ROOT_DOCTOR)
        self.assertIn(".codex-native-compact-usage", ROOT_DOCTOR)
        self.assertIn("offsetParent !== null", ROOT_DOCTOR)
        self.assertIn("CardVisible = $cardVisible", ROOT_DOCTOR)
        self.assertIn("'InstalledWaitingForCodex'", ROOT_DOCTOR)
        self.assertIn("'InstalledWaitingForDebugPort'", ROOT_DOCTOR)
        for secret in ("auth.json", "config.toml", "ApiKey", "AccessToken", "AccountId"):
            self.assertNotIn(secret, ROOT_DOCTOR)

    @unittest.skipUnless(shutil.which('node'), 'Node.js required')
    def test_collapsed_entry_visibility_is_the_health_contract(self):
        expression = ROOT_DOCTOR.split("$expression = @'\n", 1)[1].split("\n'@", 1)[0]
        connection = MagicMock()
        with patch('codex_quota.page_injector._connect', return_value=connection), \
             patch('codex_quota.page_injector._evaluate', return_value=True) as evaluate:
            self.assertTrue(card_present(9222, {'webSocketDebuggerUrl': 'ws://synthetic'}))
        probes = {'doctor': expression, 'card_present': evaluate.call_args.args[1]}
        result = subprocess.run(['node', '-e', r"""
const assert = require('node:assert/strict');
const probes = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
global.HTMLElement = class {
  constructor() {
    this.isConnected = true;
    this.hidden = false;
    this.inert = false;
    this.parentElement = null;
    this.style = {display: 'block', visibility: 'visible', opacity: '1'};
    this.rect = {left: 10, top: 20, right: 40, bottom: 50, width: 30, height: 30};
    this.attributes = {};
    this.offsetParent = null; // Fixed entries have no offsetParent and remain visible.
    this.clientLeft = this.clientTop = 0;
    this.clientWidth = this.offsetWidth = 30;
    this.clientHeight = this.offsetHeight = 30;
  }
  getBoundingClientRect() { return this.rect; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector() { return null; }
};
global.HTMLButtonElement = class extends HTMLElement {};
global.getComputedStyle = (element) => element.style;
global.innerWidth = 800;
global.innerHeight = 600;
const cases = [
  ['collapsed, no quota data or global patch flags', () => {}, true],
  ['removed API entry', ({trigger}) => { trigger.attributes['data-cq-kind'] = 'api'; }, false],
  ['missing trigger', (state) => { state.trigger = null; }, false],
  ['legacy only', (state) => { state.trigger = null; state.legacy.offsetParent = {}; }, true],
  ['hidden trigger with visible legacy', (state) => { state.trigger.hidden = true; state.legacy.offsetParent = {}; }, false],
  ['invalid trigger with visible legacy', (state) => { state.trigger.attributes['data-cq-kind'] = 'other'; state.legacy.offsetParent = {}; }, false],
  ['display contents ancestor', ({ancestor}) => { ancestor.style.display = 'contents'; ancestor.rect.width = ancestor.rect.height = 0; }, true],
  ['not a button', (state) => { state.trigger = Object.assign(new HTMLElement(), state.trigger); }, false],
  ['invalid kind', ({trigger}) => { trigger.attributes['data-cq-kind'] = 'other'; }, false],
  ['missing controls', ({trigger}) => { delete trigger.attributes['aria-controls']; }, false],
  ['wrong controls', ({trigger}) => { trigger.attributes['aria-controls'] = 'other'; }, false],
  ['missing popover', (state) => { state.popover = null; }, false],
  ['detached popover', ({popover}) => { popover.isConnected = false; }, false],
  ['detached trigger', ({trigger}) => { trigger.isConnected = false; }, false],
  ['outside left', ({trigger}) => { trigger.rect.left = -30; trigger.rect.right = 0; }, false],
  ['outside right', ({trigger}) => { trigger.rect.left = 800; trigger.rect.right = 830; }, false],
  ['outside top', ({trigger}) => { trigger.rect.top = -30; trigger.rect.bottom = 0; }, false],
  ['outside bottom', ({trigger}) => { trigger.rect.top = 600; trigger.rect.bottom = 630; }, false],
  ['partially in viewport', ({trigger}) => { trigger.rect.left = -10; trigger.rect.right = 20; }, true],
];
const clipBox = (element, left, top, width, height, scale = 1, border = 0) => {
  element.rect = {left, top, right: left + width * scale, bottom: top + height * scale, width: width * scale, height: height * scale};
  element.offsetWidth = width; element.offsetHeight = height;
  element.clientLeft = element.clientTop = border;
  element.clientWidth = width - 2 * border; element.clientHeight = height - 2 * border;
};
for (const overflow of ['hidden', 'clip', 'scroll', 'auto']) {
  cases.push([`ancestor clips x with ${overflow}`, ({ancestor}) => { clipBox(ancestor, 0, 0, 10, 100); ancestor.style.overflowX = overflow; }, false]);
  cases.push([`ancestor clips y with ${overflow}`, ({ancestor}) => { clipBox(ancestor, 0, 0, 100, 20); ancestor.style.overflowY = overflow; }, false]);
}
cases.push(
  ['partially clipped', ({ancestor}) => { clipBox(ancestor, 0, 0, 20, 100); ancestor.style.overflowX = 'hidden'; }, true],
  ['visible overflow does not clip', ({ancestor}) => { clipBox(ancestor, 0, 0, 10, 10); ancestor.style.overflowX = ancestor.style.overflowY = 'visible'; }, true],
  ['contents has no clipping box', ({ancestor}) => { clipBox(ancestor, 0, 0, 0, 0); ancestor.style.display = 'contents'; ancestor.style.overflowX = ancestor.style.overflowY = 'hidden'; }, true],
  ['border is not content', ({ancestor}) => { clipBox(ancestor, 0, 0, 14, 100, 1, 5); ancestor.style.overflowX = 'hidden'; }, false],
  ['scrollbar is not content', ({ancestor}) => { clipBox(ancestor, 0, 0, 40, 100); ancestor.clientWidth = 10; ancestor.style.overflowX = 'auto'; }, false],
  ['scaled content remains visible', ({ancestor, trigger}) => { clipBox(ancestor, 0, 0, 30, 100, 1.25, 2); clipBox(trigger, 30, 20, 4, 30); ancestor.style.overflowX = 'hidden'; }, true],
  ['scaled border clips', ({ancestor, trigger}) => { clipBox(ancestor, 0, 0, 12, 100, 1.25, 1); clipBox(trigger, 14, 20, 3, 30); ancestor.style.overflowX = 'hidden'; }, false],
  ['nested clips intersect', ({ancestor}) => { clipBox(ancestor, 0, 0, 25, 100); ancestor.style.overflowX = 'hidden'; const outer = new HTMLElement(); clipBox(outer, 30, 0, 100, 100); outer.style.overflowX = 'hidden'; ancestor.parentElement = outer; }, false],
);
for (const extent of [0, .009, .5, .999, 1, 1.25]) for (const axis of ['x', 'y']) {
  cases.push([`viewport ${axis} intersection ${extent}px`, ({trigger}) => {
    clipBox(trigger, axis === 'x' ? -30 + extent : 10, axis === 'y' ? -30 + extent : 20, 30, 30);
  }, extent >= 1]);
  cases.push([`ancestor ${axis} intersection ${extent}px`, ({ancestor}) => {
    clipBox(ancestor, 0, 0, axis === 'x' ? 10 + extent : 100, axis === 'y' ? 20 + extent : 100);
    ancestor.style[axis === 'x' ? 'overflowX' : 'overflowY'] = 'hidden';
  }, extent >= 1]);
}
for (const target of ['trigger', 'ancestor']) {
  for (const attribute of ['hidden', 'inert']) {
    cases.push([`${target} ${attribute}`, (state) => { state[target][attribute] = true; }, false]);
  }
  for (const [property, value] of [['display', 'none'], ['visibility', 'hidden'], ['visibility', 'collapse'], ['opacity', '0']]) {
    cases.push([`${target} ${property} ${value}`, (state) => { state[target].style[property] = value; }, false]);
  }
  for (const dimension of ['width', 'height']) {
    cases.push([`${target} zero ${dimension}`, (state) => { state[target].rect[dimension] = 0; }, target === 'ancestor']);
  }
}
for (const [name, expression] of Object.entries(probes)) {
  for (const [label, modify, expected] of cases) {
    const state = {trigger: new HTMLButtonElement(), popover: new HTMLElement(), ancestor: new HTMLElement(), legacy: new HTMLElement()};
    state.legacy.querySelector = () => ({});
    state.trigger.parentElement = state.ancestor;
    state.trigger.attributes = {'aria-controls': 'codex-quota-popover', 'data-cq-kind': 'official', 'aria-expanded': 'false'};
    state.popover.hidden = true;
    state.popover.style.display = 'none';
    modify(state);
    global.document = {
      getElementById: (id) => ({'codex-quota-trigger': state.trigger, 'codex-quota-popover': state.popover, 'codex-official-usage-host': state.legacy})[id] ?? null,
      querySelectorAll: () => [],
    };
    const actual = eval(expression);
    assert.equal(name === 'doctor' ? actual.visible : actual, expected, `${name}: ${label}`);
    if (name === 'doctor' && expected) {
      assert.equal(actual.kind, 'Official', label);
    }
  }
}
"""], input=json.dumps(probes), text=True, capture_output=True, check=False, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        connection.close.assert_called_once_with()

    @unittest.skipUnless(shutil.which('node'), 'Node.js required')
    def test_clipped_entry_visibility_in_browser(self):
        available = subprocess.run(['node', '-e', "require.resolve('playwright')"], capture_output=True, timeout=10)
        if available.returncode:
            self.skipTest('Existing Playwright runtime required (set NODE_PATH)')
        expression = ROOT_DOCTOR.split("$expression = @'\n", 1)[1].split("\n'@", 1)[0]
        connection = MagicMock()
        with patch('codex_quota.page_injector._connect', return_value=connection), \
             patch('codex_quota.page_injector._evaluate', return_value=True) as evaluate:
            self.assertTrue(card_present(9222, {'webSocketDebuggerUrl': 'ws://synthetic'}))
        probes = {'doctor': expression, 'card_present': evaluate.call_args.args[1]}
        result = subprocess.run(['node', '-e', r"""
const assert = require('node:assert/strict');
const probes = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const page = await browser.newPage();
    const check = async (expected, target = page, context = '') => {
      for (const [name, expression] of Object.entries(probes)) {
        const actual = await target.evaluate(expression);
        assert.equal(name === 'doctor' ? actual.visible : actual, expected, `${name}: ${context}`);
      }
    };
    for (const overflow of ['hidden', 'clip', 'auto', 'scroll']) for (const zoom of [1, 1.25]) {
      await page.setContent(`<style>body{margin:0}#clip{display:flex;width:52px;height:150px;overflow:${overflow};zoom:${zoom};border:4px solid}#rail{width:52px;flex:none}#column{width:238px;flex:none}button{width:32px;height:32px;margin:8px}</style><div id="clip"><div id="rail"></div><div id="column"><button id="codex-quota-trigger" data-cq-kind="official" aria-controls="codex-quota-popover">Quota</button></div></div><div id="codex-quota-popover" hidden></div>`);
      await check(false); // Fixed-width column is entirely clipped by its collapsed parent.
      await page.locator('#clip').evaluate(el => el.style.width = '290px');
      await check(true);
      await page.locator('#clip').evaluate(el => el.style.width = '52px');
      await page.locator('#rail').evaluate(el => el.append(document.getElementById('codex-quota-trigger')));
      await check(true); // The same entry is visible when mounted above the avatar in the rail.
      assert.equal(await page.locator('#codex-quota-trigger').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    }
    await page.locator('#column').evaluate(el => el.append(document.getElementById('codex-quota-trigger')));
    await page.locator('#clip').evaluate(el => el.style.display = 'contents');
    await check(true);
    for (const dpr of [1, 1.25, 2]) {
      const boundaryPage = await browser.newPage({deviceScaleFactor: dpr, viewport: {width: 800, height: 600}});
      try {
        for (const zoom of [1, 1.25, 2]) for (const clipping of ['viewport', 'ancestor']) {
          await boundaryPage.setContent(`<style>body{margin:0;overflow:hidden}#clip{position:absolute;inset:0 auto auto 0;width:64px;height:64px;overflow:${clipping === 'ancestor' ? 'hidden' : 'visible'}}#position{position:absolute;left:0;top:0}#zoom{zoom:${zoom}}button{display:block;box-sizing:border-box;width:32px;height:32px;margin:0;padding:0;border:0}</style><div id="clip"><div id="position"><div id="zoom"><button id="codex-quota-trigger" data-cq-kind="official" aria-controls="codex-quota-popover">Quota</button></div></div></div><div id="codex-quota-popover" hidden></div>`);
          for (const axis of ['x', 'y']) for (const extent of [0, .009, .5, .999, 1, 1.25]) {
            const actualExtent = await boundaryPage.evaluate(({axis, extent, clipping}) => {
              const position = document.getElementById('position');
              position.style.transform = 'none';
              const trigger = document.getElementById('codex-quota-trigger');
              const origin = trigger.getBoundingClientRect(), clip = document.getElementById('clip').getBoundingClientRect();
              const amount = clipping === 'ancestor' ? 64 - extent : extent - (axis === 'x' ? origin.width : origin.height);
              position.style.transform = `translate(${axis === 'x' ? amount : 0}px,${axis === 'y' ? amount : 0}px)`;
              const box = trigger.getBoundingClientRect();
              return axis === 'x'
                ? (clipping === 'ancestor' ? clip.right - box.left : box.right)
                : (clipping === 'ancestor' ? clip.bottom - box.top : box.bottom);
            }, {axis, extent, clipping});
            const context = `${clipping} ${axis} extent=${extent} DPR=${dpr} zoom=${zoom}`;
            assert.ok(Math.abs(actualExtent - extent) < .00001, `${context}: browser geometry does not exercise the intended boundary`);
            await check(extent >= 1, boundaryPage, context);
          }
        }
      } finally { await boundaryPage.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
"""], input=json.dumps(probes), text=True, capture_output=True, check=False, timeout=40)
        self.assertEqual(result.returncode, 0, result.stderr)
        connection.close.assert_called_once_with()

    def test_installer_runs_doctor_after_process_verification_and_merges_result(self):
        doctor_call = "$diagnosis = & (Join-Path $PSScriptRoot 'doctor.ps1')"
        self.assertGreater(
            INSTALLER.index(doctor_call),
            INSTALLER.index("The helper unexpectedly created a window."),
        )
        for field in (
            "ActivationState = $diagnosis.ActivationState",
            "StageCodes = $diagnosis.StageCodes",
            "TaskActionMatches = $diagnosis.TaskActionMatches",
            "HelperWindowless = $diagnosis.HelperWindowless",
            "StartupPromptVisible = $diagnosis.StartupPromptVisible",
            "CardVisible = $diagnosis.CardVisible",
            "MainPageFound = $diagnosis.MainPageFound",
        ):
            self.assertIn(field, INSTALLER)


if __name__ == "__main__":
    unittest.main()
