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
        self.assertIn('classList.contains("ring-border")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('classList.contains("bg-surface/80")', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("codex-quota-card-host", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("attachShadow", NATIVE_QUOTA_SCRIPT)
        self.assertIn("remainingMatch", NATIVE_QUOTA_SCRIPT)
        self.assertIn('classList.contains("text-secondary")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('classList.contains("font-medium") && /(\\d+', NATIVE_QUOTA_SCRIPT)
        self.assertIn("if (progresses.length !== 1", NATIVE_QUOTA_SCRIPT)
        self.assertIn("progress.value = 100 - remaining", NATIVE_QUOTA_SCRIPT)
        self.assertIn("weeklyUsedAria", NATIVE_QUOTA_SCRIPT)
        self.assertIn("syncCompactProgress(card)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const used = Number(progress.value)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('attributeFilter: ["value"]', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("client._setStatus", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-sans: var(--default-font-family", NATIVE_QUOTA_SCRIPT)
        self.assertIn("new MutationObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver?.disconnect()", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addWindow("5h"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("5h unavailable", NATIVE_QUOTA_SCRIPT)

    def test_thread_layout_uses_one_percentage_source_and_theme_safe_tokens(self):
        self.assertIn("--cq-surface: var(--color-background-elevated-secondary", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-border: var(--color-token-border-default", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-accent: var(--codex-base-accent", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#FCFAF4", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#B4552D", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("html.electron-dark", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("--cq-serif", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const used = 100 - remaining", NATIVE_QUOTA_SCRIPT)
        self.assertIn('weeklyKicker: "每周"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('weeklyKicker: "Weekly"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.querySelector(".cq-number-value").textContent = usedText', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.querySelector(".cq-remaining-value").textContent = `${remainingText}%`', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.style.setProperty("--cq-used", `${used}%`)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('data-cq-layout="thread-v2"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('replace(/^.*下次重置时间为\\s*/', NATIVE_QUOTA_SCRIPT)
        self.assertIn("cq-thread-meta", NATIVE_QUOTA_SCRIPT)
        self.assertIn("cq-thread-info", NATIVE_QUOTA_SCRIPT)
        self.assertIn("cq-thread-reset", NATIVE_QUOTA_SCRIPT)
        self.assertIn('resetCountdownPrefix: "距离自然重置"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("formatResetCountdown", NATIVE_QUOTA_SCRIPT)
        self.assertIn("Math.floor(remainingMs / 86400000)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("applyOfficialCountdown", NATIVE_QUOTA_SCRIPT)
        self.assertIn("grid-template-columns: auto minmax(0, 1fr)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("column-gap: 12px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("gap: 2px; padding-top: 1px", NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.dataset.cqLayout = "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('currentLayout !== "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("font-size: 22px; font-weight: 600", NATIVE_QUOTA_SCRIPT)
        self.assertIn("height: 1px; margin-top: 8px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("background: transparent !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("box-shadow: none !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("width: calc(100% - 16px) !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("margin: 0 8px 8px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("padding: 9px 10px 8px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("border: 1px solid var(--cq-border) !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("border-radius: 10px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("background: var(--cq-surface) !important", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-rule-marker", NATIVE_QUOTA_SCRIPT)
        self.assertIn('@media (prefers-reduced-motion: reduce)', NATIVE_QUOTA_SCRIPT)
        self.assertIn("style.textContent !== css", NATIVE_QUOTA_SCRIPT)
        self.assertIn("legacyProgresses", NATIVE_QUOTA_SCRIPT)
        self.assertIn('existing.querySelector(".cq-folio-note b")', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-scale", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("linear-gradient", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("backdrop-filter", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#8E4617", NATIVE_QUOTA_SCRIPT)

    def test_official_five_hour_window_is_never_fabricated(self):
        self.assertIn("const progresses = [...card.querySelectorAll", NATIVE_QUOTA_SCRIPT)
        self.assertIn("preserve its complete native UI", NATIVE_QUOTA_SCRIPT)
        self.assertIn('label === "5h"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('reset === "Unavailable"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('card.setAttribute("aria-label", `${copy.weeklyTitle}', NATIVE_QUOTA_SCRIPT)

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

    def test_official_fallback_uses_helper_payload_without_page_credentials(self):
        self.assertIn('const officialHostId = "codex-official-usage-host"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaUpdateOfficial", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialRequest__", NATIVE_QUOTA_SCRIPT)
        self.assertIn("requestOfficialData", NATIVE_QUOTA_SCRIPT)
        self.assertIn("renderOfficial", NATIVE_QUOTA_SCRIPT)
        self.assertIn('windows.length === 1 && windows[0].label === "Weekly"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("removeOfficialCard()", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("access_token", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("account_id", NATIVE_QUOTA_SCRIPT)

    def test_api_card_emphasizes_daily_remaining_amount(self):
        self.assertIn("(data.used / data.total) * 100", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const remainingPercent = 100 - usedPercent", NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiRemainingAria: "API 每日剩余"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiRemainingAria: "API daily remaining"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("copy.remainingAvailable", NATIVE_QUOTA_SCRIPT)

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
        self.assertIn("host.hidden = false", NATIVE_QUOTA_SCRIPT)
        self.assertIn("if (!bar)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const card = nativeQuotaCard()", NATIVE_QUOTA_SCRIPT)

    def test_card_present_accepts_api_or_official_card(self):
        connection = MagicMock()
        with patch("codex_quota.page_injector._connect", return_value=connection), \
             patch("codex_quota.page_injector._evaluate", return_value=True) as evaluate:
            self.assertTrue(card_present(9222, {"webSocketDebuggerUrl": "ws://test"}))
        expression = evaluate.call_args.args[1]
        self.assertIn("codex-api-usage-host", expression)
        self.assertIn("codex-official-usage-host", expression)
        self.assertIn('data-cq-layout="thread-v2"', expression)
        self.assertIn("bg-token-main-surface-primary", expression)
        self.assertIn("ring-border", expression)
        self.assertIn("bg-surface/80", expression)
        self.assertIn("progress[max='100']", expression)
        self.assertNotIn("__codexNativeQuotaPatched", expression)
        connection.close.assert_called_once_with()
