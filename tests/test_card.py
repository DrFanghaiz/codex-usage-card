import unittest
from unittest.mock import patch

from codex_quota.card import OfficialUsageCard
from codex_quota.model import OfficialUsageSnapshot, QuotaWindow
from codex_quota.provider import QuotaProviderError


class CardTests(unittest.TestCase):
    def test_official_track_represents_used_quota(self):
        for used in (0, 28, 100):
            with self.subTest(used=used), \
                 patch("tkinter.Frame.__init__", return_value=None), \
                 patch.object(OfficialUsageCard, "configure"), \
                 patch.object(OfficialUsageCard, "pack_propagate"), \
                 patch.object(OfficialUsageCard, "_label") as label, \
                 patch("codex_quota.card.tk.Frame") as frame:
                OfficialUsageCard(None, OfficialUsageSnapshot("pro", QuotaWindow(used, None, 10080), None))
                widths = [call.kwargs["relwidth"] for call in frame.return_value.place.call_args_list]
                self.assertEqual(widths, [used / 100])
                self.assertIn(f"已用 {used}%", [call.args[0] for call in label.call_args_list])

    def test_missing_login_keeps_official_card_and_explicit_error(self):
        from codex_quota.__main__ import main
        with patch("codex_quota.__main__.OfficialQuotaProvider") as provider, \
             patch("codex_quota.__main__.OfficialUsageCard") as card, \
             patch("codex_quota.__main__.tk.Tk") as root:
            provider.return_value.fetch.side_effect = QuotaProviderError("未登录官方账户")
            main()
            card.assert_called_once_with(root.return_value, snapshot=None, error="未登录官方账户")
