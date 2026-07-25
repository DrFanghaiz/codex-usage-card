import tkinter as tk

from .api_card import ApiUsageCard, OfficialUsageCard
from .model import OfficialUsageSnapshot
from .provider import QuotaProviderError, select_provider


def main() -> None:
    try:
        snapshot = select_provider().fetch()
        error = None
    except QuotaProviderError as exc:
        snapshot = None
        error = str(exc)
    root = tk.Tk()
    root.title("Codex Usage")
    root.configure(bg="#f7f7f7")
    root.resizable(False, False)
    card_type = OfficialUsageCard if isinstance(snapshot, OfficialUsageSnapshot) else ApiUsageCard
    card_type(root, snapshot=snapshot, error=error).pack(padx=10, pady=10)
    root.mainloop()


if __name__ == "__main__":
    main()
