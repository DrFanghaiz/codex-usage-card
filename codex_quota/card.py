import tkinter as tk

from .model import OfficialUsageSnapshot, QuotaWindow


BG = "#ffffff"
TEXT = "#202020"
MUTED = "#777777"
TRACK = "#e9e9e9"
FILL = "#202020"


class OfficialUsageCard(tk.Frame):
    def __init__(self, master: tk.Misc, snapshot: OfficialUsageSnapshot | None = None, error: str | None = None):
        super().__init__(master, bg=BG, highlightbackground="#e6e6e6", highlightthickness=1)
        self.configure(width=260, height=170)
        self.pack_propagate(False)
        self._label("Codex Usage", TEXT, 11, "bold").pack(anchor="w", padx=12, pady=(11, 6))
        if error:
            message = self._label(error, MUTED, 10)
            message.configure(wraplength=236, justify="left")
            message.pack(anchor="w", padx=12, pady=8)
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

    def _row(self, window: QuotaWindow) -> None:
        top = tk.Frame(self, bg=BG)
        top.pack(fill="x", padx=12, pady=(1, 0))
        label = "5h" if window.window_minutes == 300 else "Weekly" if window.window_minutes == 10080 else f"{window.window_minutes:.0f} min"
        self._label(label, TEXT, 10).pack(in_=top, side="left")
        self._label(f"已用 {window.used_percent:g}%", TEXT, 10).pack(in_=top, side="right")
        track = tk.Frame(self, bg=TRACK, height=5)
        track.pack(fill="x", padx=12, pady=(2, 3))
        track.pack_propagate(False)
        tk.Frame(track, bg=FILL, height=5).place(
            relx=0, rely=0, relwidth=max(0.0, min(1.0, window.used_percent / 100.0)), relheight=1
        )
        if window.reset_at is not None:
            self._label(f"Reset: {window.reset_at.isoformat()}", MUTED, 8).pack(anchor="w", padx=12, pady=(0, 2))
