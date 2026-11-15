import hashlib
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from codex_quota.page_injector import (
    NATIVE_PATCH_READY_SCRIPT,
    NATIVE_QUOTA_SCRIPT as BUNDLED_NATIVE_QUOTA_SCRIPT,
    PageInjectionError,
    _UNREPORTED_CDP_PORTS_PS,
    _connect,
    _discover_debug_port,
    _is_codex_main_page,
    _is_local_cdp_websocket,
    card_present,
    resolve_port,
    target_info,
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
    def test_automatic_port_uses_process_discovery(self):
        with patch("codex_quota.page_injector._discover_debug_port", return_value=9229) as discover:
            self.assertEqual(resolve_port(None), 9229)
        discover.assert_called_once_with()

    @unittest.skipUnless(shutil.which('powershell.exe') and shutil.which('pwsh'), 'Windows PowerShell required')
    def test_unreported_cdp_ports_are_limited_to_owned_loopback_bindings(self):
        rows = [
            dict(State=0, RemotePort=0, LocalPort=58353, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=0, LocalPort=58354, OwningProcess=42, LocalAddress='::1', RemoteAddress='::'),
            dict(State=0, RemotePort=0, LocalPort=58361, OwningProcess=42, LocalAddress='0:0:0:0:0:0:0:1', RemoteAddress='0:0:0:0:0:0:0:0'),
            dict(State=0, RemotePort=0, LocalPort=58355, OwningProcess=43, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=0, LocalPort=58356, OwningProcess=42, LocalAddress='192.168.1.10', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=9, LocalPort=58357, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=2, RemotePort=0, LocalPort=58358, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=None, RemotePort=0, LocalPort=58359, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=0, LocalPort=65536, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=0, LocalPort=0, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='0.0.0.0'),
            dict(State=0, RemotePort=0, LocalPort=58360, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='127.0.0.1'),
            dict(State=0, RemotePort=0, LocalPort=58362, OwningProcess=42, LocalAddress='127.0.0.1', RemoteAddress='::'),
            dict(State=0, RemotePort=0, LocalPort=58363, OwningProcess=42, LocalAddress='localhost', RemoteAddress='0.0.0.0'),
        ]
        import base64
        encoded = base64.b64encode(json.dumps(rows).encode()).decode('ascii')
        for shell in ('powershell.exe', 'pwsh'):
            with self.subTest(shell=shell):
                command = "$ErrorActionPreference='Stop'; $ids=@(42); " + \
                    "$rows=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))); " + \
                    "function Get-CimInstance { param($Namespace,$ClassName,$Filter,$ErrorAction) $rows }; " + \
                    "$result=@(& { " + _UNREPORTED_CDP_PORTS_PS + " }); ConvertTo-Json -Compress -InputObject $result"
                result = subprocess.run([shell, '-NoProfile', '-Command', command], capture_output=True, text=True, check=True, timeout=15)
                self.assertEqual(json.loads(result.stdout), [58353, 58354, 58361])
                failed = "$ErrorActionPreference='Stop'; $ids=@(42); function Get-CimInstance { throw 'unavailable' }; Write-Output 1234; " + _UNREPORTED_CDP_PORTS_PS
                result = subprocess.run([shell, '-NoProfile', '-Command', failed], capture_output=True, text=True, check=True, timeout=15)
                self.assertEqual(result.stdout.strip(), '1234')

    def test_discovery_validates_the_loopback_websocket_for_each_candidate(self):
        main = {'type': 'page', 'url': 'app://-/index.html', 'webSocketDebuggerUrl': 'ws://127.0.0.1:58353/devtools/page/a'}
        with patch('codex_quota.page_injector.os.name', 'nt'), \
             patch('codex_quota.page_injector.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='58353\n58353\n70000\n')), \
             patch('codex_quota.page_injector._targets', return_value=[main]) as targets:
            self.assertEqual(_discover_debug_port(), 58353)
            targets.assert_called_once_with(58353)
        with patch('codex_quota.page_injector._targets', return_value=[main]):
            self.assertEqual(target_info(58353), main)
            with self.assertRaises(PageInjectionError):
                target_info(58354)
        for url in ('ws://example.test:58353/devtools/page/a', 'ws://127.0.0.1:1234/devtools/page/a',
                    'ws://user@127.0.0.1:58353/devtools/page/a', 'wss://127.0.0.1:58353/devtools/page/a',
                    'ws://localhost:58353/devtools/page/a', 'ws://127.0.0.1:bad/devtools/page/a'):
            with self.subTest(url=url):
                self.assertFalse(_is_local_cdp_websocket(url, 58353))
        self.assertTrue(_is_local_cdp_websocket('ws://[::1]:58353/devtools/page/a', 58353))
        self.assertTrue(_is_local_cdp_websocket('ws://[0:0:0:0:0:0:0:1]:58353/devtools/page/a', 58353))
        with patch('codex_quota.page_injector.websocket.create_connection') as connect:
            with self.assertRaises(PageInjectionError):
                _connect({'webSocketDebuggerUrl': 'ws://example.test:58353/devtools/page/a'})
            connect.assert_not_called()

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

    def test_native_patch_only_exposes_official_quota_and_keeps_secrets_out_of_the_page(self):
        self.assertNotRegex(NATIVE_QUOTA_SCRIPT, r"__codexQuotaUpdateApi\s*=")
        for removed in ("__codexQuotaApiRequest__", "OPENAI_API_KEY",
                        "Authorization", "access_token", "account_id"):
            self.assertNotIn(removed, NATIVE_QUOTA_SCRIPT)
        self.assertIn('localStorage.setItem(settingsKey, JSON.stringify(preferences))', NATIVE_QUOTA_SCRIPT)

    def test_release_asset_matches_the_reviewed_page_script(self):
        self.assertEqual(BUNDLED_NATIVE_QUOTA_SCRIPT, ASSET_NATIVE_QUOTA_SCRIPT)
        digest = hashlib.sha256(NATIVE_QUOTA_SCRIPT.encode("utf-8")).hexdigest()
        self.assertIn(f"// Source SHA-256: {digest}", BUNDLED_NATIVE_QUOTA_SCRIPT)

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
        self.assertIn("更新失败，显示上次数据", NATIVE_QUOTA_SCRIPT)
        self.assertIn("刷新中…", NATIVE_QUOTA_SCRIPT)

    def test_card_present_accepts_local_and_official_entries_or_legacy_official_card(self):
        connection = MagicMock()
        with patch("codex_quota.page_injector._connect", return_value=connection), \
             patch("codex_quota.page_injector._evaluate", return_value=True) as evaluate:
            self.assertTrue(card_present(9222, {"webSocketDebuggerUrl": "ws://test"}))
        expression = evaluate.call_args.args[1]
        self.assertNotIn("codex-api-usage-host", expression)
        self.assertIn("codex-official-usage-host", expression)
        self.assertIn('data-cq-layout="thread-v2"', expression)
        self.assertIn("bg-token-main-surface-primary", expression)
        self.assertIn("ring-border", expression)
        self.assertIn("bg-surface/80", expression)
        self.assertIn("progress[max='100']", expression)
        self.assertNotIn("__codexNativeQuotaPatched", expression)
        connection.close.assert_called_once_with()

    @unittest.skipUnless(shutil.which('node'), 'Node.js required')
    def test_readiness_accepts_local_and_legacy_official_plugin_entries_only(self):
        result = subprocess.run(['node', '-e', r"""
const assert = require('node:assert/strict');
const expression = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
global.HTMLElement = class { constructor() { this.isConnected = true; this.hidden = true; } };
global.HTMLButtonElement = class extends HTMLElement {
  constructor() { super(); this.attributes = {'aria-controls': 'codex-quota-popover'}; }
  getAttribute(name) { return this.attributes[name] ?? null; }
};
const trigger = new HTMLButtonElement(), popover = new HTMLElement();
const state = {trigger, popover, duplicates: false};
global.document = {
  getElementById: id => ({'codex-quota-trigger': state.trigger, 'codex-quota-popover': state.popover})[id] ?? null,
  querySelectorAll: selector => state.duplicates ? [trigger, trigger] : selector === '#codex-quota-trigger' ? [trigger] : [popover],
};
for (const kind of ['local', 'official', 'api', 'other', null]) {
  trigger.attributes['data-cq-kind'] = kind;
  assert.equal(eval(expression), ['local', 'official'].includes(kind), `kind: ${kind}`);
}
trigger.attributes['data-cq-kind'] = 'local';
state.trigger = null; // A native quota button without our exact ID is not this plugin.
assert.equal(eval(expression), false);
state.trigger = trigger;
state.duplicates = true;
assert.equal(eval(expression), false);
state.duplicates = false;
popover.isConnected = false;
assert.equal(eval(expression), false);
popover.isConnected = true;
trigger.attributes['aria-controls'] = 'native-quota-menu';
assert.equal(eval(expression), false);
"""], input=json.dumps(NATIVE_PATCH_READY_SCRIPT), text=True, capture_output=True,
                                check=False, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

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
        for contract in ('#e2d8c4', 'min-width: 3px', 'border: .8px solid var(--cq-border)', '--color-surface-elevated-secondary',
                         '--color-text', 'prefers-reduced-motion: reduce',
                         '上次成功', '暂不可用'):
            self.assertIn(contract, NATIVE_QUOTA_SCRIPT)
