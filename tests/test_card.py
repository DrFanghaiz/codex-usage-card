import unittest

from codex_quota.api_card import format_amount


class CardTests(unittest.TestCase):
    def test_formats_amount_with_two_decimals(self):
        self.assertEqual(format_amount(1), "1.00")
        self.assertEqual(format_amount(1.236), "1.24")
