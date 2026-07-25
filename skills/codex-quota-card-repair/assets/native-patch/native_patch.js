(() => {
  const compactClass = "codex-native-compact-usage";
  const compactContentClass = "codex-native-compact-usage-content";
  const apiCardClass = "codex-api-compact-usage";
  const apiHostId = "codex-api-usage-host";
  const styleId = "codex-native-compact-usage-style";
  const staleAfterMs = 5 * 60 * 1000;
  const failureRetryMs = 60 * 1000;

  const apiMode = () => globalThis.__codexQuotaMode === "api";

  const ensureStyle = () => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .${compactClass}, .${apiCardClass} { box-sizing: border-box !important; min-height: 0 !important; padding: 8px 10px 7px !important; border-radius: 12px !important; }
      .${compactContentClass} { display: grid; gap: 6px; }
      .${compactContentClass} .cq-heading { display: flex; align-items: center; gap: 8px; }
      .${compactContentClass} .cq-title { font-size: 12px; font-weight: 600; line-height: 16px; }
      .${compactContentClass} .cq-window { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; row-gap: 1px; min-width: 0; }
      .${compactContentClass} .cq-label, .${compactContentClass} .cq-value { font-size: 12px; line-height: 16px; }
      .${compactContentClass} .cq-value { text-align: right; font-variant-numeric: tabular-nums; }
      .${compactContentClass} .cq-reset, .${compactContentClass} .cq-reset-value { opacity: .7; font-size: 10px; line-height: 13px; }
      .${compactContentClass} .cq-reset-value { overflow: hidden; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
      .${compactContentClass} .cq-window > progress { grid-column: 1 / -1; height: 4px !important; margin-top: 1px; }
      .${compactContentClass} .cq-refresh { justify-self: end; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 10px; line-height: 13px; opacity: .7; }
      .${compactContentClass} .cq-refresh:focus-visible { outline: 1px solid currentColor; outline-offset: 1px; }
    `;
    document.head.append(style);
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

  const addHeading = (content, title) => {
    const heading = document.createElement("div");
    heading.className = "cq-heading";
    const titleNode = document.createElement("span");
    titleNode.className = "cq-title";
    titleNode.textContent = title;
    heading.append(titleNode);
    content.append(heading);
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
    const weekly = [...card.querySelectorAll(".cq-window")].find((window) =>
      (window.querySelector(".cq-label")?.textContent || "").trim() === "Weekly");
    const progress = weekly?.querySelector("progress");
    if (!progress) return;
    const used = Number(progress.value);
    if (!Number.isFinite(used) || used < 0 || used > 100) return;
    const remaining = 100 - used;
    const value = weekly.querySelector(".cq-value");
    const nextText = `${Number(remaining.toFixed(2))}%`;
    if (value && value.textContent !== nextText) value.textContent = nextText;
    progress.setAttribute("aria-label", `Weekly ${Number(used.toFixed(2))}% used`);
    const reset = (weekly.querySelector(".cq-reset-value")?.textContent || "").trim();
    card.setAttribute("aria-label", `Usage. Weekly ${Number(remaining.toFixed(2))}% remaining. ${reset}`);
  };

  const compactCard = (card) => {
    if (card.querySelector(`.${compactContentClass}`)) {
      syncCompactProgress(card);
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
    card.classList.add(compactClass);
    card.setAttribute("aria-label", `Usage. Weekly ${remaining}% remaining. ${reset}`);
    const content = document.createElement("div");
    content.className = compactContentClass;
    const addWindow = (label, value, resetText) => {
      const window = document.createElement("div");
      window.className = "cq-window";
      for (const [className, text] of [["cq-label", label], ["cq-value", value], ["cq-reset", "Resets"], ["cq-reset-value", resetText]]) {
        const node = document.createElement("span");
        node.className = className;
        node.textContent = text;
        if (className === "cq-reset-value") node.title = text;
        window.append(node);
      }
      progress.value = 100 - remaining;
      progress.setAttribute("aria-label", `Weekly ${100 - remaining}% used`);
      window.append(progress);
      content.append(window);
    };
    addHeading(content, "Usage");
    addWindow("Weekly", `${remaining}%`, reset);
    card.replaceChildren(content);
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
    const content = document.createElement("div");
    content.className = compactContentClass;
    addHeading(content, "API Usage");
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
      addRow("Status", error || "API usage unavailable", true);
    } else {
      const valid = [data.used, data.remaining].every((value) => Number.isFinite(value)) && typeof data.unit === "string";
      const hasTotal = valid && Number.isFinite(data.total) && data.total > 0;
      if (!valid) addRow("Status", "Invalid API usage response", true);
      else {
        if (typeof data.planName === "string" && data.planName) addRow("Plan", data.planName, true);
        const dailyRow = addRow("Daily", hasTotal ? `${format(data.used)} / ${format(data.total)} ${data.unit}` : `${format(data.used)} ${data.unit}`);
        if (hasTotal) {
          const progress = document.createElement("progress");
          progress.max = 100;
          progress.value = Math.max(0, Math.min(100, (data.used / data.total) * 100));
          progress.setAttribute("aria-label", "API daily usage");
          dailyRow.append(progress);
        }
        addRow("Remaining", `${format(data.remaining)} ${data.unit}`);
        if (error) addRow("Status", "更新失败，显示上次数据", true);
      }
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "cq-refresh";
    refresh.disabled = globalThis.__codexQuotaApiNeedsData === true;
    refresh.textContent = refresh.disabled ? "刷新中…" : "刷新";
    refresh.addEventListener("click", () => requestApiData(true));
    content.append(refresh);
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
