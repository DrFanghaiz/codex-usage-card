import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NATIVE_SOURCE = (ROOT / "native-patch" / "CodexNativeQuotaPatch.cs").read_text(encoding="utf-8")
REGISTER_SCRIPT = (ROOT / "scripts" / "register_repair_task.ps1").read_text(encoding="utf-8")


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
        self.assertIn("native-patch\\CodexNativeQuotaPatch.next.exe", REGISTER_SCRIPT)
        self.assertIn("-MultipleInstances IgnoreNew", REGISTER_SCRIPT)
        self.assertIn("-RestartCount 3", REGISTER_SCRIPT)


if __name__ == "__main__":
    unittest.main()
