import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NATIVE_SOURCE = (ROOT / "native-patch" / "CodexNativeQuotaPatch.cs").read_text(encoding="utf-8")
REGISTER_SCRIPT = (ROOT / "scripts" / "register_usage_card_task.ps1").read_text(encoding="utf-8")
SKILL_INSTALL_SCRIPT = (
    ROOT / "skills" / "codex-usage-card" / "scripts" / "install.ps1"
).read_text(encoding="utf-8")
ROOT_INSTALL_SCRIPT = (ROOT / "install.ps1").read_text(encoding="utf-8")


class NativeHelperTests(unittest.TestCase):
    def test_codex_update_recovery_is_version_independent(self):
        self.assertNotIn("WindowsApps", NATIVE_SOURCE)
        self.assertIn('Process.GetProcessesByName("ChatGPT")', NATIVE_SOURCE)
        self.assertIn("FindListeningPortsAsync(processIds)", NATIVE_SOURCE)
        self.assertIn('String.Equals(target.Url, "app://-/index.html"', NATIVE_SOURCE)

    def test_codex_restart_wait_is_event_driven(self):
        self.assertIn("ManagementEventWatcher", NATIVE_SOURCE)
        self.assertIn("Win32_ProcessStartTrace", NATIVE_SOURCE)
        self.assertIn("if (IsCodexRunning()) return", NATIVE_SOURCE)

    def test_scheduled_task_uses_the_current_project_helper(self):
        self.assertIn("Split-Path -Parent $PSScriptRoot", REGISTER_SCRIPT)
        self.assertIn("Codex Usage Card", REGISTER_SCRIPT)
        self.assertIn("native-patch\\CodexNativeQuotaPatch.next.exe", REGISTER_SCRIPT)
        self.assertIn("-MultipleInstances IgnoreNew", REGISTER_SCRIPT)
        self.assertIn("-RestartCount 3", REGISTER_SCRIPT)

    def test_renamed_installer_migrates_only_the_exact_legacy_task(self):
        self.assertIn("[string]$TaskName = 'Codex Usage Card'", SKILL_INSTALL_SCRIPT)
        self.assertIn("'CodexUsageCard'", SKILL_INSTALL_SCRIPT)
        self.assertIn("$legacyTaskName = 'Codex Quota Card Repair'", SKILL_INSTALL_SCRIPT)
        self.assertIn("'CodexBar'", SKILL_INSTALL_SCRIPT)
        self.assertIn("The legacy task points to another path", SKILL_INSTALL_SCRIPT)
        self.assertIn("Unregister-ScheduledTask", SKILL_INSTALL_SCRIPT)
        self.assertIn("WaitForExit(5000)", SKILL_INSTALL_SCRIPT)
        self.assertLess(
            SKILL_INSTALL_SCRIPT.index("Start-ScheduledTask -TaskPath '\\' -TaskName $TaskName"),
            SKILL_INSTALL_SCRIPT.index(
                "Unregister-ScheduledTask -TaskPath '\\' -TaskName $legacyTaskName"
            ),
        )
        self.assertIn("$releaseTag = 'v1.3.0'", ROOT_INSTALL_SCRIPT)
        self.assertIn("$archiveName = 'codex-usage-card.skill.zip'", ROOT_INSTALL_SCRIPT)


if __name__ == "__main__":
    unittest.main()
