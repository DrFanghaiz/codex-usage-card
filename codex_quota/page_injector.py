import argparse
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, ProxyHandler, build_opener

import websocket



class PageInjectionError(RuntimeError):
    pass


def _discover_debug_port() -> int:
    if os.name != "nt":
        raise PageInjectionError("automatic Codex debug-port discovery requires Windows")
    command = (
        "$ErrorActionPreference='Stop'; "
        "$ids=@(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty Id); "
        "if ($ids.Count -eq 0) { exit 0 }; "
        "foreach ($line in (netstat -ano -p tcp)) { "
        "$parts=($line -replace '^\\s+','') -split '\\s+'; "
        "if ($parts.Count -lt 5 -or $parts[0] -ne 'TCP' -or "
        "$parts[3] -ne 'LISTENING' -or $ids -notcontains ([int]$parts[4])) { continue }; "
        "if ($parts[1] -match '^(127\\.0\\.0\\.1|\\[::1\\]):(\\d+)$') { "
        "Write-Output $Matches[2] } }"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PageInjectionError("could not inspect Codex debug port") from exc
    if result.returncode != 0:
        raise PageInjectionError("could not inspect Codex debug port")
    ports = {int(value) for value in result.stdout.split() if value.isdigit()}
    if not ports:
        raise PageInjectionError("no Codex debug port found")
    valid_ports: list[int] = []
    for port in sorted(ports):
        if not 1 <= port <= 65535:
            continue
        try:
            candidates = [
                value
                for value in _targets(port)
                if _is_codex_main_page(value)
            ]
        except PageInjectionError:
            continue
        if len(candidates) == 1 and isinstance(candidates[0].get("webSocketDebuggerUrl"), str):
            valid_ports.append(port)
    if len(valid_ports) != 1:
        raise PageInjectionError(f"expected one Codex debug port, found {len(valid_ports)}")
    return valid_ports[0]


def resolve_port(port: int | None) -> int:
    if port is None:
        return _discover_debug_port()
    if not 1 <= port <= 65535:
        raise PageInjectionError("port must be between 1 and 65535")
    return port


NATIVE_QUOTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "native-patch" / "native_patch.js"
).read_text(encoding="utf-8")


# Rollback-only renderer retained for older API-mode installs. The active path
# never creates this DOM and instead enables the client's own quota component.
CARD_SCRIPT = r"""
(() => {
  const hostId = "codex-quota-card-host";
  const accountButton = [...document.querySelectorAll('button[aria-label="打开个人资料菜单"]')]
    .find((button) => button instanceof HTMLElement && button.offsetParent !== null);
  if (!accountButton) throw new Error("account menu not found");
  let footer = accountButton;
  while (footer && footer !== document.body) {
    const style = getComputedStyle(footer);
    if (style.position === "absolute" && style.bottom === "0px") break;
    footer = footer.parentElement;
  }
  if (!footer || footer === document.body) throw new Error("account footer not found");
  let accountBar = accountButton;
  while (accountBar.parentElement && accountBar.parentElement !== footer) {
    accountBar = accountBar.parentElement;
  }
  if (accountBar.parentElement !== footer) throw new Error("account footer row not found");
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    host.attachShadow({mode: "open"});
  }
  host.style.cssText = "all:initial;display:block;width:100%;box-sizing:border-box";
  if (host.parentElement !== footer || host.nextElementSibling !== accountBar) {
    footer.insertBefore(host, accountBar);
  }
  const root = host.shadowRoot;
  root.innerHTML = `
    <style>
      :host { all: initial; display: block; }
      .card { box-sizing: border-box; width: calc(100% - 16px); margin: 8px 8px 8px; padding: 10px 10px 9px;
        border: 1px solid #e7e7e7;
        border-radius: 12px; background: #fff; color: #202020; box-shadow: 0 4px 14px rgba(0,0,0,.06);
        font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .title { margin-bottom: 9px; font-weight: 600; }
      .muted { color: #777; font-size: 10px; }
      .row { display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; }
      .track { height: 5px; margin-top: 4px; overflow: hidden; border-radius: 4px; background: #ededed; }
      .fill { height: 100%; background: #202020; }
      .actions { display: flex; justify-content: flex-end; margin-top: 8px; }
      .refresh { box-sizing: border-box; padding: 3px 8px; border: 1px solid #dedede; border-radius: 7px;
        background: #fff; color: #555; cursor: pointer; font: inherit; }
      .refresh:hover { background: #f5f5f5; }
      .refresh:disabled { cursor: wait; opacity: .55; }
      .error { color: #777; white-space: normal; word-break: break-word; }
    </style>
    <div class="card" role="status" aria-label="Codex Usage">
      <div id="title" class="title">Codex Usage</div>
      <div id="body" class="muted">Unavailable</div>
      <div class="actions"><button id="refresh" class="refresh" type="button">刷新</button></div>
    </div>`;
  const refreshButton = root.getElementById("refresh");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      window.__codexQuotaRefreshRequested = true;
      refreshButton.disabled = true;
      refreshButton.textContent = "刷新中…";
    });
  }
  window.__codexQuotaRefreshRequested = false;
  window.__codexQuotaUpdate = (data) => {
    const body = root.getElementById("body");
    const title = root.getElementById("title");
    const button = root.getElementById("refresh");
    if (button) {
      button.disabled = false;
      button.textContent = "刷新";
    }
    if (!body) return;
    if (!data || data.error) {
      body.className = "error";
      body.textContent = data?.error || "Unavailable";
      return;
    }
    const hasTotal = Number.isFinite(data.total) && data.total > 0;
    const usedRatio = hasTotal ? Math.max(0, Math.min(1, data.used / data.total)) : 0;
    const remainingRatio = hasTotal ? Math.max(0, Math.min(1, data.remaining / data.total)) : 0;
    const formatAmount = (value) => Number(value).toFixed(2);
    body.className = "";
    body.replaceChildren();
    const addText = (tag, className, value) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      element.textContent = String(value);
      body.appendChild(element);
      return element;
    };
    const addRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "row";
      const left = document.createElement("span");
      left.textContent = label;
      const right = document.createElement("span");
      right.textContent = value;
      row.append(left, right);
      body.appendChild(row);
    };
    const addTrack = (ratio) => {
      const track = document.createElement("div");
      track.className = "track";
      const fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = `${ratio * 100}%`;
      track.appendChild(fill);
      body.appendChild(track);
    };
    if (data.kind === "official") {
      if (!Array.isArray(data.windows) || data.windows.length === 0) {
        body.className = "error";
        body.textContent = "No usage windows";
        return;
      }
      if (title) title.textContent = "Codex Usage";
      addText("div", "muted", `Plan: ${data.plan_name}`);
      for (const window of data.windows) {
        const used = Number(window?.used_percent);
        if (!Number.isFinite(used) || used < 0 || used > 100) {
          body.className = "error";
          body.textContent = "Invalid usage window";
          return;
        }
        addRow(window?.label || "Window", `${formatAmount(used)}%`);
        addTrack(used / 100);
        if (window?.reset_at) addText("div", "muted", `Reset: ${window.reset_at}`);
      }
      return;
    }
    if (data.kind !== "api") {
      body.className = "error";
      body.textContent = "Unknown usage type";
      return;
    }
    if (title) title.textContent = "API Usage";
    const usedText = hasTotal ? `${formatAmount(data.used)} / ${formatAmount(data.total)} ${data.unit}` : `${formatAmount(data.used)} ${data.unit}`;
    const remainingText = `${formatAmount(data.remaining)} ${data.unit}`;
    addText("div", "muted", data.plan_name);
    addRow("Used", usedText);
    if (hasTotal) addTrack(usedRatio);
    addRow("Remaining", remainingText);
    if (hasTotal) addTrack(remainingRatio);
    if (!hasTotal) addText("div", "muted", "No daily limit");
  };
  return true;
})()
"""


def _targets(port: int) -> list[dict[str, Any]]:
    try:
        request = Request(f"http://127.0.0.1:{port}/json/list", method="GET")
        with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
            values = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise PageInjectionError(f"CDP endpoint unavailable on port {port}") from exc
    if not isinstance(values, list):
        raise PageInjectionError("CDP target list is invalid")
    return [value for value in values if isinstance(value, dict) and value.get("type") == "page"]


def _is_codex_main_page(value: dict[str, Any]) -> bool:
    return value.get("url") == "app://-/index.html"


def target_info(port: int) -> dict[str, Any]:
    candidates = [
        value for value in _targets(port)
        if _is_codex_main_page(value)
    ]
    if len(candidates) != 1:
        raise PageInjectionError(f"expected one Codex page target, found {len(candidates)}")
    target = candidates[0]
    if not isinstance(target.get("webSocketDebuggerUrl"), str):
        raise PageInjectionError("target has no WebSocket debugger URL")
    return target


def _connect(target: dict[str, Any]) -> websocket.WebSocket:
    try:
        return websocket.create_connection(
            target["webSocketDebuggerUrl"],
            timeout=5,
            http_proxy_host=None,
            http_proxy_port=None,
            http_no_proxy=["127.0.0.1", "localhost"],
            suppress_origin=True,
        )
    except Exception as exc:
        raise PageInjectionError("could not connect to Codex renderer") from exc


def _send_command(
    connection: websocket.WebSocket,
    method: str,
    params: dict[str, Any] | None,
    command_id: int,
) -> Any:
    try:
        connection.send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(connection.recv())
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise PageInjectionError(f"CDP command failed: {method}")
            return message.get("result")
    except (websocket.WebSocketException, OSError, json.JSONDecodeError) as exc:
        raise PageInjectionError(f"CDP communication failed: {method}") from exc


def _evaluate(connection: websocket.WebSocket, expression: str, command_id: int) -> Any:
    response = _send_command(
        connection,
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True},
        command_id,
    )
    result = response.get("result", {})
    if response.get("exceptionDetails") or result.get("subtype") == "error":
        raise PageInjectionError("page injection script failed")
    return result.get("value")


def native_patch_present(port: int, target: dict[str, Any] | None = None) -> bool:
    connection = _connect(target or target_info(port))
    try:
        value = _evaluate(
            connection,
            "Boolean(globalThis.__STATSIG__?.instance?.().__codexNativeQuotaPatched)",
            1,
        )
        return value is True
    finally:
        connection.close()


def _patch_connection(connection: websocket.WebSocket, persist: bool = True, wait_seconds: float = 30.0) -> None:
    if wait_seconds <= 0:
        raise ValueError("wait_seconds must be positive")
    if persist:
        _send_command(connection, "Page.enable", {}, 1)
        _send_command(
            connection,
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": NATIVE_QUOTA_SCRIPT},
            2,
        )
    _evaluate(connection, NATIVE_QUOTA_SCRIPT, 3)
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if _evaluate(
            connection,
            "Boolean(globalThis.__STATSIG__?.instance?.().__codexNativeQuotaPatched)",
            4,
        ) is True:
            return
        time.sleep(0.25)
    raise PageInjectionError("native quota alert component was not patched")


def install_native_patch(port: int, persist: bool = True, wait_seconds: float = 30.0) -> None:
    """Patch the current page once; a persistent CDP session keeps reload injection alive."""
    target = target_info(port)
    connection = _connect(target)
    try:
        _patch_connection(connection, persist=persist, wait_seconds=wait_seconds)
    finally:
        connection.close()


def inject(port: int, payload: dict[str, Any] | None = None) -> None:
    """Enable the built-in quota alert; payload remains for API compatibility."""
    del payload
    install_native_patch(port)


def card_present(port: int, target: dict[str, Any] | None = None) -> bool:
    """Return whether a quota entry or a supported legacy card is visible."""
    connection = _connect(target or target_info(port))
    try:
        value = _evaluate(
            connection,
            """(() => {
              const trigger = document.getElementById('codex-quota-trigger');
              const triggerVisible = (element) => {
                if (!element.isConnected) return false;
                for (let ancestor = element; ancestor instanceof HTMLElement; ancestor = ancestor.parentElement) {
                  const style = getComputedStyle(ancestor);
                  if (ancestor.hidden || ancestor.inert || style.display === 'none' ||
                      style.visibility === 'hidden' || style.visibility === 'collapse' ||
                      Number(style.opacity) === 0) return false;
                }
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
                  rect.left < innerWidth && rect.top < innerHeight;
              };
              if (trigger && trigger instanceof HTMLButtonElement &&
                  trigger.getAttribute('aria-controls') === 'codex-quota-popover' &&
                  ['api', 'official'].includes(trigger.getAttribute('data-cq-kind')) && triggerVisible(trigger)) {
                const popover = document.getElementById('codex-quota-popover');
                if (popover instanceof HTMLElement && popover.isConnected) {
                  return true;
                }
              }
              if (trigger) return false;
              const visible = (element) => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
              const api = document.getElementById('codex-api-usage-host');
              if (visible(api) && api.querySelector('.codex-native-compact-usage-content')) return true;
              const fallback = document.getElementById('codex-official-usage-host');
              if (visible(fallback) && fallback.querySelector(
                '[data-cq-layout="thread-v2"], [data-cq-layout="thread-v2-fallback"], .cq-compact-fallback'
              )) return true;
              const compact = [...document.querySelectorAll('.codex-native-compact-usage')].find((card) =>
                visible(card) && card.querySelector('[data-cq-layout="thread-v2"]'));
              if (compact) return true;
              return [...document.querySelectorAll("[role='status']")].filter((card) =>
                visible(card) &&
                card.classList.contains("rounded-2xl") &&
                Boolean(card.querySelector("progress[max='100']")) &&
                ((card.classList.contains("border") &&
                  card.classList.contains("bg-token-main-surface-primary")) ||
                 (card.classList.contains("ring-border") &&
                  card.classList.contains("bg-surface/80")))).length === 1;
            })()""",
            1,
        )
        return value is True
    finally:
        connection.close()


def _legacy_card_present(port: int, target: dict[str, Any] | None = None) -> bool:
    connection = _connect(target or target_info(port))
    try:
        value = _evaluate(
            connection,
            "Boolean(document.getElementById('codex-quota-card-host')?.shadowRoot)",
            1,
        )
        return value is True
    finally:
        connection.close()


def _legacy_inject(port: int, payload: dict[str, Any]) -> None:
    target = target_info(port)
    connection = _connect(target)
    try:
        _evaluate(connection, CARD_SCRIPT, 1)
        encoded = json.dumps(payload, ensure_ascii=True).replace("</", "<\\/")
        _evaluate(connection, f"window.__codexQuotaUpdate({encoded})", 2)
    finally:
        connection.close()


def refresh_requested(port: int, target: dict[str, Any] | None = None) -> bool:
    connection = _connect(target or target_info(port))
    try:
        value = _evaluate(
            connection,
            "(() => { const requested = window.__codexQuotaRefreshRequested === true; window.__codexQuotaRefreshRequested = false; return requested; })()",
            1,
        )
        return value is True
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Inject the quota card into a Codex renderer page")
    parser.add_argument("--port", type=int, default=None, help="CDP port; omitted means detect it from ChatGPT.exe")
    args = parser.parse_args()
    try:
        port = resolve_port(args.port)
    except PageInjectionError as exc:
        print(str(exc))
        return 2
    try:
        target_info(port)
    except PageInjectionError as exc:
        print(str(exc))
        return 2
    try:
        inject(port)
    except PageInjectionError as exc:
        print(str(exc))
        return 2
    print("injected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
