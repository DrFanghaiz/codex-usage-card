from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class QuotaWindow:
    used_percent: float
    reset_at: datetime | None
    window_minutes: float | None = None


@dataclass(frozen=True)
class OfficialUsageSnapshot:
    plan_type: str
    primary: QuotaWindow | None
    secondary: QuotaWindow | None
