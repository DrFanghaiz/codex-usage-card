import tkinter as tk

from .model import ApiUsageSnapshot, OfficialUsageSnapshot


BG = "#ffffff"
TEXT = "#202020"
MUTED = "#777777"
TRACK = "#e9e9e9"
FILL = "#202020"


def format_amount(value: float) -> str:
    return f"{value:.2f}"


class ApiUsageCard(tk.Frame):
    def __init__(self, master: tk.Misc, snapshot: ApiUsageSnapshot | None = None, error: str | None = None):
        super().__init__(master, bg=BG, highlightbackground="#e6e6e6", highlightthickness=1)
        self.configure(width=260, height=170)
        self.pack_propagate(False)
        self._label("API Usage", TEXT, 11, "bold").pack(anchor="w", padx=12, pady=(11, 6))
        if error:
            self._label(error, MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        if snapshot is None:
            self._label("Unavailable", MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        self._label(snapshot.plan_name, MUTED, 9).pack(anchor="w", padx=12, pady=(0, 4))
        self._row("Used", snapshot.used, snapshot.total, snapshot.unit)
        self._row("Remaining", snapshot.remaining, snapshot.total, snapshot.unit, inverse=True)

    def _label(self, text: str, color: str, size: int, weight: str = "normal") -> tk.Label:
        return tk.Label(self, text=text, bg=BG, fg=color, font=("Segoe UI", size, weight))

    def _row(self, title: str, value: float, total: float | None, unit: str, inverse: bool = False) -> None:
        top = tk.Frame(self, bg=BG)
        top.pack(fill="x", padx=12, pady=(1, 0))
        self._label(title, TEXT, 10).pack(in_=top, side="left")
        amount = f"{format_amount(value)} {unit}" if total is None else f"{format_amount(value)} / {format_amount(total)} {unit}"
        self._label(amount, TEXT, 10).pack(in_=top, side="right")
        if total is None:
            self._label("No daily limit", MUTED, 9).pack(anchor="e", padx=12, pady=(0, 3))
            return
        track = tk.Frame(self, bg=TRACK, height=5)
        track.pack(fill="x", padx=12, pady=(2, 5))
        track.pack_propagate(False)
        ratio = max(0.0, min(1.0, value / total))
        if inverse:
            ratio = 1.0 - ratio
        tk.Frame(track, bg=FILL, height=5).place(relx=0, rely=0, relwidth=ratio, relheight=1)


class OfficialUsageCard(tk.Frame):
    def __init__(self, master: tk.Misc, snapshot: OfficialUsageSnapshot | None = None, error: str | None = None):
        super().__init__(master, bg=BG, highlightbackground="#e6e6e6", highlightthickness=1)
        self.configure(width=260, height=170)
        self.pack_propagate(False)
        self._label("Codex Usage", TEXT, 11, "bold").pack(anchor="w", padx=12, pady=(11, 6))
        if error:
            self._label(error, MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        if snapshot is None:
            self._label("Unavailable", MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        self._label(f"Plan: {snapshot.plan_type}", MUTED, 9).pack(anchor="w", padx=12, pady=(0, 4))
        for window in (snapshot.primary, snapshot.secondary):
            if window is not None:
                self._row(window)

    def _label(self, text: str, color: str, size: int, weight: str = "normal") -> tk.Label:
        return tk.Label(self, text=text, bg=BG, fg=color, font=("Segoe UI", size, weight))

    def _row(self, window) -> None:
        top = tk.Frame(self, bg=BG)
        top.pack(fill="x", padx=12, pady=(1, 0))
        label = "5h" if window.window_minutes == 300 else "Weekly" if window.window_minutes == 10080 else f"{window.window_minutes:.0f} min"
        self._label(label, TEXT, 10).pack(in_=top, side="left")
        self._label(f"{format_amount(window.used_percent)}%", TEXT, 10).pack(in_=top, side="right")
        track = tk.Frame(self, bg=TRACK, height=5)
        track.pack(fill="x", padx=12, pady=(2, 3))
        track.pack_propagate(False)
        tk.Frame(track, bg=FILL, height=5).place(
            relx=0, rely=0, relwidth=max(0.0, min(1.0, window.used_percent / 100.0)), relheight=1
        )
        if window.reset_at is not None:
            self._label(f"Reset: {window.reset_at.isoformat()}", MUTED, 8).pack(anchor="w", padx=12, pady=(0, 2))
