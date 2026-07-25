import unittest
from unittest.mock import MagicMock, patch

from codex_quota.page_injector import (
    CARD_SCRIPT,
    NATIVE_QUOTA_SCRIPT,
    _is_codex_main_page,
    card_present,
    resolve_port,
)


class PageInjectorTests(unittest.TestCase):
    def test_dynamic_values_use_text_content(self):
        self.assertNotIn("body.innerHTML", CARD_SCRIPT)
        self.assertIn("element.textContent = String(value)", CARD_SCRIPT)
        self.assertIn("Number(value).toFixed(2)", CARD_SCRIPT)
        self.assertIn('data.kind === "official"', CARD_SCRIPT)
        self.assertIn('window?.label', CARD_SCRIPT)
        self.assertIn('window.__codexQuotaRefreshRequested', CARD_SCRIPT)
        self.assertIn('刷新', CARD_SCRIPT)

    def test_automatic_port_uses_process_discovery(self):
        with patch("codex_quota.page_injector._discover_debug_port", return_value=9229) as discover:
            self.assertEqual(resolve_port(None), 9229)
        discover.assert_called_once_with()

    def test_main_page_filter_excludes_overlay_targets(self):
        self.assertTrue(_is_codex_main_page({"title": "Codex", "url": "app://-/index.html"}))
        self.assertFalse(_is_codex_main_page({
            "title": "Codex",
            "url": "app://-/index.html?initialRoute=%2Favatar-overlay",
        }))

    def test_native_patch_reuses_client_alert(self):
        self.assertIn("__STATSIG__", NATIVE_QUOTA_SCRIPT)
        self.assertIn("remaining_threshold_percent", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexNativeQuotaPatched", NATIVE_QUOTA_SCRIPT)
        self.assertIn("codex-native-compact-usage", NATIVE_QUOTA_SCRIPT)
        self.assertIn("card.replaceChildren(content)", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("codex-quota-card-host", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("attachShadow", NATIVE_QUOTA_SCRIPT)
        self.assertIn("remainingMatch", NATIVE_QUOTA_SCRIPT)
        self.assertIn("if (progresses.length !== 1", NATIVE_QUOTA_SCRIPT)
        self.assertIn("progress.value = 100 - remaining", NATIVE_QUOTA_SCRIPT)
        self.assertIn("% used", NATIVE_QUOTA_SCRIPT)
        self.assertIn("syncCompactProgress(card)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const used = Number(progress.value)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('attributeFilter: ["value"]', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("client._setStatus", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("font-family", NATIVE_QUOTA_SCRIPT)
        self.assertIn("new MutationObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver?.disconnect()", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addWindow("5h"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("5h unavailable", NATIVE_QUOTA_SCRIPT)

    def test_official_five_hour_window_is_never_fabricated(self):
        self.assertIn("const progresses = [...card.querySelectorAll", NATIVE_QUOTA_SCRIPT)
        self.assertIn("preserve its complete native UI", NATIVE_QUOTA_SCRIPT)
        self.assertIn('label === "5h"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('reset === "Unavailable"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("card.setAttribute(\"aria-label\", `Usage. Weekly", NATIVE_QUOTA_SCRIPT)

    def test_reinstall_replaces_the_previous_page_observer(self):
        self.assertGreaterEqual(
            NATIVE_QUOTA_SCRIPT.count("__codexQuotaOfficialCardObserver?.disconnect()"),
            2,
        )

    def test_native_patch_uses_injected_login_mode_and_keeps_secrets_out_of_the_page(self):
        self.assertIn("__codexQuotaMode", NATIVE_QUOTA_SCRIPT)
        self.assertIn('=== "api"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaUpdateApi", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiRequest__", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("Account\"], [\"api", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("localStorage", NATIVE_QUOTA_SCRIPT)
        self.assertIn("Number(value).toFixed(2)", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("OPENAI_API_KEY", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("Authorization", NATIVE_QUOTA_SCRIPT)

    def test_api_progress_represents_daily_used_amount(self):
        self.assertIn("(data.used / data.total) * 100", NATIVE_QUOTA_SCRIPT)
        self.assertIn('aria-label", "API daily usage"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('aria-label", "API remaining quota"', NATIVE_QUOTA_SCRIPT)

    def test_api_refresh_is_focus_driven_and_rate_limited(self):
        self.assertIn("const staleAfterMs = 5 * 60 * 1000", NATIVE_QUOTA_SCRIPT)
        self.assertIn('window.addEventListener("focus", refreshStaleApiData)', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiLastSuccessAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiNextAutoAttemptAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiCooldownUntil", NATIVE_QUOTA_SCRIPT)
        self.assertIn("更新失败，显示上次数据", NATIVE_QUOTA_SCRIPT)
        self.assertIn("刷新中…", NATIVE_QUOTA_SCRIPT)

    def test_api_card_position_does_not_depend_on_ui_language(self):
        self.assertIn("div.absolute.inset-x-0.bottom-0.z-20", NATIVE_QUOTA_SCRIPT)
        self.assertIn("button[aria-haspopup='menu']", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('button[aria-label="打开个人资料菜单"]', NATIVE_QUOTA_SCRIPT)

    def test_quota_card_hides_without_the_sidebar_account_row(self):
        self.assertIn("const bar = accountBar()", NATIVE_QUOTA_SCRIPT)
        self.assertIn("codexQuotaSidebarHidden", NATIVE_QUOTA_SCRIPT)
        self.assertIn("card.hidden = true", NATIVE_QUOTA_SCRIPT)
        self.assertIn("card.hidden = false", NATIVE_QUOTA_SCRIPT)
        self.assertIn("if (!bar)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const card = nativeQuotaCard()", NATIVE_QUOTA_SCRIPT)

    def test_card_present_accepts_api_or_official_card(self):
        connection = MagicMock()
        with patch("codex_quota.page_injector._connect", return_value=connection), \
             patch("codex_quota.page_injector._evaluate", return_value=True) as evaluate:
            self.assertTrue(card_present(9222, {"webSocketDebuggerUrl": "ws://test"}))
        expression = evaluate.call_args.args[1]
        self.assertIn("codex-api-usage-host", expression)
        self.assertIn("bg-token-main-surface-primary", expression)
        self.assertNotIn("__codexNativeQuotaPatched", expression)
        connection.close.assert_called_once_with()
