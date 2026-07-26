(() => {
  const compactClass = "codex-native-compact-usage";
  const compactContentClass = "codex-native-compact-usage-content";
  const apiCardClass = "codex-api-compact-usage";
  const apiHostId = "codex-api-usage-host";
  const styleId = "codex-native-compact-usage-style";
  const staleAfterMs = 5 * 60 * 1000;
  const failureRetryMs = 60 * 1000;
  const isChinese = /^zh\b/i.test(navigator.language || "");
  const copy = isChinese
    ? {
        weeklyTitle: "周用量",
        weeklyKicker: "每周",
        remainingAvailable: "剩余可用",
        used: "已用",
        weeklyRemainingAria: "每周剩余",
        weeklyUsedAria: "每周已用",
        resetUnavailable: "重置时间不可用",
        apiTitle: "API 用量",
        dailyKicker: "每日",
        apiRemainingAria: "API 每日剩余",
        plan: "套餐",
        daily: "今日",
        status: "状态",
        unavailable: "API 用量不可用",
        invalid: "API 用量响应无效",
        noLimit: "未设置每日限额",
        stale: "更新失败，显示上次数据",
        refresh: "刷新",
        refreshing: "刷新中…",
      }
    : {
        weeklyTitle: "Weekly usage",
        weeklyKicker: "WEEKLY",
        remainingAvailable: "Remaining",
        used: "Used",
        weeklyRemainingAria: "Weekly remaining",
        weeklyUsedAria: "Weekly used",
        resetUnavailable: "Reset unavailable",
        apiTitle: "API usage",
        dailyKicker: "DAILY",
        apiRemainingAria: "API daily remaining",
        plan: "Plan",
        daily: "Daily",
        status: "Status",
        unavailable: "API usage unavailable",
        invalid: "Invalid API usage response",
        noLimit: "No daily limit",
        stale: "Update failed; showing last result",
        refresh: "Refresh",
        refreshing: "Refreshing…",
      };

  const apiMode = () => globalThis.__codexQuotaMode === "api";

  const ensureStyle = () => {
    const style = document.getElementById(styleId) || document.createElement("style");
    const css = `
      .${compactClass}, .${apiCardClass} {
        --cq-paper-top: #FCFAF4;
        --cq-paper-bottom: #F8F3EA;
        --cq-border: #E3DACA;
        --cq-track: #EAE2D0;
        --cq-ink: #1C1917;
        --cq-muted: #74695C;
        --cq-weak: #756A59;
        --cq-muted-strong: #6B6152;
        --cq-accent: #B4552D;
        --cq-accent-start: #C96A3B;
        --cq-serif: "Noto Serif SC", "Songti SC", Georgia, serif;
        --cq-sans: "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
        box-sizing: border-box !important;
        min-height: 0 !important;
        padding: 8px 12px !important;
        overflow: hidden;
        border-color: var(--cq-border) !important;
        border-radius: 12px !important;
        background: linear-gradient(180deg, var(--cq-paper-top) 0%, var(--cq-paper-bottom) 100%) !important;
        box-shadow: none !important;
        color: var(--cq-ink) !important;
        font-family: var(--cq-sans) !important;
      }
      html.electron-dark .${compactClass}, html.electron-dark .${apiCardClass},
      html.dark .${compactClass}, html.dark .${apiCardClass} {
        --cq-paper-top: #211E1A;
        --cq-paper-bottom: #1C1916;
        --cq-border: #4A4034;
        --cq-track: #40372E;
        --cq-ink: #F4EEE3;
        --cq-muted: #B8AA96;
        --cq-weak: #A99B87;
        --cq-muted-strong: #D0C4B1;
        --cq-accent: #D9784C;
        --cq-accent-start: #E08A61;
      }
      .${compactContentClass} { display: grid; min-width: 0; }
      .${compactContentClass} .cq-folio-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .${compactContentClass} .cq-head-end { display: flex; align-items: baseline; gap: 8px; }
      .${compactContentClass} .cq-title { font-family: var(--cq-serif); font-size: 13px; font-weight: 600; line-height: 16px; letter-spacing: .04em; }
      .${compactContentClass} .cq-kicker { flex: none; color: var(--cq-weak); font-size: 9px; font-weight: 500; line-height: 12px; letter-spacing: .16em; }
      .${compactContentClass} .cq-folio-main { display: flex; align-items: stretch; justify-content: flex-start; gap: 10px; min-width: 0; margin: 4px 0; }
      .${compactContentClass} .cq-number { display: flex; flex: none; align-self: center; align-items: baseline; font-family: var(--cq-serif); font-variant-numeric: tabular-nums; line-height: 1; }
      .${compactContentClass} .cq-number-value { font-size: 32px; font-weight: 600; letter-spacing: -.02em; }
      .${compactContentClass} .cq-number-unit { margin-left: 1px; color: var(--cq-accent); font-size: 14px; font-weight: 600; }
      .${compactContentClass} .cq-divider { flex: none; width: 1px; margin: 2px 0; background: var(--cq-border); }
      .${compactContentClass} .cq-folio-note { position: relative; min-width: 0; align-self: center; padding-left: 10px; color: var(--cq-muted); font-size: 10px; line-height: 14px; text-align: left; text-wrap: pretty; }
      .${compactContentClass} .cq-folio-note::before { position: absolute; top: 5px; left: 0; width: 4px; height: 4px; background: var(--cq-accent); content: ""; opacity: .75; transform: rotate(45deg); }
      .${compactContentClass} .cq-folio-note b { display: block; overflow-wrap: anywhere; color: var(--cq-muted-strong); font-weight: 500; }
      .${compactContentClass} .cq-rule { position: relative; height: 2px; border-radius: 2px; background: var(--cq-track); }
      .${compactContentClass} .cq-rule::before { position: absolute; inset: 0 auto 0 0; width: var(--cq-remaining, 0%); border-radius: 2px; background: linear-gradient(90deg, var(--cq-accent-start), var(--cq-accent)); content: ""; transition: width .6s cubic-bezier(.22,.9,.3,1); }
      .${compactContentClass} .cq-rule-marker { position: absolute; top: 50%; left: calc(var(--cq-remaining, 0%) - 2.5px); width: 5px; height: 5px; background: var(--cq-accent); transform: translateY(-50%) rotate(45deg); transition: left .6s cubic-bezier(.22,.9,.3,1); }
      .${compactContentClass} .cq-status { margin-top: 8px; color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      .${compactContentClass} .cq-source-progress { display: none !important; }
      .${compactContentClass}.cq-compact-fallback { gap: 8px; }
      .${compactContentClass} .cq-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .${compactContentClass} .cq-window { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; min-width: 0; }
      .${compactContentClass} .cq-label, .${compactContentClass} .cq-value { font-size: 11px; line-height: 16px; }
      .${compactContentClass} .cq-value { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .${compactContentClass} .cq-reset, .${compactContentClass} .cq-reset-value { color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      .${compactContentClass} .cq-reset-value { text-align: right; overflow-wrap: anywhere; }
      .${compactContentClass} .cq-window > progress { grid-column: 1 / -1; height: 4px !important; margin: 0; }
      .${compactContentClass} .cq-refresh { position: relative; margin: 0; padding: 0; border: 0; background: transparent; color: var(--cq-muted); cursor: pointer; font: inherit; font-size: 10px; line-height: 14px; }
      .${compactContentClass} .cq-refresh::before { position: absolute; inset: -12px; content: ""; }
      .${compactContentClass} .cq-refresh:hover { color: var(--cq-ink); }
      .${compactContentClass} .cq-refresh:focus-visible { border-radius: 4px; outline: 2px solid var(--cq-accent); outline-offset: 1px; }
      .${compactContentClass} .cq-refresh:disabled { cursor: wait; opacity: .65; }
      @media (prefers-reduced-motion: reduce) {
        .${compactContentClass} .cq-rule::before, .${compactContentClass} .cq-rule-marker { transition: none !important; }
      }
    `;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) {
      style.id = styleId;
      document.head.append(style);
    }
  };

  const resetElement = (card) => [...card.querySelectorAll("div")].find((element) =>
    element.classList.contains("text-sm") && element.classList.contains("text-token-text-secondary"));

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

  const createFolioContent = ({title, kicker, note, detail, action = null}) => {
    const content = document.createElement("div");
    content.className = compactContentClass;
    content.dataset.cqLayout = "folio-v4";
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
      <div class="cq-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="cq-rule-marker" aria-hidden="true"></span></div>`;
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
    content.querySelector(".cq-rule").setAttribute("aria-valuenow", text);
  };

  const resetText = (value) => {
    if (value === "Unavailable") return copy.resetUnavailable;
    if (!isChinese) return value;
    const time = value.replace(/^下次重置时间为\s*/, "").replace(/\s*重置$/, "");
    return `${time} 重置`;
  };

  const renderOfficialFolio = (card, progress, remaining, reset) => {
    const used = 100 - remaining;
    const content = createFolioContent({
      title: copy.weeklyTitle,
      kicker: copy.weeklyKicker,
      note: copy.remainingAvailable,
      detail: resetText(reset),
    });
    setFolioRemaining(content, remaining);
    content.querySelector(".cq-rule").setAttribute("aria-label", copy.weeklyRemainingAria);
    progress.value = 100 - remaining;
    progress.classList.add("cq-source-progress");
    progress.hidden = true;
    progress.setAttribute("aria-label", `${copy.weeklyUsedAria} ${formatPercent(used)}%`);
    content.append(progress);
    card.classList.add(compactClass);
    card.setAttribute("aria-label", `${copy.weeklyTitle}. ${copy.remainingAvailable} ${formatPercent(remaining)}%. ${resetText(reset)}`);
    card.replaceChildren(content);
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
    const content = card.querySelector(`.${compactContentClass}[data-cq-layout="folio-v4"]`);
    const progress = content?.querySelector("progress.cq-source-progress");
    if (!progress) return;
    const used = Number(progress.value);
    if (!Number.isFinite(used) || used < 0 || used > 100) return;
    const remaining = 100 - used;
    if (content.dataset.cqRemaining !== formatPercent(remaining)) setFolioRemaining(content, remaining);
    progress.setAttribute("aria-label", `${copy.weeklyUsedAria} ${formatPercent(used)}%`);
    const reset = (content.querySelector(".cq-folio-note b")?.textContent || "").trim();
    card.setAttribute("aria-label", `${copy.weeklyTitle}. ${copy.remainingAvailable} ${formatPercent(remaining)}%. ${reset}`);
  };

  const compactCard = (card) => {
    const existing = card.querySelector(`.${compactContentClass}`);
    if (existing?.dataset.cqLayout === "folio-v4") {
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
      renderOfficialFolio(card, legacyProgress, 100 - used, reset);
      return;
    }
    const progresses = [...card.querySelectorAll("progress[max='100']")];
    // One native window is the current Weekly-only contract. If the official
    // component restores more windows, preserve its complete native UI.
    if (progresses.length !== 1 || !resetElement(card)) return;
    const progress = progresses[0];
    const remainingElement = [...card.querySelectorAll("span")].find((element) =>
      element.classList.contains("text-base") && element.classList.contains("font-medium"));
    const remainingMatch = (remainingElement?.textContent || "").match(/(\d+(?:\.\d+)?)\s*%/);
    if (!remainingMatch) return;
    const remaining = Number(remainingMatch[1]);
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) return;
    const reset = resetValue(card);
    renderOfficialFolio(card, progress, remaining, reset);
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

  const apiCard = (source) => {
    let host = document.getElementById(apiHostId);
    if (host) return host;
    if (source) {
      source.dataset.codexApiSource = "true";
      source.hidden = true;
      host = source.cloneNode(false);
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
  const renderApi = (card, data, error = null) => {
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "cq-refresh";
    refresh.disabled = globalThis.__codexQuotaApiNeedsData === true;
    refresh.textContent = refresh.disabled ? copy.refreshing : copy.refresh;
    refresh.addEventListener("click", () => requestApiData(true));

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
        note: error ? copy.stale : `${copy.remainingAvailable} ${remainingAmount}`,
        detail: error ? `${copy.remainingAvailable} ${remainingAmount}` : `${copy.used} ${format(data.used)} / ${format(data.total)} ${data.unit}`,
        action: refresh,
      });
      setFolioRemaining(content, remainingPercent);
      content.querySelector(".cq-rule").setAttribute("aria-label", copy.apiRemainingAria);
      card.setAttribute(
        "aria-label",
        `${copy.apiTitle}. ${copy.remainingAvailable} ${formatPercent(remainingPercent)}%. ${remainingAmount}.`,
      );
      card.replaceChildren(content);
      return;
    }

    const content = document.createElement("div");
    content.className = `${compactContentClass} cq-compact-fallback`;
    addHeading(content, copy.apiTitle, refresh);
    const addRow = (label, value, small = false) => {
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
    if (!data) {
      addRow(copy.status, error || copy.unavailable, true);
    } else if (!valid) {
      addRow(copy.status, copy.invalid, true);
    } else {
      if (typeof data.planName === "string" && data.planName) addRow(copy.plan, data.planName, true);
      addRow(copy.daily, `${format(data.used)} ${data.unit}`);
      addRow(copy.remainingAvailable, `${format(data.remaining)} ${data.unit}`);
      addRow(copy.status, copy.noLimit, true);
      if (error) addRow(copy.status, copy.stale, true);
    }
    card.setAttribute("aria-label", copy.apiTitle);
    card.replaceChildren(content);
  };

  const requestApiData = (manual = false) => {
    if (globalThis.__codexQuotaApiNeedsData === true) return;
    const now = Date.now();
    const cooldownUntil = Number(globalThis.__codexQuotaApiCooldownUntil || 0);
    if (now < cooldownUntil) return;
    if (!manual && now < Number(globalThis.__codexQuotaApiNextAutoAttemptAt || 0)) return;
    globalThis.__codexQuotaApiNeedsData = true;
    const card = document.getElementById(apiHostId);
    if (card) renderApi(card, globalThis.__codexQuotaApiPayload || null, globalThis.__codexQuotaApiError || null);
    console.info("__codexQuotaApiRequest__");
  };

  const refreshStaleApiData = () => {
    if (!apiMode()) return;
    const lastSuccessAt = Number(globalThis.__codexQuotaApiLastSuccessAt || 0);
    if (Date.now() - lastSuccessAt >= staleAfterMs) requestApiData(false);
  };

  const nativeQuotaCard = () => [...document.querySelectorAll("[role='status']")].find((card) =>
    card.classList.contains("rounded-2xl") && card.classList.contains("border") &&
    card.classList.contains("bg-token-main-surface-primary")) || null;

  globalThis.__codexQuotaUpdateApi = (data) => {
    globalThis.__codexQuotaApiNeedsData = false;
    globalThis.__codexQuotaApiLoaded = true;
    const now = Date.now();
    if (data && !data.error) {
      globalThis.__codexQuotaApiPayload = data;
      globalThis.__codexQuotaApiError = null;
      globalThis.__codexQuotaApiLastSuccessAt = now;
      globalThis.__codexQuotaApiNextAutoAttemptAt = now + staleAfterMs;
      globalThis.__codexQuotaApiCooldownUntil = 0;
    } else {
      globalThis.__codexQuotaApiError = data?.error || "API usage unavailable";
      const retrySeconds = Number(data?.retryAfterSeconds);
      const retryMs = Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.max(failureRetryMs, retrySeconds * 1000)
        : failureRetryMs;
      globalThis.__codexQuotaApiNextAutoAttemptAt = now + retryMs;
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
        globalThis.__codexQuotaApiCooldownUntil = now + retryMs;
      }
    }
    if (apiMode()) renderApi(
      apiCard(nativeQuotaCard()),
      globalThis.__codexQuotaApiPayload || null,
      globalThis.__codexQuotaApiError || null
    );
  };

  const installLayout = () => {
    ensureStyle();
    const bar = accountBar();
    if (apiMode()) {
      if (!bar) {
        const source = nativeQuotaCard();
        const host = source ? apiCard(source) : document.getElementById(apiHostId);
        if (host) host.hidden = true;
        return;
      }
      removeApiCard();
      renderApi(
        apiCard(nativeQuotaCard()),
        globalThis.__codexQuotaApiPayload || null,
        globalThis.__codexQuotaApiError || null
      );
      if (!globalThis.__codexQuotaApiLoaded) requestApiData();
      if (!globalThis.__codexQuotaFocusRefreshInstalled) {
        window.addEventListener("focus", refreshStaleApiData);
        globalThis.__codexQuotaFocusRefreshInstalled = true;
      }
      return;
    }
    removeApiCard();
    const card = nativeQuotaCard();
    if (card && setOfficialCardSidebarVisibility(card, Boolean(bar))) compactCard(card);
  };

  const observeOfficialCards = () => {
    globalThis.__codexQuotaOfficialCardObserver?.disconnect();
    globalThis.__codexQuotaOfficialCardObserver = null;
    const root = document.documentElement;
    if (!root) return;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (apiMode() || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!apiMode()) installLayout();
      });
    });
    observer.observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ["value"]});
    globalThis.__codexQuotaOfficialCardObserver = observer;
  };

  const install = () => {
    try {
      if (apiMode()) {
        globalThis.__codexQuotaOfficialCardObserver?.disconnect();
        globalThis.__codexQuotaOfficialCardObserver = null;
        installLayout();
        return true;
      }
      const client = globalThis.__STATSIG__?.instance?.();
      if (!client || typeof client.getLayer !== "function") return false;
      if (!client.__codexNativeQuotaPatched) {
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
