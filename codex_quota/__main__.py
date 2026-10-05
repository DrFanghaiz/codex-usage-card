import tkinter as tk

from .card import OfficialUsageCard
from .provider import OfficialQuotaProvider, QuotaProviderError


def main() -> None:
    try:
        snapshot = OfficialQuotaProvider().fetch()
        error = None
    except QuotaProviderError as exc:
        snapshot = None
        error = str(exc)
    root = tk.Tk()
    root.title("Codex Usage")
    root.configure(bg="#f7f7f7")
    root.resizable(False, False)
    OfficialUsageCard(root, snapshot=snapshot, error=error).pack(padx=10, pady=10)
    root.mainloop()


if __name__ == "__main__":
    main()
