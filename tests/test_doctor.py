import unittest
import base64
import json
import shutil
import subprocess
from pathlib import Path
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
  $cardKinds = @('Api', 'Official')
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
        self.assertEqual(values[0]['kind'], 'Mixed')

    def test_root_and_skill_doctors_are_exact_mirrors(self):
        self.assertEqual(ROOT_DOCTOR, SKILL_DOCTOR)

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
        self.assertIn("codex-api-usage-host", ROOT_DOCTOR)
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
  ['official', ({trigger}) => { trigger.attributes['data-cq-kind'] = 'official'; }, true],
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
    state.trigger.attributes = {'aria-controls': 'codex-quota-popover', 'data-cq-kind': 'api', 'aria-expanded': 'false'};
    state.popover.hidden = true;
    state.popover.style.display = 'none';
    modify(state);
    global.document = {
      getElementById: (id) => ({'codex-quota-trigger': state.trigger, 'codex-quota-popover': state.popover, 'codex-api-usage-host': state.legacy})[id] ?? null,
      querySelectorAll: () => [],
    };
    const actual = eval(expression);
    assert.equal(name === 'doctor' ? actual.visible : actual, expected, `${name}: ${label}`);
    if (name === 'doctor' && expected) {
      assert.equal(actual.kind, state.trigger?.attributes['data-cq-kind'] === 'official' ? 'Official' : 'Api', label);
    }
  }
}
"""], input=json.dumps(probes), text=True, capture_output=True, check=False, timeout=15)
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
