import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from codex_quota.discover import discover_credentials


class DiscoverTests(unittest.TestCase):
    def test_reads_only_official_credentials_and_ignores_api_configuration(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "CODEX_API_KEY": "ignored-key", "CODEX_API_BASE_URL": "https://unused.example.test",
            "CODEX_USAGE_URL": "https://unused.example.test/balance",
        }, clear=True):
            root = Path(folder)
            (root / "config.toml").write_text("invalid TOML is not read", encoding="utf-8")
            (root / "auth.json").write_text(json.dumps({
                "OPENAI_API_KEY": "ignored-key",
                "tokens": {"access_token": "official-token", "account_id": "account-id"},
            }), encoding="utf-8")
            credentials = discover_credentials(root)
            self.assertEqual(credentials.access_token, "official-token")
            self.assertEqual(credentials.account_id, "account-id")
            self.assertEqual(credentials.source, "codex-auth")
            self.assertFalse(hasattr(credentials, "api_key"))
            self.assertFalse(hasattr(credentials, "base_url"))

    def test_config_home_precedence_without_reading_real_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            locations = {"configured": parent / "configured", "explicit": parent / "explicit",
                         "fallback": parent / ".codex"}
            for name, location in locations.items():
                location.mkdir()
                (location / "auth.json").write_text(json.dumps({
                    "tokens": {"access_token": name, "account_id": name},
                }), encoding="utf-8")
            with patch.dict(os.environ, {"CODEX_HOME": str(locations["configured"])}, clear=True), \
                 patch("codex_quota.discover._home", return_value=parent):
                self.assertEqual(discover_credentials().account_id, "configured")
                self.assertEqual(discover_credentials(locations["explicit"]).account_id, "explicit")
                for value in ("", "   "):
                    os.environ["CODEX_HOME"] = value
                    self.assertEqual(discover_credentials().account_id, "fallback")
                os.environ["CODEX_HOME"] = str(parent / "missing")
                self.assertIsNone(discover_credentials().access_token)

    def test_api_login_does_not_reuse_old_official_tokens(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {}, clear=True):
            root = Path(folder)
            for mode in ("api", "apikey", " APIKEY "):
                with self.subTest(mode=mode):
                    (root / "auth.json").write_text(json.dumps({"auth_mode": mode,
                        "tokens": {"access_token": "old-token", "account_id": "old-account"}}), encoding="utf-8")
                    credentials = discover_credentials(root)
                    self.assertIsNone(credentials.access_token)
                    self.assertIsNone(credentials.account_id)

    def test_environment_credentials_do_not_mix_with_another_account(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "auth.json").write_text(json.dumps({
                "tokens": {"access_token": "file-token", "account_id": "file-account"},
            }), encoding="utf-8")
            for values in ({"CODEX_ACCESS_TOKEN": "env-token"}, {"CODEX_ACCOUNT_ID": "env-account"},
                           {"CODEX_ACCESS_TOKEN": "env-token", "CODEX_ACCOUNT_ID": "env-account"}):
                with self.subTest(values=values), patch.dict(os.environ, values, clear=True):
                    credentials = discover_credentials(root)
                    self.assertEqual(credentials.access_token, values.get("CODEX_ACCESS_TOKEN"))
                    self.assertEqual(credentials.account_id, values.get("CODEX_ACCOUNT_ID"))
                    self.assertEqual(credentials.source, "environment")
