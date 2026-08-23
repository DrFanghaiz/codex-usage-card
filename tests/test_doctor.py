import unittest
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
        self.assertIn("app://-/index.html", ROOT_DOCTOR)
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
