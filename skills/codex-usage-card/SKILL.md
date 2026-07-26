---
name: codex-usage-card
description: Install, build, deploy, repair, and verify Codex Usage Card for Windows. Use when another Windows computer needs one-click installation, the Codex desktop usage card is missing, used and remaining values are reversed, official-account or API-mode support is required, or the helper must recover after a Codex update without modifying WindowsApps, themes, or exposing API keys.
---

# Codex Usage Card

Use this skill to install the bundled helper on another Windows computer or maintain the existing implementation in a checked-out project. Treat the project as the source of truth; do not redesign the card or invent a second authentication flow.

## Install on another Windows computer

When this skill is installed without a source checkout, run `scripts/install.ps1`. It copies the bundled native helper to `%LOCALAPPDATA%\CodexUsageCard`, registers the current-user task `Codex Usage Card`, and starts one windowless instance. It migrates the legacy `Codex Quota Card Repair` task only when that task points to the exact legacy install path. If either task name points somewhere else, stop and report the path instead of overwriting it.

Use `scripts/uninstall.ps1` only when the user explicitly asks to remove Codex Usage Card. It removes only the exact task and files installed by this skill.

## Scope

- Run only in Windows PowerShell. Do not use Linux, WSL, `/mnt/data`, or shell-specific substitutes.
- Accept the project directory from the user or discover it from the current workspace. Never hard-code another user's absolute path.
- Work on the native helper and page script, not the Codex WindowsApps installation directory.
- Keep official-account and API login detection automatic. Do not add an Account/API switch.
- Keep the helper windowless: compile the C# target as `winexe`, and do not reintroduce `python.exe`, `pythonw.exe`, `wscript.exe`, or a console launcher into the scheduled task.

## Project files

Inspect these relative paths before changing code:

- `native-patch/CodexNativeQuotaPatch.cs`
- `native-patch/native_patch.js`
- `codex_quota/page_injector.py`
- `scripts/register_usage_card_task.ps1`
- `scripts/repair_codex.ps1`
- `tests/`

The implementation must continue to use the task name `Codex Usage Card` and the deployable output `native-patch/CodexNativeQuotaPatch.next.exe`. Never overwrite the old `CodexNativeQuotaPatch.exe` when Windows has it locked.

## Non-negotiable safety rules

1. Never read, print, log, persist, commit, or send an API key. Existing code may hold it in memory only long enough to make the already-supported request.
2. Never modify, replace, or inspect files inside the Codex WindowsApps install directory.
3. Never change Codex theme settings, global fonts, or fixed colors. Page styles must inherit the active theme.
4. Never stop an unrelated process. During deployment, stop the scheduled task first, then stop only a process whose executable path exactly equals the project `.next.exe` path.
5. Do not close or restart the Codex client.
6. Use `apply_patch` for source and documentation edits. Do not hide errors with fallback behavior, guessed API fields, or high-frequency polling.
7. Do not commit `auth.json`, `config.toml`, `api-proxy.dat`, API responses, screenshots containing secrets, or generated executables unless the user explicitly requests a release artifact.

## Required workflow

### 1. Establish the host and source

Run `Get-Location` first. Confirm Windows PowerShell and that the requested project is accessible. Read the current `task_plan.md`, `findings.md`, and `progress.md` when present. Preserve unrelated worktree changes.

### 2. Review before editing

Check `WaitForLoginConfigurationChangeAsync()` and its callers:

- Existing `.codex`: watch `auth.json` and `config.toml` creation, modification, deletion, and rename events.
- Missing `.codex`: watch its parent directory for creation or rename of `.codex`.
- Start the watcher before the final state recheck so a write cannot fall into a setup gap.
- Release every `FileSystemWatcher` with deterministic disposal. Surface watcher errors to the reconnect path; do not turn them into an endless loop.
- A temporary incomplete login file must wait for the next file event. A real access or transport error must remain visible to the outer reconnect path.

Review the page script for these invariants:

- Official mode uses the native quota component and remains language-independent.
- Official Weekly Folio uses the compact split layout: remaining number, vertical divider, left-aligned reset metadata, and remaining progress line. The hidden native progress keeps the used percentage, and dynamic updates keep the two values summing to 100.
- Never fabricate a 5h row. Compact only the single-window Weekly native card; if the official component exposes additional windows again, preserve its complete native UI so restored limits remain visible.
- Hide the quota card when the sidebar account row is absent; restore it when the row returns. Do not hide unrelated status notifications.
- API mode creates one card above the account row, never the official card. Its Folio number and compact line show `100 - used / total`; the remaining amount is displayed separately.
- API refresh is event-driven: initial load, manual refresh, stale successful data on focus, and server-directed cooldowns only. Do not add a timer that polls continuously.
- `card_present()` checks a visible real card, not merely an internal patch marker.
- The script does not touch model pickers, model labels, menus, or option lists.

If an invariant is unclear, stop and report the evidence instead of guessing.

### 3. Test and compile

From the project directory, run:

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

Report only the total passed and failed test counts. Compile the helper with the Visual Studio Roslyn `csc.exe` as a `winexe` to:

```text
native-patch\CodexNativeQuotaPatch.next.exe
```

Use the existing references: `System.dll`, `System.Core.dll`, `System.Management.dll`, `System.Net.Http.dll`, `System.Web.Extensions.dll`, and `System.Security.dll`. Do not route output to the old executable.

### 4. Replace the background instance safely

Operate only on `Codex Usage Card`. During a verified upgrade, the installer may remove the legacy `Codex Quota Card Repair` task only when its single action points to the exact legacy install path:

1. Verify its action points to the exact `.next.exe` path, then stop the task.
2. Resolve processes by exact executable path, not by process name alone.
3. Stop only exact matches, if any.
4. Compile the new `.next.exe`.
5. Start the same task.
6. Recheck the action path, exact process count, and `MainWindowHandle` (must be `0`).

If any identity check fails, stop before changing state.

### 5. Verify the real page

Use the active Codex debugging target only when it is available. Without a running client or debugging port, report that the page cannot be verified; never fabricate a result.

For official mode, verify the visible native card, Weekly remaining/used complement, account-row placement, absence of the API card, unchanged theme, and `card_present() == True`.

For API mode, verify the visible API card, absence of the official card, language-independent account-row lookup, Daily remaining progress semantics, refresh state, and that no key enters the page. Do not switch the user's real login configuration merely to create a screenshot.

### 6. Record and review

Use `apply_patch` to update the project plan and findings with the actual test count, compiler result, task path, process state, page result, and anything not verified. Then review from first principles:

- no unnecessary polling;
- ordinary Codex updates, process restarts, debug-port changes, and page reloads rediscover and reinject without using a version-specific WindowsApps path;
- no permanent exit on transient login state;
- no duplicate helper instance;
- no UI-language dependency;
- no theme mutation;
- no API-key disclosure;
- no more complex implementation than the requirement needs.

End with a concise Chinese report: changes, passed/failed counts, task/process state, page result, and remaining unverified items.

## GitHub packaging

This skill is a workflow layer, not a copy of a user's login state. Keep the repository portable:

- use relative paths and environment discovery;
- bundle the reviewed AnyCPU `winexe` release artifact so a target computer does not need Visual Studio;
- keep the matching C# and JavaScript source beside the release artifact for auditing and rebuilding;
- exclude credentials, proxy blobs, runtime logs, screenshots with secrets, and local caches;
- keep the source project and this skill directory separate so the skill can be installed from the repository;
- document required user approval for scheduled-task changes and any missing compiler/debug-port dependency.

The usage-card skill must never alter the Codex model picker. A duplicate model label such as `5.6 Luna` is outside this skill's scope and should be investigated in Codex's own model catalog.
