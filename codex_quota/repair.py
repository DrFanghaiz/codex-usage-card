import argparse
import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .page_injector import (
    PageInjectionError,
    _connect,
    _evaluate,
    _patch_connection,
    inject,
    resolve_port,
    target_info,
)


class RepairMatchError(RuntimeError):
    pass


DEFAULT_PACKAGE_PARENT = Path("C:/Program Files/WindowsApps")


@dataclass(frozen=True)
class PackageMatch:
    root: str
    package_name: str
    version: str
    executable: str


def _version_key(version: str) -> tuple[int, int, int, int]:
    values = tuple(int(part) for part in version.split("."))
    if len(values) != 4:
        raise RepairMatchError("invalid package version")
    return values


def inspect_package(root: str | Path) -> PackageMatch:
    package_root = Path(root)
    manifest_path = package_root / "AppxManifest.xml"
    executable = package_root / "app" / "ChatGPT.exe"
    if not manifest_path.is_file():
        raise RepairMatchError("AppxManifest.xml not found")
    if not executable.is_file():
        raise RepairMatchError("app/ChatGPT.exe not found")
    try:
        document = ET.parse(manifest_path)
        identity = next(element for element in document.getroot() if element.tag.endswith("Identity"))
    except (ET.ParseError, StopIteration) as exc:
        raise RepairMatchError("invalid AppxManifest.xml") from exc
    name = identity.attrib.get("Name")
    version = identity.attrib.get("Version")
    if name != "OpenAI.Codex":
        raise RepairMatchError("unexpected package name")
    if not version or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", version):
        raise RepairMatchError("invalid package version")
    return PackageMatch(str(package_root), name, version, "app/ChatGPT.exe")


def _matches_in_parent(parent: Path) -> list[PackageMatch]:
    if not parent.is_dir():
        raise RepairMatchError("Codex package directory not found")
    try:
        candidates = [
            child
            for child in parent.iterdir()
            if child.is_dir() and child.name.startswith("OpenAI.Codex_")
        ]
    except OSError as exc:
        raise RepairMatchError("Codex package directory cannot be read") from exc
    matches: list[PackageMatch] = []
    for candidate in candidates:
        try:
            matches.append(inspect_package(candidate))
        except RepairMatchError:
            continue
    return matches


def _appx_install_locations() -> list[Path]:
    if os.name != "nt":
        return []
    command = (
        "$ErrorActionPreference='Stop'; "
        "Get-AppxPackage -Name 'OpenAI.Codex' | "
        "Select-Object -ExpandProperty InstallLocation"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]


def _running_install_locations() -> list[Path]:
    """Read the package roots of running ChatGPT processes from Windows."""
    if os.name != "nt":
        return []
    command = (
        "$ErrorActionPreference='Stop'; "
        "Get-Process -Name 'ChatGPT' | "
        "Select-Object -ExpandProperty Path"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    roots: list[Path] = []
    for line in result.stdout.splitlines():
        executable = Path(line.strip())
        if executable.name.casefold() == "chatgpt.exe" and executable.parent.name.casefold() == "app":
            roots.append(executable.parent.parent)
    return roots


def _select_latest(matches: list[PackageMatch]) -> PackageMatch:
    if not matches:
        raise RepairMatchError("OpenAI.Codex package was not found")
    latest_key = max(_version_key(match.version) for match in matches)
    latest = [match for match in matches if _version_key(match.version) == latest_key]
    if len(latest) != 1:
        raise RepairMatchError("multiple OpenAI.Codex packages have the same version")
    return latest[0]


def discover_latest_package(parent: str | Path | None = None) -> PackageMatch:
    """Find the highest manifest version using an exact package contract."""
    if parent is not None:
        return _select_latest(_matches_in_parent(Path(parent)))

    configured_parent = os.environ.get("CODEX_PACKAGE_PARENT")
    search_parent = Path(configured_parent) if configured_parent else DEFAULT_PACKAGE_PARENT
    try:
        matches = _matches_in_parent(search_parent)
    except RepairMatchError:
        matches = []
    if matches:
        return _select_latest(matches)

    appx_matches: list[PackageMatch] = []
    seen: set[str] = set()
    for root in [*_running_install_locations(), *_appx_install_locations()]:
        key = str(root).casefold()
        if key in seen:
            continue
        seen.add(key)
        try:
            appx_matches.append(inspect_package(root))
        except RepairMatchError:
            continue
    return _select_latest(appx_matches)


def repair_once(
    package_root: str | Path | None = None,
    package_parent: str | Path | None = None,
    port: int | None = None,
) -> PackageMatch:
    """Validate the package and enable the client's native quota alert once."""
    actual_port = resolve_port(port)
    target_info(actual_port)
    match = inspect_package(package_root) if package_root is not None else discover_latest_package(package_parent)
    inject(actual_port)
    return match


def wait_for_repair(
    package_parent: str | Path | None = None,
    port: int | None = None,
    timeout: float = 120.0,
    interval: float = 1.0,
) -> PackageMatch:
    """Wait for Codex's page endpoint, then patch once and exit."""
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    if interval <= 0:
        raise ValueError("interval must be positive")
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return repair_once(package_parent=package_parent, port=port)
        except (PageInjectionError, RepairMatchError) as exc:
            last_error = exc
            time.sleep(interval)
    if last_error is not None:
        raise last_error
    raise RepairMatchError("Codex did not become ready before timeout")


def _target_signature(target: dict[str, object]) -> tuple[object, object, object]:
    return target.get("id"), target.get("url"), target.get("title")


def watch(
    package_parent: str | Path | None = None,
    port: int | None = None,
    interval: float = 2.0,
    refresh_interval: float = 60.0,
    max_cycles: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    write: Callable[[str], None] = print,
) -> None:
    """Keep the native alert patch restored when the package or page changes."""
    if interval <= 0:
        raise ValueError("interval must be positive")
    if refresh_interval <= 0:
        raise ValueError("refresh_interval must be positive")
    del refresh_interval
    observed_package: PackageMatch | None = None
    observed_target: tuple[object, object, object] | None = None
    actual_port: int | None = None
    connection = None
    cycle = 0
    while max_cycles is None or cycle < max_cycles:
        cycle += 1
        try:
            if actual_port is None:
                actual_port = resolve_port(port)
            match = discover_latest_package(package_parent)
            target = target_info(actual_port)
            signature = _target_signature(target)
            if connection is None or signature != observed_target:
                if connection is not None:
                    connection.close()
                connection = _connect(target)
                _patch_connection(connection, persist=True)
                observed_target = signature
                observed_package = match
                write(json.dumps({"repaired": True, "reason": "restore", **asdict(match)}, ensure_ascii=True))
            else:
                patched = _evaluate(
                    connection,
                    "Boolean(globalThis.__STATSIG__?.instance?.().__codexNativeQuotaPatched)",
                    5,
                ) is True
                if not patched:
                    _patch_connection(connection, persist=False)
                if match != observed_package:
                    observed_package = match
        except (PageInjectionError, RepairMatchError) as exc:
            write(str(exc))
            if connection is not None:
                connection.close()
                connection = None
            observed_target = None
            actual_port = None
        if max_cycles is None or cycle < max_cycles:
            sleep(interval)
    if connection is not None:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect or restore the Codex quota card")
    parser.add_argument("package_root", nargs="?", type=Path)
    parser.add_argument("--package-parent", type=Path)
    parser.add_argument("--port", type=int, default=None, help="CDP port; omitted means detect it from ChatGPT.exe")
    parser.add_argument("--repair", action="store_true", help="restore the card once")
    parser.add_argument("--wait", action="store_true", help="wait for Codex to become ready, then patch once")
    parser.add_argument("--watch", action="store_true", help="restore after package/page changes")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=120.0, help="startup wait timeout in seconds")
    args = parser.parse_args()
    if args.package_root is not None and args.package_parent is not None:
        parser.error("package_root and --package-parent cannot be used together")
    if sum(bool(value) for value in (args.repair, args.wait, args.watch)) > 1:
        parser.error("--repair, --wait and --watch are mutually exclusive")
    if args.watch and args.package_root is not None:
        parser.error("--watch discovers the latest package and does not accept package_root")
    try:
        if args.watch:
            watch(args.package_parent, args.port, args.interval, 60.0)
            return 0
        if args.wait:
            match = wait_for_repair(args.package_parent, args.port, args.timeout, args.interval)
            print(json.dumps({"repaired": True, **asdict(match)}, ensure_ascii=True))
            return 0
        if args.repair:
            match = repair_once(args.package_root, args.package_parent, args.port)
            print(json.dumps({"repaired": True, **asdict(match)}, ensure_ascii=True))
            return 0
        match = inspect_package(args.package_root) if args.package_root else discover_latest_package(args.package_parent)
    except (PageInjectionError, RepairMatchError, ValueError) as exc:
        print(str(exc))
        return 2
    print(json.dumps({"matched": True, **asdict(match)}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
