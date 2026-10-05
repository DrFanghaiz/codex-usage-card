import os
import json
import unittest
from unittest.mock import patch

from codex_quota.discover import DiscoveredCredentials
from codex_quota.model import OfficialUsageSnapshot
from codex_quota.provider import (
    OfficialQuotaProvider,
    QuotaProviderError,
    parse_official_usage_payload,
    snapshot_to_card_payload,
)


def official_payload():
    return {"plan_type": "plus", "rate_limit": {"allowed": True, "limit_reached": False,
        "primary_window": {"used_percent": 28, "limit_window_seconds": 604800, "reset_at": 1785379445},
        "secondary_window": None}}


class ProviderTests(unittest.TestCase):
    def test_parses_official_usage_windows(self):
        snapshot = parse_official_usage_payload(official_payload())
        self.assertIsInstance(snapshot, OfficialUsageSnapshot)
        self.assertEqual(snapshot.primary.window_minutes, 10080)
        self.assertIsNone(snapshot.secondary)
        payload = snapshot_to_card_payload(snapshot)
        self.assertEqual(payload["kind"], "official")
        self.assertEqual(payload["windows"][0]["label"], "Weekly")
        self.assertEqual(payload["windows"][0]["used_percent"], 28)

    def test_rejects_official_unknown_shape(self):
        for payload in ({"plan_type": "plus", "rate_limit": {}}, {"isValid": True, "remaining": 100}):
            with self.subTest(payload=payload), self.assertRaises(QuotaProviderError):
                parse_official_usage_payload(payload)

    def test_rejects_invalid_official_windows(self):
        for field in ("used_percent", "limit_window_seconds", "reset_at"):
            for value in (float("nan"), float("inf"), float("-inf"), 10 ** 1000, True, -1):
                with self.subTest(field=field, value=str(value)[:16]):
                    payload = official_payload()
                    payload["rate_limit"]["primary_window"][field] = value
                    with self.assertRaises(QuotaProviderError):
                        parse_official_usage_payload(payload)
        payload = official_payload()
        payload["rate_limit"]["primary_window"]["used_percent"] = 101
        with self.assertRaises(QuotaProviderError):
            parse_official_usage_payload(payload)

    def test_missing_official_login_fails_before_network(self):
        for token, account in ((None, None), ("token", None), (None, "account"), (" ", "account")):
            with self.subTest(token=token, account=account), patch("codex_quota.provider._get_json") as request:
                provider = OfficialQuotaProvider(credentials=DiscoveredCredentials("test", token, account))
                with self.assertRaisesRegex(QuotaProviderError, "未登录官方账户"):
                    provider.fetch()
                request.assert_not_called()

    def test_official_fetch_ignores_legacy_external_endpoints(self):
        with patch.dict(os.environ, {"CODEX_USAGE_URL": "https://unused.example.test/balance",
                "CODEX_OFFICIAL_USAGE_URL": "https://unused.example.test/quota"}, clear=True), \
             patch("codex_quota.provider._get_json", return_value=official_payload()) as request:
            snapshot = OfficialQuotaProvider(credentials=DiscoveredCredentials("test", "token", "account")).fetch()
        self.assertEqual(snapshot.primary.used_percent, 28)
        request.assert_called_once_with("https://chatgpt.com/backend-api/wham/usage", {
            "Accept": "application/json", "Authorization": "Bearer token", "ChatGPT-Account-ID": "account",
        }, 10.0)

    def test_unreadable_or_invalid_auth_is_a_reportable_provider_error(self):
        for error in (PermissionError("synthetic auth denied"),
                      json.JSONDecodeError("synthetic invalid auth", "{", 0),
                      UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid")):
            with self.subTest(error=type(error).__name__), \
                 patch("codex_quota.provider.discover_credentials", side_effect=error), \
                 patch("codex_quota.provider._get_json") as request:
                with self.assertRaisesRegex(QuotaProviderError, "官方登录信息读取失败") as raised:
                    OfficialQuotaProvider()
                self.assertIs(raised.exception.__cause__, error)
                request.assert_not_called()
