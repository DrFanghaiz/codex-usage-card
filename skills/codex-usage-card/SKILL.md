---
name: codex-usage-card
description: Install, build, deploy, repair, and verify Codex Usage Card for Windows. Use when another Windows computer needs one-click installation, the Codex desktop usage card is missing, used and remaining values are reversed, official-account or API-mode support is required, or the helper must recover after a Codex update without modifying WindowsApps, themes, or exposing API keys.
---

# Codex Usage Card

Use this skill to install the bundled helper on another Windows computer or maintain the existing implementation in a checked-out project. Treat the project as the source of truth; do not redesign the card or invent a second authentication flow.

## Install on another Windows computer

When this skill is installed without a source checkout, run `scripts/install.ps1`. It copies the bundled native helper to `%LOCALAPPDATA%\CodexUsageCard`, registers the current-user task `Codex Usage Card`, and starts one windowless instance. It migrates the legacy `Codex Quota Card Repair` task only when that task points to the exact legacy install path. If either task name points somewhere else, stop and report the path instead of overwriting it.

Use `scripts/uninstall.ps1` only when the user explicitly asks to remove Codex Usage Card. It removes only the exact task and files installed by this skill.

## Read-only diagnosis

Run `scripts/doctor.ps1` to inspect the exact task action, exact helper process, windowless state, Codex process, local CDP main page, and visible official/API card without changing system state. Its structured result uses non-sensitive `StageCodes` and never reads or prints credentials, account identifiers, or API responses. `CardVisible = $null` means the page could not be inspected because Codex, its debugging endpoint, or its main page was unavailable; it does not mean installation failed. `CardVisible = $false` means the main page was inspected and no supported visible card was found.

## Scope

- Run only in Windows PowerShell. Do not use Linux, WSL, `/mnt/data`, or shell-specific substitutes.
- Accept the project directory from the user or discover it from the current workspace. Never hard-code another user's absolute path.
- Work on the native helper and page script, not the Codex WindowsApps installation directory.
- Keep official-account and API login detection automatic. Do not add an Account/API switch.
- Keep the helper windowless: compile the C# target as `winexe`, and do not reintroduce `python.exe`, `pythonw.exe`, `wscript.exe`, or a console launcher into the scheduled task.
- Keep direct-start recovery scoped to a newly observed `OpenAI.Codex` root process without a remote-debugging port. Seed existing root process IDs when the helper starts, pass through already-debuggable launches, reject renderer and other ChatGPT packages, verify the executable path again before terminating the new process, and relaunch it with a dynamic loopback port under the current-session Explorer parent.

## Project files

Inspect these relative paths before changing code:

- `native-patch/CodexNativeQuotaPatch.cs`
- `native-patch/native_patch.js`
- `codex_quota/page_injector.py`
- `scripts/register_usage_card_task.ps1`
- `scripts/doctor_usage_card.ps1`
- `scripts/repair_codex.ps1`
- `tests/`

The implementation must continue to use the task name `Codex Usage Card` and the deployable output `native-patch/CodexNativeQuotaPatch.next.exe`. Never overwrite the old `CodexNativeQuotaPatch.exe` when Windows has it locked.

## Non-negotiable safety rules

1. Never read, print, log, persist, commit, or send an API key. Existing code may hold it in memory only long enough to make the already-supported request.
2. Never modify, replace, or inspect files inside the Codex WindowsApps install directory.
3. Never change Codex theme settings, global fonts, or fixed colors. Page styles must inherit the active theme.
4. Never stop an unrelated process. During deployment, stop the scheduled task first, then stop only a process whose executable path exactly equals the project `.next.exe` path.
5. Do not close or restart an existing Codex client during maintenance. The only permitted client restart is the direct-start recovery above, limited to a newly observed unpatched root process before the helper attaches.
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

Check direct-start recovery before changing it:

- Existing Codex roots are captured by PID plus WMI creation time before the reconnect loop and are never removed on a transient omission, so installing, upgrading, or restarting the helper cannot terminate an active session while still distinguishing future PID reuse.
- Only the version-independent `OpenAI.Codex_*\app\ChatGPT.exe` root command line is eligible. `--type=` children, ChatGPT Classic, and roots already carrying `--remote-debugging-port` are not restarted.
- Resolve an unused loopback port, revalidate the exact process path immediately before termination, and use `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` with the same-session Explorer so the replacement does not inherit the scheduled task lifecycle.
- Win32 launch failures must surface to the reconnect path. Do not silently fall back to an ordinary child process.

Review the page script for these invariants:

- Official mode prefers the native quota component. When Codex does not render it, the helper fetches the validated official usage window and sends only the sanitized quota payload to a language-independent fallback card; credentials never enter the page.
- Official usage follows the A2 merged-row layout: a 248px maximum warm-paper card adapted to the available sidebar width, 12/14/11 padding, a label/refresh header, a merged used/2px-progress/remaining row after 6px, and a footer after 8px. Exact `pro` + single `Weekly` data adds the `Pro` pill and keeps the Weekly countdown/date footer. Exact `plus` + real `5h` and `Weekly` data uses Plus X: add the `Plus` pill, keep 5h as the sole main percentage/track, show only the 5h countdown at footer left, and put the compact Weekly used/reset-date summary in the footer right. Plus X has no 5h absolute time, Weekly track, divider, or fourth row, and matches Pro height at normal sidebar width. Native container queries reduce track gaps and stack the footer at narrow widths without shrinking text or hiding information.
- Never fabricate a 5h row. Match plan names case-insensitively but exactly, identify windows by their validated labels rather than array position, and render Plus X only when both real target windows exist. Preserve every unknown multi-window shape in the complete fallback layout. When a native card exists, keep one hidden source progress per displayed real window; helper refreshes and native progress changes must update the matching labeled source without creating observer loops.
- Hide the quota card when the sidebar account row is absent; restore it when the row returns. Do not hide unrelated status notifications.
- API mode creates one card above the account row, never the official card. Its Folio number and compact line show `100 - used / total`; the remaining amount is displayed separately.
- Official and API refresh use one visibility-aware adaptive one-shot timer. Recent focus/manual interaction uses 2 minutes for 5 minutes, warm interaction uses 5 minutes through 1 hour, 1–4 hours idle uses 15 minutes, and longer idle uses 30 minutes; a changed usage fingerprint keeps the 5-minute activity tier. For visible Plus X, the same timer wakes at the earlier of the next network refresh or minute boundary and recomputes the countdown locally without another request. Clear the timer while hidden, bring stale data forward on focus/visibility restoration, replace the previous handler on reinjection, and keep failure retries behind the existing 60-second minimum and server-directed cooldown. Do not scan processes, session files, keyboard input, or add a continuously polling interval.
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

For official mode, verify Pro single-Weekly and Plus X three-line rendering, equal normal-width height, each used/remaining complement, both reset semantics, plan/window switching, account-row placement, absence of the API card, unchanged theme, and `card_present() == True`.

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
