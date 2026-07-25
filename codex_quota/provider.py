import json
import os
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from .discover import DiscoveredCredentials, discover_credentials
from .model import ApiUsageSnapshot, OfficialUsageSnapshot, QuotaSnapshot, QuotaWindow


class QuotaProviderError(RuntimeError):
    pass


def _window(payload: dict, name: str) -> QuotaWindow:
    value = payload.get(name)
    if not isinstance(value, dict):
        raise QuotaProviderError(f"missing object: {name}")
    used = value.get("used_percent")
    if not isinstance(used, (int, float)) or isinstance(used, bool) or not 0 <= used <= 100:
        raise QuotaProviderError(f"invalid used_percent: {name}")
    reset_raw = value.get("reset_at")
    if reset_raw is None:
        reset_at = None
    elif isinstance(reset_raw, str):
        try:
            reset_at = datetime.fromisoformat(reset_raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise QuotaProviderError(f"invalid reset_at: {name}") from exc
    else:
        raise QuotaProviderError(f"invalid reset_at: {name}")
    return QuotaWindow(float(used), reset_at)


def parse_quota_payload(payload: object) -> QuotaSnapshot:
    if not isinstance(payload, dict):
        raise QuotaProviderError("response must be a JSON object")
    return QuotaSnapshot(
        five_hour=_window(payload, "five_hour"),
        weekly=_window(payload, "weekly"),
    )


def _official_window(value: object, name: str, required: bool = False) -> QuotaWindow | None:
    if value is None:
        if required:
            raise QuotaProviderError(f"missing object: {name}")
        return None
    if not isinstance(value, dict):
        raise QuotaProviderError(f"invalid object: {name}")
    used = value.get("used_percent")
    seconds = value.get("limit_window_seconds")
    reset_at = value.get("reset_at")
    if not isinstance(used, (int, float)) or isinstance(used, bool) or not 0 <= used <= 100:
        raise QuotaProviderError(f"invalid used_percent: {name}")
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds <= 0:
        raise QuotaProviderError(f"invalid limit_window_seconds: {name}")
    if not isinstance(reset_at, (int, float)) or isinstance(reset_at, bool) or reset_at < 0:
        raise QuotaProviderError(f"invalid reset_at: {name}")
    try:
        reset_datetime = datetime.fromtimestamp(float(reset_at), tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise QuotaProviderError(f"invalid reset_at: {name}") from exc
    return QuotaWindow(float(used), reset_datetime, float(seconds) / 60.0)


def parse_official_usage_payload(payload: object) -> OfficialUsageSnapshot:
    if not isinstance(payload, dict):
        raise QuotaProviderError("response must be a JSON object")
    plan_type = payload.get("plan_type")
    if not isinstance(plan_type, str) or not plan_type:
        raise QuotaProviderError("missing plan_type")
    rate_limit = payload.get("rate_limit")
    if not isinstance(rate_limit, dict):
        raise QuotaProviderError("missing rate_limit")
    for name in ("allowed", "limit_reached"):
        if not isinstance(rate_limit.get(name), bool):
            raise QuotaProviderError(f"invalid rate_limit.{name}")
    primary = _official_window(rate_limit.get("primary_window"), "primary_window", required=True)
    secondary = _official_window(rate_limit.get("secondary_window"), "secondary_window")
    if primary is None and secondary is None:
        raise QuotaProviderError("no usage windows")
    return OfficialUsageSnapshot(plan_type=plan_type, primary=primary, secondary=secondary)


def parse_api_usage_payload(payload: object) -> ApiUsageSnapshot:
    """Parse the provider's explicit daily subscription usage contract."""
    if not isinstance(payload, dict):
        raise QuotaProviderError("response must be a JSON object")
    if payload.get("isValid") is not True:
        message = payload.get("invalidMessage")
        raise QuotaProviderError(str(message) if isinstance(message, str) and message else "API usage unavailable")
    status = "active"
    plan_name = payload.get("planName")
    unit = payload.get("unit")
    if not isinstance(plan_name, str) or not plan_name:
        raise QuotaProviderError("missing planName")
    if not isinstance(unit, str) or not unit:
        raise QuotaProviderError("missing unit")
    numbers = {"remaining": payload.get("remaining")}
    subscription = payload.get("subscription")
    if isinstance(subscription, dict):
        numbers["used"] = subscription.get("daily_usage_usd")
        numbers["total"] = subscription.get("daily_limit_usd")
    else:
        usage = payload.get("usage")
        today = usage.get("today") if isinstance(usage, dict) else None
        if not isinstance(today, dict):
            raise QuotaProviderError("missing daily usage")
        numbers["used"] = today.get("cost")
        numbers["total"] = 0
    for name, value in numbers.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            raise QuotaProviderError(f"invalid {name}")
        numbers[name] = float(value)
    if numbers["total"] == 0:
        numbers["total"] = None
    elif numbers["used"] > numbers["total"]:
        raise QuotaProviderError("invalid total or used")
    return ApiUsageSnapshot(status=status, plan_name=plan_name, unit=unit, **numbers)


def _get_json(url: str, headers: dict[str, str], timeout: float) -> object:
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise QuotaProviderError("quota request failed") from exc


class ApiQuotaProvider:
    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        timeout: float = 10.0,
        credentials: DiscoveredCredentials | None = None,
    ):
        credentials = credentials or discover_credentials()
        self.url = url or os.environ.get("CODEX_USAGE_URL")
        if self.url is None and credentials.base_url:
            base_url = credentials.base_url.rstrip("/")
            self.url = base_url + ("/usage" if base_url.endswith("/v1") else "/v1/usage")
        self.api_key = api_key if api_key is not None else credentials.api_key
        self.base_url = credentials.base_url
        self.timeout = timeout

    def fetch(self) -> ApiUsageSnapshot:
        if not self.url:
            raise QuotaProviderError("CODEX_USAGE_URL is not configured")
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return parse_api_usage_payload(_get_json(self.url, headers, self.timeout))


class OfficialQuotaProvider:
    DEFAULT_URL = "https://chatgpt.com/backend-api/wham/usage"

    def __init__(
        self,
        url: str | None = None,
        access_token: str | None = None,
        account_id: str | None = None,
        timeout: float = 10.0,
        credentials: DiscoveredCredentials | None = None,
    ):
        credentials = credentials or discover_credentials()
        self.url = url or os.environ.get("CODEX_OFFICIAL_USAGE_URL") or self.DEFAULT_URL
        self.access_token = access_token if access_token is not None else credentials.access_token
        self.account_id = account_id if account_id is not None else credentials.account_id
        self.timeout = timeout

    def fetch(self) -> OfficialUsageSnapshot:
        if not self.access_token or not self.account_id:
            raise QuotaProviderError("official account auth unavailable")
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.access_token}",
            "ChatGPT-Account-ID": self.account_id,
        }
        return parse_official_usage_payload(_get_json(self.url, headers, self.timeout))


def select_provider(credentials: DiscoveredCredentials | None = None):
    credentials = credentials or discover_credentials()
    if credentials.access_token is not None or credentials.account_id is not None:
        return OfficialQuotaProvider(credentials=credentials)
    return ApiQuotaProvider(credentials=credentials)


def _window_label(window: QuotaWindow) -> str:
    if window.window_minutes is None:
        raise QuotaProviderError("official window duration unavailable")
    if window.window_minutes == 300:
        return "5h"
    if window.window_minutes == 10080:
        return "Weekly"
    return f"{window.window_minutes:.0f} min"


def snapshot_to_card_payload(snapshot: OfficialUsageSnapshot | ApiUsageSnapshot) -> dict[str, object]:
    if isinstance(snapshot, OfficialUsageSnapshot):
        windows = []
        for window in (snapshot.primary, snapshot.secondary):
            if window is not None:
                windows.append({
                    "label": _window_label(window),
                    "used_percent": window.used_percent,
                    "reset_at": window.reset_at.isoformat() if window.reset_at else None,
                })
        return {"kind": "official", "plan_name": snapshot.plan_type, "windows": windows}
    return {
        "kind": "api",
        "plan_name": snapshot.plan_name,
        "used": snapshot.used,
        "total": snapshot.total,
        "remaining": snapshot.remaining,
        "unit": snapshot.unit,
    }


def fetch_card_payload() -> dict[str, object]:
    return snapshot_to_card_payload(select_provider().fetch())
