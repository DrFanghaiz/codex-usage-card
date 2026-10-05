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
        self.assertNotIn("^(ChatGPT|Codex)$", NATIVE_SOURCE)
        self.assertIn('Process.GetProcessesByName("ChatGPT")', NATIVE_SOURCE)
        self.assertIn("FindListeningPortsAsync(processIds)", NATIVE_SOURCE)
        self.assertIn('String.Equals(target.Url, "app://-/index.html"', NATIVE_SOURCE)

    def test_codex_restart_wait_is_event_driven(self):
        self.assertIn("SetWinEventHook", NATIVE_SOURCE)
        self.assertIn("GetMessage(out message", NATIVE_SOURCE)
        self.assertNotIn("Win32_ProcessStartTrace", NATIVE_SOURCE)
        self.assertIn("if (InspectCodexStartup()) return", NATIVE_SOURCE)

    def test_legacy_startup_restarts_only_new_unconnected_roots(self):
        self.assertIn("ObservedCodexRoots.Add(process.Identity)", NATIVE_SOURCE)
        self.assertIn("if (ObservedCodexRoots.Contains(root.Identity)) continue", NATIVE_SOURCE)
        self.assertIn("if (!ObservedCodexRoots.Add(root.Identity)) return", NATIVE_SOURCE)
        self.assertIn("RelaunchWithRemoteDebugging(root)", NATIVE_SOURCE)
        self.assertIn('StartsWith("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase)', NATIVE_SOURCE)
        self.assertIn('Regex.IsMatch(commandLine, "(?:^|\\\\s)--type="', NATIVE_SOURCE)
        self.assertIn('args[0] == "--launch"', NATIVE_SOURCE)
        self.assertLess(NATIVE_SOURCE.index("if (launchRequested)"), NATIVE_SOURCE.index('Local\\CodexUsageCard.Helper'))
        self.assertIn("--remote-debugging-address=127.0.0.1", NATIVE_SOURCE)
        self.assertIn("--remote-debugging-port=", NATIVE_SOURCE)
        self.assertIn("--remote-allow-origins=http://127.0.0.1:", NATIVE_SOURCE)
        self.assertIn("activation.ActivateApplication(appId, arguments, 0, out processId)", NATIVE_SOURCE)
        self.assertIn("CoCreateInstance(ref classId, IntPtr.Zero, 4, ref interfaceId, out activation)", NATIVE_SOURCE)
        self.assertIn("Get-AppxPackageManifest", NATIVE_SOURCE)
        self.assertNotIn("ProcThreadAttributeParentProcess", NATIVE_SOURCE)
        self.assertNotIn("using (var replacement = Process.Start(startInfo))", NATIVE_SOURCE)
        launch = NATIVE_SOURCE[NATIVE_SOURCE.index("private static void LaunchCodex()"):NATIVE_SOURCE.index("private static string FindInstalledCodexAppId()")]
        self.assertIn("process.Kill()", launch)
        self.assertIn("process.WaitForExit(5000)", launch)
        self.assertIn("process.StartTime.ToUniversalTime().Ticks / 10 != expectedTicks / 10", launch)
        self.assertNotIn("StartupPromptPanel.Show", NATIVE_SOURCE)
        self.assertNotIn("CloseMainWindow()", launch)
        self.assertIn("Get-AppxPackage -Name OpenAI.Codex", NATIVE_SOURCE)

    def test_official_usage_is_fetched_by_the_helper_and_only_payload_enters_the_page(self):
        self.assertIn("https://chatgpt.com/backend-api/wham/usage", NATIVE_SOURCE)
        self.assertIn('request.Headers["ChatGPT-Account-ID"]', NATIVE_SOURCE)
        self.assertIn("__codexQuotaOfficialRequest__", NATIVE_SOURCE)
        self.assertIn("__codexQuotaUpdateOfficial", NATIVE_SOURCE)
        self.assertIn('"usedPercent"', NATIVE_SOURCE)
        self.assertIn('"resetAt"', NATIVE_SOURCE)
        self.assertNotIn("Console.WriteLine", NATIVE_SOURCE)

    def test_only_complete_official_login_is_accepted_and_no_api_key_is_read(self):
        self.assertIn(
            """            var account = LoadOfficialConfiguration();
            if (account == null) return false;""",
            NATIVE_SOURCE,
        )
        for removed in ("LoadApiConfiguration", "FetchApiPayload", "ApiConfiguration", "OPENAI_API_KEY", "__codexQuotaUpdateApi", "__codexQuotaApiRequest__"):
            self.assertNotIn(removed, NATIVE_SOURCE)
        self.assertIn('String.Equals(mode, "apikey", StringComparison.OrdinalIgnoreCase)', NATIVE_SOURCE)
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
        self.assertIn('"NETWORK_ERROR"', NATIVE_SOURCE)
        self.assertIn('{ "errorCode", "INVALID_RESPONSE" }', NATIVE_SOURCE)
        self.assertIn('"AUTH_REQUIRED"', NATIVE_SOURCE)
        self.assertIn('"RATE_LIMITED"', NATIVE_SOURCE)
        self.assertIn('WebErrorPayload(exception)', NATIVE_SOURCE)
        self.assertNotIn("usage network request failed", NATIVE_SOURCE)
        self.assertNotIn("usage response is invalid", NATIVE_SOURCE)
        self.assertNotIn("exception.Message", NATIVE_SOURCE)

    def test_graphical_doctor_uses_required_powershell_7_without_a_console(self):
        self.assertIn('@"PowerShell\\7\\pwsh.exe"', NATIVE_SOURCE)
        self.assertIn('CreateNoWindow = true', NATIVE_SOURCE)
        self.assertIn('WindowStyle = ProcessWindowStyle.Hidden', NATIVE_SOURCE)
        self.assertIn('SanitizeDiagnosis(', NATIVE_SOURCE)

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
        self.assertIn("The legacy task action does not match", SKILL_INSTALL_SCRIPT)
        self.assertIn("$taskActionMatches $legacyTask $legacyExecutable", SKILL_INSTALL_SCRIPT)
        self.assertIn("Unregister-ScheduledTask", SKILL_INSTALL_SCRIPT)
        self.assertIn("WaitForExit(5000)", SKILL_INSTALL_SCRIPT)
        self.assertLess(
            SKILL_INSTALL_SCRIPT.index("Start-ScheduledTask -TaskPath '\\' -TaskName $TaskName"),
            SKILL_INSTALL_SCRIPT.index(
                "Unregister-ScheduledTask -TaskPath '\\' -TaskName $legacyTaskName"
            ),
        )
        self.assertIn("$releaseTag = 'v2.3.0'", ROOT_INSTALL_SCRIPT)
        self.assertIn("$archiveName = 'codex-usage-card.skill.zip'", ROOT_INSTALL_SCRIPT)
        self.assertIn("'scripts\\doctor.ps1'", ROOT_INSTALL_SCRIPT)
        self.assertIn("E3BFBF7B61434DBB44A06646A60C2F4D821F2A93DB1F1FE65951D5BD3BD47E61", ROOT_INSTALL_SCRIPT)


if __name__ == "__main__":
    unittest.main()
