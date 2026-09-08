import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from codex_quota.page_injector import (
    CARD_SCRIPT,
    NATIVE_QUOTA_SCRIPT,
    _is_codex_main_page,
    card_present,
    resolve_port,
)


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
        self.assertIn('attributeFilter: ["value", "class", "style", "hidden", "data-theme", "data-color-theme"]', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("client._setStatus", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-sans: var(--default-font-family", NATIVE_QUOTA_SCRIPT)
        self.assertIn("new MutationObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialCardObserver?.disconnect()", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addWindow("5h"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("5h unavailable", NATIVE_QUOTA_SCRIPT)

    def test_thread_layout_uses_one_percentage_source_and_theme_safe_tokens(self):
        self.assertIn("--cq-sidebar: var(--color-token-side-bar-background", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-border: color-mix(in srgb, var(--cq-ink) 9%", NATIVE_QUOTA_SCRIPT)
        self.assertIn("--cq-theme-accent: var(--codex-base-accent", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#FCFAF4", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#B4552D", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("html.electron-dark", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("--cq-serif", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const used = 100 - remaining", NATIVE_QUOTA_SCRIPT)
        self.assertIn('officialSourceAria: "官方账户"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('officialSourceAria: "Official account"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('remainingSuffix: ""', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.querySelector(".cq-number-value").textContent = preferences.remaining ? remainingText : usedText', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.querySelector(".cq-remaining-value").textContent = `${preferences.remaining ? usedText : remainingText}%`', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.style.setProperty("--cq-used", `${preferences.remaining ? 100 - used : used}%`)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('data-cq-layout="thread-v2"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('replace(/^.*下次重置时间为\\s*/', NATIVE_QUOTA_SCRIPT)
        self.assertIn("cq-thread-meta", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-thread-info", NATIVE_QUOTA_SCRIPT)
        self.assertIn("cq-thread-reset", NATIVE_QUOTA_SCRIPT)
        self.assertIn('resetCountdownPrefix: "距离自然重置"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("formatResetCountdown", NATIVE_QUOTA_SCRIPT)
        self.assertIn("Math.floor(remainingMs / 86400000)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("applyOfficialCountdown", NATIVE_QUOTA_SCRIPT)
        self.assertIn("padding: 12px 14px 11px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("border-radius: 12px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("align-items: flex-end; min-width: 0; margin-top: 6px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("flex: 1; height: 2px; margin: 0 10px 2px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("flex: none; padding-bottom: 1px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("margin-top: 8px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("container-type: inline-size", NATIVE_QUOTA_SCRIPT)
        self.assertIn("@container (max-width: 170px)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("margin-inline: 6px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("@container (max-width: 147px)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("align-items: stretch; flex-direction: column; gap: 4px", NATIVE_QUOTA_SCRIPT)
        self.assertIn(".cq-reset-date { text-align: right; }", NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.dataset.cqLayout = "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('currentLayout !== "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("font-size: 24px; font-weight: 600", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("height: 2px; margin-top: 9px", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#FAF7EF", NATIVE_QUOTA_SCRIPT)
        self.assertIn("box-shadow: none !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("width: calc(100% - 16px) !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("margin: 0 8px 8px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("padding: 12px 14px 11px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("border: 1px solid var(--cq-border) !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("border-radius: 12px !important", NATIVE_QUOTA_SCRIPT)
        self.assertIn("background: var(--cq-solid) !important", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-rule-marker", NATIVE_QUOTA_SCRIPT)
        self.assertIn('@media (prefers-reduced-motion: reduce)', NATIVE_QUOTA_SCRIPT)
        self.assertIn("style.textContent !== css", NATIVE_QUOTA_SCRIPT)
        self.assertIn("legacyProgresses", NATIVE_QUOTA_SCRIPT)
        self.assertIn('existing.querySelector(".cq-folio-note b")', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-scale", NATIVE_QUOTA_SCRIPT)
        self.assertIn("backdrop-filter: blur(18px)", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("#8E4617", NATIVE_QUOTA_SCRIPT)

    def test_official_windows_are_never_fabricated(self):
        self.assertIn("const progresses = [...card.querySelectorAll", NATIVE_QUOTA_SCRIPT)
        self.assertIn('const fiveHour = windows.find((window) => window.label === "5h")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('const weekly = windows.find((window) => window.label === "Weekly")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('planName === "plus" && windows.length === 2 && fiveHour && weekly', NATIVE_QUOTA_SCRIPT)
        self.assertIn("else if (progresses.length !== 2)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("Preserve every other multi-window shape", NATIVE_QUOTA_SCRIPT)
        self.assertIn('label === "5h"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('reset === "Unavailable"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('card.setAttribute("aria-label", `${copy.officialSourceAria}', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addWindow("5h"', NATIVE_QUOTA_SCRIPT)

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

    def test_official_fallback_uses_helper_payload_without_page_credentials(self):
        self.assertIn('const officialHostId = "codex-official-usage-host"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaUpdateOfficial", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialRequest__", NATIVE_QUOTA_SCRIPT)
        self.assertIn("requestOfficialData", NATIVE_QUOTA_SCRIPT)
        self.assertIn("renderOfficial", NATIVE_QUOTA_SCRIPT)
        self.assertIn("officialPresentation(data)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('presentation?.kind === "plus-x"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('presentation?.kind === "weekly"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('presentation?.kind === "fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("renderOfficialPlus(card", NATIVE_QUOTA_SCRIPT)
        self.assertIn("renderOfficial(nativeCard, data", NATIVE_QUOTA_SCRIPT)
        self.assertIn('existing?.dataset.cqLayout === "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertGreaterEqual(
            NATIVE_QUOTA_SCRIPT.count('nativeCard.querySelector(`.${compactContentClass}`)'),
            2,
        )
        self.assertIn("removeOfficialCard()", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("access_token", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("account_id", NATIVE_QUOTA_SCRIPT)

    def test_plus_x_and_pro_variants_follow_the_selected_spec(self):
        self.assertIn('fiveHourTitle: "5小时已用"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('fiveHourTitle: "5h used"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('fiveHourUsedAria: "5小时已用"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('planLabel: planName === "pro" ? "Pro" : ""', NATIVE_QUOTA_SCRIPT)
        self.assertIn('planLabel: "Plus"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('variant: "a2-plus-x-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('summary.classList.add("cq-week-summary")', NATIVE_QUOTA_SCRIPT)
        self.assertIn("display: inline-flex; align-items: baseline; gap: 3px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("font-size: 9px", NATIVE_QUOTA_SCRIPT)
        self.assertIn('resetDate: ""', NATIVE_QUOTA_SCRIPT)
        self.assertIn("formatResetCountdown(fiveHour.resetAt, true)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('`${hours}小时 ${minutes}分`', NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.dataset.cqVariant === "a2-plus-x-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("content.dataset.cqWeeklyUsed", NATIVE_QUOTA_SCRIPT)
        self.assertIn("content.dataset.cqWeeklyUsed !== formatPercent(weeklyUsed)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("dateNode.textContent !== resetDate", NATIVE_QUOTA_SCRIPT)
        self.assertIn('content.querySelector(".cq-week-summary")?.setAttribute(', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-week-divider", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("cq-week-used-suffix", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("formatOfficialReset(fiveHour.resetAt)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("applyOfficialSourceValues(nativeCard, data)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('progress[data-cq-window-label="${window.label}"]', NATIVE_QUOTA_SCRIPT)
        self.assertIn('progress.dataset.cqWindowLabel = "Weekly"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('window.label === "Weekly" && existing.dataset.cqVariant === "a2-merge-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('progress = document.createElement("progress")', NATIVE_QUOTA_SCRIPT)
        self.assertIn("setOfficialCardAria(card, content)", NATIVE_QUOTA_SCRIPT)

    def test_release_asset_matches_the_reviewed_page_script(self):
        self.assertEqual(NATIVE_QUOTA_SCRIPT, ASSET_NATIVE_QUOTA_SCRIPT)

    def test_api_card_emphasizes_daily_remaining_amount(self):
        self.assertIn("(data.used / data.total) * 100", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const remainingPercent = 100 - usedPercent", NATIVE_QUOTA_SCRIPT)
        self.assertIn("host.classList.remove(compactClass)", NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiRemainingAria: "API 每日剩余"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiRemainingAria: "API daily remaining"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("copy.remainingAvailable", NATIVE_QUOTA_SCRIPT)

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
        self.assertIn('data-cq-variant="a2-plus-x-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("60000 - (now % 60000)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("const networkNextAt = Math.max", NATIVE_QUOTA_SCRIPT)
        self.assertIn("applyOfficialCountdown(card, globalThis.__codexQuotaOfficialPayload || null)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("clearTimeout(globalThis.__codexQuotaAutoRefreshTimer)", NATIVE_QUOTA_SCRIPT)
        self.assertEqual(NATIVE_QUOTA_SCRIPT.count("setInterval("), 1)
        self.assertNotIn("__codexQuotaFocusRefreshInstalled", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("__codexQuotaOfficialFocusRefreshInstalled", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addEventListener("keydown"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('addEventListener("pointerdown"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiLastSuccessAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiNextAutoAttemptAt", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiCooldownUntil", NATIVE_QUOTA_SCRIPT)
        self.assertIn("更新失败，显示上次数据", NATIVE_QUOTA_SCRIPT)
        self.assertIn("刷新中…", NATIVE_QUOTA_SCRIPT)

    def test_quota_card_states_copy_accessibility_and_motion_are_explicit(self):
        self.assertIn('weeklyTitle: "本周已用"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('weeklyTitle: "Weekly used"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiTitle: "API 剩余"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('apiTitle: "API remaining"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('return isChinese ? `${days}天 ${hours}小时`', NATIVE_QUOTA_SCRIPT)

        self.assertIn('loading: "正在读取…"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('stalePrefix: "更新失败，显示 "', NATIVE_QUOTA_SCRIPT)
        self.assertIn('cooldownPrefix: "暂时不可用，"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("formatStatusTime(lastSuccessAt)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaApiErrorCode", NATIVE_QUOTA_SCRIPT)
        self.assertIn("__codexQuotaOfficialErrorCode", NATIVE_QUOTA_SCRIPT)
        self.assertIn('data?.errorCode || "UNAVAILABLE"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("error || copy.officialUnavailable", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn("error || copy.unavailable", NATIVE_QUOTA_SCRIPT)

        self.assertIn('const requestOfficialData = (manual = false)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('requestOfficialData(true)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('showCooldown("api", cooldownUntil)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('showCooldown("official", cooldownUntil)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('const staleThread = currentLayout === "thread-v2"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('!host.querySelector(".cq-refresh-icon")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('!host.querySelector(".cq-clock")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('const staleFallback = currentLayout === "thread-v2-fallback"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('card.setAttribute("role", "region")', NATIVE_QUOTA_SCRIPT)
        self.assertIn(".${compactClass}[role='region']", NATIVE_QUOTA_SCRIPT)
        self.assertIn('card.setAttribute("aria-busy", String(busy))', NATIVE_QUOTA_SCRIPT)
        self.assertIn('status.setAttribute("aria-live", "polite")', NATIVE_QUOTA_SCRIPT)
        self.assertIn('if (needsData) return {busy: true, text: data ? copy.refreshing : copy.loading}', NATIVE_QUOTA_SCRIPT)
        self.assertIn('progress.setAttribute("aria-valuetext"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('class="cq-refresh-icon"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('class="cq-clock"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('variant = "a2-merge-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('variant: "a2-plus-x-v1"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('<div class="cq-thread-rule" role="progressbar"', NATIVE_QUOTA_SCRIPT)
        self.assertIn('class="cq-reset-date"', NATIVE_QUOTA_SCRIPT)
        self.assertIn("formatResetDate", NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('transform: scale(.94)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('button.setAttribute("aria-label", label)', NATIVE_QUOTA_SCRIPT)
        self.assertIn('button.title = label', NATIVE_QUOTA_SCRIPT)
        self.assertIn('resetNode.setAttribute("aria-label"', NATIVE_QUOTA_SCRIPT)
        self.assertNotIn('refresh.textContent = copy.refreshing', NATIVE_QUOTA_SCRIPT)

        self.assertIn("font-size: 10.5px", NATIVE_QUOTA_SCRIPT)
        self.assertIn("var(--cq-theme-ink) 78%", NATIVE_QUOTA_SCRIPT)
        self.assertIn("@media (prefers-contrast: more)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("@media (forced-colors: active)", NATIVE_QUOTA_SCRIPT)
        self.assertIn("transition: width .18s", NATIVE_QUOTA_SCRIPT)
        self.assertIn("prefers-reduced-motion: reduce", NATIVE_QUOTA_SCRIPT)

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
