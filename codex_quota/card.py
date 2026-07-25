import tkinter as tk
from datetime import datetime

from .model import QuotaSnapshot, QuotaWindow


BG = "#ffffff"
TEXT = "#202020"
MUTED = "#777777"
TRACK = "#e9e9e9"
FILL = "#202020"


def _reset_text(value: datetime | None) -> str:
    if value is None:
        return "Unavailable"
    return value.astimezone().strftime("%b %d, %I:%M %p")


class QuotaCard(tk.Frame):
    def __init__(self, master: tk.Misc, snapshot: QuotaSnapshot | None = None, error: str | None = None):
        super().__init__(master, bg=BG, highlightbackground="#e6e6e6", highlightthickness=1)
        self.configure(width=260, height=170)
        self.pack_propagate(False)
        self._label("Usage", TEXT, 11, "bold").pack(anchor="w", padx=12, pady=(11, 6))
        if error:
            self._label(error, MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        if snapshot is None:
            self._label("Unavailable", MUTED, 10).pack(anchor="w", padx=12, pady=8)
            return
        self._row("5h", snapshot.five_hour)
        self._row("Weekly", snapshot.weekly)

    def _label(self, text: str, color: str, size: int, weight: str = "normal") -> tk.Label:
        return tk.Label(self, text=text, bg=BG, fg=color, font=("Segoe UI", size, weight))

    def _row(self, title: str, window: QuotaWindow) -> None:
        top = tk.Frame(self, bg=BG)
        top.pack(fill="x", padx=12, pady=(1, 0))
        self._label(title, TEXT, 10).pack(in_=top, side="left")
        self._label(f"{window.used_percent:g}%", TEXT, 10).pack(in_=top, side="right")
        track = tk.Frame(self, bg=TRACK, height=5)
        track.pack(fill="x", padx=12, pady=(2, 2))
        track.pack_propagate(False)
        fill = tk.Frame(track, bg=FILL, height=5)
        fill.place(relx=0, rely=0, relwidth=window.used_percent / 100, relheight=1)
        self._label("Resets", MUTED, 9).pack(anchor="w", padx=12)
        self._label(_reset_text(window.reset_at), MUTED, 9).pack(anchor="e", padx=12, pady=(0, 3))
