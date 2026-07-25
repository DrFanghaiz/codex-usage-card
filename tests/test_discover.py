import json
import tempfile
import unittest
from pathlib import Path

from codex_quota.discover import discover_credentials


class DiscoverTests(unittest.TestCase):
    def test_reads_codex_config_without_exposing_key(self):
        root = Path(tempfile.mkdtemp())
        (root / "config.toml").write_text(
            'model_provider = "custom"\n'
            '[model_providers.custom]\nbase_url = "https://example.test"\n',
            encoding="utf-8",
        )
        (root / "auth.json").write_text(json.dumps({
            "OPENAI_API_KEY": "secret",
            "tokens": {"access_token": "official-token", "account_id": "account-id"},
        }), encoding="utf-8")
        credentials = discover_credentials(root)
        self.assertEqual(credentials.base_url, "https://example.test")
        self.assertEqual(credentials.api_key, "secret")
        self.assertEqual(credentials.access_token, "official-token")
        self.assertEqual(credentials.account_id, "account-id")
