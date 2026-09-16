---
name: codex-usage-card
description: Install, build, deploy, repair, and verify Codex Usage Card for Windows. Use when another Windows computer needs one-click installation, the Codex desktop usage card is missing, used and remaining values are reversed, official-account or API-mode support is required, or the helper must recover after a Codex update without modifying WindowsApps, themes, or exposing API keys.
---

# Codex Usage Card

## UI source and build

Edit `native-patch/native_patch.source.js`, not the generated `native_patch.js`. Run `npm ci`, `npm run build`, and `npm run build:check`; the build bundles Motion's native mini API, Lucide icons, and component-prefixed Tailwind utilities into both deployed JavaScript copies. No CDN, React runtime, or Node.js service is required on the target computer. Keep Tailwind Preflight and global selectors out of the injected CSS. Dependency licenses remain embedded in the bundle.

Official cards retain the final layout and palette, with Motion press feedback, refresh rotation and usage-fill transitions as explicitly requested after the design specification. Keep the card height stable and update numeric values immediately; preserve minimum fill widths during animation. Do not restore obsolete official layouts or add gradients. Motion also remains for settings, notifications and API interactions. Motion controls must stop cleanly on hidden pages, removed cards, and reinjection. Complete their logical end state without leaving fixed height/transform overrides; reduced-motion changes must not clip the card. Preserve live DOM nodes during same-layout quota updates. Rebuild stale UI event handlers on reinjection, including unknown native fallback cards. Initialize only after head/body exist when injected into a new document. Run browser behavior tests with reduced motion and dedicated animation lifecycle tests with motion enabled.

## 2.1 maintenance

Keep the settings and diagnostics introduced in version 2.0, without adding an expandable quota-details panel or a usage-history database. Version 2.1 shows used quota only on official cards: Pro has two rows (248 × 72px); Plus has three (248 × 96px), with 5h primary and Weekly secondary. Keep the warm paper surface, brown fill and sans-serif typography. Each usage row has a bar and an elapsed-time ring derived from its real reset timestamp (7 days or 5 hours), followed by the absolute reset date/time. Main and secondary bars are 3px and 1.5px high, with matching minimum fill widths. Keep full ring tracks, clockwise arcs from 12 o'clock, and no countdown or remaining text. Without a timestamp, preserve native reset text and an unfilled ring rather than inventing elapsed time. Reuse the visibility-aware timer to update rings once per minute.

Old official compact/remaining preferences must not override this final layout. Only API settings expose compact mode and transparency. API defaults to remaining quota and retains its adaptive palette; compact API mode uses the existing two-row used-percentage layout only when a real total is present. Preserve all unknown fallback windows and never fabricate API reset times. Keep mode changes idempotent under layout observation and reinjection.

Alerts use only sanitized quota data and a random helper-provided session scope. Never put credentials or account identifiers in browser storage. Low-quota and recovery alerts have independent switches. Cross-window state changes must run under Web Locks and recheck the active scope before publishing. Store only the latest deduplication state, not history. Official recovery requires a real response with a later reset window and increased remaining quota. Helper restart starts a new reminder scope; do not claim persistent per-account deduplication across restarts.

Connect all discovered main pages, reuse server cooldowns across windows, and invalidate old in-flight requests when login files change. Keep a stable reminder scope for the same official account across token refreshes. Newly created windows in an attached browser are discovered through Target events, not polling.

Do not queue historical console requests replayed by `Runtime.enable`. Continue queueing real requests while other CDP commands await replies. Preserve an unexpired 429 cooldown across configuration generations for the same account scope, while keeping normal response data generation-specific.

Quota console requests carry a second argument: a page-lifetime nonce plus sequence, stored in `__codexQuotaOfficialRequestId` / `__codexQuotaApiRequestId`. Return the event's original ID as the second argument to the corresponding update callback; never substitute the latest page ID when a response arrives. Pending requests reject missing or mismatched IDs and responses beyond their absolute 25-second deadline. Timeout releases the busy state while retaining prior quota data; visibility restoration and reinjection preserve the original deadline. Ship the matching JavaScript and Helper together. The Helper bounds HTTP reads and active CDP commands to 15 seconds with disposed cancellation registrations, while idle event listeners remain blocking without polling.

Successful manual refresh feedback distinguishes changed quota from unchanged quota. Known official/API layouts keep their height on failure: expose a warning action and accessible description, with the full message in a keyboard-accessible top-layer popover. Keep amounts unchanged until valid data arrives. Initial no-data and unknown-window layouts retain meaningful inline status. Do not report timeout, authentication failure or rate limiting as success.

The settings dialog invokes only the fixed read-only Doctor script through PowerShell 7 (the documented installation prerequisite, standard Program Files location). Ship `scripts/doctor.ps1` under the runtime install root as well as the Skill. Doctor must inspect every discovered window and report missing/unknown windows without hiding them behind another window's success. Return only whitelisted diagnostic fields to the page. Do not substitute Windows PowerShell 5.1: its .NET Framework WebSocket handshake is rejected by the tested Electron CDP endpoint.

Installation must validate task identities before stopping anything, retain exact previous files and task XML under `backups`, and restore them if deployment or startup checks fail. Preserve unrelated files and backup directories on uninstall. Public installer tags and archive hashes change only when the actual release artifact is published.

In addition to Python and JavaScript checks, run `node --test tests/native_patch_runtime.cjs` with the existing Playwright runtime, and run `tests/native_helper_regressions.ps1` and `tests/installer_regressions.ps1` in Windows PowerShell 5.1. Compile to an isolated candidate before stopping the exact deployed helper; retain the old executable before replacement.

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
- `native-patch/native_patch.source.js` and its generated `native_patch.js`
- `codex_quota/page_injector.py`
- `scripts/register_usage_card_task.ps1`
- `scripts/doctor_usage_card.ps1`
- `scripts/repair_codex.ps1`
- `tests/`

The implementation must continue to use the task name `Codex Usage Card` and the deployable output `native-patch/CodexNativeQuotaPatch.next.exe`. Never overwrite the old `CodexNativeQuotaPatch.exe` when Windows has it locked.

## Non-negotiable safety rules

1. Never read, print, log, persist, commit, or send an API key. Existing code may hold it in memory only long enough to make the already-supported request.
2. Never modify, replace, or inspect files inside the Codex WindowsApps install directory.
3. Never change Codex theme settings, global fonts, or host page colors. Scope styles to the widget: official cards use the user-approved warm paper/brown palette; API cards adapt to the active theme. Preserve high-contrast and forced-colors support.
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
- Official usage follows the version 2.1 layout above, with a 248px maximum width adapted to the available sidebar. Exact `pro` + single `Weekly` data uses the two-row Pro card; exact `plus` + real `5h` and `Weekly` data uses the three-row Plus card. Keep used-only numbers, 3px/1.5px usage bars, elapsed-time rings and absolute reset dates/times. Native container queries tighten spacing and typography for narrow sidebars without hiding information. Preserve the scoped warm paper/brown palette, no gradients, light Motion feedback and stable refresh height; old compact/remaining preferences do not change official cards.
- Never fabricate a 5h row. Match plan names case-insensitively but exactly, identify windows by their validated labels rather than array position, and render the Plus layout only when both real target windows exist. Preserve every unknown multi-window shape in the complete fallback layout. When a native card exists, keep one hidden source progress per displayed real window; helper refreshes and native progress changes must update the matching labeled source without creating observer loops.
- Hide the quota card when the sidebar account row is absent; restore it when the row returns. Do not hide unrelated status notifications.
- API mode creates one card above the account row, never the official card. With a real total, its default number and progress show remaining percentage, `(1 - used / total) * 100`; compact mode shows used percentage. Without a total, retain the complete data layout. API surfaces adapt to the sidebar theme and chosen transparency preference. Recompute on ancestor theme and stylesheet changes, cache unchanged inputs, and never poll for theme changes. Increased contrast and forced colors use opaque surfaces and remove blur, highlights, and shadows.
- Official and API refresh use one visibility-aware adaptive one-shot timer. Recent focus/manual interaction uses 2 minutes for 5 minutes, warm interaction uses 5 minutes through 1 hour, 1–4 hours idle uses 15 minutes, and longer idle uses 30 minutes; a changed usage fingerprint keeps the 5-minute activity tier. For visible official cards with reset timestamps, the same timer wakes at the earlier of the next network refresh or minute boundary and updates elapsed-time rings locally without another request. Clear the timer while hidden, bring stale data forward on focus/visibility restoration, replace the previous handler on reinjection, and keep failure retries behind the existing 60-second minimum and server-directed cooldown. Do not scan processes, session files, keyboard input, or add a continuously polling interval.
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

For official mode, verify Pro single-Weekly two-row rendering (248 × 72px), Plus three-row rendering (248 × 96px), used percentages, usage bars, elapsed-time rings and absolute reset dates/times. Check narrow widths, Motion feedback, stable refresh height, plan/window switching, account-row placement, absence of the API card, unchanged host theme, and `card_present() == True`.

For API mode, verify the visible API card, absence of the official card, language-independent account-row lookup, Daily remaining progress semantics, refresh state, and that no key enters the page. Do not switch the user's real login configuration merely to create a screenshot.

### 6. Record and review

Use `apply_patch` to update the project plan and findings with the actual test count, compiler result, task path, process state, page result, and anything not verified. Then review from first principles:

- no unnecessary polling;
- ordinary Codex updates, process restarts, debug-port changes, and page reloads rediscover and reinject without using a version-specific WindowsApps path;
- no permanent exit on transient login state;
- no duplicate helper instance;
- no UI-language dependency;
- no host theme mutation;
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
