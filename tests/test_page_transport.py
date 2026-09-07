import json
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import websocket

from codex_quota.page_injector import PageInjectionError, _evaluate, _send_command, card_present


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
  ['api', true, false], ['api', false, true],
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
