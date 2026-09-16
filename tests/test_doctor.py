import unittest
import json
import shutil
import subprocess
from pathlib import Path


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
            "CardVisible = $diagnosis.CardVisible",
            "MainPageFound = $diagnosis.MainPageFound",
        ):
            self.assertIn(field, INSTALLER)


if __name__ == "__main__":
    unittest.main()
