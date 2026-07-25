import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from codex_quota.repair import (
    RepairMatchError,
    discover_latest_package,
    inspect_package,
    repair_once,
    watch,
)


class RepairTests(unittest.TestCase):
    def _package(self, name="OpenAI.Codex", version="26.715.10079.0", parent=None):
        folder = Path(tempfile.mkdtemp(prefix=f"OpenAI.Codex_{version}_", dir=parent))
        (folder / "app").mkdir()
        (folder / "app" / "ChatGPT.exe").write_bytes(b"test")
        (folder / "AppxManifest.xml").write_text(
            f'<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">'
            f'<Identity Name="{name}" Version="{version}" /></Package>',
            encoding="utf-8",
        )
        return folder

    def test_matches_known_structure(self):
        match = inspect_package(self._package())
        self.assertEqual(match.package_name, "OpenAI.Codex")

    def test_rejects_other_package(self):
        with self.assertRaises(RepairMatchError):
            inspect_package(self._package(name="Other.App"))

    def test_discovers_highest_manifest_version(self):
        parent = Path(tempfile.mkdtemp())
        self._package(version="26.715.10079.0", parent=parent)
        newer = self._package(version="26.716.10000.0", parent=parent)
        match = discover_latest_package(parent)
        self.assertEqual(match.version, "26.716.10000.0")
        self.assertEqual(match.root, str(newer))

    def test_rejects_duplicate_latest_version(self):
        parent = Path(tempfile.mkdtemp())
        self._package(version="26.716.10000.0", parent=parent)
        self._package(version="26.716.10000.0", parent=parent)
        with self.assertRaises(RepairMatchError):
            discover_latest_package(parent)

    def test_repair_validates_before_injecting(self):
        package = self._package()
        with patch("codex_quota.repair.target_info", return_value={"id": "1"}) as target, \
             patch("codex_quota.repair.inject") as inject:
            match = repair_once(package_root=package, port=9222)
        target.assert_called_once_with(9222)
        inject.assert_called_once_with(9222)
        self.assertEqual(match.version, "26.715.10079.0")

    def test_watch_repairs_when_card_is_missing(self):
        package = self._package()
        target = {"id": "1", "url": "app://-/index.html", "title": "Codex"}
        messages = []
        with patch("codex_quota.repair.discover_latest_package", return_value=inspect_package(package)), \
             patch("codex_quota.repair.target_info", return_value=target), \
             patch("codex_quota.repair._connect", return_value=MagicMock()), \
             patch("codex_quota.repair._patch_connection") as patch_connection:
            watch(port=9222, interval=1, max_cycles=1, write=messages.append)
        patch_connection.assert_called_once()
        self.assertIn('"repaired": true', messages[0])

    def test_watch_keeps_connection_when_native_patch_is_present(self):
        package = self._package()
        target = {"id": "1", "url": "app://-/index.html", "title": "Codex"}
        messages = []
        with patch("codex_quota.repair.discover_latest_package", return_value=inspect_package(package)), \
             patch("codex_quota.repair.target_info", return_value=target), \
             patch("codex_quota.repair._connect", return_value=MagicMock()), \
             patch("codex_quota.repair._patch_connection") as patch_connection, \
             patch("codex_quota.repair._evaluate", return_value=True):
            watch(port=9222, interval=1, refresh_interval=60, max_cycles=2, sleep=lambda _: None, write=messages.append)
        patch_connection.assert_called_once()
        self.assertIn('"reason": "restore"', messages[0])
