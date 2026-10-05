import json
import math
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from .discover import DiscoveredCredentials, discover_credentials
from .model import OfficialUsageSnapshot, QuotaWindow


class QuotaProviderError(RuntimeError):
    pass


def _is_finite_number(value: object) -> bool:
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


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
    if not _is_finite_number(used) or not 0 <= used <= 100:
        raise QuotaProviderError(f"invalid used_percent: {name}")
    if not _is_finite_number(seconds) or seconds <= 0:
        raise QuotaProviderError(f"invalid limit_window_seconds: {name}")
    if not _is_finite_number(reset_at) or reset_at < 0:
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


def _get_json(url: str, headers: dict[str, str], timeout: float) -> object:
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise QuotaProviderError("quota request failed") from exc


class OfficialQuotaProvider:
    DEFAULT_URL = "https://chatgpt.com/backend-api/wham/usage"

    def __init__(
        self,
        timeout: float = 10.0,
        credentials: DiscoveredCredentials | None = None,
    ):
        try:
            credentials = credentials or discover_credentials()
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise QuotaProviderError("官方登录信息读取失败，请检查 Codex 登录状态或配置目录权限。") from exc
        self.access_token = credentials.access_token
        self.account_id = credentials.account_id
        self.timeout = timeout

    def fetch(self) -> OfficialUsageSnapshot:
        if not self.access_token or not self.access_token.strip() or not self.account_id or not self.account_id.strip():
            raise QuotaProviderError("未登录官方账户，请在 Codex 中使用 ChatGPT 账户登录。")
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.access_token}",
            "ChatGPT-Account-ID": self.account_id,
        }
        return parse_official_usage_payload(_get_json(self.DEFAULT_URL, headers, self.timeout))


def _window_label(window: QuotaWindow) -> str:
    if window.window_minutes is None:
        raise QuotaProviderError("official window duration unavailable")
    if window.window_minutes == 300:
        return "5h"
    if window.window_minutes == 10080:
        return "Weekly"
    return f"{window.window_minutes:.0f} min"


def snapshot_to_card_payload(snapshot: OfficialUsageSnapshot) -> dict[str, object]:
    windows = []
    for window in (snapshot.primary, snapshot.secondary):
        if window is not None:
            windows.append({
                "label": _window_label(window),
                "used_percent": window.used_percent,
                "reset_at": window.reset_at.isoformat() if window.reset_at else None,
            })
    return {"kind": "official", "plan_name": snapshot.plan_type, "windows": windows}


def fetch_card_payload() -> dict[str, object]:
    return snapshot_to_card_payload(OfficialQuotaProvider().fetch())
