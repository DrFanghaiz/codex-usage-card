(() => {
  const compactClass = "codex-native-compact-usage";
  const compactContentClass = "codex-native-compact-usage-content";
  const apiCardClass = "codex-api-compact-usage";
  const apiHostId = "codex-api-usage-host";
  const officialHostId = "codex-official-usage-host";
  const styleId = "codex-native-compact-usage-style";
  const staleAfterMs = 5 * 60 * 1000;
  const failureRetryMs = 60 * 1000;
  const isChinese = /^zh\b/i.test(navigator.language || "");
  const copy = isChinese
    ? {
        weeklyTitle: "本周已用",
        fiveHourTitle: "5小时已用",
        officialSourceAria: "官方账户",
        remainingPrefix: "剩余",
        remainingAvailable: "剩余可用",
        remainingSuffix: "",
        resetSuffix: "重置",
        resetAtPrefix: "重置时间",
        resetCountdownPrefix: "距离自然重置",
        used: "已用",
        summaryUsed: "已用",
        weeklySummaryTitle: "周",
        weeklyUsedAria: "每周已用",
        fiveHourUsedAria: "5小时已用",
        resetUnavailable: "重置时间不可用",
        officialUnavailable: "周用量不可用",
        apiTitle: "API 剩余",
        dailyKicker: "每日",
        apiRemainingAria: "API 每日剩余",
        plan: "套餐",
        daily: "今日",
        status: "状态",
        unavailable: "API 用量不可用",
        invalid: "API 用量响应无效",
        noLimit: "未设置每日限额",
        loading: "正在读取…",
        stale: "更新失败，显示上次数据",
        stalePrefix: "更新失败，显示 ",
        staleSuffix: " 的数据",
        cooldownPrefix: "暂时不可用，",
        cooldownSuffix: " 后重试",
        refresh: "刷新用量",
        refreshing: "刷新中…",
      }
    : {
        weeklyTitle: "Weekly used",
        fiveHourTitle: "5h used",
        officialSourceAria: "Official account",
        remainingPrefix: "Remaining",
        remainingAvailable: "Remaining",
        remainingSuffix: "",
        resetSuffix: "reset",
        resetAtPrefix: "Reset at",
        resetCountdownPrefix: "Until reset",
        used: "Used",
        summaryUsed: "used",
        weeklySummaryTitle: "Week",
        weeklyUsedAria: "Weekly used",
        fiveHourUsedAria: "5-hour used",
        resetUnavailable: "Reset unavailable",
        officialUnavailable: "Weekly usage unavailable",
        apiTitle: "API remaining",
        dailyKicker: "Daily",
        apiRemainingAria: "API daily remaining",
        plan: "Plan",
        daily: "Daily",
        status: "Status",
        unavailable: "API usage unavailable",
        invalid: "Invalid API usage response",
        noLimit: "No daily limit",
        loading: "Loading…",
        stale: "Update failed; showing last result",
        stalePrefix: "Update failed; showing data from ",
        staleSuffix: "",
        cooldownPrefix: "Unavailable; retry after ",
        cooldownSuffix: "",
        refresh: "Refresh usage",
        refreshing: "Refreshing…",
      };

  const apiMode = () => globalThis.__codexQuotaMode === "api";

  const adaptiveRefreshDelayMs = (now = Date.now()) => {
    const sinceInteraction = now - Number(globalThis.__codexQuotaLastInteractionAt || 0);
    if (sinceInteraction <= staleAfterMs) return 2 * 60 * 1000;
    if (sinceInteraction <= 60 * 60 * 1000) return staleAfterMs;
    const sinceUsageActivity = now - Number(globalThis.__codexQuotaLastUsageActivityAt || 0);
    if (sinceUsageActivity <= staleAfterMs) return staleAfterMs;
    if (sinceInteraction <= 4 * 60 * 60 * 1000) return 15 * 60 * 1000;
    return 30 * 60 * 1000;
  };

  const quotaUsageFingerprint = (data) => Array.isArray(data?.windows)
    ? JSON.stringify(data.windows.map((window) => [window.label, window.usedPercent]).sort(([a], [b]) => a.localeCompare(b)))
    : JSON.stringify([data?.used, data?.remaining, data?.total]);

  const officialPresentation = (data) => {
    const planName = typeof data?.planName === "string" ? data.planName.trim().toLowerCase() : "";
    const windows = Array.isArray(data?.windows) ? data.windows : [];
    const valid = planName && windows.length > 0 && windows.every((window) =>
      typeof window?.label === "string" &&
      Number.isFinite(window?.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 &&
      Number.isFinite(window?.resetAt) && window.resetAt >= 0);
    if (!valid) return null;
    const fiveHour = windows.find((window) => window.label === "5h");
    const weekly = windows.find((window) => window.label === "Weekly");
    if (planName === "plus" && windows.length === 2 && fiveHour && weekly) {
      return {kind: "plus-x", planName, planLabel: "Plus", windows, fiveHour, weekly};
    }
    if (windows.length === 1 && weekly) {
      return {kind: "weekly", planName, planLabel: planName === "pro" ? "Pro" : "", windows, weekly};
    }
    return {kind: "fallback", planName, windows};
  };

  const updatePalette = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    const probeId = "codex-quota-color-probe";
    const probe = document.getElementById(probeId) || document.createElement("span");
    probe.id = probeId;
    probe.hidden = true;
    if (!probe.isConnected) document.head.append(probe);
    const cache = new WeakMap();
    const darkMode = matchMedia("(prefers-color-scheme: dark)");
    const mix = (front, back, alpha) => front.map((v, i) => v * alpha + back[i] * (1 - alpha));
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const linear = (v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const gamma = (v) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
    const luminance = (rgb) => rgb.map(linear).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const contrast = (rgb, backgrounds) => Math.min(...backgrounds.map((background) => {
      const a = luminance(rgb), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }));
    const readColor = (value) => {
      if (!CSS.supports("color", value)) throw new Error("Invalid quota theme color");
      context.clearRect(0, 0, 1, 1);
      // Resolve system colors and light-dark() in the card's color scheme first.
      probe.style.color = value;
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
    };
    const opaque = (rgba, background) => mix(rgba.slice(0, 3), background, rgba[3]);
    // Oklab matrices: https://bottosson.github.io/posts/oklab/ (public domain).
    const toLab = (rgb) => {
      const [r, g, b] = rgb.map(linear);
      const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
      const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
      const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
      return [.2104542553 * l + .793617785 * m - .0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
        .0259040371 * l + .7827717662 * m - .808675766 * s];
    };
    const fromLab = ([L, a, b]) => {
      const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
      const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
      const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
      return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
        -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(gamma);
    };
    const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1.000001);
    const gamut = (lab) => {
      const rgb = fromLab(lab);
      if (inGamut(rgb)) return rgb.map(clamp);
      let low = 0, high = 1;
      for (let i = 0; i < 22; i++) {
        const k = (low + high) / 2;
        if (inGamut(fromLab([lab[0], lab[1] * k, lab[2] * k]))) low = k;
        else high = k;
      }
      return fromLab([lab[0], lab[1] * low, lab[2] * low]).map(clamp);
    };
    const readable = (start, ink, backgrounds, minimum) => {
      for (let i = 0; i <= 100; i++) {
        const rgb = mix(ink, start, i / 100);
        if (contrast(rgb, backgrounds) >= minimum) return rgb;
      }
      return ink;
    };
    return (card) => {
      const style = getComputedStyle(card);
      const inputs = ["--cq-sidebar", "--cq-theme-ink", "--cq-theme-muted", "--cq-theme-accent"]
        .map((name) => style.getPropertyValue(name).trim());
      probe.style.colorScheme = style.colorScheme;
      let background = readColor(inputs[0]);
      if (background[3] < 1) {
        // Transparent sidebar tokens need the actual ancestor composition.
        const ancestors = [];
        for (let node = card.parentElement; node; node = node.parentElement) ancestors.push(node);
        background = ancestors.reverse().reduce((under, node) =>
          opaque(readColor(getComputedStyle(node).backgroundColor), under), readColor("Canvas").slice(0, 3));
      } else background = background.slice(0, 3);
      const key = JSON.stringify([inputs, background, style.colorScheme, darkMode.matches]);
      if (cache.get(card) === key && card.style.getPropertyValue("--cq-palette-solid")) return;
      const [L, a, b] = toLab(background), chroma = Math.hypot(a, b);
      const cap = chroma > .08 ? .08 : chroma > .025 ? .04 : L >= .65 ? .016 : .020;
      const nextChroma = chroma < .006 ? 0 : Math.min(chroma * (chroma > .08 ? .5 : .65), cap);
      const scale = chroma > 0 ? nextChroma / chroma : 0;
      let lightness = L + (L >= .65 ? .03 : .05);
      if (lightness > .98) lightness = L - .03;
      let surface, backgrounds, ink, opacity = .9, glow = .025;
      // Check nearby lightness candidates when a midtone leaves too little text contrast.
      for (const shift of [0, .02, -.02]) {
        surface = gamut([clamp(lightness + shift), a * scale, b * scale]);
        const composite = mix(surface, background, opacity);
        backgrounds = [surface, composite, mix([1, 1, 1], composite, glow)];
        const requested = opaque(readColor(inputs[1]), composite);
        const candidates = [requested, [0, 0, 0], [1, 1, 1]];
        ink = candidates.find((rgb) => contrast(rgb, backgrounds) >= 4.7);
        if (ink) break;
      }
      if (!ink) {
        // A solid surface always permits an accessible black/white pair.
        opacity = 1; glow = 0; backgrounds = [surface];
        ink = contrast([0, 0, 0], backgrounds) >= 4.5 ? [0, 0, 0] : [1, 1, 1];
      }
      const composite = mix(surface, background, opacity);
      const muted = readable(opaque(readColor(inputs[2]), composite), ink, backgrounds, 4.65);
      const accent = readable(opaque(readColor(inputs[3]), composite), ink, backgrounds, 3.1);
      const colors = {solid: surface, ink, muted, accent};
      for (const [name, rgb] of Object.entries(colors)) {
        card.style.setProperty(`--cq-palette-${name}`, `rgb(${rgb.map((v) => (v * 255).toFixed(3)).join(" ")})`);
      }
      card.style.setProperty("--cq-palette-opacity", String(opacity));
      card.style.setProperty("--cq-palette-glow", String(glow));
      cache.set(card, key);
    };
  })();

  const ensureStyle = () => {
    const style = document.getElementById(styleId) || document.createElement("style");
    const css = `
      .${compactClass}, .${apiCardClass} {
        --cq-sidebar: var(--color-token-side-bar-background, var(--vscode-sideBar-background, var(--color-background-surface-under, Canvas)));
        --cq-solid: var(--cq-palette-solid, var(--cq-sidebar));
        --cq-surface: color-mix(in srgb, var(--cq-solid) calc(var(--cq-palette-opacity, .9) * 100%), transparent);
        --cq-border: color-mix(in srgb, var(--cq-ink) 9%, transparent);
        --cq-track: color-mix(in srgb, var(--cq-ink) 12%, transparent);
        --cq-theme-ink: var(--color-token-text-primary, var(--vscode-foreground, CanvasText));
        --cq-theme-muted: var(--color-text-secondary-solid, color-mix(in srgb, var(--cq-theme-ink) 78%, transparent));
        --cq-theme-accent: var(--codex-base-accent, var(--color-text-accent, var(--cq-theme-ink)));
        --cq-ink: var(--cq-palette-ink, var(--cq-theme-ink));
        --cq-muted: var(--cq-palette-muted, var(--cq-theme-muted));
        --cq-soft: var(--cq-muted);
        --cq-faint: var(--cq-muted);
        --cq-accent: var(--cq-palette-accent, var(--cq-theme-accent));
        --cq-sans: var(--default-font-family, inherit);
        box-sizing: border-box !important;
        min-height: 0 !important;
        color: var(--cq-ink) !important;
        font-family: var(--cq-sans) !important;
      }
      .${compactClass} {
        container-type: inline-size;
        display: block !important;
        width: calc(100% - 16px) !important;
        max-width: 248px;
        margin: 0 8px 8px !important;
        padding: 12px 14px 11px !important;
        overflow: hidden;
        border: 1px solid var(--cq-border) !important;
        border-radius: 12px !important;
        outline: 0 !important;
      }
      #${officialHostId} {
        width: calc(100% - 16px) !important;
        max-width: 248px;
        margin: 0 8px 8px !important;
        padding: 12px 14px 11px !important;
        border: 1px solid var(--cq-border) !important;
        border-radius: 12px !important;
      }
      .${apiCardClass} {
        padding: 8px 12px !important;
        overflow: hidden;
        border: 0 !important;
        border-radius: 12px !important;
        outline: .5px solid var(--cq-border);
        outline-offset: -.5px;
      }
      .${compactClass}, .${apiCardClass} {
        background: linear-gradient(135deg, rgb(255 255 255 / var(--cq-palette-glow, .025)), transparent 60%), var(--cq-surface) !important;
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
        box-shadow: 0 1px 3px rgba(0, 0, 0, .025) !important;
      }
      .${compactContentClass} { display: grid; min-width: 0; }
      .${compactContentClass} .cq-thread-head { display: flex; align-items: center; justify-content: space-between; }
      .${compactContentClass} .cq-title-wrap { display: flex; min-width: 0; align-items: center; }
      .${compactContentClass} .cq-thread-head .cq-title { color: var(--cq-muted); font-size: 11px; font-weight: 500; line-height: 16px; letter-spacing: .02em; }
      .${compactContentClass} .cq-plan { margin-left: 7px; padding: 1px 7px; border: 1px solid var(--cq-border); border-radius: 999px; background: transparent; color: var(--cq-ink); font-size: 9px; font-weight: 600; line-height: 1.5; letter-spacing: .04em; }
      .${compactContentClass} .cq-plan:empty { display: none; }
      .${compactContentClass} .cq-thread-head .cq-head-action { display: grid; width: 13px; height: 13px; place-items: center; }
      .${compactContentClass} .cq-thread-main { display: flex; align-items: flex-end; min-width: 0; margin-top: 6px; }
      .${compactContentClass} .cq-thread-main > .cq-number { display: flex; flex: none; align-items: baseline; font-variant-numeric: tabular-nums; line-height: 1; }
      .${compactContentClass} .cq-thread-main > .cq-number .cq-number-value { font-size: 24px; font-weight: 600; letter-spacing: -.01em; }
      .${compactContentClass} .cq-thread-main > .cq-number .cq-number-unit { margin-left: 1px; color: var(--cq-muted); font-size: 12px; font-weight: 500; }
      .${compactContentClass} .cq-thread-meta { flex: none; padding-bottom: 1px; color: var(--cq-soft); font-size: 10px; line-height: normal; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .${compactContentClass} .cq-thread-meta b { color: var(--cq-ink); font-weight: 600; }
      .${compactContentClass} .cq-thread-rule { position: relative; flex: 1; height: 2px; margin: 0 10px 2px; border-radius: 2px; background: var(--cq-track); }
      .${compactContentClass} .cq-thread-rule::before { position: absolute; inset: 0 auto 0 0; width: var(--cq-used, 0%); border-radius: inherit; background: var(--cq-accent); content: ""; }
      .${compactContentClass} .cq-thread-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
      .${compactContentClass} .cq-thread-reset { display: flex; align-items: center; gap: 5px; color: var(--cq-soft); font-size: 9.5px; line-height: normal; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .${compactContentClass} .cq-thread-reset .cq-reset-prefix { display: none; }
      .${compactContentClass} .cq-thread-reset b { color: var(--cq-muted); font-size: inherit; font-weight: 500; line-height: inherit; }
      .${compactContentClass} .cq-clock { width: 11px; height: 11px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .${compactContentClass} .cq-reset-date { color: var(--cq-faint); font-size: 9.5px; line-height: normal; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .${compactContentClass} .cq-reset-date b { color: var(--cq-muted); font-weight: 500; }
      .${compactContentClass} .cq-week-summary { display: inline-flex; align-items: baseline; gap: 3px; color: var(--cq-faint); font-size: 9px; line-height: normal; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .${compactContentClass} .cq-week-summary b { color: var(--cq-muted); font-weight: 500; }
      .${compactContentClass} .cq-folio-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .${compactContentClass} .cq-head-end { display: flex; align-items: baseline; gap: 8px; }
      .${compactContentClass} .cq-title { font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0; }
      .${compactContentClass} .cq-kicker { flex: none; color: var(--cq-muted); font-size: 10px; font-weight: 500; line-height: 14px; letter-spacing: 0; }
      .${compactContentClass} .cq-folio-main { display: flex; align-items: stretch; justify-content: flex-start; gap: 10px; min-width: 0; margin: 3px 0 4px; }
      .${compactContentClass} .cq-number { display: flex; flex: none; align-self: center; align-items: baseline; font-variant-numeric: tabular-nums; line-height: 1; }
      .${compactContentClass} .cq-number-value { font-size: 30px; font-weight: 500; letter-spacing: -.02em; }
      .${compactContentClass} .cq-number-unit { margin-left: 2px; color: var(--cq-ink); font-size: 12px; font-weight: 500; }
      .${compactContentClass} .cq-divider { flex: none; width: 1px; margin: 2px 0; background: var(--cq-border); }
      .${compactContentClass} .cq-folio-note { min-width: 0; align-self: center; color: var(--cq-muted); font-size: 11px; line-height: 14px; text-align: left; text-wrap: pretty; }
      .${compactContentClass} .cq-folio-note b { display: block; overflow-wrap: anywhere; color: var(--cq-ink); font-weight: 500; }
      .${compactContentClass} .cq-rule { position: relative; height: 3px; border-radius: 999px; background: var(--cq-track); }
      .${compactContentClass} .cq-rule::before { position: absolute; inset: 0 auto 0 0; width: var(--cq-remaining, 0%); border-radius: inherit; background: var(--cq-accent); content: ""; transition: width .18s cubic-bezier(.16,1,.3,1); }
      .${compactContentClass} .cq-status { margin-top: 8px; color: var(--cq-muted); font-size: 10.5px; line-height: 16px; }
      .${compactContentClass} .cq-source-progress { display: none !important; }
      .${compactClass}[hidden], .${apiCardClass}[hidden],
      [data-codex-quota-sidebar-hidden="true"], [data-codex-api-source="true"] {
        display: none !important;
      }
      .${compactContentClass}.cq-compact-fallback { gap: 8px; }
      .${compactContentClass} .cq-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .${compactContentClass} .cq-window { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; min-width: 0; }
      .${compactContentClass} .cq-label, .${compactContentClass} .cq-value { font-size: 11px; line-height: 16px; }
      .${compactContentClass} .cq-value { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .${compactContentClass} .cq-reset, .${compactContentClass} .cq-reset-value { color: var(--cq-muted); font-size: 10.5px; line-height: 16px; }
      .${compactContentClass} .cq-reset-value { text-align: right; overflow-wrap: anywhere; }
      .${compactContentClass} .cq-window > progress { grid-column: 1 / -1; height: 4px !important; margin: 0; }
      .${compactContentClass} .cq-refresh { position: relative; display: inline-grid; width: 13px; height: 13px; margin: 0; padding: 0; place-items: center; border: 0; background: transparent; color: var(--cq-faint); cursor: pointer; line-height: 0; }
      .${compactContentClass} .cq-refresh-icon { display: block; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .${compactContentClass} .cq-refresh::before { position: absolute; inset: -10px; content: ""; }
      .${compactContentClass} .cq-refresh:hover { color: var(--cq-ink); }
      .${compactContentClass} .cq-refresh:focus-visible { border-radius: 4px; outline: 2px solid var(--cq-accent); outline-offset: 1px; }
      .${compactContentClass} .cq-refresh:disabled { cursor: wait; opacity: .65; }
      @media (prefers-contrast: more) {
        .${compactClass}, .${apiCardClass} { --cq-border: var(--cq-ink); --cq-muted: var(--cq-ink); --cq-soft: var(--cq-ink); --cq-faint: var(--cq-ink); }
        #${officialHostId}, .${apiCardClass} { border-color: var(--cq-ink) !important; outline-color: var(--cq-ink); }
      }
      @supports not (backdrop-filter: blur(1px)) {
        .${compactClass}, .${apiCardClass} { background: var(--cq-solid) !important; }
      }
      @media (prefers-contrast: more), (forced-colors: active) {
        .${compactClass}, .${apiCardClass} {
          background: var(--cq-solid) !important;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          box-shadow: none !important;
        }
      }
      @container (max-width: 170px) {
        .${compactContentClass} .cq-thread-rule { margin-inline: 6px; }
      }
      @container (max-width: 147px) {
        .${compactContentClass} .cq-thread-foot { align-items: stretch; flex-direction: column; gap: 4px; }
        .${compactContentClass} .cq-reset-date { text-align: right; }
        .${compactContentClass} .cq-week-summary { align-self: flex-end; }
      }
      @media (forced-colors: active) {
        .${compactClass}, .${apiCardClass} { --cq-solid: Canvas; --cq-surface: Canvas; --cq-border: CanvasText; --cq-track: GrayText; --cq-ink: CanvasText; --cq-muted: CanvasText; --cq-soft: CanvasText; --cq-faint: CanvasText; --cq-accent: Highlight; forced-color-adjust: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .${compactContentClass} .cq-rule::before, .${compactContentClass} .cq-refresh { transition: none !important; }
      }
    `;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) {
      style.id = styleId;
      document.head.append(style);
    }
  };

  const resetElement = (card) => [...card.querySelectorAll("div")].find((element) =>
    (element.classList.contains("text-sm") && element.classList.contains("text-token-text-secondary")) ||
    (element.classList.contains("text-xs") && element.classList.contains("text-secondary")));

  const resetValue = (card) => {
    const reset = resetElement(card);
    if (!reset) return "Unavailable";
    const text = (reset.textContent || "").trim();
    const separator = text.indexOf("·");
    return separator >= 0 ? text.slice(separator + 1).trim() : text || "Unavailable";
  };

  const addHeading = (content, title, action = null) => {
    const heading = document.createElement("div");
    heading.className = "cq-heading";
    const titleNode = document.createElement("span");
    titleNode.className = "cq-title";
    titleNode.textContent = title;
    heading.append(titleNode);
    if (action instanceof Node) heading.append(action);
    content.append(heading);
  };

  const formatPercent = (value) => String(Number(value.toFixed(2)));

  const resetTime = (value) => {
    if (value === "Unavailable" || value === copy.resetUnavailable) return copy.resetUnavailable;
    const text = String(value).trim();
    if (isChinese) return text.replace(/^.*下次重置时间为\s*/, "").replace(/\s*重置$/, "");
    return text.replace(/^resets?(?:\s+at)?\s*/i, "").replace(/\s+resets?$/i, "");
  };

  const quotaErrorCode = (kind) => kind === "api"
    ? globalThis.__codexQuotaApiErrorCode || (globalThis.__codexQuotaApiError ? "UNAVAILABLE" : null)
    : globalThis.__codexQuotaOfficialErrorCode || (globalThis.__codexQuotaOfficialError ? "UNAVAILABLE" : null);

  const quotaTiming = (isApi = apiMode()) => ({
    lastSuccessAt: Number(isApi
      ? globalThis.__codexQuotaApiLastSuccessAt || 0
      : globalThis.__codexQuotaOfficialLastSuccessAt || 0),
    nextAttemptAt: Number(isApi
      ? globalThis.__codexQuotaApiNextAutoAttemptAt || 0
      : globalThis.__codexQuotaOfficialNextAutoAttemptAt || 0),
    cooldownUntil: Number(isApi
      ? globalThis.__codexQuotaApiCooldownUntil || 0
      : globalThis.__codexQuotaOfficialCooldownUntil || 0),
  });

  const recordQuotaInteraction = (kind) => {
    const now = Date.now();
    globalThis.__codexQuotaLastInteractionAt = now;
    const isApi = kind === "api";
    const {lastSuccessAt} = quotaTiming(isApi);
    if (!lastSuccessAt || quotaErrorCode(kind)) return;
    const nextAt = lastSuccessAt + adaptiveRefreshDelayMs(now);
    if (isApi) globalThis.__codexQuotaApiNextAutoAttemptAt = nextAt;
    else globalThis.__codexQuotaOfficialNextAutoAttemptAt = nextAt;
  };

  const formatStatusTime = (value) => {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const quotaState = (kind, data, errorCode = quotaErrorCode(kind)) => {
    const isApi = kind === "api";
    const needsData = isApi
      ? globalThis.__codexQuotaApiNeedsData === true
      : globalThis.__codexQuotaOfficialNeedsData === true;
    const loaded = isApi
      ? globalThis.__codexQuotaApiLoaded === true
      : globalThis.__codexQuotaOfficialLoaded === true;
    const {lastSuccessAt, cooldownUntil} = quotaTiming(isApi);
    if (needsData) return {busy: true, text: data ? null : copy.loading};
    if (errorCode && data) {
      const time = formatStatusTime(lastSuccessAt);
      return {busy: false, text: time ? `${copy.stalePrefix}${time}${copy.staleSuffix}` : copy.stale};
    }
    if (!data) {
      if (!loaded) return {busy: true, text: copy.loading};
      const retryAt = cooldownUntil > Date.now() ? formatStatusTime(cooldownUntil) : "";
      return {
        busy: false,
        text: retryAt
          ? `${copy.cooldownPrefix}${retryAt}${copy.cooldownSuffix}`
          : isApi ? copy.unavailable : copy.officialUnavailable,
      };
    }
    return {busy: false, text: null};
  };

  const setRefreshButtonState = (button, busy) => {
    const label = busy ? copy.refreshing : copy.refresh;
    button.disabled = busy;
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  const createRefreshButton = (kind) => {
    const button = document.createElement("button");
    const busy = kind === "api"
      ? globalThis.__codexQuotaApiNeedsData === true
      : globalThis.__codexQuotaOfficialNeedsData === true;
    button.type = "button";
    button.className = "cq-refresh";
    button.innerHTML = `
      <svg class="cq-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 12a8 8 0 1 1-2.34-5.66"></path>
        <path d="M20 4v6h-6"></path>
      </svg>`;
    setRefreshButtonState(button, busy);
    button.addEventListener("click", () => {
      recordQuotaInteraction(kind);
      if (kind === "api") requestApiData(true);
      else requestOfficialData(true);
    });
    return button;
  };

  const setCardAccessibility = (card, busy) => {
    card.setAttribute("role", "region");
    card.removeAttribute("aria-live");
    card.removeAttribute("aria-atomic");
    card.setAttribute("aria-busy", String(busy));
  };

  const setContentStatus = (content, text) => {
    let status = content.querySelector(".cq-status");
    if (!text) {
      status?.remove();
      return;
    }
    if (!status) {
      status = document.createElement("div");
      status.className = "cq-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      content.append(status);
    }
    status.textContent = text;
  };

  const showCooldown = (kind, cooldownUntil) => {
    const card = kind === "api"
      ? document.getElementById(apiHostId)
      : nativeQuotaCard() || document.getElementById(officialHostId);
    const content = card?.querySelector(`.${compactContentClass}`);
    const retryAt = formatStatusTime(cooldownUntil);
    if (!card || !content || !retryAt) return;
    setContentStatus(content, `${copy.cooldownPrefix}${retryAt}${copy.cooldownSuffix}`);
    setCardAccessibility(card, false);
  };

  const setThreadReset = (content, prefix, detail, date) => {
    const resetNode = content.querySelector(".cq-thread-reset");
    const prefixNode = content.querySelector(".cq-reset-prefix");
    const valueNode = content.querySelector(".cq-reset-value");
    const dateNode = content.querySelector(".cq-reset-date");
    const dateValueNode = content.querySelector(".cq-reset-date-value");
    if (prefixNode && prefixNode.textContent !== prefix) prefixNode.textContent = prefix;
    if (valueNode && valueNode.textContent !== detail) valueNode.textContent = detail;
    if (dateValueNode && dateValueNode.textContent !== date) dateValueNode.textContent = date;
    content.dataset.cqResetPrefix = prefix;
    if (resetNode) resetNode.setAttribute("aria-label", `${prefix} ${detail}`.trim());
    if (dateNode) dateNode.setAttribute("aria-label", `${date} ${copy.resetSuffix}`.trim());
  };

  const setWeeklySummary = (content, used, resetDate) => {
    const usedText = formatPercent(used);
    content.dataset.cqWeeklyUsed = usedText;
    const usedNode = content.querySelector(".cq-week-used");
    const dateNode = content.querySelector(".cq-week-reset-date");
    if (usedNode && usedNode.textContent !== `${usedText}%`) usedNode.textContent = `${usedText}%`;
    if (dateNode && dateNode.textContent !== resetDate) dateNode.textContent = resetDate;
    content.querySelector(".cq-week-summary")?.setAttribute(
      "aria-label",
      `${copy.weeklySummaryTitle} ${usedText}% ${copy.summaryUsed}. ${resetDate} ${copy.resetSuffix}`
    );
  };

  const createThreadContent = ({
    title,
    resetPrefix,
    resetDetail,
    resetDate,
    action = null,
    planLabel = "",
    variant = "a2-merge-v1",
    weeklySummary = null,
  }) => {
    const content = document.createElement("div");
    content.className = compactContentClass;
    content.dataset.cqLayout = "thread-v2";
    content.dataset.cqVariant = variant;
    content.innerHTML = `
      <div class="cq-thread-head">
        <span class="cq-title-wrap"><span class="cq-title"></span><span class="cq-plan"></span></span>
        <span class="cq-head-action"></span>
      </div>
      <div class="cq-thread-main">
        <div class="cq-number"><span class="cq-number-value">0</span><span class="cq-number-unit">%</span></div>
        <div class="cq-thread-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
        <div class="cq-thread-meta"><span class="cq-remaining-prefix"></span> <b class="cq-remaining-value">0%</b> <span class="cq-remaining-suffix"></span></div>
      </div>
      <div class="cq-thread-foot">
        <div class="cq-thread-reset">
          <svg class="cq-clock" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5l3 2"></path>
          </svg>
          <span class="cq-reset-prefix"></span><b class="cq-reset-value"></b>
        </div>
        <div class="cq-reset-date"><b class="cq-reset-date-value"></b> <span class="cq-reset-date-suffix"></span></div>
      </div>`;
    content.querySelector(".cq-title").textContent = title;
    content.querySelector(".cq-plan").textContent = planLabel;
    content.querySelector(".cq-remaining-prefix").textContent = copy.remainingPrefix;
    content.querySelector(".cq-remaining-suffix").textContent = copy.remainingSuffix;
    content.querySelector(".cq-reset-date-suffix").textContent = copy.resetSuffix;
    if (action instanceof Node) content.querySelector(".cq-head-action").append(action);
    setThreadReset(content, resetPrefix, resetDetail, resetDate);
    if (weeklySummary) {
      const summary = content.querySelector(".cq-reset-date");
      summary.classList.add("cq-week-summary");
      summary.innerHTML = `
        <span class="cq-week-title"></span>
        <b class="cq-week-used"></b>
        <span aria-hidden="true">·</span>
        <b class="cq-week-reset-date"></b>
        <span class="cq-week-reset-suffix"></span>`;
      summary.querySelector(".cq-week-title").textContent = copy.weeklySummaryTitle;
      summary.querySelector(".cq-week-reset-suffix").textContent = copy.resetSuffix;
      setWeeklySummary(content, weeklySummary.used, weeklySummary.resetDate);
    }
    return content;
  };

  const setThreadUsage = (content, value, usageAria = copy.weeklyUsedAria) => {
    const used = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(used)) return;
    const usedText = formatPercent(used);
    const remainingText = formatPercent(100 - used);
    content.dataset.cqUsed = usedText;
    content.dataset.cqUsageAria = usageAria;
    content.querySelector(".cq-number-value").textContent = usedText;
    content.querySelector(".cq-remaining-value").textContent = `${remainingText}%`;
    content.style.setProperty("--cq-used", `${used}%`);
    const progress = content.querySelector(".cq-thread-rule");
    progress.setAttribute("aria-valuenow", usedText);
    progress.setAttribute("aria-label", usageAria);
    progress.setAttribute("aria-valuetext", `${usageAria} ${usedText}%`);
  };

  const setOfficialCardAria = (card, content) => {
    const used = content.dataset.cqUsed;
    if (used === undefined) return;
    const remaining = formatPercent(100 - Number(used));
    const title = content.querySelector(".cq-title")?.textContent || copy.weeklyTitle;
    const planLabel = content.querySelector(".cq-plan")?.textContent || "";
    const usageAria = content.dataset.cqUsageAria || copy.weeklyUsedAria;
    const resetPrefix = content.dataset.cqResetPrefix || copy.resetCountdownPrefix;
    const resetDetail = content.querySelector(".cq-reset-value")?.textContent || copy.resetUnavailable;
    const parts = [copy.officialSourceAria];
    if (planLabel) parts.push(`${copy.plan} ${planLabel}`);
    parts.push(title, `${usageAria} ${used}%`, `${copy.remainingPrefix} ${remaining}%`, `${resetPrefix} ${resetDetail}`);
    if (content.dataset.cqVariant === "a2-plus-x-v1") {
      const weeklyUsed = content.dataset.cqWeeklyUsed;
      const weeklyDate = content.querySelector(".cq-week-reset-date")?.textContent || copy.resetUnavailable;
      parts.push(`${copy.weeklySummaryTitle} ${weeklyUsed}% ${copy.summaryUsed}`, `${weeklyDate} ${copy.resetSuffix}`);
    } else {
      const resetDate = content.querySelector(".cq-reset-date-value")?.textContent || copy.resetUnavailable;
      parts.push(`${resetDate} ${copy.resetSuffix}`);
    }
    card.setAttribute("aria-label", parts.join(". "));
  };

  const createFolioContent = ({title, kicker, note, detail, action = null}) => {
    const content = document.createElement("div");
    content.className = compactContentClass;
    content.dataset.cqLayout = "folio-v5";
    content.innerHTML = `
      <div class="cq-folio-head">
        <span class="cq-title"></span>
        <span class="cq-head-end"><span class="cq-kicker"></span><span class="cq-head-action"></span></span>
      </div>
      <div class="cq-folio-main">
        <div class="cq-number"><span class="cq-number-value">0</span><span class="cq-number-unit">%</span></div>
        <div class="cq-divider" aria-hidden="true"></div>
        <div class="cq-folio-note"><span></span><b></b></div>
      </div>
      <div class="cq-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>`;
    content.querySelector(".cq-title").textContent = title;
    content.querySelector(".cq-kicker").textContent = kicker;
    content.querySelector(".cq-folio-note span").textContent = note;
    content.querySelector(".cq-folio-note b").textContent = detail;
    if (action instanceof Node) content.querySelector(".cq-head-action").append(action);
    return content;
  };

  const setFolioRemaining = (content, value) => {
    const remaining = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(remaining)) return;
    const text = formatPercent(remaining);
    content.dataset.cqRemaining = text;
    content.querySelector(".cq-number-value").textContent = text;
    content.style.setProperty("--cq-remaining", `${remaining}%`);
    const progress = content.querySelector(".cq-rule");
    progress.setAttribute("aria-valuenow", text);
    progress.setAttribute("aria-valuetext", `${copy.apiRemainingAria} ${text}%`);
  };

  const renderOfficialThread = (card, progress, remaining, reset, planLabel = "") => {
    const used = 100 - remaining;
    const content = createThreadContent({
      title: copy.weeklyTitle,
      resetPrefix: copy.resetAtPrefix,
      resetDetail: resetTime(reset),
      resetDate: resetTime(reset),
      action: createRefreshButton("official"),
      planLabel,
    });
    setThreadUsage(content, used);
    progress.value = 100 - remaining;
    progress.dataset.cqWindowLabel = "Weekly";
    progress.classList.add("cq-source-progress");
    progress.hidden = true;
    progress.setAttribute("aria-label", `${copy.weeklyUsedAria} ${formatPercent(used)}%`);
    content.append(progress);
    card.classList.add(compactClass);
    const state = quotaState("official", globalThis.__codexQuotaOfficialPayload || null);
    setContentStatus(content, state.text);
    setCardAccessibility(card, state.busy);
    setOfficialCardAria(card, content);
    card.replaceChildren(content);
  };

  const renderOfficialPlus = (card, presentation, sourceProgresses = [], state = null) => {
    const {fiveHour, weekly, windows} = presentation;
    const content = createThreadContent({
      title: copy.fiveHourTitle,
      resetPrefix: copy.resetCountdownPrefix,
      resetDetail: formatResetCountdown(fiveHour.resetAt, true),
      resetDate: "",
      action: createRefreshButton("official"),
      planLabel: presentation.planLabel,
      variant: "a2-plus-x-v1",
      weeklySummary: {used: weekly.usedPercent, resetDate: formatResetDate(weekly.resetAt)},
    });
    setThreadUsage(content, fiveHour.usedPercent, copy.fiveHourUsedAria);
    sourceProgresses.forEach((progress, index) => {
      const window = windows[index];
      progress.value = window.usedPercent;
      progress.dataset.cqWindowLabel = window.label;
      progress.classList.add("cq-source-progress");
      progress.hidden = true;
      progress.setAttribute("aria-label", `${window.label} ${copy.used} ${formatPercent(window.usedPercent)}%`);
      content.append(progress);
    });
    card.classList.add(compactClass);
    const currentState = state || quotaState("official", globalThis.__codexQuotaOfficialPayload || null);
    setContentStatus(content, currentState.text);
    setCardAccessibility(card, currentState.busy);
    setOfficialCardAria(card, content);
    card.replaceChildren(content);
  };

  const applyOfficialSourceValues = (card, data) => {
    const presentation = officialPresentation(data);
    const content = card?.querySelector(`.${compactContentClass}[data-cq-layout="thread-v2"]`);
    if (!presentation || !content) return;
    if (presentation.kind === "plus-x" && content.dataset.cqVariant === "a2-plus-x-v1") {
      for (const window of [presentation.fiveHour, presentation.weekly]) {
        const progress = content.querySelector(`progress[data-cq-window-label="${window.label}"]`);
        if (progress && Number(progress.value) !== window.usedPercent) progress.value = window.usedPercent;
      }
      return;
    }
    if (presentation.kind === "weekly") {
      const progresses = [...content.querySelectorAll("progress.cq-source-progress")];
      const progress = content.querySelector("progress[data-cq-window-label='Weekly']") ||
        (progresses.length === 1 ? progresses[0] : null);
      if (progress && Number(progress.value) !== presentation.weekly.usedPercent) {
        progress.value = presentation.weekly.usedPercent;
      }
    }
  };

  const syncCompactProgress = (card) => {
    for (const window of card.querySelectorAll(".cq-window")) {
      const label = (window.querySelector(".cq-label")?.textContent || "").trim();
      const value = (window.querySelector(".cq-value")?.textContent || "").trim();
      const reset = (window.querySelector(".cq-reset-value")?.textContent || "").trim();
      if (label === "5h" && value === "—" && reset === "Unavailable" && !window.querySelector("progress")) {
        window.remove();
      }
    }
    const content = card.querySelector(`.${compactContentClass}[data-cq-layout="thread-v2"]`);
    if (content?.dataset.cqVariant === "a2-plus-x-v1") {
      const fiveHourProgress = content.querySelector("progress[data-cq-window-label='5h']");
      const weeklyProgress = content.querySelector("progress[data-cq-window-label='Weekly']");
      const fiveHourUsed = Number(fiveHourProgress?.value);
      const weeklyUsed = Number(weeklyProgress?.value);
      if (Number.isFinite(fiveHourUsed) && content.dataset.cqUsed !== formatPercent(fiveHourUsed)) {
        setThreadUsage(content, fiveHourUsed, copy.fiveHourUsedAria);
      }
      if (Number.isFinite(weeklyUsed) && content.dataset.cqWeeklyUsed !== formatPercent(weeklyUsed)) {
        const weeklyDate = content.querySelector(".cq-week-reset-date")?.textContent || copy.resetUnavailable;
        setWeeklySummary(content, weeklyUsed, weeklyDate);
      }
      setOfficialCardAria(card, content);
      return;
    }
    const progress = content?.querySelector("progress.cq-source-progress");
    if (!progress) return;
    const used = Number(progress.value);
    if (!Number.isFinite(used) || used < 0 || used > 100) return;
    if (content.dataset.cqUsed !== formatPercent(used)) setThreadUsage(content, used);
    progress.setAttribute("aria-label", `${copy.weeklyUsedAria} ${formatPercent(used)}%`);
    setOfficialCardAria(card, content);
  };

  const compactCard = (card) => {
    const existing = card.querySelector(`.${compactContentClass}`);
    const presentation = officialPresentation(globalThis.__codexQuotaOfficialPayload || null);
    const planLabel = presentation?.planLabel || "";
    if (presentation?.kind === "plus-x") {
      if (existing?.dataset.cqVariant === "a2-plus-x-v1") {
        syncCompactProgress(card);
        return;
      }
      let progresses = [...card.querySelectorAll("progress[max='100']")];
      if (existing) {
        progresses = presentation.windows.map((window) => {
          let progress = existing.querySelector(`progress[data-cq-window-label="${window.label}"]`);
          if (!progress && window.label === "Weekly" && existing.dataset.cqVariant === "a2-merge-v1") {
            progress = existing.querySelector("progress.cq-source-progress");
          }
          if (!progress) {
            progress = document.createElement("progress");
            progress.max = 100;
            progress.value = window.usedPercent;
          }
          return progress;
        });
      } else if (progresses.length !== 2) {
        return;
      }
      renderOfficialPlus(card, presentation, progresses);
      return;
    }
    if (existing?.dataset.cqLayout === "thread-v2-fallback") {
      if (presentation?.kind === "weekly") {
        const progress = document.createElement("progress");
        progress.max = 100;
        progress.value = presentation.weekly.usedPercent;
        renderOfficialThread(
          card,
          progress,
          100 - presentation.weekly.usedPercent,
          formatOfficialReset(presentation.weekly.resetAt),
          presentation.planLabel
        );
      }
      return;
    }
    if (existing?.dataset.cqLayout === "thread-v2") {
      const sourceProgresses = [...existing.querySelectorAll("progress.cq-source-progress")];
      const progress = presentation?.kind === "weekly"
        ? existing.querySelector("progress[data-cq-window-label='Weekly']") ||
          (sourceProgresses.length === 1 ? sourceProgresses[0] : null)
        : sourceProgresses.length === 1 ? sourceProgresses[0] : null;
      const used = Number(progress?.value);
      const staleThread = !existing.querySelector(".cq-refresh") ||
        existing.dataset.cqVariant !== "a2-merge-v1" ||
        !existing.querySelector(".cq-refresh-icon") ||
        !existing.querySelector(".cq-clock") ||
        existing.querySelector(".cq-title")?.textContent !== copy.weeklyTitle ||
        (existing.querySelector(".cq-plan")?.textContent || "") !== planLabel;
      if (progress && staleThread && Number.isFinite(used)) {
        const reset = (existing.querySelector(".cq-reset-value")?.textContent || "").trim() || "Unavailable";
        renderOfficialThread(card, progress, 100 - used, reset, planLabel);
        return;
      }
      syncCompactProgress(card);
      return;
    }
    if (existing) {
      const legacyProgresses = [...existing.querySelectorAll("progress[max='100']")];
      if (legacyProgresses.length !== 1) return;
      const legacyProgress = legacyProgresses[0];
      const used = Number(legacyProgress.value);
      if (!Number.isFinite(used) || used < 0 || used > 100) return;
      const reset = (
        existing.querySelector(".cq-reset-value")?.textContent ||
        existing.querySelector(".cq-folio-note b")?.textContent ||
        ""
      ).trim() || "Unavailable";
      renderOfficialThread(card, legacyProgress, 100 - used, reset, planLabel);
      return;
    }
    const progresses = [...card.querySelectorAll("progress[max='100']")];
    // Compact one real Weekly window, or the exact real Plus 5h + Weekly pair above.
    // Preserve every other multi-window shape without inventing a limit.
    if (progresses.length !== 1 || !resetElement(card)) return;
    const progress = progresses[0];
    const remainingElement = [...card.querySelectorAll("span")].find((element) =>
      element.classList.contains("font-medium") && /(\d+(?:\.\d+)?)\s*%/.test(element.textContent || ""));
    const remainingMatch = (remainingElement?.textContent || "").match(/(\d+(?:\.\d+)?)\s*%/);
    if (!remainingMatch) return;
    const remaining = Number(remainingMatch[1]);
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) return;
    const reset = resetValue(card);
    renderOfficialThread(card, progress, remaining, reset, planLabel);
  };

  const accountBar = () => {
    const footers = [...document.querySelectorAll("div.absolute.inset-x-0.bottom-0.z-20")]
      .filter((footer) => footer instanceof HTMLElement && footer.offsetParent !== null);
    if (footers.length !== 1) return null;
    const footer = footers[0];
    const rows = [...footer.children].filter((row) =>
      row instanceof HTMLElement && Boolean(row.querySelector("button[aria-haspopup='menu']")));
    return rows.length === 1 ? rows[0] : null;
  };

  const officialCard = () => {
    let host = document.getElementById(officialHostId);
    if (host) return host;
    const bar = accountBar();
    if (!bar) throw new Error("account footer not found");
    host = document.createElement("div");
    host.id = officialHostId;
    host.className = compactClass;
    host.setAttribute("role", "status");
    bar.parentElement?.insertBefore(host, bar);
    return host;
  };

  const removeOfficialCard = () => document.getElementById(officialHostId)?.remove();

  const apiCard = (source) => {
    if (source) {
      source.dataset.codexApiSource = "true";
      source.hidden = true;
    }
    let host = document.getElementById(apiHostId);
    if (host) return host;
    if (source) {
      host = source.cloneNode(false);
      delete host.dataset.codexApiSource;
      delete host.dataset.codexQuotaSidebarHidden;
      host.classList.remove(compactClass);
      host.classList.add(apiCardClass);
      host.removeAttribute("role");
      host.hidden = false;
      source.parentElement?.insertBefore(host, source);
    } else {
      const bar = accountBar();
      if (!bar) throw new Error("account footer not found");
      host = document.createElement("div");
      host.className = "flex w-full flex-col gap-3 rounded-2xl border border-token-border bg-token-main-surface-primary p-3 text-left text-token-foreground " + apiCardClass;
      bar.parentElement?.insertBefore(host, bar);
    }
    host.id = apiHostId;
    setCardAccessibility(host, false);
    return host;
  };

  const removeApiCard = () => {
    document.getElementById(apiHostId)?.remove();
    for (const source of document.querySelectorAll("[data-codex-api-source='true']")) {
      source.hidden = false;
      delete source.dataset.codexApiSource;
    }
  };

  const setOfficialCardSidebarVisibility = (card, visible) => {
    if (!visible) {
      card.dataset.codexQuotaSidebarHidden = "true";
      card.hidden = true;
      return false;
    }
    if (card.dataset.codexQuotaSidebarHidden === "true") {
      card.hidden = false;
      delete card.dataset.codexQuotaSidebarHidden;
    }
    return true;
  };

  const format = (value) => Number(value).toFixed(2);
  const formatOfficialReset = (value) => {
    const date = new Date(Number(value) * 1000);
    if (!Number.isFinite(date.getTime())) return copy.resetUnavailable;
    return new Intl.DateTimeFormat(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const formatResetDate = (value) => {
    const date = new Date(Number(value) * 1000);
    if (!Number.isFinite(date.getTime())) return copy.resetUnavailable;
    return new Intl.DateTimeFormat(navigator.language, {
      month: isChinese ? "long" : "short",
      day: "numeric",
    }).format(date);
  };

  const formatResetCountdown = (value, includeMinutes = false) => {
    const remainingMs = Math.max(0, Number(value) * 1000 - Date.now());
    if (!Number.isFinite(remainingMs)) return copy.resetUnavailable;
    if (includeMinutes) {
      const totalMinutes = Math.floor(remainingMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return isChinese ? `${hours}小时 ${minutes}分` : `${hours} h ${minutes} min`;
    }
    const days = Math.floor(remainingMs / 86400000);
    const hours = Math.floor((remainingMs % 86400000) / 3600000);
    return isChinese ? `${days}天 ${hours}小时` : `${days} d ${hours} h`;
  };

  const applyOfficialCountdown = (card, data) => {
    const presentation = officialPresentation(data);
    const content = card?.querySelector(`.${compactContentClass}[data-cq-layout="thread-v2"]`);
    if (!presentation || !content) return;
    if (presentation.kind === "plus-x" && content.dataset.cqVariant === "a2-plus-x-v1") {
      setThreadReset(
        content,
        copy.resetCountdownPrefix,
        formatResetCountdown(presentation.fiveHour.resetAt, true),
        ""
      );
      const weeklyUsed = Number(content.dataset.cqWeeklyUsed);
      setWeeklySummary(
        content,
        Number.isFinite(weeklyUsed) ? weeklyUsed : presentation.weekly.usedPercent,
        formatResetDate(presentation.weekly.resetAt)
      );
      setOfficialCardAria(card, content);
      return;
    }
    if (presentation.kind === "weekly") {
      setThreadReset(
        content,
        copy.resetCountdownPrefix,
        formatResetCountdown(presentation.weekly.resetAt),
        formatResetDate(presentation.weekly.resetAt)
      );
      setOfficialCardAria(card, content);
    }
  };

  const addFallbackRow = (content, label, value, small = false) => {
    const row = document.createElement("div");
    row.className = "cq-window";
    const left = document.createElement("span");
    left.className = small ? "cq-reset" : "cq-label";
    left.textContent = label;
    const right = document.createElement("span");
    right.className = small ? "cq-reset-value" : "cq-value";
    right.textContent = value;
    row.append(left, right);
    content.append(row);
    return row;
  };

  const renderOfficial = (card, data, errorCode = null) => {
    const state = quotaState("official", data, errorCode);
    const presentation = officialPresentation(data);
    const windows = presentation?.windows || [];
    if (presentation?.kind === "plus-x") {
      renderOfficialPlus(card, presentation, [], state);
      return;
    }
    if (presentation?.kind === "weekly") {
      const {weekly, planLabel} = presentation;
      const countdown = formatResetCountdown(weekly.resetAt);
      const resetDate = formatResetDate(weekly.resetAt);
      const content = createThreadContent({
        title: copy.weeklyTitle,
        resetPrefix: copy.resetCountdownPrefix,
        resetDetail: countdown,
        resetDate,
        action: createRefreshButton("official"),
        planLabel,
      });
      setThreadUsage(content, weekly.usedPercent);
      setContentStatus(content, state.text);
      setCardAccessibility(card, state.busy);
      setOfficialCardAria(card, content);
      card.replaceChildren(content);
      return;
    }

    const content = document.createElement("div");
    content.className = `${compactContentClass} cq-compact-fallback`;
    content.dataset.cqLayout = "thread-v2-fallback";
    addHeading(content, copy.weeklyTitle, createRefreshButton("official"));
    if (!presentation) {
      addFallbackRow(content, copy.status, data ? copy.officialUnavailable : state.text, true);
    } else {
      for (const window of windows) {
        const row = addFallbackRow(content, window.label, `${formatPercent(window.usedPercent)}%`);
        const progress = document.createElement("progress");
        progress.max = 100;
        progress.value = window.usedPercent;
        progress.setAttribute("aria-label", `${window.label} ${copy.used} ${formatPercent(window.usedPercent)}%`);
        progress.setAttribute("aria-valuetext", `${window.label} ${copy.used} ${formatPercent(window.usedPercent)}%`);
        row.append(progress);
        addFallbackRow(content, copy.resetSuffix, formatOfficialReset(window.resetAt), true);
      }
      if (state.text) addFallbackRow(content, copy.status, state.text, true);
    }
    setCardAccessibility(card, state.busy);
    card.setAttribute("aria-label", `${copy.officialSourceAria}. ${copy.weeklyTitle}`);
    card.replaceChildren(content);
  };

  const renderApi = (card, data, errorCode = null) => {
    const state = quotaState("api", data, errorCode);
    const refresh = createRefreshButton("api");
    setCardAccessibility(card, state.busy);

    const valid = data &&
      [data.used, data.remaining].every((value) => Number.isFinite(value)) &&
      typeof data.unit === "string";
    const hasTotal = valid && Number.isFinite(data.total) && data.total > 0;
    if (hasTotal) {
      const usedPercent = Math.max(0, Math.min(100, (data.used / data.total) * 100));
      const remainingPercent = 100 - usedPercent;
      const remainingAmount = `${format(data.remaining)} ${data.unit}`;
      const content = createFolioContent({
        title: copy.apiTitle,
        kicker: copy.dailyKicker,
        note: state.text || `${copy.remainingAvailable} ${remainingAmount}`,
        detail: state.text ? `${copy.remainingAvailable} ${remainingAmount}` : `${copy.used} ${format(data.used)} / ${format(data.total)} ${data.unit}`,
        action: refresh,
      });
      setFolioRemaining(content, remainingPercent);
      content.querySelector(".cq-rule").setAttribute("aria-label", copy.apiRemainingAria);
      card.setAttribute(
        "aria-label",
        `${copy.apiTitle}. ${copy.remainingAvailable} ${formatPercent(remainingPercent)}%. ${remainingAmount}.${state.text ? ` ${state.text}.` : ""}`,
      );
      card.replaceChildren(content);
      return;
    }

    const content = document.createElement("div");
    content.className = `${compactContentClass} cq-compact-fallback`;
    addHeading(content, copy.apiTitle, refresh);
    if (!data) {
      addFallbackRow(content, copy.status, state.text, true);
    } else if (!valid) {
      addFallbackRow(content, copy.status, copy.invalid, true);
    } else {
      if (typeof data.planName === "string" && data.planName) addFallbackRow(content, copy.plan, data.planName, true);
      addFallbackRow(content, copy.daily, `${format(data.used)} ${data.unit}`);
      addFallbackRow(content, copy.remainingAvailable, `${format(data.remaining)} ${data.unit}`);
      addFallbackRow(content, copy.status, copy.noLimit, true);
      if (state.text) addFallbackRow(content, copy.status, state.text, true);
    }
    card.setAttribute("aria-label", copy.apiTitle);
    card.replaceChildren(content);
  };

  const requestApiData = (manual = false) => {
    if (globalThis.__codexQuotaApiNeedsData === true) return;
    const now = Date.now();
    const cooldownUntil = Number(globalThis.__codexQuotaApiCooldownUntil || 0);
    if (now < cooldownUntil) {
      showCooldown("api", cooldownUntil);
      return;
    }
    if (!manual && now < Number(globalThis.__codexQuotaApiNextAutoAttemptAt || 0)) return;
    globalThis.__codexQuotaApiNeedsData = true;
    const card = document.getElementById(apiHostId);
    if (card) renderApi(card, globalThis.__codexQuotaApiPayload || null, quotaErrorCode("api"));
    console.info("__codexQuotaApiRequest__");
  };

  const requestOfficialData = (manual = false) => {
    if (globalThis.__codexQuotaOfficialNeedsData === true) return;
    const now = Date.now();
    const cooldownUntil = Number(globalThis.__codexQuotaOfficialCooldownUntil || 0);
    if (now < cooldownUntil) {
      showCooldown("official", cooldownUntil);
      return;
    }
    if (!manual && now < Number(globalThis.__codexQuotaOfficialNextAutoAttemptAt || 0)) return;
    globalThis.__codexQuotaOfficialNeedsData = true;
    const nativeCard = nativeQuotaCard();
    if (nativeCard) {
      compactCard(nativeCard);
      const content = nativeCard.querySelector(`.${compactContentClass}`);
      const state = quotaState("official", globalThis.__codexQuotaOfficialPayload || null);
      if (content) setContentStatus(content, state.text);
      setCardAccessibility(nativeCard, state.busy);
      const refresh = content?.querySelector(".cq-refresh");
      if (refresh) setRefreshButtonState(refresh, state.busy);
    } else {
      const card = document.getElementById(officialHostId);
      if (card) renderOfficial(card, globalThis.__codexQuotaOfficialPayload || null, quotaErrorCode("official"));
    }
    console.info("__codexQuotaOfficialRequest__");
  };

  const refreshStaleData = () => {
    const isApi = apiMode();
    const {nextAttemptAt, cooldownUntil} = quotaTiming(isApi);
    const nextAt = Math.max(nextAttemptAt, cooldownUntil);
    if (nextAt > 0 && Date.now() >= nextAt) {
      if (isApi) requestApiData(false);
      else requestOfficialData();
      return;
    }
    scheduleAutoRefresh();
  };

  const scheduleAutoRefresh = () => {
    clearTimeout(globalThis.__codexQuotaAutoRefreshTimer);
    globalThis.__codexQuotaAutoRefreshTimer = null;
    if (document.visibilityState !== "visible") return;
    const isApi = apiMode();
    const loaded = isApi
      ? globalThis.__codexQuotaApiLoaded === true
      : globalThis.__codexQuotaOfficialLoaded === true;
    if (!loaded) return;
    const {lastSuccessAt, nextAttemptAt, cooldownUntil} = quotaTiming(isApi);
    const fallbackNextAt = lastSuccessAt ? lastSuccessAt + adaptiveRefreshDelayMs() : 0;
    const networkNextAt = Math.max(nextAttemptAt || fallbackNextAt, cooldownUntil);
    const now = Date.now();
    const plusX = !isApi
      ? document.querySelector(`.${compactContentClass}[data-cq-variant="a2-plus-x-v1"]`)
      : null;
    const countdownNextAt = plusX ? now + (60000 - (now % 60000)) : Infinity;
    const nextAt = Math.min(networkNextAt || Infinity, countdownNextAt);
    if (!Number.isFinite(nextAt)) return;
    globalThis.__codexQuotaAutoRefreshTimer = setTimeout(() => {
      globalThis.__codexQuotaAutoRefreshTimer = null;
      if (document.visibilityState !== "visible") return;
      if (!apiMode()) {
        const card = nativeQuotaCard() || document.getElementById(officialHostId);
        if (card) applyOfficialCountdown(card, globalThis.__codexQuotaOfficialPayload || null);
      }
      refreshStaleData();
    }, Math.max(1000, nextAt - Date.now()));
  };

  const installAutoRefresh = () => {
    const previous = globalThis.__codexQuotaAutoRefreshHandler;
    if (typeof previous === "function") {
      window.removeEventListener("focus", previous);
      document.removeEventListener("visibilitychange", previous);
    }
    const handler = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(globalThis.__codexQuotaAutoRefreshTimer);
        globalThis.__codexQuotaAutoRefreshTimer = null;
        return;
      }
      recordQuotaInteraction(apiMode() ? "api" : "official");
      refreshStaleData();
    };
    globalThis.__codexQuotaAutoRefreshHandler = handler;
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", handler);
    if (document.visibilityState === "visible") recordQuotaInteraction(apiMode() ? "api" : "official");
    scheduleAutoRefresh();
  };

  const nativeQuotaCard = () => {
    const cards = [...document.querySelectorAll(`[role='status'], .${compactClass}[role='region']`)].filter((card) =>
      card instanceof HTMLElement && card.classList.contains("rounded-2xl") &&
      Boolean(card.querySelector("progress[max='100']")) &&
      ((card.classList.contains("border") && card.classList.contains("bg-token-main-surface-primary")) ||
       (card.classList.contains("ring-border") && card.classList.contains("bg-surface/80"))));
    return cards.length === 1 ? cards[0] : null;
  };

  globalThis.__codexQuotaUpdateOfficial = (data) => {
    globalThis.__codexQuotaOfficialNeedsData = false;
    globalThis.__codexQuotaOfficialLoaded = true;
    const now = Date.now();
    if (data && !data.errorCode && !data.error && Array.isArray(data.windows)) {
      const fingerprint = quotaUsageFingerprint(data);
      const previousFingerprint = globalThis.__codexQuotaOfficialUsageFingerprint;
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        globalThis.__codexQuotaLastUsageActivityAt = now;
      }
      globalThis.__codexQuotaOfficialUsageFingerprint = fingerprint;
      globalThis.__codexQuotaOfficialPayload = data;
      globalThis.__codexQuotaOfficialErrorCode = null;
      globalThis.__codexQuotaOfficialError = null;
      globalThis.__codexQuotaOfficialLastSuccessAt = now;
      globalThis.__codexQuotaOfficialNextAutoAttemptAt = now + adaptiveRefreshDelayMs(now);
      globalThis.__codexQuotaOfficialCooldownUntil = 0;
    } else {
      globalThis.__codexQuotaOfficialErrorCode = data?.errorCode || "UNAVAILABLE";
      globalThis.__codexQuotaOfficialError = null;
      const retrySeconds = Number(data?.retryAfterSeconds);
      const retryMs = Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.max(failureRetryMs, retrySeconds * 1000)
        : failureRetryMs;
      globalThis.__codexQuotaOfficialNextAutoAttemptAt = now + retryMs;
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
        globalThis.__codexQuotaOfficialCooldownUntil = now + retryMs;
      }
    }
    const nativeCard = nativeQuotaCard();
    if (!apiMode() && nativeCard) {
      const presentation = officialPresentation(data);
      if (presentation?.kind === "fallback") {
        renderOfficial(nativeCard, data, quotaErrorCode("official"));
      } else {
        applyOfficialSourceValues(nativeCard, data);
        compactCard(nativeCard);
        applyOfficialCountdown(nativeCard, globalThis.__codexQuotaOfficialPayload || null);
      }
      const content = nativeCard.querySelector(`.${compactContentClass}`);
      const state = quotaState("official", globalThis.__codexQuotaOfficialPayload || null);
      if (content) setContentStatus(content, state.text);
      setCardAccessibility(nativeCard, state.busy);
      const refresh = content?.querySelector(".cq-refresh");
      if (refresh) setRefreshButtonState(refresh, state.busy);
    } else {
      const card = document.getElementById(officialHostId);
      if (!apiMode() && card) renderOfficial(
        card,
        globalThis.__codexQuotaOfficialPayload || null,
        quotaErrorCode("official")
      );
    }
    if (!apiMode()) scheduleAutoRefresh();
  };

  globalThis.__codexQuotaUpdateApi = (data) => {
    globalThis.__codexQuotaApiNeedsData = false;
    globalThis.__codexQuotaApiLoaded = true;
    const now = Date.now();
    if (data && !data.errorCode && !data.error) {
      const fingerprint = quotaUsageFingerprint(data);
      const previousFingerprint = globalThis.__codexQuotaApiUsageFingerprint;
      if (previousFingerprint && previousFingerprint !== fingerprint) {
        globalThis.__codexQuotaLastUsageActivityAt = now;
      }
      globalThis.__codexQuotaApiUsageFingerprint = fingerprint;
      globalThis.__codexQuotaApiPayload = data;
      globalThis.__codexQuotaApiErrorCode = null;
      globalThis.__codexQuotaApiError = null;
      globalThis.__codexQuotaApiLastSuccessAt = now;
      globalThis.__codexQuotaApiNextAutoAttemptAt = now + adaptiveRefreshDelayMs(now);
      globalThis.__codexQuotaApiCooldownUntil = 0;
    } else {
      globalThis.__codexQuotaApiErrorCode = data?.errorCode || "UNAVAILABLE";
      globalThis.__codexQuotaApiError = null;
      const retrySeconds = Number(data?.retryAfterSeconds);
      const retryMs = Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.max(failureRetryMs, retrySeconds * 1000)
        : failureRetryMs;
      globalThis.__codexQuotaApiNextAutoAttemptAt = now + retryMs;
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
        globalThis.__codexQuotaApiCooldownUntil = now + retryMs;
      }
    }
    if (apiMode()) {
      const card = document.getElementById(apiHostId) || (accountBar() ? apiCard(nativeQuotaCard()) : null);
      if (card) renderApi(card, globalThis.__codexQuotaApiPayload || null, quotaErrorCode("api"));
    }
    if (apiMode()) scheduleAutoRefresh();
  };

  const renderLayout = () => {
    ensureStyle();
    const bar = accountBar();
    if (apiMode()) {
      removeOfficialCard();
      if (!bar) {
        const source = nativeQuotaCard();
        const host = source ? apiCard(source) : document.getElementById(apiHostId);
        if (host) host.hidden = true;
        return;
      }
      const host = apiCard(nativeQuotaCard());
      host.hidden = false;
      if (host.nextElementSibling !== bar) bar.parentElement.insertBefore(host, bar);
      renderApi(
        host,
        globalThis.__codexQuotaApiPayload || null,
        quotaErrorCode("api")
      );
      if (!globalThis.__codexQuotaApiLoaded) requestApiData();
      return;
    }
    removeApiCard();
    const card = nativeQuotaCard();
    if (card) {
      removeOfficialCard();
      if (setOfficialCardSidebarVisibility(card, Boolean(bar))) {
        compactCard(card);
        applyOfficialCountdown(card, globalThis.__codexQuotaOfficialPayload || null);
      }
      if (!globalThis.__codexQuotaOfficialLoaded) requestOfficialData();
      return;
    }
    if (!bar) {
      const host = document.getElementById(officialHostId);
      if (host) host.hidden = true;
      return;
    }
    const host = officialCard();
    host.hidden = false;
    const currentLayout = host.firstElementChild?.dataset.cqLayout;
    const presentation = officialPresentation(globalThis.__codexQuotaOfficialPayload || null);
    const expectedVariant = presentation?.kind === "plus-x" ? "a2-plus-x-v1" : "a2-merge-v1";
    const expectedTitle = presentation?.kind === "plus-x" ? copy.fiveHourTitle : copy.weeklyTitle;
    const expectedPlan = presentation?.planLabel || "";
    const staleThread = currentLayout === "thread-v2" &&
      (!host.querySelector(".cq-refresh") ||
       host.firstElementChild?.dataset.cqVariant !== expectedVariant ||
       !host.querySelector(".cq-refresh-icon") ||
       !host.querySelector(".cq-clock") ||
       host.querySelector(".cq-title")?.textContent !== expectedTitle ||
       (host.querySelector(".cq-plan")?.textContent || "") !== expectedPlan);
    const staleFallback = currentLayout === "thread-v2-fallback" &&
      (!host.querySelector(".cq-refresh") || host.getAttribute("role") !== "region");
    if ((currentLayout !== "thread-v2" && currentLayout !== "thread-v2-fallback") ||
        staleThread || staleFallback) {
      renderOfficial(
        host,
        globalThis.__codexQuotaOfficialPayload || null,
        quotaErrorCode("official")
      );
    } else if (currentLayout === "thread-v2") {
      applyOfficialCountdown(host, globalThis.__codexQuotaOfficialPayload || null);
    }
    if (!globalThis.__codexQuotaOfficialLoaded) requestOfficialData();
  };

  const installLayout = () => {
    renderLayout();
    document.querySelectorAll(`.${compactClass}, .${apiCardClass}`).forEach(updatePalette);
  };

  const observeOfficialCards = () => {
    globalThis.__codexQuotaOfficialCardObserver?.disconnect();
    globalThis.__codexQuotaOfficialCardObserver = null;
    const root = document.documentElement;
    if (!root) return;
    const footerSelector = "div.absolute.inset-x-0.bottom-0.z-20";
    const cardSelector = `[role='status'].rounded-2xl, .${compactClass}[role='region']`;
    const contentSelector = `#${apiHostId}, #${officialHostId}, .${compactContentClass}`;
    let footer = document.querySelector(footerSelector);
    let scheduled = false;
    const observer = new MutationObserver((records) => {
      if (scheduled || !records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!(target instanceof Element)) return false;
        if (target.id === styleId) return false;
        if (target.closest("head") && (target.matches("style, link") ||
            [...record.addedNodes, ...record.removedNodes].some((node) =>
              node instanceof Element && node.matches("style, link")))) return true;
        if (record.type === "attributes") {
          if (record.attributeName === "value") {
            return target.matches("progress[max='100']") && Boolean(target.closest(cardSelector));
          }
          return target.matches(footerSelector) || Boolean(footer && target.contains(footer));
        }
        // Ignore our own rendering and unrelated conversation updates.
        if (target.closest(contentSelector)) return false;
        if (target.closest(footerSelector) || target.closest(cardSelector)) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) =>
          node instanceof Element && (node.matches(`${footerSelector}, ${cardSelector}`) ||
            node.querySelector(`${footerSelector}, ${cardSelector}`)));
      })) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (globalThis.__codexQuotaOfficialCardObserver !== observer) return;
        footer = document.querySelector(footerSelector);
        installLayout();
      });
    });
    observer.observe(root, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["value", "class", "style", "hidden", "data-theme", "data-color-theme"],
    });
    observer.observe(document.head, {childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["href", "media", "rel", "disabled"]});
    globalThis.__codexQuotaThemeCleanup?.();
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = () => installLayout();
    const onStylesheetLoad = (event) => {
      if (event.target instanceof HTMLLinkElement && event.target.relList.contains("stylesheet")) installLayout();
    };
    media.addEventListener("change", onThemeChange);
    document.addEventListener("load", onStylesheetLoad, true);
    globalThis.__codexQuotaThemeCleanup = () => {
      media.removeEventListener("change", onThemeChange);
      document.removeEventListener("load", onStylesheetLoad, true);
    };
    globalThis.__codexQuotaOfficialCardObserver = observer;
  };

  const install = () => {
    try {
      if (apiMode()) {
        observeOfficialCards();
        installLayout();
        installAutoRefresh();
        return true;
      }
      const client = globalThis.__STATSIG__?.instance?.();
      if (client && typeof client.getLayer === "function" && !client.__codexNativeQuotaPatched) {
        const layerKeys = new Set(["3605558075", "1385051397", "2673725514"]);
        const original = client.getLayer.bind(client);
        client.getLayer = function(name, options) {
          const layer = original(name, options);
          if (!layerKeys.has(String(name)) || !layer || typeof layer.get !== "function") return layer;
          const get = layer.get.bind(layer);
          return Object.assign({}, layer, { get(parameter, fallback) {
            if (parameter === "enabled") return true;
            if (parameter === "remaining_threshold_percent") return 100;
            return get(parameter, fallback);
          }});
        };
        client.__codexNativeQuotaPatched = true;
      }
      observeOfficialCards();
      installLayout();
      installAutoRefresh();
      return true;
    } catch (_) { return false; }
  };
  if (install()) return true;
  let attempts = 0;
  const timer = setInterval(() => {
    if (install() || ++attempts >= 120) clearInterval(timer);
  }, 250);
  return false;
})()
