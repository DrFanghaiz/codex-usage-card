import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DiscoveredCredentials:
    source: str
    access_token: str | None = None
    account_id: str | None = None


def _home() -> Path:
    return Path.home()


def discover_credentials(root: Path | None = None) -> DiscoveredCredentials:
    """Read official credentials from one source without exposing or persisting them."""
    access_token = os.environ.get("CODEX_ACCESS_TOKEN")
    account_id = os.environ.get("CODEX_ACCOUNT_ID")
    if access_token is not None or account_id is not None:
        return DiscoveredCredentials("environment", access_token, account_id)

    configured_home = os.environ.get("CODEX_HOME")
    config_root = root or (Path(configured_home) if configured_home and configured_home.strip() else _home() / ".codex")
    auth_path = config_root / "auth.json"
    if not auth_path.is_file():
        return DiscoveredCredentials("none")
    with auth_path.open("r", encoding="utf-8") as stream:
        auth = json.load(stream)
    if not isinstance(auth, dict) or str(auth.get("auth_mode", "")).strip().lower() in ("api", "apikey"):
        return DiscoveredCredentials("none")
    tokens = auth.get("tokens")
    if not isinstance(tokens, dict):
        return DiscoveredCredentials("none")
    access_token = tokens.get("access_token")
    account_id = tokens.get("account_id")
    return DiscoveredCredentials(
        source="codex-auth",
        access_token=access_token if isinstance(access_token, str) and access_token.strip() else None,
        account_id=account_id if isinstance(account_id, str) and account_id.strip() else None,
    )
