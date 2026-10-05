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
            if not isinstance(message, dict):
                raise PageInjectionError(f"invalid CDP response: {method}")
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise PageInjectionError(f"CDP command failed: {method}")
            result = message.get("result")
            if not isinstance(result, dict):
                raise PageInjectionError(f"invalid CDP result: {method}")
            return result
    except (websocket.WebSocketException, OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PageInjectionError(f"CDP communication failed: {method}") from exc


def _evaluate(connection: websocket.WebSocket, expression: str, command_id: int) -> Any:
    response = _send_command(
        connection,
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True},
        command_id,
    )
    result = response.get("result")
    if not isinstance(result, dict):
        raise PageInjectionError("invalid page evaluation result")
    if response.get("exceptionDetails") or result.get("subtype") == "error":
        raise PageInjectionError("page injection script failed")
    return result.get("value")


# Installation readiness is independent of sidebar visibility and Statsig flags.
NATIVE_PATCH_READY_SCRIPT = """(() => {
  const trigger = document.getElementById('codex-quota-trigger');
  const popover = document.getElementById('codex-quota-popover');
  return trigger instanceof HTMLButtonElement && trigger.isConnected &&
    trigger.getAttribute('data-cq-kind') === 'official' &&
    trigger.getAttribute('aria-controls') === 'codex-quota-popover' &&
    popover instanceof HTMLElement && popover.isConnected &&
    document.querySelectorAll('#codex-quota-trigger').length === 1 &&
    document.querySelectorAll('#codex-quota-popover').length === 1;
})()"""


def native_patch_present(port: int, target: dict[str, Any] | None = None) -> bool:
    connection = _connect(target or target_info(port))
    try:
        value = _evaluate(
            connection,
            NATIVE_PATCH_READY_SCRIPT,
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
            NATIVE_PATCH_READY_SCRIPT,
            4,
        ) is True:
            return
        time.sleep(0.25)
    raise PageInjectionError("official quota entry was not installed")


def install_native_patch(port: int, persist: bool = True, wait_seconds: float = 30.0) -> None:
    """Patch the current page once; a persistent CDP session keeps reload injection alive."""
    target = target_info(port)
    connection = _connect(target)
    try:
        _patch_connection(connection, persist=persist, wait_seconds=wait_seconds)
    finally:
        connection.close()


def inject(port: int) -> None:
    """Enable the official quota entry."""
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
                  trigger.getAttribute('data-cq-kind') === 'official' && triggerVisible(trigger)) {
                const popover = document.getElementById('codex-quota-popover');
                if (popover instanceof HTMLElement && popover.isConnected) {
                  return true;
                }
              }
              if (trigger) return false;
              const visible = (element) => element instanceof HTMLElement && !element.hidden && element.offsetParent !== null;
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
