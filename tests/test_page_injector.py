import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from codex_quota.page_injector import (
    CARD_SCRIPT,
    NATIVE_QUOTA_SCRIPT as BUNDLED_NATIVE_QUOTA_SCRIPT,
    _is_codex_main_page,
    card_present,
    resolve_port,
)

NATIVE_QUOTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "native-patch" / "native_patch.source.js"
).read_text(encoding="utf-8")

ASSET_NATIVE_QUOTA_SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "codex-usage-card"
    / "assets"
    / "native-patch"
    / "native_patch.js"
).read_text(encoding="utf-8")

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
        self.assertTrue(_is_codex_main_page({"title": "A renamed task window", "url": "app://-/index.html"}))
        self.assertFalse(_is_codex_main_page({
            "title": "Codex",
            "url": "app://-/index.html?initialRoute=%2Favatar-overlay",
        }))

    def test_reinstall_replaces_the_previous_page_observer(self):
        self.assertIn("__codexQuotaOfficialCardObserver?.disconnect()", NATIVE_QUOTA_SCRIPT)
        self.assertIn("globalThis.__codexQuotaOfficialCardObserver !== observer", NATIVE_QUOTA_SCRIPT)

    def test_native_patch_uses_injected_login_mode_and_keeps_secrets_out_of_the_page(self):
        self.assertIn("__codexQuotaMode", NATIVE_QUOTA_SCRIPT)
        self.assertIn('=== "api"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaUpdateApi", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiRequest__", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("Account\"], [\"api", NATIVE_QUOTA_SCRIPT)
        self.assertIn('localStorage.setItem(settingsKey, JSON.stringify(preferences))', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("account_id", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("access_token", NATIVE_QUOTA_SCRIPT)
        self.assertIn("Number(value).toFixed(2)", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("OPENAI_API_KEY", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("Authorization", NATIVE_QUOTA_SCRIPT)

    def test_release_asset_matches_the_reviewed_page_script(self):
        self.assertEqual(BUNDLED_NATIVE_QUOTA_SCRIPT, ASSET_NATIVE_QUOTA_SCRIPT)
        self.assertIn(NATIVE_QUOTA_SCRIPT.strip(), BUNDLED_NATIVE_QUOTA_SCRIPT)

    def test_auto_refresh_is_visibility_aware_and_rate_limited(self):
        self.assertIn("const staleAfterMs = 5 * 60 * 1000", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const adaptiveRefreshDelayMs = (now = Date.now()) =>", NATIVE_QUOTA_SCRIPT)
        self.assertIn("return 2 * 60 * 1000", NATIVE_QUOTA_SCRIPT)
        self.assertIn("return 15 * 60 * 1000", NATIVE_QUOTA_SCRIPT)
        self.assertIn("return 30 * 60 * 1000", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaLastInteractionAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaLastUsageActivityAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("quotaUsageFingerprint(data)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("recordQuotaInteraction(kind)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const scheduleAutoRefresh = () =>", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaAutoRefreshTimer", NATIVE_QUOTA_SCRIPT)
        self.assertIn('document.visibilityState !== "visible"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('window.addEventListener("focus", handler)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('document.addEventListener("visibilitychange", handler)', NATIVE_QUOTA_SCRIPT)
        self.assertIn("Math.max(1000, nextAt - Date.now())", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const networkNextAt = Math.max", NATIVE_QUOTA_SCRIPT)
        self.assertIn("applyOfficialTime(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("clearTimeout(globalThis.__codexQuotaAutoRefreshTimer)", NATIVE_QUOTA_SCRIPT)
        self.assertEqual(NATIVE_QUOTA_SCRIPT.count("setInterval("), 1)
        self.assertNotIn("__codexQuotaFocusRefreshInstalled", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("__codexQuotaOfficialFocusRefreshInstalled", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('document.addEventListener("keydown"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('document.addEventListener("pointerdown"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiLastSuccessAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiNextAutoAttemptAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiCooldownUntil", NATIVE_QUOTA_SCRIPT)
        self.assertIn("更新失败，显示上次数据", NATIVE_QUOTA_SCRIPT)
        self.assertIn("刷新中…", NATIVE_QUOTA_SCRIPT)

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

    def test_sidebar_v3_uses_host_anchors_and_native_popover(self):
        # Geometry, interactions, data semantics and scheduler behavior run in
        # native_patch_runtime.cjs; avoid freezing the obsolete card markup here.
        for contract in ('.sidebar-navigation', 'data-app-navigation-rail',
                         'codex-quota-trigger', 'codex-quota-popover',
                         'getBoundingClientRect()', 'ResizeObserver', 'popup.popover = "auto"'):
            self.assertIn(contract, NATIVE_QUOTA_SCRIPT)
        for obsolete in ('accountBar()', 'showModal()', 'updatePalette'):
            self.assertNotIn(obsolete, NATIVE_QUOTA_SCRIPT)

    def test_sidebar_v3_bundles_the_approved_track_and_host_tokens(self):
        for contract in ('#e2d8c4', 'min-width: 3px', 'backdrop-filter: blur(8px)', '--color-surface-elevated-secondary',
                         '--color-text', 'prefers-reduced-motion: reduce',
                         'data.remaining / data.total * 100', '上次成功', '暂不可用'):
            self.assertIn(contract, NATIVE_QUOTA_SCRIPT)
