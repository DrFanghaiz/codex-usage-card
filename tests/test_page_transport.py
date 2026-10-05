import json
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import websocket

from codex_quota.page_injector import PageInjectionError, NATIVE_QUOTA_SCRIPT, _evaluate, _send_command, _patch_connection, card_present


class PageTransportTests(unittest.TestCase):
    def test_transport_errors_preserve_the_cause(self):
        for operation in ("send", "recv"):
            for error in (websocket.WebSocketConnectionClosedException("closed"),
                          websocket.WebSocketTimeoutException("timeout"), OSError("connection lost")):
                with self.subTest(operation=operation, error=type(error).__name__):
                    connection = MagicMock()
                    getattr(connection, operation).side_effect = error
                    with self.assertRaises(PageInjectionError) as raised:
                        _evaluate(connection, "true", 1)
                    self.assertIs(raised.exception.__cause__, error)

    def test_invalid_json_is_a_page_injection_error(self):
        connection = MagicMock()
        connection.recv.return_value = ""
        with self.assertRaises(PageInjectionError) as raised:
            _send_command(connection, "Page.enable", {}, 1)
        self.assertIsInstance(raised.exception.__cause__, json.JSONDecodeError)

    def test_evaluation_ignores_events_and_reports_script_exceptions(self):
        connection = MagicMock()
        connection.recv.side_effect = [
            json.dumps({"method": "Page.loadEventFired"}),
            json.dumps({"id": 1, "result": {"result": {"value": True}}}),
        ]
        self.assertTrue(_evaluate(connection, "true", 1))
        request = json.loads(connection.send.call_args.args[0])
        self.assertEqual(request["method"], "Runtime.evaluate")
        self.assertEqual(request["params"], {"expression": "true", "returnByValue": True})
        connection.recv.side_effect = None
        connection.recv.return_value = json.dumps({
            "id": 2,
            "result": {"result": {"type": "string", "value": "failure"},
                       "exceptionDetails": {"text": "Uncaught"}},
        })
        with self.assertRaises(PageInjectionError):
            _evaluate(connection, "throw 'failure'", 2)

    def test_card_presence_checks_visibility_and_current_official_cards(self):
        connection = MagicMock()
        with patch("codex_quota.page_injector._connect", return_value=connection), \
             patch("codex_quota.page_injector._evaluate", return_value=True) as evaluate:
            card_present(9222, {"webSocketDebuggerUrl": "ws://synthetic"})
        expression = evaluate.call_args.args[1]
        result = subprocess.run(["node", "-e", r"""
const assert = require('node:assert/strict');
const expression = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
global.HTMLElement = class {
  constructor(hidden = false) { this.hidden = hidden; this.offsetParent = hidden ? null : {}; }
  querySelector() { return {}; }
};
for (const [kind, hidden, expected] of [
  ['api', true, false], ['api', false, false],
  ['official', true, false], ['official', false, true],
  ['compact', true, false], ['compact', false, true], ['none', false, false]
]) {
  const card = new HTMLElement(hidden);
  global.document = {
    getElementById: (id) => id === `codex-${kind}-usage-host` ? card : null,
    querySelectorAll: (selector) => kind === 'compact' && selector === '.codex-native-compact-usage' ? [card] : []
  };
  assert.equal(eval(expression), expected, `${kind}, hidden=${hidden}`);
}
"""], input=json.dumps(expression), text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        connection.close.assert_called_once_with()

    def test_malformed_cdp_envelopes_are_reportable_transport_errors(self):
        for response in (None, [], {"id": 1}, {"id": 1, "result": None},
                         {"id": 1, "result": {"result": None}}):
            with self.subTest(response=response):
                connection = MagicMock()
                connection.recv.return_value = json.dumps(response)
                with self.assertRaises(PageInjectionError):
                    _evaluate(connection, "true", 1)

    def test_install_accepts_mounted_official_entry_without_statsig(self):
        def evaluate(_connection, expression, _command_id):
            if expression == NATIVE_QUOTA_SCRIPT:
                return True
            script = r"""
const expression = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
global.HTMLElement = class { constructor() { this.isConnected = true; } };
global.HTMLButtonElement = class extends HTMLElement {
  getAttribute(key) { return {'aria-controls':'codex-quota-popover','data-cq-kind':'official'}[key]; }
};
const assert = require('node:assert/strict');
const trigger = new HTMLButtonElement(), popover = new HTMLElement();
const state = {trigger, popover, duplicates: false};
global.document = {
  getElementById: id => ({'codex-quota-trigger':state.trigger,'codex-quota-popover':state.popover})[id],
  querySelectorAll: selector => state.duplicates ? [trigger, trigger] : selector === '#codex-quota-trigger' ? [trigger] : [popover]
};
trigger.hidden = true; // A hidden sidebar does not require reinjection.
assert.equal(eval(expression), true);
state.duplicates = true;
assert.equal(eval(expression), false);
state.duplicates = false;
state.popover = null;
assert.equal(eval(expression), false);
state.popover = popover;
process.stdout.write(JSON.stringify(eval(expression)));
"""
            result = subprocess.run(['node', '-e', script], input=json.dumps(expression),
                                    text=True, capture_output=True, check=True, timeout=5)
            return json.loads(result.stdout)
        with patch('codex_quota.page_injector._evaluate', side_effect=evaluate), \
             patch('codex_quota.page_injector.time.monotonic', side_effect=[0, 0, 1]), \
             patch('codex_quota.page_injector.time.sleep'):
            _patch_connection(MagicMock(), persist=False, wait_seconds=0.5)
