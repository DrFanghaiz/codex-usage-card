import unittest
from datetime import datetime

from codex_quota.discover import DiscoveredCredentials
from codex_quota.model import OfficialUsageSnapshot
from codex_quota.provider import (
    ApiQuotaProvider,
    QuotaProviderError,
    parse_api_usage_payload,
    parse_official_usage_payload,
    parse_quota_payload,
    select_provider,
    snapshot_to_card_payload,
)


class ProviderTests(unittest.TestCase):
    def test_parses_contract(self):
        snapshot = parse_quota_payload({
            "five_hour": {"used_percent": 5, "reset_at": "2026-07-25T07:52:00+08:00"},
            "weekly": {"used_percent": 30, "reset_at": None},
        })
        self.assertEqual(snapshot.five_hour.used_percent, 5.0)
        self.assertIsInstance(snapshot.five_hour.reset_at, datetime)
        self.assertIsNone(snapshot.weekly.reset_at)

    def test_rejects_unknown_shape(self):
        with self.assertRaises(QuotaProviderError):
            parse_quota_payload({"usage": 30})

    def test_rejects_invalid_percentage(self):
        with self.assertRaises(QuotaProviderError):
            parse_quota_payload({
                "five_hour": {"used_percent": 101, "reset_at": None},
                "weekly": {"used_percent": 30, "reset_at": None},
            })

    def test_parses_api_usage_contract(self):
        snapshot = parse_api_usage_payload({
            "isValid": True,
            "planName": "Daily",
            "unit": "USD",
            "remaining": 80.0,
            "subscription": {"daily_usage_usd": 20.0, "daily_limit_usd": 100},
        })
        self.assertEqual(snapshot.remaining, 80.0)
        self.assertEqual(snapshot.unit, "USD")

    def test_accepts_zero_daily_limit_as_unlimited(self):
        snapshot = parse_api_usage_payload({
            "isValid": True,
            "planName": "Unlimited",
            "remaining": 10,
            "unit": "USD",
            "subscription": {"daily_usage_usd": 20.0, "daily_limit_usd": 0},
        })
        self.assertIsNone(snapshot.total)

    def test_parses_current_api_daily_usage_contract(self):
        snapshot = parse_api_usage_payload({
            "isValid": True,
            "planName": "API",
            "remaining": 80,
            "unit": "USD",
            "usage": {"today": {"cost": 20}},
        })
        self.assertEqual(snapshot.used, 20.0)
        self.assertIsNone(snapshot.total)

    def test_parses_official_usage_windows(self):
        snapshot = parse_official_usage_payload({
            "plan_type": "plus",
            "rate_limit": {
                "allowed": True,
                "limit_reached": False,
                "primary_window": {
                    "used_percent": 28,
                    "limit_window_seconds": 604800,
                    "reset_at": 1785379445,
                },
                "secondary_window": None,
            },
        })
        self.assertIsInstance(snapshot, OfficialUsageSnapshot)
        self.assertEqual(snapshot.primary.window_minutes, 10080)
        self.assertIsNone(snapshot.secondary)
        payload = snapshot_to_card_payload(snapshot)
        self.assertEqual(payload["kind"], "official")
        self.assertEqual(payload["windows"][0]["label"], "Weekly")

    def test_rejects_official_unknown_shape(self):
        with self.assertRaises(QuotaProviderError):
            parse_official_usage_payload({"plan_type": "plus", "rate_limit": {}})

    def test_official_auth_selects_official_provider(self):
        provider = select_provider(DiscoveredCredentials(
            base_url=None,
            api_key=None,
            source="test",
            access_token="token",
            account_id="account",
        ))
        self.assertEqual(provider.__class__.__name__, "OfficialQuotaProvider")

    def test_api_usage_url_does_not_duplicate_v1(self):
        provider = ApiQuotaProvider(credentials=DiscoveredCredentials(
            base_url="https://api.example.test/v1",
            api_key="test-key",
            source="test",
        ))
        self.assertEqual(provider.url, "https://api.example.test/v1/usage")
