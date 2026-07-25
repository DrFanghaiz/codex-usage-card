import json
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DiscoveredCredentials:
    base_url: str | None
    api_key: str | None
    source: str
    access_token: str | None = None
    account_id: str | None = None


def _home() -> Path:
    return Path.home()


def discover_credentials(root: Path | None = None) -> DiscoveredCredentials:
    """Read configured endpoint and key without printing or persisting secrets."""
    config_root = root or (_home() / ".codex")
    base_url = os.environ.get("CODEX_API_BASE_URL")
    api_key = os.environ.get("CODEX_API_KEY")
    access_token = os.environ.get("CODEX_ACCESS_TOKEN")
    account_id = os.environ.get("CODEX_ACCOUNT_ID")
    sources = []
    if base_url is not None or api_key is not None or access_token is not None or account_id is not None:
        sources.append("environment")

    config_path = config_root / "config.toml"
    if config_path.is_file():
        with config_path.open("rb") as stream:
            config = tomllib.load(stream)
        provider_name = config.get("model_provider")
        providers = config.get("model_providers", {})
        provider = providers.get(provider_name, {}) if isinstance(providers, dict) else {}
        if base_url is None and isinstance(provider, dict):
            configured_url = provider.get("base_url")
            if isinstance(configured_url, str) and configured_url:
                base_url = configured_url
        sources.append("codex-config")

    auth_path = config_root / "auth.json"
    if auth_path.is_file():
        with auth_path.open("r", encoding="utf-8") as stream:
            auth = json.load(stream)
        auth_source = False
        configured_key = auth.get("OPENAI_API_KEY") if isinstance(auth, dict) else None
        if api_key is None and isinstance(configured_key, str) and configured_key:
            api_key = configured_key
            auth_source = True
        tokens = auth.get("tokens") if isinstance(auth, dict) else None
        if isinstance(tokens, dict):
            configured_access_token = tokens.get("access_token")
            configured_account_id = tokens.get("account_id")
            if access_token is None and isinstance(configured_access_token, str) and configured_access_token:
                access_token = configured_access_token
                auth_source = True
            if account_id is None and isinstance(configured_account_id, str) and configured_account_id:
                account_id = configured_account_id
                auth_source = True
        if auth_source:
            sources.append("codex-auth")

    return DiscoveredCredentials(
        base_url=base_url,
        api_key=api_key,
        source="+".join(sources) if sources else "none",
        access_token=access_token,
        account_id=account_id,
    )
