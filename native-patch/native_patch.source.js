(function installQuotaUI() {
  if (globalThis.__codexQuotaDomReadyHandler) document.removeEventListener("DOMContentLoaded", globalThis.__codexQuotaDomReadyHandler);
  delete globalThis.__codexQuotaDomReadyHandler;
  if (!document.head || !document.body) {
    globalThis.__codexQuotaDomReadyHandler = installQuotaUI;
    document.addEventListener("DOMContentLoaded", installQuotaUI, {once: true});
    return false;
  }
  const {animate, spring, createElement, Gauge, ChevronUp} = __codexQuotaLibraries;
  const restoreOpen = Boolean(document.getElementById("codex-quota-popover")?.matches(":popover-open"));
  globalThis.__codexQuotaMotionCleanup?.();
  document.getElementById("cq-settings")?.remove();
  globalThis.__codexQuotaGeometryCleanup?.();
  for (const id of ["codex-quota-trigger", "codex-quota-footer", "codex-quota-popover", "codex-official-usage-host", "codex-api-usage-host"]) document.getElementById(id)?.remove();
  clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
  const uiRevision = String(globalThis.__codexQuotaUiRevision = (globalThis.__codexQuotaUiRevision || 0) + 1);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const motions = new Map();
  let sharedPopover = null;
  const refreshFeedbackTimers = new Map();
  const requestTimers = new Map();
  const requestEpoch = crypto.getRandomValues(new Uint32Array(2)).join("-");
  let requestSequence = 0;
  let manualRefresh = null;
  const hideRefreshMessage = (button) => {
    const message = document.getElementById("cq-refresh-message");
    if (!button || message?.cqOwner === button) message?.remove();
  };
  const showRefreshMessage = (button) => {
    const text = button.dataset.cqMessage;
    if (!text || !button.isConnected || !button.getClientRects().length || document.visibilityState !== "visible") return;
    hideRefreshMessage();
    const message = document.createElement("div");
    message.id = "cq-refresh-message";
    message.popover = "manual";
    message.setAttribute("role", "status");
    message.cqOwner = button;
    message.textContent = text;
    const style = getComputedStyle(button.closest(".codex-native-compact-usage, .codex-api-compact-usage"));
    for (const name of ["--cq-solid", "--cq-ink", "--cq-border"]) message.style.setProperty(name, style.getPropertyValue(name));
    document.body.append(message);
    message.showPopover();
    const rect = button.getBoundingClientRect();
    message.style.left = Math.max(8, Math.min(innerWidth - message.offsetWidth - 8, rect.right - message.offsetWidth)) + "px";
    const above = rect.top - message.offsetHeight - 7;
    message.style.top = Math.max(8, Math.min(innerHeight - message.offsetHeight - 8, above >= 8 ? above : rect.bottom + 7)) + "px";
    delete button.dataset.cqShowMessage;
  };
  const clearRefreshFeedback = (button) => {
    clearTimeout(refreshFeedbackTimers.get(button));
    refreshFeedbackTimers.delete(button);
    delete button.dataset.cqRefreshed;
    delete button.dataset.cqMessage;
    delete button.dataset.cqShowMessage;
    hideRefreshMessage(button);
    const label = button.disabled ? copy.refreshing : copy.refresh;
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  let disposed = false;
  const stopMotion = (element) => {
    const current = motions.get(element);
    if (!current) return;
    motions.delete(element);
    // Looping indicators have no final pose to commit, especially after hiding.
    if (current.looping) current.control.cancel();
    else current.control.stop();
    current.cleanup?.();
  };
  const finalStyle = (element, frames) => {
    for (const [key, value] of Object.entries(frames)) element.style[key] = String(Array.isArray(value) ? value[value.length - 1] : value);
  };
  const move = (element, frames, options = {}, cleanup) => {
    stopMotion(element);
    const instant = reducedMotion.matches || document.visibilityState !== "visible";
    if (instant) { finalStyle(element, frames); cleanup?.(); return Promise.resolve(); }
    const control = animate(element, frames, {...options, ...(options.type === "spring" ? {type: spring} : {})});
    const record = {control, cleanup, frames, looping: options.repeat === Infinity};
    motions.set(element, record);
    const done = () => {
      if (motions.get(element) !== record) return;
      motions.delete(element);
      cleanup?.();
    };
    control.then(done);
    return control;
  };
  const finishMotion = () => {
    finishSharedPopover();
    for (const [element, record] of [...motions]) {
      stopMotion(element);
      if (!record.looping && !record.cleanup) finalStyle(element, record.frames);
    }
  };
  const icon = (definition, className) => createElement(definition, {
    class: className, "aria-hidden": "true", focusable: "false", "stroke-width": "1.8",
  });
  // Optical drawings for a 16px tool slot, rather than downscaling a 24px icon.
  const toolIcons = {
    refresh: [["path", {d: "M13 8a5 5 0 1 1-1.4645-3.5355M11.5355 1.75v2.7145H8.75"}]],
    settings: [["path", {d: "M2.5 5h3M8.5 5h5M2.5 11h5M10.5 11h3"}], ["circle", {cx: "7", cy: "5", r: "1.5"}], ["circle", {cx: "9", cy: "11", r: "1.5"}]],
    done: [["path", {d: "m3.5 8.25 3 3 6.25-6.5"}]],
    warning: [["circle", {cx: "8", cy: "8", r: "5.5"}], ["path", {d: "M8 4.75v3.5M8 11.25h.01"}]],
  };
  const toolIcon = (name, className) => createElement(toolIcons[name], {
    class: className, viewBox: "0 0 16 16", width: "16", height: "16",
    "aria-hidden": "true", focusable: "false", "stroke-width": "1.5",
  });
  const pressFeedback = (button) => {
    // Keep tiny vector strokes at their optical size; tool buttons use :active color.
    if (button.matches(".cq-refresh,.cq-settings-button")) return;
    let pressed = false;
    const press = () => {
      if (button.disabled || pressed) return;
      pressed = true;
      if (!reducedMotion.matches) move(button, {transform: "scale(.94)"}, {duration: .08});
    };
    const release = () => {
      if (!pressed) return;
      pressed = false;
      move(button, {transform: "scale(1)"}, {duration: .12}, () => button.style.removeProperty("transform"));
    };
    button.cqRelease = release;
    button.addEventListener("pointerdown", press);
    for (const event of ["pointerup", "pointercancel", "pointerleave", "blur"]) button.addEventListener(event, release);
    button.addEventListener("keydown", event => { if (event.key === " " || event.key === "Enter") press(); });
    button.addEventListener("keyup", release);
  };
  const updateFill = (track, value) => {
    const fill = track.querySelector(".cq-progress-fill");
    const target = `${value}%`;
    if (!fill || fill.dataset.target === target) return;
    const first = !fill.dataset.target || !fill.isConnected;
    fill.dataset.target = target;
    if (first) finalStyle(fill, {width: target});
    else move(fill, {width: target}, {duration: .2, ease: [.2, .8, .2, 1]});
  };
  const refreshMotion = (button) => {
    const glyph = button.querySelector(".cq-refresh-icon");
    if (!glyph) return;
    if (!button.isConnected || !button.getClientRects().length || document.visibilityState !== "visible" || reducedMotion.matches) {
      stopMotion(glyph);
    } else if (button.disabled) {
      if (!motions.has(glyph)) move(glyph, {transform: ["rotate(0deg)", "rotate(360deg)"]},
        {duration: .9, ease: "linear", repeat: Infinity}, () => glyph.style.removeProperty("transform"));
    } else if (Number(getComputedStyle(glyph).opacity) === 0) {
      // A fast response can complete before the spinner has appeared at all.
      stopMotion(glyph);
    }
    // Otherwise keep rotating during its native opacity fade; transitionend stops it
    // only after it is invisible, so there is no visible angle reset on completion.
  };
  const onMotionPreference = () => {
    for (const id of ["codex-quota-trigger", "codex-quota-popover"]) document.getElementById(id)?.toggleAttribute("data-cq-instant", document.visibilityState !== "visible");
    hideRefreshMessage();
    finishMotion();
    document.querySelectorAll('.cq-actions button, #cq-settings button, #cq-settings a, #cq-notice button').forEach(button => button.cqRelease?.());
    document.querySelectorAll(".cq-refresh").forEach(refreshMotion);
  };
  reducedMotion.addEventListener("change", onMotionPreference);
  document.addEventListener("visibilitychange", onMotionPreference);
  window.addEventListener("blur", onMotionPreference);
  globalThis.__codexQuotaMotionCleanup = () => {
    disposed = true;
    for (const timer of requestTimers.values()) clearTimeout(timer);
    hideRefreshMessage();
    for (const button of refreshFeedbackTimers.keys()) clearRefreshFeedback(button);
    finishMotion();
    reducedMotion.removeEventListener("change", onMotionPreference);
    document.removeEventListener("visibilitychange", onMotionPreference);
    window.removeEventListener("blur", onMotionPreference);
    window.removeEventListener("resize", hideRefreshMessageOnMove);
    window.removeEventListener("scroll", hideRefreshMessageOnMove, true);
    const panel = document.getElementById("cq-settings");
    if (panel) { panel.onclose = null; panel.remove(); }
  };
  const hideRefreshMessageOnMove = (event) => {
    const owner = document.getElementById("cq-refresh-message")?.cqOwner;
    if (event.type === "resize" || event.target === document || event.target === window ||
        (event.target instanceof Element && owner && event.target.contains(owner))) hideRefreshMessage();
  };
  window.addEventListener("resize", hideRefreshMessageOnMove);
  window.addEventListener("scroll", hideRefreshMessageOnMove, true);
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
        remainingAvailable: "剩余可用",
        resetSuffix: "重置",
        resetAtPrefix: "重置时间",
        used: "已用",
        summaryUsed: "已用",
        weeklySummaryTitle: "本周",
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
        remainingAvailable: "Remaining",
        resetSuffix: "reset",
        resetAtPrefix: "Reset at",
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

  const settingsKey = "codex-usage-card.settings.v2";
  const defaults = {compact: false, alerts: true, thresholds: "20,10", recovery: true, system: false, hour12: false, transparency: "blur"};
  const readSettings = () => {
    try {
      const value = JSON.parse(localStorage.getItem(settingsKey) || "{}");
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key,
        typeof value?.[key] === typeof fallback ? value[key] : fallback]));
    } catch { return {...defaults}; }
  };
  let preferences = readSettings();
  const words = (zh, en) => isChinese ? zh : en;
  const officialTitle = (fiveHour = false) => fiveHour ? copy.fiveHourTitle : copy.weeklyTitle;
  const thresholds = () => [...new Set(preferences.thresholds.split(",").map(Number))]
    .filter(value => Number.isFinite(value) && value > 0 && value < 100).sort((a, b) => b - a);

  const contentFor = (card, layout, variant) => {
    const content = card.querySelector(`.${compactContentClass}`);
    return content?.dataset.cqUi === uiRevision && content.dataset.cqLayout === layout &&
      (!variant || content.dataset.cqVariant === variant) ? content : null;
  };
  const mountContent = (card, content) => {
    if (content.parentElement !== card) {
      for (const element of [...motions.keys()]) if (element !== card && card.contains(element)) stopMotion(element);
      card.replaceChildren(content);
    }
    content.querySelectorAll(".cq-refresh").forEach(refreshMotion);
    content.querySelectorAll(".cq-refresh[data-cq-show-message]").forEach(showRefreshMessage);
  };
  const stopCardMotion = (card) => {
    if (card) {
      const popup = document.getElementById("cq-refresh-message");
      if (popup && card.contains(popup.cqOwner)) hideRefreshMessage();
      for (const element of [...motions.keys()]) if (card.contains(element)) stopMotion(element);
      for (const button of refreshFeedbackTimers.keys()) if (card.contains(button)) clearRefreshFeedback(button);
    }
  };
  const announceQuota = (message) => {
    let notice = document.getElementById("cq-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "cq-notice";
      notice.setAttribute("role", "status");
      const text = document.createElement("span");
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = words("关闭", "Dismiss");
      close.onclick = () => {
        notice.cqDismissed = true;
        move(notice, {opacity: 0, transform: "translateY(4px)"}, {duration: .14}, () => { if (notice.cqDismissed) notice.remove(); });
      };
      pressFeedback(close);
      notice.append(text, close);
      document.body.append(notice);
      notice.style.opacity = "0";
      notice.style.transform = "translateY(6px)";
    }
    notice.cqDismissed = false;
    move(notice, {opacity: 1, transform: "translateY(0px)"}, {duration: .22, ease: [.2, .8, .2, 1]});
    notice.firstElementChild.textContent = message;
    if (preferences.system && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("Codex Usage Card", {body: message, tag: "codex-usage-card", silent: true}); }
      catch { /* The in-app notice remains available when the host blocks system notifications. */ }
    }
  };

  const checkAlerts = async (kind, data) => {
    if ((!preferences.alerts && !preferences.recovery) || document.visibilityState !== "visible") return;
    const scope = globalThis.__codexQuotaSessionScope;
    if (!scope) return;
    const windows = kind === "official" ? data.windows : data.total > 0
      ? [{label: "API", usedPercent: data.used / data.total * 100, resetAt: null}] : [];
    const run = () => {
      if (scope !== globalThis.__codexQuotaSessionScope || document.visibilityState !== "visible") return;
      const key = "codex-usage-card.alerts.v2";
      let stored;
      try { stored = JSON.parse(localStorage.getItem(key) || "{}"); }
      catch { return; } // Shared storage is required to guarantee cross-window deduplication.
      const records = stored?.scope === scope && stored.records ? stored.records : {};
      const messages = [];
      for (const item of windows || []) {
        if (!Number.isFinite(item.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100) continue;
        const remaining = 100 - item.usedPercent;
        const previous = records[item.label];
        const replenished = previous && remaining > previous.remaining &&
          (kind === "official" ? item.resetAt > previous.resetAt : remaining > previous.remaining);
        const cycleChanged = previous && kind === "official" && item.resetAt > previous.resetAt;
        const sent = cycleChanged || replenished ? [] : previous?.sent || [];
        if (preferences.recovery && replenished && previous.remaining <= Math.max(...thresholds(), 0)) {
          messages.push(`${item.label}: ${words("额度已恢复，剩余", "Quota replenished, remaining")} ${formatPercent(remaining)}%`);
        }
        const crossed = preferences.alerts ? thresholds().filter(limit => remaining <= limit && !sent.includes(limit)) : [];
        if (crossed.length) {
          messages.push(`${item.label}: ${words("额度偏低，剩余", "Low quota, remaining")} ${formatPercent(remaining)}%`);
          sent.push(...crossed);
        }
        records[item.label] = {remaining, resetAt: item.resetAt, sent};
      }
      try { localStorage.setItem(key, JSON.stringify({scope, records})); }
      catch { return; }
      if (messages.length) announceQuota(messages.join(" · "));
    };
    // Web Locks serialize the read/write across Codex windows without another timer.
    if (navigator.locks) await navigator.locks.request("codex-usage-card.alerts", run);
  };

  globalThis.__codexQuotaUpdateDiagnosis = (data) => {
    const output = document.getElementById("cq-diagnosis");
    if (!output) return;
    clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
    if (data?.errorCode) {
      output.textContent = words("自检未完成，请重试或运行 doctor.ps1。", "Diagnosis unavailable. Retry or run doctor.ps1.");
      return;
    }
    const labels = {TaskActionMatches: words("启动任务", "Startup task"), HelperWindowless: words("无窗口 Helper", "Windowless helper"),
      CdpEndpointFound: words("调试连接", "Debug connection"), MainPageFound: words("主页面", "Main page"), CardVisible: words("入口可见", "Entry visible")};
    output.textContent = Object.entries(labels).map(([key, label]) => `${label}: ${data[key] === true
      ? words("正常", "OK") : data[key] === false ? words("未就绪", "Not ready") : words("未检查", "Not checked")}`).join("\n") +
      (Number.isInteger(data.WindowCount) ? `\n${words("可见入口／主窗口", "Visible entries / main windows")}: ${data.VisibleCardCount} / ${data.WindowCount}${data.UninspectedWindowCount ? ` (${words("未检查", "not checked")}: ${data.UninspectedWindowCount})` : ""}` : "") +
      (Array.isArray(data.StageCodes) && data.StageCodes.length ? "\n" + data.StageCodes.join(", ") : "");
  };

  const openSettings = (opener) => {
    const existing = document.getElementById("cq-settings");
    if (existing) { existing.querySelector("button")?.focus(); return; }
    const popup = document.getElementById("codex-quota-popover");
    const host = opener.closest(`.${compactClass}, .${apiCardClass}`);
    if (!popup || !host) return;
    const previousRect = settlePopoverMotion();
    const panel = document.createElement("div");
    panel.id = "cq-settings";
    panel.innerHTML = `<form method="dialog"><header class="cq:flex cq:items-center cq:justify-between cq:gap-[8px]"><div class="cq-settings-heading cq:flex cq:flex-wrap cq:items-baseline cq:gap-x-[8px] cq:gap-y-[3px] cq:min-w-0"><h2 id="cq-settings-title"></h2><p class="cq-settings-feedback" role="status"></p></div><button value="close"></button></header>
      <div class="cq-options cq:grid cq:gap-[8px]"><div class="cq-option-group cq-display-options" role="group"></div><div class="cq-option-group cq-alert-options" role="group"></div></div>
      <div class="cq-tools cq:flex cq:flex-wrap cq:items-center cq:gap-[4px]"><button type="button" class="cq-doctor"></button><button type="button" class="cq-copy"></button><a target="_blank" rel="noopener noreferrer" href="https://github.com/DrFanghaiz/codex-usage-card/releases/latest"></a></div>
      <pre id="cq-diagnosis" role="status"></pre></form>`;
    panel.querySelector("h2").textContent = words("额度卡设置", "Usage card settings");
    panel.querySelector("header button").textContent = words("返回", "Back");
    const feedback = panel.querySelector(".cq-settings-feedback");
    if (!navigator.locks || !globalThis.__codexQuotaSessionScope) feedback.textContent = words("提醒等待兼容的 Helper 与浏览器连接。", "Alerts require a compatible helper and browser connection.");
    const save = () => {
      try { localStorage.setItem(settingsKey, JSON.stringify(preferences)); feedback.textContent = words("已保存", "Saved"); }
      catch { feedback.textContent = words("无法保存设置，本次窗口内有效。", "Storage unavailable; settings apply to this window only."); }
      installLayout();
    };
    const displayOptions = panel.querySelector(".cq-display-options");
    const alertOptions = panel.querySelector(".cq-alert-options");
    displayOptions.setAttribute("aria-label", words("显示", "Display"));
    alertOptions.setAttribute("aria-label", words("提醒", "Alerts"));
    const rowClass = "cq:flex cq:items-center cq:justify-between cq:gap-[12px] cq:box-border cq:min-h-[35px] cq:px-[10px] cq:py-[5px] cq:cursor-pointer";
    for (const [key, label] of [["compact", words("紧凑模式", "Compact mode")], ["alerts", words("低额度提醒", "Low quota alerts")],
      ["recovery", words("额度恢复提醒", "Quota recovery alerts")], ["system", words("系统通知", "System notifications")], ["hour12", words("12 小时制", "12-hour clock")]]) {
      if (key === "compact") continue;
      const row = document.createElement("label");
      row.className = rowClass;
      row.textContent = label;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = preferences[key];
      input.name = key;
      input.onchange = async () => {
        if (key === "system" && input.checked) {
          try { input.checked = typeof Notification !== "undefined" && await Notification.requestPermission() === "granted"; }
          catch { input.checked = false; }
        }
        preferences[key] = input.checked;
        save();
        if (key === "system" && !input.checked) feedback.textContent = words("系统通知未启用，卡内提醒仍可使用。", "System notifications are off; in-app alerts remain available.");
      };
      const toggle = document.createElement("span");
      toggle.className = "cq-switch";
      const track = document.createElement("span");
      track.className = "cq-switch-track";
      track.setAttribute("aria-hidden", "true");
      toggle.append(input, track);
      row.append(toggle);
      (key === "compact" || key === "hour12" ? displayOptions : alertOptions).append(row);
    }
    const thresholdRow = document.createElement("label");
    thresholdRow.className = rowClass;
    thresholdRow.textContent = words("提醒阈值（%）", "Alert thresholds (%)");
    const input = document.createElement("input");
    input.name = "thresholds";
    input.value = preferences.thresholds;
    input.placeholder = "20,10";
    input.onchange = () => {
      if (!/^\d{1,2}(\s*,\s*\d{1,2}){0,3}$/.test(input.value) || input.value.split(",").some(value => Number(value) <= 0)) {
        input.setCustomValidity(words("输入 1–99，逗号分隔，最多四档。", "Enter 1–99, comma-separated, up to four thresholds."));
        input.reportValidity(); return;
      }
      input.setCustomValidity(""); preferences.thresholds = input.value; save();
    };
    thresholdRow.append(input); alertOptions.firstElementChild.after(thresholdRow);
    const doctor = panel.querySelector(".cq-doctor");
    doctor.textContent = words("运行自检", "Run diagnosis");
    doctor.onclick = () => {
      panel.querySelector("pre").textContent = words("正在检查…", "Checking…");
      console.debug("__codexQuotaDoctorRequest__");
      clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
      globalThis.__codexQuotaDiagnosisTimer = setTimeout(() => globalThis.__codexQuotaUpdateDiagnosis({errorCode: "TIMEOUT"}), 20000);
    };
    const copyButton = panel.querySelector(".cq-copy");
    copyButton.textContent = words("复制诊断", "Copy diagnosis");
    copyButton.onclick = async () => {
      try { await navigator.clipboard.writeText(panel.querySelector("pre").textContent); feedback.textContent = words("已复制", "Copied"); }
      catch { feedback.textContent = words("复制失败，请选中文字手动复制。", "Copy failed; select the diagnostic text to copy manually."); }
    };
    panel.querySelector("a").textContent = words("版本更新", "Release notes");
    panel.querySelector("a").setAttribute("aria-label", words("检查更新与版本说明", "Check updates and release notes"));
    panel.querySelector("form").onsubmit = event => {
      event.preventDefault();
      clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
      const previousRect = settlePopoverMotion();
      panel.remove();
      host.hidden = false;
      animatePane(previousRect, host);
      opener.focus();
    };
    popup.append(panel);
    host.hidden = true;
    animatePane(previousRect, panel);
    panel.querySelector("header button").focus();
  };

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
      return {kind: "plus-x", planName, planLabel: "Plus", windows: [weekly, fiveHour], fiveHour, weekly};
    }
    if (windows.length === 1 && weekly) {
      return {kind: "weekly", planName, planLabel: planName === "pro" ? "Pro" : "", windows, weekly};
    }
    return {kind: "fallback", planName, windows};
  };

  const ensureStyle = () => {
    const style = document.getElementById(styleId) || document.createElement("style");
    const css = __codexQuotaTailwindCss + `
      #codex-quota-trigger, #codex-quota-popover {
        --cq-solid: var(--color-surface-elevated-secondary, var(--color-token-main-surface-primary, #f5f3eb));
        --cq-ink: var(--color-text, var(--color-token-text-primary, #202522));
        --cq-muted: var(--color-text-secondary, var(--color-token-text-secondary, #63675d));
        --cq-border: var(--color-border, #e1ded5);
        --cq-hover: var(--color-background-primary-ghost-hover, color-mix(in srgb, var(--cq-ink) 7%, transparent));
        --cq-accent: var(--cq-ink);
        --cq-fill: #8e4617;
        --cq-track: #e2d8c4;
        --cq-warning: var(--color-text-warning-surface, #98601c);
        color: var(--cq-ink);
        font: 13px/1.4 var(--default-font-family, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif);
        font-variant-numeric: tabular-nums;
        box-sizing: border-box;
      }
      #codex-quota-trigger[data-cq-dark], #codex-quota-popover[data-cq-dark] {
        --cq-solid: var(--color-surface-elevated-secondary, var(--color-token-main-surface-primary, Canvas));
        --cq-ink: var(--color-text, var(--color-token-text-primary, CanvasText));
        --cq-muted: var(--color-text-secondary, var(--color-token-text-secondary, var(--cq-ink)));
        --cq-border: var(--color-border, color-mix(in srgb, var(--cq-ink) 12%, transparent));
        --cq-track: color-mix(in srgb, var(--cq-ink) 24%, var(--cq-solid));
        --cq-fill: color-mix(in srgb, var(--cq-ink) 65%, #8e4617);
        --cq-warning: var(--color-text-warning-surface, #e2bb78);
      }
      #codex-quota-footer { flex: none; box-sizing: border-box; padding: 0 8px; }
      #codex-quota-trigger { display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; margin: 0; padding: 0 8px; border: 1px solid var(--cq-border); border-radius: var(--radius-sm, 6px); background: var(--cq-solid); box-shadow: 0 1px 3px #00000006; text-align: left; cursor: pointer; transition: background 110ms, border-color 110ms; }
      #codex-quota-trigger:is(:hover,[aria-expanded="true"]) { background: color-mix(in srgb, var(--cq-solid) 94%, var(--cq-ink)); border-color: var(--color-border-strong, var(--cq-border)); }
      @supports (backdrop-filter: blur(1px)) { #codex-quota-trigger { background: color-mix(in srgb, var(--cq-solid) 82%, transparent); backdrop-filter: blur(18px); } }
      #codex-quota-trigger .cq-trigger-icon { display: none; }
      :is(#codex-quota-trigger,#codex-quota-popover) .cq-plan-badge { display: inline-block; flex: none; box-sizing: border-box; height: 16px; padding: 3px 7px; border: 0; border-radius: 99px; color: color-mix(in srgb, var(--cq-ink) 72%, transparent); background: color-mix(in srgb, var(--cq-ink) 7%, transparent); font-size: 9.5px; line-height: 10px; font-weight: 600; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      :is(#codex-quota-trigger,#codex-quota-popover) .cq-plan-badge[hidden] { display: none; }
      :is(#codex-quota-trigger,#codex-quota-popover) .cq-plan-badge:where([data-cq-tier="pro"]) { color: var(--cq-fill); background: color-mix(in srgb, var(--cq-fill) 10%, transparent); }
      #codex-quota-trigger .cq-trigger-copy { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #codex-quota-trigger .cq-trigger-graphics { display: none; }
      #codex-quota-trigger[data-cq-graphical] { height: 32px; }
      #codex-quota-trigger[data-cq-graphical] .cq-trigger-copy { display: none; }
      #codex-quota-trigger[data-cq-graphical] .cq-trigger-graphics { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; white-space: nowrap; }
      #codex-quota-trigger .cq-trigger-graphics > * { flex: none; }
      #codex-quota-trigger[data-cq-graphical="plus"] .cq-trigger-graphics { gap: 2px; }
      #codex-quota-trigger .cq-trigger-window-label { font-size: 12px; }
      #codex-quota-trigger .cq-trigger-separator { color: var(--cq-muted); }
      #codex-quota-trigger .cq-trigger-weekly-bar { width: 42px; height: 2px; border-radius: 2px; background: var(--cq-track); }
      #codex-quota-trigger[data-cq-graphical="plus"] .cq-trigger-weekly-bar { width: 24px; }
      #codex-quota-trigger .cq-trigger-time { display: inline-flex; }
      #codex-quota-trigger .cq-trigger-chevron { width: 12px; height: 12px; flex: none; margin-left: auto; color: var(--cq-muted); }
      #codex-quota-trigger .cq-trigger-graphics [data-cq-window] { display: inline-flex; align-items: baseline; }
      :is(#codex-quota-trigger,#codex-quota-popover) :is(.cq-trigger-digits,.cq-trigger-percent,.cq-value-digits,.cq-value-percent,.cq-label-name,.cq-trigger-window-label) { display: inline-block; line-height: 1; }
      #codex-quota-trigger .cq-trigger-plan, #codex-quota-trigger .cq-trigger-copy, #codex-quota-trigger .cq-trigger-graphics { opacity: 1; }
      #codex-quota-trigger[data-cq-replaced] > * { opacity: 0; }
      #codex-quota-trigger[data-cq-replaced] { background: transparent !important; border-color: transparent !important; box-shadow: none !important; backdrop-filter: none !important; pointer-events: none; outline: none; }
      #codex-quota-trigger[data-cq-replaced][aria-expanded="false"] { pointer-events: auto; }
      #codex-quota-trigger .cq-trigger-chevron { transition: transform 180ms cubic-bezier(.2,.8,.2,1); }
      #codex-quota-trigger[aria-expanded="true"] .cq-trigger-chevron { transform: rotate(180deg); transition-duration: 240ms; }
      #codex-quota-trigger .cq-warning, #codex-quota-popover [data-cq-low] .cq-value-group { color: var(--cq-warning); }
      #codex-quota-trigger .cq-trigger-weekly-bar.cq-warning { --cq-fill: var(--cq-warning); }
      #codex-quota-trigger[data-cq-collapsed] { width: 36px; height: 36px; flex: none; justify-content: center; padding: 8px; align-self: center; }
      #codex-quota-trigger[data-cq-collapsed] .cq-trigger-icon { display: block; width: 20px; height: 20px; }
      #codex-quota-trigger[data-cq-collapsed] :is(.cq-trigger-plan,.cq-trigger-copy,.cq-trigger-graphics,.cq-trigger-chevron) { display: none; }
      #codex-quota-trigger[data-cq-low]::after { content: ""; flex: none; width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
      #codex-quota-trigger[data-cq-collapsed][data-cq-low]::after { position: absolute; margin: 23px 0 0 22px; }
      #codex-quota-popover { position: fixed; inset: auto; margin: 0; padding: 8px 0 8px 8px; max-width: none; max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; scrollbar-width: none; border: .8px solid var(--cq-border); border-radius: var(--radius-sm, 6px); background: var(--cq-solid); box-shadow: 0 4px 12px #302c2212, 0 16px 32px #302c2207; opacity: 0; transition: display 700ms allow-discrete, overlay 700ms allow-discrete; }
      @supports (backdrop-filter: blur(1px)) { #codex-quota-popover { background: color-mix(in srgb, var(--cq-solid) 90%, transparent); backdrop-filter: blur(8px); border: 0; } }
      #codex-quota-popover:not([data-cq-inplace]) { transition-duration: 180ms; }
      #codex-quota-popover:popover-open { opacity: 1; }
      #codex-quota-popover[data-cq-opening] { opacity: 0; }
      #codex-quota-popover:not(:popover-open) { pointer-events: none; }
      #codex-quota-popover > * { opacity: 0; }
      #codex-quota-popover:popover-open > * { opacity: 1; }
      #codex-quota-popover::backdrop { background: transparent; pointer-events: none; }
      #codex-quota-popover [hidden], #codex-quota-footer[hidden], #codex-quota-trigger[hidden], [data-codex-quota-source] { display: none !important; }
      #codex-quota-popover :is(button,input,select,a) { font: inherit; color: inherit; box-sizing: border-box; }
      #codex-quota-popover button { border: 0; background: transparent; cursor: pointer; }
      #codex-quota-popover button:disabled { opacity: .6; cursor: default; }
      #codex-quota-popover button:hover { background: var(--cq-hover); }
      #codex-quota-trigger:focus-visible, #codex-quota-popover :is(button,input,select,a):focus-visible { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #codex-quota-popover .cq-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; padding: 0 var(--cq-control-right, 6px) 0 8px; }
      #codex-quota-popover .cq-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      #codex-quota-popover .cq-title[data-cq-error], #codex-quota-popover .cq-refresh[data-cq-error] { color: var(--cq-warning); }
      #codex-quota-popover .cq-plan { margin-right: auto; margin-left: 0; min-width: 0; flex: 0 1 auto; }
      #codex-quota-popover .cq-actions { display: flex; flex: none; gap: 8px; }
      #codex-quota-popover .cq-actions button { display: grid; place-items: center; width: 24px; height: 24px; padding: 4px; border-radius: 6px; color: var(--cq-muted); }
      #codex-quota-popover .cq-actions svg { display: block; width: 16px; height: 16px; stroke-width: 1.5; }
      #codex-quota-popover .cq-actions button { transition: background-color 120ms ease, color 120ms ease; }
      #codex-quota-popover .cq-actions button:active:not(:disabled) { background: color-mix(in srgb, var(--cq-ink) 12%, transparent); color: var(--cq-ink); transition-duration: 0s; }
      #codex-quota-popover .cq-collapse-button { position: absolute; z-index: 3; display: grid; place-items: center; width: 24px; height: 24px; padding: 6px; border-radius: 5px; color: var(--cq-muted); }
      #codex-quota-popover .cq-collapse-icon { width: 12px; height: 12px; transform: rotate(180deg); }
      #codex-quota-popover[data-cq-inplace] #cq-settings { padding-bottom: 25px; }
      #codex-quota-popover[data-cq-inplace] .cq-rows > :last-child { padding-bottom: 0; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child .cq-reset { grid-area: 3 / 1 / 4 / -1; padding-right: 24px; min-height: 16px; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child[data-cq-secondary] .cq-reset { grid-row: 2; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child[data-cq-secondary] .cq-low { grid-row: 3; padding-right: 24px; }
      #codex-quota-popover[data-cq-inplace] :not([data-cq-focal]) > .cq-rows > :last-child { padding-right: 40px; }
      #codex-quota-popover[data-cq-morph] { background: transparent; border-color: transparent; box-shadow: none; backdrop-filter: none; overflow: visible; opacity: 1; pointer-events: auto; }
      #codex-quota-popover[data-cq-morph] > * { opacity: 1; }
      #codex-quota-popover .cq-shared-layer { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      #codex-quota-popover[data-cq-morph] > :is(#codex-official-usage-host,#codex-api-usage-host,#cq-settings) { position: relative; z-index: 1; }
      #codex-quota-popover .cq-shared-surface { position: absolute; z-index: 0; transform-origin: 0 0; pointer-events: none; }
      #codex-quota-popover .cq-shared-actor { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; will-change: transform; }
      :is(#codex-quota-trigger,#codex-quota-popover) [data-cq-shared-hidden] { visibility: hidden !important; }
      #codex-quota-popover .cq-refresh:disabled { opacity: 1; cursor: progress; }
      #codex-quota-popover .cq-refresh > * { grid-area: 1 / 1; pointer-events: none; opacity: 0; transition: opacity 140ms linear; }
      #codex-quota-popover .cq-refresh-icon { display: grid; place-items: center; width: 16px; height: 16px; transform-origin: 50% 50%; }
      #codex-quota-popover .cq-refresh > .cq-refresh-idle { opacity: 1; }
      #codex-quota-popover .cq-refresh:is(:disabled,[data-cq-refreshed],[data-cq-error]) > .cq-refresh-idle { opacity: 0; }
      #codex-quota-popover .cq-refresh:disabled > .cq-refresh-icon,
      #codex-quota-popover .cq-refresh[data-cq-refreshed]:not(:disabled) > .cq-refresh-done,
      #codex-quota-popover .cq-refresh[data-cq-error]:not(:disabled) > .cq-refresh-warning { opacity: 1; }
      #codex-quota-popover .cq-refresh:disabled > .cq-refresh-icon { will-change: transform; }
      @media (prefers-reduced-motion: reduce) { #codex-quota-popover .cq-actions button, #codex-quota-popover .cq-refresh > * { transition: none; } }
      #codex-quota-popover[data-cq-instant] .cq-actions button, #codex-quota-popover[data-cq-instant] .cq-refresh > * { transition: none; }
      #codex-quota-popover .cq-quota-row { padding: 8px 16px 8px 8px; min-width: 0; }
      #codex-quota-popover .cq-row-head { display: flex; justify-content: space-between; gap: 8px; line-height: 18px; }
      #codex-quota-popover .cq-value-group { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; column-gap: 4px; }
      #codex-quota-popover .cq-value { white-space: nowrap; }
      #codex-quota-popover .cq-value-label { color: var(--cq-muted); font-size: 11px; font-weight: 400; letter-spacing: normal; }
      #codex-quota-popover .cq-value-number, #codex-quota-trigger .cq-trigger-graphics [data-cq-window] { font-weight: 600; letter-spacing: -.01em; }
      #codex-quota-popover .cq-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #codex-quota-popover .cq-row-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; min-height: 16px; }
      #codex-quota-popover .cq-rule { position: relative; flex: 1; min-width: 3px; height: 2px; border-radius: 2px; background: var(--cq-track); }
      :is(#codex-quota-popover,#codex-quota-trigger) .cq-progress-fill { display: block; height: 100%; min-width: 3px; max-width: 100%; border-radius: inherit; background: var(--cq-fill); }
      #codex-quota-popover .cq-reset { display: inline-flex; align-items: center; gap: 4px; color: var(--cq-muted); font-size: 11px; white-space: nowrap; }
      #codex-quota-popover .cq-rows { container: cq-rows / inline-size; }
      #codex-quota-popover [data-cq-focal] .cq-quota-row { display: grid; grid-template-columns: auto minmax(12px,1fr) auto; align-items: end; gap: 8px; padding: 8px 16px 4px 8px; }
      #codex-quota-popover [data-cq-focal] :is(.cq-row-head,.cq-row-foot,.cq-value-group) { display: contents; }
      #codex-quota-popover [data-cq-focal] .cq-label { grid-area: 1 / 1 / 2 / -1; max-width: 50%; font-size: 11px; line-height: 14px; color: var(--cq-muted); white-space: normal; }
      #codex-quota-popover [data-cq-focal] .cq-value { grid-area: 2 / 1; line-height: 20px; }
      #codex-quota-popover [data-cq-focal] .cq-value-number { font-size: 20px; letter-spacing: -.02em; }
      #codex-quota-popover [data-cq-focal] .cq-value-percent { margin-left: 1px; font-size: 11px; font-weight: 500; color: var(--cq-muted); }
      #codex-quota-popover [data-cq-focal] .cq-rule { grid-area: 2 / 2; margin-bottom: 3px; }
      #codex-quota-popover [data-cq-focal] .cq-reset { grid-area: 2 / 3; padding-bottom: 1px; }
      #codex-quota-popover [data-cq-focal] .cq-reset-date-value { color: var(--cq-ink); font-weight: 500; }
      #codex-quota-popover [data-cq-focal] .cq-low { grid-area: 1 / 1 / 2 / -1; justify-self: end; max-width: 50%; white-space: normal; text-align: right; }
      #codex-quota-popover [data-cq-focal] [data-cq-secondary] { grid-template-columns: auto auto minmax(12px,1fr) auto; align-items: center; gap: 8px; padding-top: 8px; }
      #codex-quota-popover [data-cq-secondary] .cq-label { grid-area: 1 / 1; max-width: none; white-space: nowrap; }
      #codex-quota-popover [data-cq-secondary] .cq-value { grid-area: 1 / 2; line-height: 18px; }
      #codex-quota-popover [data-cq-secondary] .cq-value-number { font-size: 13px; letter-spacing: -.01em; }
      #codex-quota-popover [data-cq-secondary] .cq-value-percent { margin-left: 0; font-size: inherit; font-weight: inherit; color: inherit; }
      #codex-quota-popover [data-cq-secondary] .cq-rule { grid-area: 1 / 3; height: 1.5px; margin-bottom: 0; }
      #codex-quota-popover [data-cq-secondary] .cq-reset { grid-area: 1 / 4; padding-bottom: 0; }
      #codex-quota-popover [data-cq-secondary] .cq-time-ring { width: 9px; height: 9px; }
      #codex-quota-popover [data-cq-secondary] .cq-low { grid-area: 2 / 1 / 3 / -1; max-width: 100%; }
      @container cq-rows (max-width: 198px) {
        #codex-quota-popover [data-cq-focal] .cq-quota-row { grid-template-columns: auto minmax(0,1fr); }
        #codex-quota-popover [data-cq-focal] .cq-reset { grid-area: 3 / 1 / 4 / -1; flex-wrap: wrap; white-space: normal; }
        #codex-quota-popover [data-cq-focal] [data-cq-secondary] { grid-template-columns: auto auto minmax(0,1fr); }
        #codex-quota-popover [data-cq-secondary] .cq-reset { grid-area: 2 / 1 / 3 / -1; }
        #codex-quota-popover [data-cq-secondary] .cq-low { grid-row: 3; }
      }
      :is(#codex-quota-popover,#codex-quota-trigger) .cq-time-ring { width: 10px; height: 10px; flex: none; transform: rotate(-90deg); }
      :is(#codex-quota-popover,#codex-quota-trigger) .cq-ring-track { fill: none; stroke: var(--cq-track); stroke-width: 2.75; }
      :is(#codex-quota-popover,#codex-quota-trigger) .cq-ring-fill { fill: none; stroke: var(--cq-fill); stroke-width: 2.75; stroke-linecap: round; }
      #codex-quota-popover .cq-low { font-size: 11px; white-space: nowrap; }
      #codex-quota-popover .cq-status { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      #codex-quota-popover .cq-empty { padding: 8px 16px 8px 8px; color: var(--cq-muted); }
      #cq-settings { padding-right: 8px; }
      #cq-settings header { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; padding: 0 8px; }
      #cq-settings h2 { font-size: 13px; font-weight: 500; margin: 0; }
      #cq-settings header button { flex: none; min-height: 28px; padding: 4px 6px; border-radius: 6px; }
      #cq-settings .cq-settings-feedback { margin: 0; color: var(--cq-muted); font-size: 11px; overflow-wrap: anywhere; }
      #cq-settings .cq-settings-feedback:empty { display: none; }
      #cq-settings .cq-option-group { overflow: hidden; }
      #cq-settings .cq-option-group + .cq-option-group { border-top: 1px solid var(--cq-border); padding-top: 8px; }
      #cq-settings label { padding: 8px; gap: 8px; }
      #cq-settings :is(input,select) { min-width: 0; accent-color: var(--cq-ink); }
      #cq-settings input:not([type=checkbox]) { width: 58px; padding: 3px; border: 1px solid var(--cq-border); border-radius: 4px; background: var(--cq-solid); }
      #cq-settings .cq-switch { position: relative; display: inline-flex; flex: none; width: 28px; height: 16px; }
      #cq-settings .cq-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
      #cq-settings .cq-switch-track { width: 28px; height: 16px; border-radius: 99px; background: #cfc9ba; pointer-events: none; transition: background 130ms ease; }
      #cq-settings .cq-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 99px; background: #fdfcf8; box-shadow: 0 1px 2px #20252240; transition: transform 130ms ease; }
      #cq-settings .cq-switch input:checked + .cq-switch-track { background: var(--cq-fill); }
      #cq-settings .cq-switch input:checked + .cq-switch-track::after { transform: translateX(12px); }
      #cq-settings .cq-switch input:focus-visible + .cq-switch-track { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #cq-settings .cq-tools { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--cq-border); font-size: 11px; color: var(--cq-muted); }
      #cq-settings .cq-tools :is(button,a) { padding: 5px; border-radius: 6px; text-decoration: none; }
      #cq-settings pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.5 var(--default-font-family, sans-serif); margin: 8px; user-select: text; }
      #cq-settings pre:empty { display: none; }
      #cq-notice { position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 16px; max-width: min(460px, calc(100vw - 40px)); padding: 12px 16px; border: 1px solid ButtonBorder; border-radius: 8px; background: Canvas; color: CanvasText; font: 13px/1.4 var(--default-font-family, sans-serif); }
      #cq-notice button { padding: 6px; color: inherit; background: transparent; border: 1px solid ButtonBorder; border-radius: 4px; }
      #cq-refresh-message { position: fixed; inset: auto; margin: 0; width: max-content; max-width: min(280px, calc(100vw - 24px)); box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cq-border, ButtonBorder); border-radius: 8px; background: var(--cq-solid, Canvas); color: var(--cq-ink, CanvasText); font: 12px/1.5 var(--default-font-family, sans-serif); pointer-events: none; overflow-wrap: anywhere; }
      @media (prefers-reduced-motion: reduce) { #codex-quota-popover, #codex-quota-popover:popover-open, #codex-quota-trigger { transition: none; transform: none; } }
      @media (prefers-reduced-motion: reduce) { #codex-quota-trigger .cq-trigger-plan, #codex-quota-trigger .cq-trigger-copy, #codex-quota-trigger .cq-trigger-graphics, #codex-quota-trigger .cq-trigger-graphics > *, #codex-quota-trigger .cq-trigger-chevron { transition: none !important; } }
      #codex-quota-popover[data-cq-instant], #codex-quota-trigger[data-cq-instant], #codex-quota-trigger[data-cq-instant] .cq-trigger-plan, #codex-quota-trigger[data-cq-instant] .cq-trigger-copy, #codex-quota-trigger[data-cq-instant] .cq-trigger-graphics, #codex-quota-trigger[data-cq-instant] .cq-trigger-graphics > *, #codex-quota-trigger[data-cq-instant] .cq-trigger-chevron { transition: none !important; }
      @media (prefers-reduced-motion: reduce) { #cq-settings .cq-switch-track, #cq-settings .cq-switch-track::after { transition: none; } }
      @media (prefers-contrast: more) { #codex-quota-trigger, #codex-quota-popover { --cq-muted: var(--cq-ink); --cq-border: var(--cq-ink); } }
      @media (prefers-contrast: more), (forced-colors: active) { #codex-quota-trigger, #codex-quota-trigger:is(:hover,[aria-expanded="true"]) { background: var(--cq-solid); border-color: var(--cq-border); backdrop-filter: none; box-shadow: none; } }
      @media (prefers-contrast: more), (forced-colors: active) { #codex-quota-popover { background: var(--cq-solid); border: .8px solid var(--cq-border); backdrop-filter: none; } }
      @media (forced-colors: active) {
        :is(#codex-quota-trigger,#codex-quota-popover) .cq-plan-badge { background: Canvas; color: CanvasText; }
        #codex-quota-trigger, #codex-quota-popover { --cq-solid: Canvas; --cq-ink: CanvasText; --cq-muted: CanvasText; --cq-border: ButtonBorder; --cq-track: GrayText; --cq-fill: Highlight; --cq-warning: CanvasText; box-shadow: none; }
        #cq-settings .cq-switch-track { forced-color-adjust: none; background: Canvas; outline: 1px solid ButtonText; }
        #cq-settings .cq-switch-track::after { background: ButtonText; }
        #cq-settings .cq-switch input:checked + .cq-switch-track { background: Highlight; }
        #cq-settings .cq-switch input:checked + .cq-switch-track::after { background: HighlightText; }
      }
    `;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) { style.id = styleId; document.head.append(style); }
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
    if (!value) return "";
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: preferences.hour12,
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
    if (globalThis.__codexQuotaAwaitingFreshSession && !data) return {busy: false, text: words("暂不可用，等待账户连接", "Unavailable; awaiting account connection")};
    if (needsData) return {busy: true, text: copy.refreshing};
    if (errorCode) {
      const reason = errorCode === "AUTH_REQUIRED" ? words("请重新登录", "Sign in again")
        : errorCode === "RATE_LIMITED" ? words("服务端限流", "Rate limited")
        : errorCode === "REQUEST_TIMEOUT" ? words("刷新超时，可重试", "Refresh timed out; retry") : "";
      const previous = lastSuccessAt ? `${words("上次成功", "Last success")} ${new Date(lastSuccessAt).toLocaleString(navigator.language, {hour12: preferences.hour12})}`
        : words("上次成功时间未知", "Last success time unavailable");
      const retry = cooldownUntil > Date.now() ? ` · ${words("重试时间", "Retry at")} ${formatStatusTime(cooldownUntil)}` : "";
      return {busy: false, text: [words("更新失败", "Update failed"), reason, data ? previous : words("暂不可用", "Unavailable")].filter(Boolean).join(" · ") + retry};
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
    const showingMessage = document.getElementById("cq-refresh-message")?.cqOwner === button;
    const kind = button.dataset.cqKind;
    const data = kind === "api" ? globalThis.__codexQuotaApiPayload : globalThis.__codexQuotaOfficialPayload;
    const error = !busy && quotaErrorCode(kind);
    const completed = !busy && manualRefresh?.kind === kind;
    if (busy || error) clearRefreshFeedback(button);
    if (completed) {
      if (!error) {
        const unchanged = manualRefresh.fingerprint !== null && manualRefresh.fingerprint === quotaUsageFingerprint(data);
        clearRefreshFeedback(button);
        button.dataset.cqRefreshed = unchanged ? "unchanged" : "updated";
        refreshFeedbackTimers.set(button, setTimeout(() => clearRefreshFeedback(button), 2000));
      }
      manualRefresh = null;
    }
    const message = error ? quotaState(kind, data).text : button.dataset.cqRefreshed === "unchanged"
      ? words("额度未变化", "Quota unchanged") : button.dataset.cqRefreshed ? words("已更新", "Updated") : "";
    const label = busy ? copy.refreshing : message || copy.refresh;
    button.disabled = busy;
    button.toggleAttribute("data-cq-error", Boolean(error));
    if (message) button.dataset.cqMessage = message;
    else delete button.dataset.cqMessage;
    button.setAttribute("aria-label", label);
    button.title = message ? "" : label;
    refreshMotion(button);
    if (message && (completed || showingMessage)) { button.dataset.cqShowMessage = "true"; showRefreshMessage(button); }
  };

  const createRefreshButton = (kind) => {
    const button = document.createElement("button");
    const busy = kind === "api"
      ? globalThis.__codexQuotaApiNeedsData === true
      : globalThis.__codexQuotaOfficialNeedsData === true;
    button.type = "button";
    button.className = "cq-refresh";
    button.dataset.cqKind = kind;
    const rotor = document.createElement("span");
    rotor.className = "cq-refresh-icon";
    rotor.setAttribute("aria-hidden", "true");
    rotor.append(toolIcon("refresh", "cq-refresh-symbol"));
    rotor.addEventListener("transitionend", event => {
      if (event.target === rotor && event.propertyName === "opacity" && !button.disabled && Number(getComputedStyle(rotor).opacity) === 0) stopMotion(rotor);
    });
    button.append(toolIcon("refresh", "cq-refresh-idle"), rotor, toolIcon("done", "cq-refresh-done"), toolIcon("warning", "cq-refresh-warning"));
    pressFeedback(button);
    setRefreshButtonState(button, busy);
    for (const event of ["pointerenter", "focus"]) button.addEventListener(event, () => showRefreshMessage(button));
    for (const event of ["pointerleave", "blur"]) button.addEventListener(event, () => hideRefreshMessage(button));
    button.addEventListener("keydown", event => { if (event.key === "Escape") hideRefreshMessage(button); });
    button.addEventListener("click", () => {
      recordQuotaInteraction(kind);
      if (kind === "api") requestApiData(true);
      else requestOfficialData(true);
    });
    const actions = document.createElement("span");
    actions.className = "cq-actions";
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "cq-settings-button";
    settings.setAttribute("aria-label", words("额度卡设置", "Usage card settings"));
    settings.title = settings.getAttribute("aria-label");
    settings.append(toolIcon("settings", "cq-settings-icon"));
    pressFeedback(settings);
    settings.onclick = () => openSettings(settings);
    actions.append(button, settings);
    return actions;
  };

  const setCardAccessibility = (card, busy) => {
    card.setAttribute("role", "region");
    card.removeAttribute("aria-live");
    card.removeAttribute("aria-atomic");
    card.setAttribute("aria-busy", String(busy));
    const error = quotaErrorCode(apiMode() ? "api" : "official");
    const {lastSuccessAt} = quotaTiming();
    card.dataset.cqState = busy ? "refreshing" : error === "AUTH_REQUIRED" ? "auth-required"
      : error === "RATE_LIMITED" ? "cooldown" : error === "REQUEST_TIMEOUT" ? "timeout" : error ? "stale" : lastSuccessAt ? "ready" : "loading";
    card.title = lastSuccessAt ? `${words("最近成功更新", "Last successful update")}: ${formatStatusTime(lastSuccessAt)}` : copy.loading;
  };

  const setContentStatus = (content, text) => {
    const button = content.querySelector(".cq-refresh");
    const error = Boolean(text && quotaErrorCode(button.dataset.cqKind));
    const title = content.querySelector(".cq-title");
    const nextTitle = !text ? words("额度", "Quota") : button.disabled ? copy.refreshing
      : error ? words("更新失败", "Update failed") : words("暂不可用", "Unavailable");
    if (sharedPopover && title.textContent !== nextTitle) finishSharedPopover();
    title.textContent = nextTitle;
    title.toggleAttribute("data-cq-error", error && !button.disabled);
    content.querySelector(".cq-heading").title = text || "";
    let status = content.querySelector(".cq-status");
    if (!text) {
      status?.remove();
      button.removeAttribute("aria-describedby");
      return;
    }
    if (!status) {
      status = document.createElement("div");
      status.className = "cq-status";
      status.id = `cq-status-${apiMode() ? "api" : "official"}`;
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      content.append(status);
    }
    status.textContent = text;
    button.setAttribute("aria-describedby", status.id);
    if (!button.disabled) {
      button.dataset.cqMessage = text;
      button.setAttribute("aria-label", text);
    }
  };

  const showCooldown = (kind, cooldownUntil) => {
    const card = kind === "api"
      ? document.getElementById(apiHostId)
      : document.getElementById(officialHostId);
    const content = card?.querySelector(`.${compactContentClass}`);
    const retryAt = formatStatusTime(cooldownUntil);
    if (!card || !content || !retryAt) return;
    const data = kind === "api" ? globalThis.__codexQuotaApiPayload : globalThis.__codexQuotaOfficialPayload || nativeSnapshot;
    setCardAccessibility(card, false);
    const button = content.querySelector(".cq-refresh");
    setRefreshButtonState(button, false);
    setContentStatus(content, quotaState(kind, data).text || `${copy.cooldownPrefix}${retryAt}${copy.cooldownSuffix}`);
    showRefreshMessage(button);
  };

  const setTimeReset = (row, resetAt, windowSeconds, fallback = copy.resetUnavailable) => {
    const known = Number.isFinite(resetAt) && Number.isFinite(new Date(resetAt * 1000).getTime());
    const date = known ? (windowSeconds === 18000 ? formatOfficialReset(resetAt) : formatResetDate(resetAt)) : resetTime(fallback);
    const dateNode = row.querySelector(".cq-reset-date-value, .cq-week-reset-date");
    if (dateNode && dateNode.textContent !== date) dateNode.textContent = date;
    const ring = row.querySelector(".cq-time-ring");
    const fill = ring.querySelector(".cq-ring-fill");
    // Native text alone does not identify a cycle start; leave its ring unfilled until the helper supplies a timestamp.
    const elapsed = known ? Math.max(0, Math.min(100, (1 - (resetAt - Date.now() / 1000) / windowSeconds) * 100)) : null;
    fill.style.display = elapsed > 0 ? "" : "none";
    if (known) fill.setAttribute("stroke-dasharray", `${elapsed} ${100 - elapsed}`);
    else fill.removeAttribute("stroke-dasharray");
    ring.setAttribute("aria-label", known
      ? `${windowSeconds === 18000 ? words("5小时周期", "5-hour window") : words("本周", "Weekly window")} ${words("已流逝", "elapsed")} ${formatPercent(elapsed)}%`
      : copy.resetUnavailable);
    row.title = `${copy.resetAtPrefix}: ${known ? new Date(resetAt * 1000).toLocaleString(navigator.language, {hour12: preferences.hour12}) : date}`;
  };

  const format = (value) => Number(value).toFixed(2);
  const formatOfficialReset = (value) => {
    const date = new Date(Number(value) * 1000);
    if (!Number.isFinite(date.getTime())) return copy.resetUnavailable;
    return new Intl.DateTimeFormat(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: preferences.hour12,
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

  const windowName = (label) => label === "Weekly" ? copy.weeklySummaryTitle : label;
  const windowSeconds = (label) => label === "5h" ? 18000 : label === "Weekly" ? 604800 : null;
  const validApiPayload = (data) => data && [data.used, data.remaining].every(Number.isFinite) && typeof data.unit === "string";
  const amount = (data) => data.unit === "USD" ? `$${format(data.remaining)}` : `${format(data.remaining)} ${data.unit}`;
  const timeRingMarkup = '<svg class="cq-time-ring" viewBox="0 0 18 18" role="img" focusable="false"><circle class="cq-ring-track" cx="9" cy="9" r="7"/><circle class="cq-ring-fill" cx="9" cy="9" r="7" pathLength="100"/></svg>';

  const setPlanBadge = (badge, label, tier = "") => {
    badge.hidden = !label;
    badge.textContent = label;
    badge.title = label;
    if (tier) badge.dataset.cqTier = tier;
    else delete badge.dataset.cqTier;
  };

  const renderTrigger = (trigger, kind, data, summary) => {
    trigger.querySelector(".cq-trigger-copy").textContent = summary;
    const presentation = kind === "official" ? officialPresentation(data) : null;
    const badge = trigger.querySelector(".cq-trigger-plan");
    const tier = ["pro", "plus"].includes(presentation?.planName) ? presentation.planName : "";
    const planLabel = tier === "pro" ? "Pro" : tier === "plus" ? "Plus" : "";
    setPlanBadge(badge, planLabel, tier);
    const variant = presentation?.kind === "plus-x" ? "plus"
      : presentation?.kind === "weekly" && presentation.planName === "pro" ? "pro" : "";
    const graphics = trigger.querySelector(".cq-trigger-graphics");
    if (graphics.dataset.variant !== variant) {
      stopCardMotion(graphics);
      graphics.replaceChildren();
      graphics.dataset.variant = variant;
      if (variant) {
        graphics.innerHTML = (variant === "plus" ? '<span class="cq-trigger-window-label" data-cq-label="5h">5h</span><span data-cq-window="5h"></span><span class="cq-trigger-separator">·</span>' : '')
          + '<span class="cq-trigger-window-label cq-trigger-week-label"></span><span class="cq-trigger-weekly-bar"><span class="cq-progress-fill"></span></span><span data-cq-window="Weekly"></span><span class="cq-trigger-time">' + timeRingMarkup + '</span>';
        graphics.querySelector(".cq-trigger-week-label").textContent = copy.weeklySummaryTitle;
      }
    }
    if (!variant) { delete trigger.dataset.cqGraphical; return planLabel; }
    const threshold = Math.max(...thresholds(), 0);
    for (const item of presentation.windows) {
      const value = graphics.querySelector(`[data-cq-window="${item.label}"]`);
      if (!value.firstElementChild) value.innerHTML = '<span class="cq-trigger-digits"></span><span class="cq-trigger-percent">%</span>';
      value.firstElementChild.textContent = formatPercent(item.usedPercent);
      value.classList.toggle("cq-warning", 100 - item.usedPercent <= threshold);
    }
    const weeklyBar = graphics.querySelector(".cq-trigger-weekly-bar");
    weeklyBar.classList.toggle("cq-warning", 100 - presentation.weekly.usedPercent <= threshold);
    updateFill(weeklyBar, presentation.weekly.usedPercent);
    setTimeReset(graphics.querySelector(".cq-trigger-time"), presentation.weekly.resetAt, 604800);
    trigger.dataset.cqGraphical = variant;
    // Keep the full text fallback when the actual column cannot fit this language/value combination.
    if (!trigger.hasAttribute("data-cq-collapsed") && graphics.scrollWidth > graphics.clientWidth) delete trigger.dataset.cqGraphical;
    return planLabel;
  };

  const quotaContent = (card, kind, keys) => {
    let content = contentFor(card, "sidebar-v3");
    if (!content) {
      content = document.createElement("div");
      content.className = compactContentClass;
      content.dataset.cqUi = uiRevision;
      content.dataset.cqLayout = "sidebar-v3";
      content.innerHTML = '<div class="cq-heading"><span class="cq-title"></span><span class="cq-plan cq-plan-badge"></span></div><div class="cq-rows"></div>';
      content.querySelector(".cq-title").textContent = words("额度", "Quota");
      content.querySelector(".cq-heading").append(createRefreshButton(kind));
      mountContent(card, content);
    }
    const rows = content.querySelector(".cq-rows");
    const key = JSON.stringify(keys);
    if (rows.dataset.keys !== key) {
      stopCardMotion(rows);
      rows.replaceChildren();
      rows.dataset.keys = key;
      for (const label of keys) {
        const row = document.createElement("div");
        row.className = "cq-quota-row";
        row.innerHTML = '<div class="cq-row-head"><span class="cq-label"></span><span class="cq-value-group"><span class="cq-value"><span class="cq-value-label" hidden></span><span class="cq-value-number"></span></span><span class="cq-low" hidden></span></span></div><div class="cq-row-foot"><div class="cq-rule" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="cq-progress-fill" aria-hidden="true"></span></div><span class="cq-reset"></span></div>';
        row.querySelector(".cq-label").textContent = label;
        rows.append(row);
      }
      if (!keys.length) {
        const empty = document.createElement("div");
        empty.className = "cq-empty";
        empty.textContent = words("暂不可用", "Unavailable");
        rows.append(empty);
      }
    }
    return content;
  };

  const setUsage = (row, value, label) => {
    const progress = row.querySelector(".cq-rule");
    progress.hidden = !Number.isFinite(value);
    if (progress.hidden) return;
    updateFill(progress, value);
    progress.setAttribute("aria-valuenow", formatPercent(value));
    progress.setAttribute("aria-label", label);
    progress.setAttribute("aria-valuetext", `${label} ${formatPercent(value)}%`);
  };

  const applyOfficialTime = (card, data) => {
    const windows = officialPresentation(data)?.windows || data?.windows || [];
    card.querySelectorAll(".cq-quota-row").forEach((row, index) => {
      const item = windows[index];
      if (!item) return;
      const reset = row.querySelector(".cq-reset");
      const seconds = windowSeconds(item.label);
      if (seconds) {
        if (!reset.querySelector("svg")) reset.innerHTML = timeRingMarkup + '<span class="cq-reset-date-value"></span><span class="cq-reset-suffix"></span>';
        reset.querySelector(".cq-reset-suffix").textContent = copy.resetSuffix;
        reset.querySelector(".cq-reset-suffix").hidden = !Number.isFinite(item.resetAt);
        setTimeReset(row, item.resetAt, seconds, item.resetText);
      } else {
        reset.textContent = Number.isFinite(item.resetAt) ? `${formatResetDate(item.resetAt)} ${formatOfficialReset(item.resetAt)}` : copy.resetUnavailable;
        reset.title = copy.resetAtPrefix;
      }
    });
    const triggerTime = document.querySelector("#codex-quota-trigger .cq-trigger-time");
    const weekly = windows.find(item => item.label === "Weekly");
    if (triggerTime && weekly) setTimeReset(triggerTime, weekly.resetAt, 604800);
  };

  const finishRender = (card, content, kind, data, errorCode, summary, low) => {
    const state = quotaState(kind, data, errorCode);
    setCardAccessibility(card, state.busy);
    setRefreshButtonState(content.querySelector(".cq-refresh"), state.busy);
    setContentStatus(content, state.text);
    const trigger = document.getElementById("codex-quota-trigger");
    if (trigger) {
      trigger.toggleAttribute("data-cq-low", low);
      trigger.dataset.cqKind = kind;
      const planLabel = renderTrigger(trigger, kind, data, summary);
      const description = planLabel ? `${planLabel} · ${summary}` : summary;
      trigger.setAttribute("aria-label", description + (low ? words("，额度偏低", ", low quota") : ""));
      trigger.title = description;
    }
    mountShell();
  };

  const renderOfficial = (card, data, errorCode = null) => {
    if (sharedPopover && sharedPopover.signature !== JSON.stringify(data || null)) finishSharedPopover();
    const presentation = officialPresentation(data);
    const windows = presentation?.windows || (data?.native ? data.windows : []);
    const content = quotaContent(card, "official", windows.map(item => windowName(item.label)));
    const focal = presentation?.kind === "plus-x" || (presentation?.kind === "weekly" && presentation.planName === "pro");
    content.toggleAttribute("data-cq-focal", focal);
    const planName = presentation?.planName || "";
    const planLabel = planName === "pro" ? "Pro" : planName === "plus" ? "Plus" : planName;
    setPlanBadge(content.querySelector(".cq-plan"), planLabel, planName);
    let low = false;
    content.querySelectorAll(".cq-quota-row").forEach((row, index) => {
      const item = windows[index];
      row.dataset.cqWindow = item.label;
      row.toggleAttribute("data-cq-secondary", focal && item.label === "5h");
      const primary = focal && item.label === "Weekly";
      const name = row.querySelector(".cq-label");
      if (!name.firstElementChild) name.innerHTML = '<span class="cq-label-name"></span><span class="cq-label-suffix"></span>';
      name.firstElementChild.textContent = windowName(item.label);
      name.lastElementChild.textContent = primary ? ` · ${copy.used}` : "";
      const label = row.querySelector(".cq-value-label");
      label.hidden = primary;
      label.textContent = `${copy.used} `;
      const number = row.querySelector(".cq-value-number");
      if (!number.querySelector(".cq-value-digits")) number.innerHTML = '<span class="cq-value-digits"></span><span class="cq-value-percent">%</span>';
      number.firstElementChild.textContent = formatPercent(item.usedPercent);
      setUsage(row, item.usedPercent, `${windowName(item.label)} ${copy.used}`);
      const remaining = 100 - item.usedPercent;
      const note = row.querySelector(".cq-low");
      note.hidden = remaining > Math.max(...thresholds(), 0);
      note.textContent = `${copy.remainingAvailable} ${formatPercent(remaining)}%`;
      row.toggleAttribute("data-cq-low", !note.hidden);
      low ||= !note.hidden;
    });
    applyOfficialTime(card, data);
    const summary = windows.length ? `${copy.used}  ${data.windows.map(item => `${windowName(item.label)} ${formatPercent(item.usedPercent)}%`).join("  |  ")}` : words("额度  暂不可用", "Quota  Unavailable");
    finishRender(card, content, "official", windows.length ? data : null, errorCode, summary, low);
  };

  const renderApi = (card, data, errorCode = null) => {
    if (sharedPopover && sharedPopover.signature !== JSON.stringify(data || null)) finishSharedPopover();
    const valid = validApiPayload(data);
    const hasTotal = valid && Number.isFinite(data.total) && data.total > 0;
    const remainingPercent = hasTotal ? Math.max(0, Math.min(100, data.remaining / data.total * 100)) : null;
    const content = quotaContent(card, "api", valid ? [copy.apiTitle] : []);
    setPlanBadge(content.querySelector(".cq-plan"), valid && typeof data.planName === "string" ? data.planName.trim() : "");
    const row = content.querySelector(".cq-quota-row");
    if (row) {
      row.querySelector(".cq-value-number").textContent = amount(data);
      setUsage(row, remainingPercent, copy.apiRemainingAria);
      row.querySelector(".cq-reset").textContent = hasTotal ? `${copy.remainingAvailable} ${formatPercent(remainingPercent)}%` : "";
      row.querySelector(".cq-row-foot").hidden = !hasTotal;
      row.toggleAttribute("data-cq-low", hasTotal && remainingPercent <= Math.max(...thresholds(), 0));
    }
    const summary = valid ? `${copy.apiTitle}  ${amount(data)}` : words("额度  暂不可用", "Quota  Unavailable");
    finishRender(card, content, "api", valid ? data : null, errorCode, summary, hasTotal && remainingPercent <= Math.max(...thresholds(), 0));
  };


  const clearQuotaRequest = (kind) => {
    clearTimeout(requestTimers.get(kind));
    requestTimers.delete(kind);
    const prefix = kind === "api" ? "__codexQuotaApi" : "__codexQuotaOfficial";
    delete globalThis[prefix + "RequestId"];
    delete globalThis[prefix + "RequestDeadline"];
  };

  const armRequestTimeout = (kind) => {
    clearTimeout(requestTimers.get(kind));
    requestTimers.delete(kind);
    const prefix = kind === "api" ? "__codexQuotaApi" : "__codexQuotaOfficial";
    const requestId = globalThis[prefix + "RequestId"];
    if (!requestId || disposed) return;
    const remaining = Number(globalThis[prefix + "RequestDeadline"] || 0) - Date.now();
    if (remaining <= 0) {
      clearQuotaRequest(kind);
      const receive = kind === "api" ? globalThis.__codexQuotaUpdateApi : globalThis.__codexQuotaUpdateOfficial;
      receive({errorCode: "REQUEST_TIMEOUT"});
      return;
    }
    requestTimers.set(kind, setTimeout(() => armRequestTimeout(kind), remaining));
  };

  const beginQuotaRequest = (kind, manual) => {
    const prefix = kind === "api" ? "__codexQuotaApi" : "__codexQuotaOfficial";
    const data = globalThis[prefix + "Payload"];
    manualRefresh = manual ? {kind, fingerprint: data ? quotaUsageFingerprint(data) : null} : null;
    const requestId = `${requestEpoch}-${++requestSequence}`;
    globalThis[prefix + "RequestId"] = requestId;
    globalThis[prefix + "RequestDeadline"] = Date.now() + 25000;
    globalThis[prefix + "NeedsData"] = true;
    armRequestTimeout(kind);
    return requestId;
  };

  const acceptQuotaResponse = (kind, requestId) => {
    const pendingId = kind === "api" ? globalThis.__codexQuotaApiRequestId : globalThis.__codexQuotaOfficialRequestId;
    if ((pendingId || requestId != null) && requestId !== pendingId) return false;
    const deadline = kind === "api" ? globalThis.__codexQuotaApiRequestDeadline : globalThis.__codexQuotaOfficialRequestDeadline;
    if (pendingId && Date.now() >= deadline) { armRequestTimeout(kind); return false; }
    clearQuotaRequest(kind);
    return true;
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
    const requestId = beginQuotaRequest("api", manual);
    const card = document.getElementById(apiHostId);
    if (card) renderApi(card, globalThis.__codexQuotaApiPayload || null, quotaErrorCode("api"));
    console.info("__codexQuotaApiRequest__", requestId);
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
    const requestId = beginQuotaRequest("official", manual);
    const card = document.getElementById(officialHostId);
    if (card) renderOfficial(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot, quotaErrorCode("official"));
    console.info("__codexQuotaOfficialRequest__", requestId);
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
    const timedCard = !isApi
      ? document.querySelector(`.${compactContentClass}[data-cq-layout="sidebar-v3"]`)
      : null;
    const ringNextAt = timedCard ? now + (60000 - (now % 60000)) : Infinity;
    const nextAt = Math.min(networkNextAt || Infinity, ringNextAt);
    if (!Number.isFinite(nextAt)) return;
    globalThis.__codexQuotaAutoRefreshTimer = setTimeout(() => {
      globalThis.__codexQuotaAutoRefreshTimer = null;
      if (document.visibilityState !== "visible") return;
      if (!apiMode()) {
        const card = document.getElementById(officialHostId);
        if (card) applyOfficialTime(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot);
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
      for (const kind of ["api", "official"]) armRequestTimeout(kind);
      if (!apiMode()) {
        const card = document.getElementById(officialHostId);
        if (card) applyOfficialTime(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot);
      }
      recordQuotaInteraction(apiMode() ? "api" : "official");
      refreshStaleData();
    };
    globalThis.__codexQuotaAutoRefreshHandler = handler;
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", handler);
    for (const kind of ["api", "official"]) armRequestTimeout(kind);
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

  globalThis.__codexQuotaUpdateOfficial = (data, requestId) => {
    if (!acceptQuotaResponse("official", requestId)) return;
    const awaitingSession = globalThis.__codexQuotaAwaitingFreshSession;
    globalThis.__codexQuotaOfficialNeedsData = false;
    globalThis.__codexQuotaOfficialLoaded = true;
    const now = Date.now();
    if (data && !data.errorCode && !data.error && officialPresentation(data)) {
      globalThis.__codexQuotaAwaitingFreshSession = false;
      void checkAlerts("official", data);
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
    if (!apiMode()) {
      const card = document.getElementById(officialHostId);
      if (card) renderOfficial(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot, quotaErrorCode("official"));
    }
    if (awaitingSession && !globalThis.__codexQuotaAwaitingFreshSession) installLayout();
    if (!apiMode()) scheduleAutoRefresh();
  };

  globalThis.__codexQuotaUpdateApi = (data, requestId) => {
    if (!acceptQuotaResponse("api", requestId)) return;
    const awaitingSession = globalThis.__codexQuotaAwaitingFreshSession;
    globalThis.__codexQuotaApiNeedsData = false;
    globalThis.__codexQuotaApiLoaded = true;
    const now = Date.now();
    if (data && !data.errorCode && !data.error && validApiPayload(data)) {
      globalThis.__codexQuotaAwaitingFreshSession = false;
      void checkAlerts("api", data);
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
      const card = document.getElementById(apiHostId);
      if (card) renderApi(card, globalThis.__codexQuotaApiPayload || null, quotaErrorCode("api"));
    }
    if (awaitingSession && !globalThis.__codexQuotaAwaitingFreshSession) installLayout();
    if (apiMode()) scheduleAutoRefresh();
  };

  // These anchors are from the installed host shell, not the offline prototype.
  const columnSelector = ".sidebar-navigation";
  const railSelector = 'nav[data-app-navigation-rail="true"]';
  let anchors = null;
  let quotaShell = null;
  let nativeSnapshot = null;
  const visible = (node) => {
    if (!(node instanceof Element) || !node.isConnected || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const findAnchors = () => {
    const rail = [...document.querySelectorAll(railSelector)].find(visible);
    if (!rail) return null;
    // The bottom stack owns help and profile. Measure the rounded avatar itself,
    // not its larger menu-button hit area; labels vary with the host language.
    const stack = rail.querySelector(':scope > div.relative.shrink-0.w-9 > div.flex.items-center.flex-col');
    const profiles = [...(stack?.querySelectorAll('.sidebar-item button') || [])].filter(visible);
    if (profiles.length !== 1) return null;
    const avatar = [...profiles[0].querySelectorAll('img.rounded-full, span.rounded-full')].find(visible)
      || [...profiles[0].querySelectorAll('svg')].find(visible);
    if (!avatar) return null;
    const column = [...document.querySelectorAll(columnSelector)].find(visible) || null;
    return {rail, avatar, stack, column};
  };
  const positionPopover = () => {
    const popup = document.getElementById("codex-quota-popover");
    const trigger = document.getElementById("codex-quota-trigger");
    if (sharedPopover || !popup?.matches(":popover-open") || !visible(trigger)) return;
    const rect = trigger.getBoundingClientRect();
    const column = anchors?.column && visible(anchors.column) ? anchors.column.getBoundingClientRect() : null;
    const leftEdge = column ? Math.max(12, column.left + 8) : 12;
    const rightEdge = column ? Math.min(innerWidth - 12, column.right - 8) : innerWidth - 12;
    const width = Math.max(0, Math.min(272, column ? column.width - 16 : 272, rightEdge - leftEdge));
    popup.style.width = width + "px";
    const bottom = column ? Math.min(rect.bottom, column.bottom, innerHeight) : innerHeight - 12;
    popup.style.maxHeight = Math.max(0, bottom - 12) + "px";
    const left = column ? rect.right - width : rect.right + 8;
    popup.style.left = Math.max(leftEdge, Math.min(rightEdge - width, left)) + "px";
    const height = popup.getBoundingClientRect().height;
    const top = column ? bottom - height : rect.bottom - height;
    popup.style.top = Math.max(12, Math.min(bottom - height, top)) + "px";
    const box = popup.getBoundingClientRect();
    const arrow = trigger.querySelector(".cq-trigger-chevron").getBoundingClientRect();
    const collapse = quotaShell.collapse;
    const controlLeft = column ? arrow.left + arrow.width / 2 - box.left - popup.clientLeft - 12 : popup.clientWidth - 30;
    collapse.style.left = controlLeft + "px";
    // Both right-hand tools share the measured entry arrow axis.
    const heading = popup.querySelector(".cq-heading");
    if (heading?.getClientRects().length) popup.style.setProperty("--cq-control-right",
      (heading.getBoundingClientRect().right - box.left - popup.clientLeft - controlLeft - 24) + "px");
    collapse.style.top = (column ? arrow.top + arrow.height / 2 - box.top - popup.clientTop + popup.scrollTop - 12 : popup.scrollTop + popup.clientHeight - 30) + "px";
  };
  const finishSharedPopover = () => {
    const state = sharedPopover;
    if (!state) return;
    sharedPopover = null;
    for (const animation of state.animations || []) { animation.onfinish = null; animation.cancel(); }
    state.layer.remove();
    state.surface.remove();
    for (const {from, to} of state.actors) {
      from.removeAttribute("data-cq-shared-hidden");
      to.removeAttribute("data-cq-shared-hidden");
    }
    for (const name of ["opacity", "clip-path"]) state.content.style.removeProperty(name);
    const {popup, trigger, collapse} = quotaShell;
    popup.removeAttribute("data-cq-morph");
    collapse.firstElementChild.style.removeProperty("transform");
    const open = popup.matches(":popover-open");
    trigger.toggleAttribute("data-cq-replaced", open && !trigger.hasAttribute("data-cq-collapsed"));
    trigger.tabIndex = trigger.getAttribute("aria-expanded") === "true" && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
    collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
    collapse.title = collapse.getAttribute("aria-label");
    if (open) positionPopover();
  };

  const animateSharedPopover = (open) => {
    const {popup, trigger, collapse} = quotaShell;
    if (reducedMotion.matches || document.visibilityState !== "visible" || !visible(trigger)) {
      finishSharedPopover();
      return false;
    }
    if (!sharedPopover) {
      settlePopoverMotion();
      const content = [...popup.children].find(node => !node.hidden && node !== collapse);
      if (!content || popup.scrollHeight > popup.clientHeight + 1) return false;
      const rect = popup.getBoundingClientRect(), origin = trigger.getBoundingClientRect();
      const surfaceStyle = getComputedStyle(popup), triggerStyle = getComputedStyle(trigger);
      const union = {left: Math.min(rect.left, origin.left), top: Math.min(rect.top, origin.top),
        right: Math.max(rect.right, origin.right), bottom: Math.max(rect.bottom, origin.bottom)};
      const surface = document.createElement("div");
      surface.className = "cq-shared-surface";
      surface.setAttribute("aria-hidden", "true");
      Object.assign(surface.style, {left: union.left - rect.left - popup.clientLeft + "px",
        top: union.top - rect.top - popup.clientTop + "px", width: union.right - union.left + "px",
        height: union.bottom - union.top + "px", background: surfaceStyle.background,
        backdropFilter: surfaceStyle.backdropFilter, boxShadow: surfaceStyle.boxShadow,
        border: surfaceStyle.border, borderRadius: surfaceStyle.borderRadius});
      const layer = document.createElement("div");
      layer.className = "cq-shared-layer";
      layer.setAttribute("aria-hidden", "true");
      layer.inert = true;
      const actors = [];
      const pair = (key, from, to) => {
        if (!from || !to || from.textContent !== to.textContent && !["weekly-track", "weekly-ring"].includes(key)) return;
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
        if (!a.width || !a.height || !b.width || !b.height || getComputedStyle(from).display === "none") return;
        const node = document.createElement("div"), clone = from.cloneNode(true);
        node.className = "cq-shared-actor";
        node.dataset.cqSharedKey = key;
        Object.assign(node.style, {width: a.width + "px", height: a.height + "px"});
        const css = getComputedStyle(from);
        for (const name of ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "color", "background", "border", "border-radius", "padding", "box-sizing", "white-space", "transform"]) clone.style.setProperty(name, css.getPropertyValue(name));
        clone.removeAttribute("id");
        clone.removeAttribute("aria-label");
        clone.removeAttribute("role");
        Object.assign(clone.style, {width: "100%", height: "100%", minWidth: "0", maxWidth: "none", margin: "0", display: "block"});
        node.append(clone);
        layer.append(node);
        const fill = key === "weekly-track" ? clone.querySelector(".cq-progress-fill") : null;
        const fillWidth = fill ? from.firstElementChild.getBoundingClientRect().width : 0;
        const minFill = fill ? Math.max(2, parseFloat(getComputedStyle(to.firstElementChild).minWidth) || 2) : 2;
        if (fill) { fill.style.width = fillWidth + "px"; fill.style.minWidth = "0"; fill.style.transformOrigin = "0 0"; }
        actors.push({key, node, clone, from, to, a, b, fill, fillWidth, minFill, fillColor: fill ? getComputedStyle(from.firstElementChild).backgroundColor : "", endFillColor: fill ? getComputedStyle(to.firstElementChild).backgroundColor : "", usedPercent: fill ? Number(to.getAttribute("aria-valuenow")) : 0, color: css.color, endColor: getComputedStyle(to).color});
      };
      // Only actual corresponding data is shared. API/text/rail modes never invent actors.
      if (trigger.hasAttribute("data-cq-graphical") && content.querySelector("[data-cq-focal]")) {
        pair("plan", trigger.querySelector(".cq-trigger-plan"), content.querySelector(".cq-plan"));
        for (const [label, key] of [["Weekly", "weekly"], ["5h", "5h"]]) {
          const row = content.querySelector(`.cq-quota-row[data-cq-window="${label}"]`);
          if (!row) continue;
          const source = trigger.querySelector(`[data-cq-window="${label}"]`);
          pair(`${key}-digits`, source?.querySelector(".cq-trigger-digits"), row.querySelector(".cq-value-digits"));
          pair(`${key}-percent`, source?.querySelector(".cq-trigger-percent"), row.querySelector(".cq-value-percent"));
          pair(`${key}-label`, trigger.querySelector(label === "Weekly" ? ".cq-trigger-week-label" : '[data-cq-label="5h"]'), row.querySelector(".cq-label-name"));
          if (label === "Weekly") {
            pair("weekly-track", trigger.querySelector(".cq-trigger-weekly-bar"), row.querySelector(".cq-rule"));
            pair("weekly-ring", trigger.querySelector(".cq-time-ring"), row.querySelector(".cq-time-ring"));
          }
        }
      }
      const state = {initial: open ? 0 : 1, actors, layer, surface, content, column: anchors.column,
        signature: JSON.stringify((apiMode() ? globalThis.__codexQuotaApiPayload : globalThis.__codexQuotaOfficialPayload || nativeSnapshot) || null)};
      const offsetX = rect.left + popup.clientLeft, offsetY = rect.top + popup.clientTop;
      const startRadius = parseFloat(triggerStyle.borderTopLeftRadius) * origin.height / trigger.offsetHeight;
      const endRadius = parseFloat(surfaceStyle.borderTopLeftRadius);
      const mix = (a, b, p) => a + (b - a) * p;
      const number = actors.find(actor => actor.key === "weekly-digits");
      state.framesAt = value => {
        const frames = new Map();
        const frame = (element, style) => frames.set(element, {...frames.get(element), ...style});
        const p = Math.max(0, Math.min(1, value));
        const edges = {left: mix(origin.left, rect.left, p), top: mix(origin.top, rect.top, 1 - (1 - p) ** 3),
          right: mix(origin.right, rect.right, p), bottom: mix(origin.bottom, rect.bottom, p)};
        const scaleX = (edges.right - edges.left) / (union.right - union.left);
        const scaleY = (edges.bottom - edges.top) / (union.bottom - union.top);
        const radius = mix(startRadius, endRadius, p);
        // Scale the empty material only; text lives in independent shared layers.
        frame(surface, {transform: `translate3d(${edges.left - union.left}px, ${edges.top - union.top}px, 0) scale(${scaleX}, ${scaleY})`,
          borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`});
        for (const actor of actors) {
          const {key, node, clone, a, b, fill, fillWidth, minFill} = actor;
          const numeric = number && (key === "weekly-digits" || key === "weekly-percent");
          // The number lifts over the growing line before settling into its focal position.
          const shift = numeric ? (number.b.left - number.a.left) * (p * p - p) : 0;
          const lift = numeric ? Math.min(12, Math.abs(number.b.top - number.a.top) / 2) * Math.sin(Math.PI * p) : 0;
          const sx = mix(1, b.width / a.width, key === "weekly-track" ? p * p : p);
          const sy = mix(1, b.height / a.height, p);
          frame(node, {transform: `translate3d(${mix(a.left, b.left, p) + shift - offsetX}px, ${mix(a.top, b.top, key === "plan" ? 1 - (1 - p) ** 3 : p) - lift - offsetY}px, 0) scale(${sx}, ${sy})`});
          if (actor.color !== actor.endColor) frame(clone, {color: `color-mix(in srgb, ${actor.color} ${(1 - p) * 100}%, ${actor.endColor})`});
          // Counter-scale the tiny fill to preserve its minimum width during the morph.
          if (fill && actor.fillColor !== actor.endFillColor) frame(fill, {backgroundColor: `color-mix(in srgb, ${actor.fillColor} ${(1 - p) * 100}%, ${actor.endFillColor})`});
          if (fill && fillWidth) frame(fill, {transform: `scaleX(${Math.max(minFill, a.width * sx * actor.usedPercent / 100) / (fillWidth * sx)})`});
        }
        frame(content, {opacity: Math.max(0, Math.min(1, (p - .85) / .15))});
        frame(collapse.firstElementChild, {transform: `rotate(${180 * p}deg)`});
        return frames;
      };
      popup.append(surface, layer);
      for (const {from, to} of actors) { from.setAttribute("data-cq-shared-hidden", ""); to.setAttribute("data-cq-shared-hidden", ""); }
      popup.setAttribute("data-cq-morph", "");
      sharedPopover = state;
    }
    const state = sharedPopover;
    state.target = Number(open);
    trigger.setAttribute("data-cq-replaced", "");
    // Native closed popovers leave hit testing before their visual exit finishes.
    // The invisible original entry must accept the next click/key during that exit.
    trigger.tabIndex = open ? -1 : 0;
    collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
    collapse.title = collapse.getAttribute("aria-label");
    // Native keyframes do not write inline styles every frame. This avoids waking
    // the host's document observers and keeps transforms running on its animation clock.
    const elapsed = Number(state.animations?.[0]?.currentTime || 0);
    const current = state.generator ? state.generator.next(elapsed).value : state.initial;
    const velocity = state.generator ? state.generator.velocity(elapsed) : 0;
    for (const animation of state.animations || []) { animation.onfinish = null; animation.cancel(); }
    const generator = spring({keyframes: [current, Number(open)], velocity,
      stiffness: 420, damping: 42, mass: 1, restDelta: .001, restSpeed: .01});
    const samples = [];
    for (let time = 0; ; time += 1000 / 120) {
      const sample = generator.next(time);
      samples.push({time, value: sample.value});
      if (sample.done && time > 0) break;
    }
    const duration = samples.at(-1).time, tracks = new Map();
    for (const sample of samples) {
      for (const [element, frame] of state.framesAt(sample.value)) {
        if (!tracks.has(element)) tracks.set(element, []);
        tracks.get(element).push({...frame, offset: sample.time / duration});
      }
    }
    const startTime = document.timeline.currentTime;
    state.generator = generator;
    state.animations = [...tracks].flatMap(([element, keyframes]) =>
      Object.keys(keyframes[0]).filter(property => property !== "offset").map(property => {
        // Isolate transform/opacity from paint-only properties so they can be composited.
        const animation = element.animate(keyframes.map(frame => ({[property]: frame[property], offset: frame.offset})),
          {duration, fill: "both", easing: "linear"});
        animation.startTime = startTime;
        return animation;
      }));
    const clock = state.animations[0];
    clock.onfinish = () => { if (sharedPopover === state && state.animations[0] === clock) finishSharedPopover(); };
    return true;
  };

  const settlePopoverMotion = () => {
    if (!quotaShell) return null;
    const {popup} = quotaShell;
    finishSharedPopover();
    stopMotion(popup);
    for (const child of popup.children) stopMotion(child);
    positionPopover();
    return popup.getBoundingClientRect();
  };
  const animatePopover = (open) => {
    const {popup, trigger} = quotaShell;
    if (!trigger.hasAttribute("data-cq-collapsed") && animateSharedPopover(open)) return;
    const rect = settlePopoverMotion();
    if (reducedMotion.matches || document.visibilityState !== "visible" || !visible(trigger)) return;
    const origin = trigger.getBoundingClientRect();
    const height = Math.min(origin.height, rect.height), width = Math.min(origin.width, rect.width);
    const top = trigger.hasAttribute("data-cq-collapsed") ? (rect.height - height) / 2 : rect.height - height;
    const radius = parseFloat(getComputedStyle(trigger).borderTopLeftRadius) * origin.height / trigger.offsetHeight;
    const endRadius = getComputedStyle(popup).borderTopLeftRadius;
    const seed = `inset(${top}px ${rect.width - width}px ${rect.height - top - height}px 0px round ${radius}px)`;
    const full = `inset(0px 0px 0px 0px round ${endRadius})`;
    // The clipped slice, not the full panel, must start at the measured trigger.
    const offset = `translate(${origin.left - rect.left}px, ${origin.top - rect.top - top}px)`;
    const content = [...popup.children].find(child => !child.hidden);
    if (content) move(content, {opacity: open ? [0, 1] : [1, 0], transform: open ? ["translateY(4px)", "translateY(0px)"] : ["translateY(0px)", "translateY(4px)"]},
      {duration: open ? .16 : .08, delay: open ? .08 : 0, ease: [.2, .8, .2, 1]}, () => {
        content.style.removeProperty("opacity"); content.style.removeProperty("transform");
      });
    move(popup, {transform: open ? [offset, "translate(0px, 0px)"] : ["translate(0px, 0px)", offset], clipPath: open ? [seed, full] : [full, seed], opacity: [1, 1]},
      {duration: open ? .24 : .18, ease: [.2, .8, .2, 1]}, () => {
        for (const name of ["transform", "clip-path", "opacity"]) popup.style.removeProperty(name);
      });
  };
  const animatePane = (previous, content) => {
    const {popup} = quotaShell;
    positionPopover();
    if (!previous || !popup.matches(":popover-open") || reducedMotion.matches || document.visibilityState !== "visible") return;
    const next = popup.getBoundingClientRect();
    // Reserve both endpoints once; only the mask and content translation animate.
    popup.style.height = Math.max(previous.height, next.height) + "px";
    positionPopover();
    const box = popup.getBoundingClientRect();
    const radius = getComputedStyle(popup).borderTopLeftRadius;
    content.style.transform = `translateY(${box.height - next.height}px)`;
    move(content, {opacity: [0, 1]}, {duration: .16, ease: [.2, .8, .2, 1]}, () => content.style.removeProperty("opacity"));
    move(popup, {
      transform: [`translate(${previous.left - box.left}px, ${previous.bottom - box.bottom}px)`, `translate(${next.left - box.left}px, ${next.bottom - box.bottom}px)`],
      clipPath: [`inset(${Math.max(0, box.height - previous.height)}px 0px 0px 0px round ${radius})`, `inset(${Math.max(0, box.height - next.height)}px 0px 0px 0px round ${radius})`],
    }, {duration: .16, ease: [.2, .8, .2, 1]}, () => {
      for (const name of ["height", "transform", "clip-path"]) popup.style.removeProperty(name);
      content.style.removeProperty("transform");
      positionPopover();
    });
  };
  const syncSurface = () => {
    const railStyle = getComputedStyle(anchors.rail);
    const dark = railStyle.colorScheme === "dark" || document.documentElement.classList.contains("dark") ||
      (railStyle.colorScheme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    for (const node of [document.getElementById("codex-quota-trigger"), document.getElementById("codex-quota-popover")]) {
      node.toggleAttribute("data-cq-dark", dark);
      node.style.colorScheme = dark ? "dark" : "light";
      // Scoped theme variables may live on the shell rather than :root.
      for (const name of ["--color-surface-elevated-secondary", "--color-token-main-surface-primary", "--color-text", "--color-token-text-primary", "--color-text-secondary", "--color-token-text-secondary", "--color-text-warning-surface", "--color-border", "--color-border-strong", "--color-background-primary-ghost-hover", "--radius-sm", "--default-font-family"]) {
        const value = railStyle.getPropertyValue(name);
        if (value) node.style.setProperty(name, value);
        else node.style.removeProperty(name);
      }
    }
  };
  const ensureShell = () => {
    if (quotaShell) {
      if (!quotaShell.popup.isConnected) document.body.append(quotaShell.popup);
      return quotaShell.trigger;
    }
    let trigger;
    trigger = document.createElement("button");
    trigger.id = "codex-quota-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-controls", "codex-quota-popover");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "dialog");
    const badge = document.createElement("span");
    badge.className = "cq-trigger-plan cq-plan-badge";
    badge.hidden = true;
    badge.setAttribute("aria-hidden", "true");
    trigger.append(icon(Gauge, "cq-trigger-icon"), badge, Object.assign(document.createElement("span"), {className: "cq-trigger-copy"}));
    const graphics = document.createElement("span");
    graphics.className = "cq-trigger-graphics";
    graphics.setAttribute("aria-hidden", "true");
    trigger.append(graphics, icon(ChevronUp, "cq-trigger-chevron"));
    const popup = document.createElement("div");
    popup.id = "codex-quota-popover";
    popup.popover = "auto";
    trigger.popoverTargetElement = popup;
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "cq-collapse-button";
    collapse.setAttribute("aria-label", words("收起额度", "Collapse quota"));
    collapse.title = collapse.getAttribute("aria-label");
    collapse.append(icon(ChevronUp, "cq-collapse-icon"));
    collapse.onclick = () => {
      if (popup.matches(":popover-open")) { popup.hidePopover(); trigger.focus({preventScroll: true}); }
      else popup.showPopover();
    };
    popup.append(collapse);
    popup.addEventListener("scroll", positionPopover);
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", words("额度", "Quota"));
    let escapeClose = false;
    let openingPending = false;
    let focusFromTrigger = false;
    const startOpen = () => {
      if (!openingPending || !popup.matches(":popover-open")) return;
      openingPending = false;
      popup.removeAttribute("data-cq-opening");
      animatePopover(true);
      if (focusFromTrigger) [...popup.querySelectorAll("button:not(:disabled)")].find(button => button.getClientRects().length)?.focus({preventScroll: true});
      focusFromTrigger = false;
    };
    const escape = (event) => {
      if (event.key === "Escape" && popup.matches(":popover-open")) {
        escapeClose = true;
        popup.hidePopover();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // No global keyboard tracking: only the active popover/trigger handles Escape.
    popup.addEventListener("keydown", escape);
    trigger.addEventListener("keydown", escape);
    popup.addEventListener("beforetoggle", event => {
      const open = event.newState === "open";
      focusFromTrigger = open && document.activeElement === trigger;
      for (const node of [trigger, popup]) node.toggleAttribute("data-cq-instant", document.visibilityState !== "visible");
      trigger.setAttribute("aria-expanded", String(open));
      collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
      collapse.title = collapse.getAttribute("aria-label");
      trigger.toggleAttribute("data-cq-replaced", (open || Boolean(sharedPopover)) && !trigger.hasAttribute("data-cq-collapsed"));
      trigger.tabIndex = trigger.getAttribute("aria-expanded") === "true" && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
      if (open) {
        if (!sharedPopover) settlePopoverMotion();
        openingPending = true;
        popup.toggleAttribute("data-cq-opening", !sharedPopover && !reducedMotion.matches && document.visibilityState === "visible");
        // A mid-close reversal returns to the same pane and measured geometry.
        // Only a fresh opening returns from settings to the quota view.
        if (!sharedPopover) {
          document.getElementById("cq-settings")?.remove();
          const host = popup.querySelector(`#${officialHostId}, #${apiHostId}`);
          if (host) host.hidden = false;
        }
        queueMicrotask(startOpen);
      } else {
        openingPending = false;
        popup.removeAttribute("data-cq-opening");
        animatePopover(false);
        hideRefreshMessage();
        popup.querySelectorAll(".cq-refresh-icon").forEach(stopMotion);
        if (escapeClose) trigger.focus({preventScroll: true});
        escapeClose = false;
      }
    });
    popup.addEventListener("toggle", () => {
      // Native keyboard/pointer activation can finish opening after the microtask checkpoint.
      startOpen();
      trigger.setAttribute("aria-expanded", String(popup.matches(":popover-open")));
      positionPopover();
      popup.querySelectorAll(".cq-refresh").forEach(refreshMotion);
    });
    const footer = document.createElement("div");
    footer.id = "codex-quota-footer";
    footer.append(trigger);
    document.body.append(footer, popup);
    quotaShell = {trigger, footer, popup, collapse};
    return trigger;
  };
  const mountShell = () => {
    anchors = findAnchors();
    const trigger = ensureShell();
    const {footer, popup} = quotaShell;
    trigger.hidden = !anchors;
    footer.hidden = !anchors?.column;
    if (!anchors) { if (popup.matches(":popover-open")) popup.hidePopover(); return false; }
    const {column, avatar, rail, stack} = anchors;
    if (sharedPopover && (sharedPopover.column !== column || !column)) finishSharedPopover();
    trigger.toggleAttribute("data-cq-collapsed", !column);
    popup.toggleAttribute("data-cq-inplace", Boolean(column));
    trigger.toggleAttribute("data-cq-replaced", Boolean(column && (popup.matches(":popover-open") || sharedPopover)));
    trigger.tabIndex = trigger.getAttribute("aria-expanded") === "true" && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
    if (column) {
      if (footer.parentElement !== column) column.append(footer);
      if (trigger.parentElement !== footer) footer.append(trigger);
      trigger.style.removeProperty("margin-bottom");
      trigger.style.removeProperty("width");
      const columnRect = column.getBoundingClientRect();
      const avatarRect = avatar.getBoundingClientRect();
      const triggerHeight = trigger.getBoundingClientRect().height;
      const shellScale = triggerHeight / trigger.offsetHeight;
      // footer-bottom + trigger-height = avatar-bottom + avatar-size.
      // Both bottom distances share the measured column bottom as their origin.
      const avatarBottom = columnRect.bottom - avatarRect.bottom;
      const footerBottom = avatarBottom + avatarRect.height - triggerHeight;
      footer.style.paddingBottom = Math.max(0, footerBottom / shellScale) + "px";
      trigger.dataset.cqAlignment = footerBottom >= 0 ? "measured" : "insufficient-space";
    } else {
      if (trigger.parentElement !== stack || stack.firstElementChild !== trigger) stack.prepend(trigger);
      trigger.style.width = Math.min(36, rail.clientWidth) + "px";
      trigger.style.marginBottom = Math.max(0, 14 - (parseFloat(getComputedStyle(stack).rowGap) || 0)) + "px";
    }
    syncSurface();
    positionPopover();
    return true;
  };
  const quotaHost = (kind) => {
    const id = kind === "api" ? apiHostId : officialHostId;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      host.className = kind === "api" ? apiCardClass : compactClass;
      document.getElementById("codex-quota-popover").prepend(host);
    }
    return host;
  };
  const removeOfficialCard = () => { const card = document.getElementById(officialHostId); stopCardMotion(card); card?.remove(); };
  const removeApiCard = () => { const card = document.getElementById(apiHostId); stopCardMotion(card); card?.remove(); };
  const readNativeQuota = () => {
    if (globalThis.__codexQuotaAwaitingFreshSession) return null;
    const card = nativeQuotaCard();
    const progress = card?.querySelectorAll("progress[max='100']");
    if (progress?.length === 1 && resetElement(card)) {
      const used = Number(progress[0].getAttribute("value"));
      if (progress[0].hasAttribute("value") && Number.isFinite(used) && used >= 0 && used <= 100) {
        nativeSnapshot = {native: true, windows: [{label: "Weekly", usedPercent: used, resetAt: null, resetText: resetValue(card)}]};
      }
    }
    return nativeSnapshot;
  };
  const renderLayout = () => {
    ensureStyle();
    mountShell();
    const native = nativeQuotaCard();
    const data = apiMode() ? globalThis.__codexQuotaApiPayload : globalThis.__codexQuotaOfficialPayload || readNativeQuota();
    if (native) native.setAttribute("data-codex-quota-source", "");
    if (apiMode()) {
      removeOfficialCard();
      renderApi(quotaHost("api"), data || null, quotaErrorCode("api"));
      if (!globalThis.__codexQuotaApiLoaded) requestApiData();
    } else {
      removeApiCard();
      renderOfficial(quotaHost("official"), data || null, quotaErrorCode("official"));
      if (!globalThis.__codexQuotaOfficialLoaded) requestOfficialData();
    }
  };
  const installLayout = () => {
    for (const element of [...motions.keys()]) if (!element.isConnected) stopMotion(element);
    for (const button of refreshFeedbackTimers.keys()) if (!button.isConnected) clearRefreshFeedback(button);
    renderLayout();
  };


  globalThis.__codexQuotaResetSession = () => {
    finishMotion();
    manualRefresh = null;
    for (const kind of ["api", "official"]) clearQuotaRequest(kind);
    for (const button of refreshFeedbackTimers.keys()) clearRefreshFeedback(button);
    clearTimeout(globalThis.__codexQuotaAutoRefreshTimer);
    for (const kind of ["Api", "Official"]) {
      for (const suffix of ["Payload", "ErrorCode", "Error", "UsageFingerprint", "LastSuccessAt", "NextAutoAttemptAt", "CooldownUntil", "NeedsData", "Loaded"]) {
        delete globalThis[`__codexQuota${kind}${suffix}`];
      }
    }
    document.getElementById("cq-notice")?.remove();
    nativeSnapshot = null;
    removeOfficialCard(); removeApiCard();
    const popup = document.getElementById("codex-quota-popover");
    if (popup?.matches(":popover-open")) popup.hidePopover();
    document.getElementById("cq-settings")?.remove();
    const trigger = document.getElementById("codex-quota-trigger");
    if (trigger) {
      const empty = words("额度  暂不可用", "Quota  Unavailable");
      trigger.querySelector(".cq-trigger-copy").textContent = empty;
      trigger.setAttribute("aria-label", empty);
      trigger.title = empty;
      trigger.removeAttribute("data-cq-low");
    }
    const native = nativeQuotaCard();
    if (native) native.setAttribute("data-codex-quota-source", "");
    globalThis.__codexQuotaAwaitingFreshSession = true;
    if (document.getElementById("codex-quota-popover")) {
      if (apiMode()) renderApi(quotaHost("api"), null);
      else renderOfficial(quotaHost("official"), null);
    }
  };
  globalThis.__codexQuotaSettingsCleanup?.();
  const settingsChanged = (event) => {
    if (event.key === settingsKey) {
      preferences = readSettings();
      installLayout();
      document.querySelectorAll('#cq-settings input[type="checkbox"]').forEach(input => {
        input.checked = preferences[input.name];
      });
    }
  };
  window.addEventListener("storage", settingsChanged);
  globalThis.__codexQuotaSettingsCleanup = () => window.removeEventListener("storage", settingsChanged);

  const observeOfficialCards = () => {
    globalThis.__codexQuotaOfficialCardObserver?.disconnect();
    globalThis.__codexQuotaGeometryCleanup?.();
    globalThis.__codexQuotaThemeCleanup?.();
    let scheduled = false;
    const observed = new Set();
    const owned = '#codex-quota-footer, #codex-quota-trigger, #codex-quota-popover, #cq-refresh-message, #cq-notice';
    const hostSelector = `${railSelector}, ${columnSelector}, [role='status'].rounded-2xl`;
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (disposed || globalThis.__codexQuotaOfficialCardObserver !== observer) return;
        installLayout();
        const current = new Set(anchors ? [anchors.rail, anchors.stack, anchors.avatar, anchors.column].filter(Boolean) : []);
        for (const node of observed) if (!current.has(node)) { resize.unobserve(node); observed.delete(node); }
        for (const node of current) if (!observed.has(node)) { resize.observe(node); observed.add(node); }
      });
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!target || target.id === styleId || target.closest(owned)) return false;
        // Host extensions can rewrite the same class or stylesheet repeatedly.
        // React only to actual changes; otherwise our render wakes their observers again.
        if (record.type === "attributes" && record.oldValue === target.getAttribute(record.attributeName)) return false;
        if (record.type === "characterData" && record.oldValue === record.target.nodeValue) return false;
        if (record.type === "childList" && record.addedNodes.length === 1 && record.removedNodes.length === 1 &&
            record.addedNodes[0].nodeType === Node.TEXT_NODE && record.removedNodes[0].nodeType === Node.TEXT_NODE &&
            record.addedNodes[0].nodeValue === record.removedNodes[0].nodeValue) return false;
        if (target.closest("head")) return target.matches("style, link") || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && node.matches("style, link"));
        if (record.type === "attributes") {
          if (record.attributeName === "value") return target.matches("progress[max='100']");
          return target.matches(`${hostSelector}, html, body`) || Boolean(anchors && [anchors.rail, anchors.column, anchors.avatar].some(node => node && target.contains(node)));
        }
        const changed = [...record.addedNodes, ...record.removedNodes].filter(node => !(node instanceof Element && node.matches(owned)));
        if (!changed.length) return false;
        if (target.closest(railSelector) || target.closest("[role='status'].rounded-2xl")) return true;
        return changed.some(node => node instanceof Element && (node.matches(hostSelector) || node.querySelector(hostSelector)));
      })) schedule();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["value", "class", "style", "hidden", "inert", "data-theme", "data-color-theme", "data-state"]});
    observer.observe(document.head, {childList: true, subtree: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeOldValue: true, attributeFilter: ["href", "media", "rel", "disabled"]});
    const onGeometryChange = () => { settlePopoverMotion(); schedule(); };
    const resize = new ResizeObserver(onGeometryChange);
    const popupResize = new ResizeObserver(positionPopover);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onStylesheetLoad = event => { if (event.target instanceof HTMLLinkElement && event.target.relList.contains("stylesheet")) schedule(); };
    window.addEventListener("resize", onGeometryChange);
    media.addEventListener("change", schedule);
    document.addEventListener("load", onStylesheetLoad, true);
    globalThis.__codexQuotaGeometryCleanup = () => {
      resize.disconnect(); popupResize.disconnect(); window.removeEventListener("resize", onGeometryChange);
    };
    globalThis.__codexQuotaThemeCleanup = () => {
      media.removeEventListener("change", schedule);
      document.removeEventListener("load", onStylesheetLoad, true);
    };
    globalThis.__codexQuotaOfficialCardObserver = observer;
    schedule();
    requestAnimationFrame(() => { const popup = document.getElementById("codex-quota-popover"); if (!disposed && popup) popupResize.observe(popup); });
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
    } catch (error) { console.error("Codex quota UI installation failed", error); return false; }
  };
  if (install()) {
    if (restoreOpen && visible(document.getElementById("codex-quota-trigger"))) document.getElementById("codex-quota-trigger").click();
    return true;
  }
  let attempts = 0;
  const timer = setInterval(() => {
    if (install() || ++attempts >= 120) clearInterval(timer);
  }, 250);
  return false;
})()
