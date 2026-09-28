---
name: codex-usage-card
description: Install, build, deploy, repair, and verify Codex Usage Card for Windows. Use when another Windows computer needs one-click installation, the Codex desktop usage card is missing, used and remaining values are reversed, official-account or API-mode support is required, or the helper must recover after a Codex update without modifying WindowsApps, themes, or exposing API keys.
---

# Codex Usage Card

## UI source and build

Edit `native-patch/native_patch.source.js`, not the generated `native_patch.js`. Run `npm ci`, `npm run build`, and `npm run build:check`; the build bundles Motion's native mini API, Lucide icons, and component-prefixed Tailwind utilities into both deployed JavaScript copies. No CDN, React runtime, or Node.js service is required on the target computer. Keep Tailwind Preflight and global selectors out of the injected CSS. Dependency licenses remain embedded in the bundle.

The initial geometry and data contracts are in `docs/quota-sidebar-v3/spec.md`; later approved appearance and motion decisions are in `docs/codex-bar-proposal-20260926.html` in the source repository. Use one collapsed-by-default trigger and one native auto popover. Keep component-local CSS, stable DOM during data updates, reduced-motion support, refresh feedback and sanitized data paths. Build both JavaScript copies; browser tests cover geometry, interactions, request deadlines and account isolation.

## Sidebar v3 maintenance (v2.2)

Preserve settings, alerts and diagnosis, rendered as a replacement pane inside the same popover. Official bars mean used; API bars mean remaining. Never invent windows, aggregate independent percentages, or infer an API percentage without a real total. Known-window rings derive elapsed time from the actual reset timestamp and window duration using the existing visibility-aware timer; API has no ring. Primary official/API bars are 2px high, the 5h secondary track is 1.5px, and fill has a 3px minimum, per the approved design revisions. Light track is #E2D8C4 and fill is #8E4617; dark fill mixes 65% host foreground with 35% warm ochre. Quota numerals use weight 600 and -0.01em tracking; known-window rings are 10px with a 2.75 stroke. Prefer host surface/foreground tokens and retain forced-colors overrides. The persistent trigger has light glass blur and a thin border. Actual Pro weekly-only and Plus 5h/weekly data use a 32px graphical trigger with only a weekly bar; other data and insufficient measured width keep a 30px text trigger. Remeasure footer alignment after changing height. Warnings follow each window independently. Both trigger and popup use host --radius-sm; the popup uses 90% host surface, blur(8px), no border and the existing shadow; unsupported blur/high contrast use an opaque surface and .8px border. Settings switches use native checkbox semantics with :checked-driven 28×16px tracks, keyboard focus and forced-colors support. Do not copy proposal markup into production or modify the startup/request/account-isolation chain for visual work.

Expanded-sidebar motion uses the existing Motion spring to precompute keyframes and native WAAPI to play shared elements: stiffness 420, damping 42, mass 1. Keep one stationary bottom-right expand/collapse control; plan, digits, percent, bar and time ring move independently. Preserve velocity on reversal and restore original-trigger hit testing and keyboard access as soon as native closing starts. Do not write styles or animate height/top per frame. The card shares the measured trigger bottom and right edge, within column bounds; never leave a blank trigger below it. The collapsed-rail fallback retains 240ms/180ms transitions; settings use a 160ms pane transition. Explicit collapse/Escape restores trigger focus. Clear temporary layers on interruption, session changes and reinjection; reduced-motion and hidden pages switch immediately.

Use 8px spacing for the main layout and a shared left alignment for the heading, labels, primary value and final reset line. Header settings and bottom collapse share the measured arrow axis, with space reserved inside the header rather than negative margins. Normal cards must have zero horizontal/vertical overflow. Hide scrollbars while retaining keyboard/wheel access in short-window settings. Draw refresh/settings/success/failure SVGs at 16px with a 1.5px stroke and 24px hit areas; preserve their optical size on press. The independent HTML refresh rotor loops through native transform; fixed icon layers crossfade opacity for 140ms. Cancel only after the rotor is invisible, or immediately for hidden/closed/reduced-motion cleanup. Never add artificial request delays or reset a running refresh clock on rerender.

Old compact/remaining/transparency preferences do not override v3. Unknown windows remain separate. Missing data is unavailable, never zero. Every failed update retains the previous successful values and visibly reports failure plus the last successful time, including cooldown retries.

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

When this skill is installed without a source checkout, run `scripts/install.ps1`. It copies the bundled native helper to `%LOCALAPPDATA%\CodexUsageCard`, registers the current-user task `Codex Usage Card`, starts one windowless instance, and creates the current user's desktop `Codex（额度卡）.lnk` targeting that helper with `--launch`. Validate any existing shortcut's target, arguments and working directory before stopping the task; preserve unrelated shortcuts and restore installation state on failure. `-SkipTaskRegistration` must not touch shortcuts. It migrates the legacy `Codex Quota Card Repair` task only when that task points to the exact legacy install path. If either task name points somewhere else, stop and report the path instead of overwriting it.

Use `scripts/uninstall.ps1` only when the user explicitly asks to remove Codex Usage Card. It removes only the exact task and files installed by this skill.

## Read-only diagnosis

Run `scripts/doctor.ps1` to inspect the exact task action, exact helper process, windowless state, Codex process, local CDP main page, and visible official/API entry (closed popovers are healthy) without changing system state. Its structured result uses non-sensitive `StageCodes` and never reads or prints credentials, account identifiers, or API responses. Explicit `--launch` processes are not extra background helper instances. The current Helper has no startup confirmation UI; any retained prompt diagnostic fields are compatibility fields for older builds. `CardVisible = $null` means the page could not be inspected because Codex, its debugging endpoint, or its main page was unavailable; it does not mean installation failed. `CardVisible = $false` means the main page was inspected and no supported visible entry was found.

## Scope

- Run only in Windows PowerShell. Do not use Linux, WSL, `/mnt/data`, or shell-specific substitutes.
- Accept the project directory from the user or discover it from the current workspace. Never hard-code another user's absolute path.
- Work on the native helper and page script, not the Codex WindowsApps installation directory.
- Keep official-account and API login detection automatic. Do not add an Account/API switch.
- Keep the helper windowless: compile the C# target as `winexe`, and do not reintroduce `python.exe`, `pythonw.exe`, `wscript.exe`, or a console launcher into the scheduled task.
- Preserve the user-requested v1.9 startup behavior. Snapshot existing Codex root identities when the Helper starts and leave those sessions untouched. When waiting for a debuggable client, automatically terminate each newly observed root missing debugging arguments at most once, wait up to 5 seconds for exit, and relaunch with a dynamic loopback debugging port. Validate the exact process identity immediately before termination; do not restart for quota, login or transient network errors. Keep handled identities in memory, with no confirmation UI or persisted prompt decisions. Both automatic recovery and optional `--launch` use the same launcher mutex. `--launch` runs before the Helper single-instance lock: focus an existing Codex without restarting it; otherwise resolve the current user's registered `OpenAI.Codex` application ID and activate it once through Windows package activation. The background helper waits on native window-show/foreground events, with no polling or privileged process-trace subscription.

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
5. Preserve Codex sessions already open when the Helper starts; do not close them for maintenance or testing. The user explicitly authorized restoring automatic termination and relaunch only for subsequently observed roots missing debugging arguments. Reject identity changes before termination; an exit timeout must not trigger a replacement launch. An existing session opened through `--launch` is only focused, never terminated.
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

Check the explicit launcher before changing it:

- Only current-session, version-independent `OpenAI.Codex_*\app\ChatGPT.exe` roots are eligible. Reject `--type=` children, other ChatGPT packages and missing creation timestamps. Revalidate PID, creation time and executable path while holding the process handle immediately before automatically terminating a newly observed root. Protect the identities present at Helper startup.
- Resolve current-user package registration and the manifest application matching `app/ChatGPT.exe` with a hidden, bounded Windows PowerShell query. Resolve a free loopback port before the single activation. Use `IApplicationActivationManager.ActivateApplication` with `AO_NONE` and a `CLSCTX_LOCAL_SERVER` object so the process retains MSIX package identity and the short-lived launcher does not own activation-argument lifetime. Initialize COM on the calling thread, release the object, then pair successful initialization with `CoUninitialize`. Do not launch the packaged executable through raw `CreateProcess` with a substituted Explorer parent.
- Report explicit launch failures with a visible message and nonzero exit code. Keep the background service windowless. Register out-of-context WinEvent hooks before inspecting roots in the waiting loop; hold callbacks alive and unregister on the same message-pump thread. Coalesce events and apply startup grace before discovery. Record a new root as handled only after acquiring the launcher mutex, then allow at most one automatic attempt for that identity. `Win32_ProcessStartTrace` is denied in the tested limited-user context and must not gate startup detection. Resolve package registration and a free loopback port before termination; call `Kill()`, require `WaitForExit(5000)` to succeed, and submit the replacement activation. A transient forwarding root must not cancel the activation; Codex owns its single-instance lock. Keep bounded startup diagnostics without account data or full command lines; a returned activation call is not a doctor success.
- Run `tests/launcher_regressions.ps1` and `tests/startup_window_regressions.ps1` in Windows PowerShell 5.1. Native event tests use invisible, self-exiting probes; fake process decisions alone do not validate event delivery. Verify desktop shortcut identity and preserve the running Codex PID during deployment. Report a real cold launch as unverified until the user naturally closes and reopens Codex; do not close their session to test it. Run `tests/packaged_activation_smoke.ps1` only with an already open debug client; it checks real activation and `GetPackageFullName` while preserving that client. For a manual cold launch, verify the new root package identity, dynamic port and actual quota entry. The removed startup confirmation UI has no required prompt regression.

Review the page script for these invariants:

- Reuse Helper-validated official/API payloads and native single-window fallback. Credentials never enter the page. Keep request identifiers, deadlines, rate limits, alert scope and account reset behavior intact.
- Mount a normal-flow footer in the measured `.sidebar-navigation` flex column. Align trigger and visible avatar tops from actual rectangles, converting viewport pixels before writing padding inside the host zoom root. Never use prototype sidebar or avatar dimensions as host interfaces.
- Render all real windows individually; only known 5h/Weekly durations produce elapsed rings. Without a timestamp retain native reset text and an unfilled ring. Do not average windows or manufacture missing ones.
- Move the same trigger into `nav[data-app-navigation-rail]` bottom stack above help when the list column is hidden, and move it back when restored. Observe host geometry/visibility/replacement while ignoring own mutations and chat streaming.
- API shows remaining amount and, only with a real total, remaining percentage. Both modes use one auto popover: width min(272px, measured list width minus 16px), within the list column and viewport; collapsed rail mode uses viewport bounds. Settings replace its content; native light dismissal and Escape keep aria-expanded and focus coherent.
- Official and API refresh use one visibility-aware adaptive one-shot timer. Recent focus/manual interaction uses 2 minutes for 5 minutes, warm interaction uses 5 minutes through 1 hour, 1–4 hours idle uses 15 minutes, and longer idle uses 30 minutes; a changed usage fingerprint keeps the 5-minute activity tier. For visible official cards with reset timestamps, the same timer wakes at the earlier of the next network refresh or minute boundary and updates elapsed-time rings locally without another request. Clear the timer while hidden, bring stale data forward on focus/visibility restoration, replace the previous handler on reinjection, and keep failure retries behind the existing 60-second minimum and server-directed cooldown. Do not scan processes, session files, keyboard input, or add a continuously polling interval.
- `card_present()` and Doctor accept the actual visible v3 trigger even with its popover closed or quota unavailable. Preserve CardVisible field and multi-window aggregation; internal patch markers are insufficient. Retain old-card detection only for old installations.
- The script does not touch model pickers, model labels, menus, or option lists.

If an invariant is unclear, stop and report the evidence instead of guessing.

### 3. Test and compile

From the project directory, run:

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

Report only the total passed and failed test counts. Compile the helper with the Visual Studio Roslyn `csc.exe` using `/codepage:65001` and `/target:winexe` to:

```text
native-patch\CodexNativeQuotaPatch.next.exe
```

Use the existing references: `System.dll`, `System.Core.dll`, `System.Management.dll`, `System.Net.Http.dll`, `System.Web.Extensions.dll`, and `System.Security.dll`. The removed startup panel requires no WPF references. Preserve UTF-8 when generating candidate sources; PowerShell/native stdout conversion must not corrupt Chinese literals. Do not route output to the old executable.

### 4. Replace the background instance safely

Operate only on `Codex Usage Card`. During a verified upgrade, the installer may remove the legacy `Codex Quota Card Repair` task only when its single action points to the exact legacy install path:

1. Verify its action points to the exact `.next.exe` path, then stop the task.
2. Resolve processes by exact executable path, not by process name alone.
3. Stop only exact matches, if any.
4. Compile the new `.next.exe`.
5. Start the same task.
6. Recheck the action path, exact background process count, and windowless state through Doctor. Verify that the Codex PID and creation time present before deployment are unchanged. The newly started Helper must record and protect those existing sessions; automatic relaunch applies only to subsequently observed roots lacking debugging arguments.

If any identity check fails, stop before changing state.

### 5. Verify the real page

Use the active Codex debugging target only when it is available. Without a running client or debugging port, report that the page cannot be verified; never fabricate a result.

For official mode, run the v3 17-check geometry/interaction matrix and its data regressions. Verify known and unknown windows, used bars, timestamp-derived rings, plan switching, session reset, default collapse, avatar alignment, rail relocation, host zoom and unchanged host theme. Escape, outside clicks, motion feel and native screenshot match still require human acceptance on the real client.

For API mode, verify remaining amount, optional real-total percentage, no time ring, default-closed entry health, settings, refresh failure with last-success time, and absence of official data. Do not switch real login configuration merely to create a screenshot.

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
