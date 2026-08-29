import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NATIVE_SOURCE = (ROOT / "native-patch" / "CodexNativeQuotaPatch.cs").read_text(encoding="utf-8")
SKILL_NATIVE_SOURCE = (
    ROOT / "skills" / "codex-usage-card" / "assets" / "native-patch" / "CodexNativeQuotaPatch.cs"
).read_text(encoding="utf-8")
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

    def test_direct_codex_start_is_relaunched_once_with_loopback_cdp(self):
        self.assertIn("var observedCodexProcesses = new HashSet<string>();", NATIVE_SOURCE)
        self.assertIn("ProcessId, CreationDate, ExecutablePath, CommandLine", NATIVE_SOURCE)
        self.assertNotIn("observedProcessIds.RemoveWhere", NATIVE_SOURCE)
        self.assertIn('StartsWith("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase)', NATIVE_SOURCE)
        self.assertIn('Regex.IsMatch(commandLine, "(?:^|\\\\s)--type="', NATIVE_SOURCE)
        self.assertIn("!observedProcesses.Add(process.Identity)", NATIVE_SOURCE)
        self.assertIn("HasRemoteDebuggingPort(process.CommandLine)", NATIVE_SOURCE)
        self.assertIn("--remote-debugging-address=127.0.0.1", NATIVE_SOURCE)
        self.assertIn("--remote-debugging-port=", NATIVE_SOURCE)
        self.assertIn("--remote-allow-origins=http://127.0.0.1:", NATIVE_SOURCE)
        self.assertIn("ProcThreadAttributeParentProcess", NATIVE_SOURCE)
        self.assertIn("ExtendedStartupInfoPresent", NATIVE_SOURCE)
        self.assertIn('Process.GetProcessesByName("explorer")', NATIVE_SOURCE)
        self.assertNotIn("using (var replacement = Process.Start(startInfo))", NATIVE_SOURCE)
        self.assertLess(
            NATIVE_SOURCE.index("Codex process identity changed before relaunch"),
            NATIVE_SOURCE.index("process.Kill()"),
        )

    def test_official_usage_is_fetched_by_the_helper_and_only_payload_enters_the_page(self):
        self.assertIn("https://chatgpt.com/backend-api/wham/usage", NATIVE_SOURCE)
        self.assertIn('request.Headers["ChatGPT-Account-ID"]', NATIVE_SOURCE)
        self.assertIn("__codexQuotaOfficialRequest__", NATIVE_SOURCE)
        self.assertIn("__codexQuotaUpdateOfficial", NATIVE_SOURCE)
        self.assertIn('"usedPercent"', NATIVE_SOURCE)
        self.assertIn('"resetAt"', NATIVE_SOURCE)
        self.assertNotIn("Console.WriteLine", NATIVE_SOURCE)

    def test_complete_official_login_precedes_api_and_partial_official_login_waits(self):
        self.assertIn(
            """            official = HasOfficialAccount();
            if (official) return true;
            api = LoadApiConfiguration();
            return api != null;""",
            NATIVE_SOURCE,
        )
        self.assertNotIn("return official != (api != null);", NATIVE_SOURCE)
        self.assertIn('!auth.ContainsKey("tokens") || auth["tokens"] == null', NATIVE_SOURCE)
        self.assertIn("if (tokens == null) throw new InvalidOperationException();", NATIVE_SOURCE)
        self.assertIn(
            'if (!tokens.ContainsKey("access_token") && !tokens.ContainsKey("account_id")) return null;',
            NATIVE_SOURCE,
        )
        self.assertIn(
            'tokens.ContainsKey("access_token") ? tokens["access_token"] as string : null',
            NATIVE_SOURCE,
        )
        self.assertIn(
            'tokens.ContainsKey("account_id") ? tokens["account_id"] as string : null',
            NATIVE_SOURCE,
        )
        self.assertIn(
            """        if (String.IsNullOrWhiteSpace(accessToken) || String.IsNullOrWhiteSpace(accountId))
            throw new InvalidOperationException();""",
            NATIVE_SOURCE,
        )

    def test_page_error_payloads_are_stable_codes_without_raw_messages(self):
        self.assertEqual(NATIVE_SOURCE.count('{ "errorCode", "NETWORK_ERROR" }'), 2)
        self.assertEqual(NATIVE_SOURCE.count('{ "errorCode", "INVALID_RESPONSE" }'), 2)
        self.assertIn('payload["retryAfterSeconds"] = retryAfter;', NATIVE_SOURCE)
        self.assertNotIn("usage network request failed", NATIVE_SOURCE)
        self.assertNotIn("usage response is invalid", NATIVE_SOURCE)
        self.assertNotIn("exception.Message", NATIVE_SOURCE)

    def test_skill_helper_source_matches_the_project_source(self):
        self.assertEqual(NATIVE_SOURCE, SKILL_NATIVE_SOURCE)

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
        self.assertIn("$releaseTag = 'v1.8.0'", ROOT_INSTALL_SCRIPT)
        self.assertIn("$archiveName = 'codex-usage-card.skill.zip'", ROOT_INSTALL_SCRIPT)
        self.assertIn("'scripts\\doctor.ps1'", ROOT_INSTALL_SCRIPT)
        self.assertIn("0456B3569971EB26F017AA3DFE9D3841929881948FE6A7512189F8AAC747A0A5", ROOT_INSTALL_SCRIPT)


if __name__ == "__main__":
    unittest.main()
