(function installQuotaUI() {
  if (globalThis.__codexQuotaDomReadyHandler) document.removeEventListener("DOMContentLoaded", globalThis.__codexQuotaDomReadyHandler);
  delete globalThis.__codexQuotaDomReadyHandler;
  if (!document.head || !document.body) {
    globalThis.__codexQuotaDomReadyHandler = installQuotaUI;
    document.addEventListener("DOMContentLoaded", installQuotaUI, {once: true});
    return false;
  }
  const {animate, spring, createElement, ChevronUp} = __codexQuotaLibraries;
  const restoreOpen = Boolean(document.getElementById("codex-quota-popover")?.matches(":popover-open"));
  globalThis.__codexQuotaReleaseCleanup?.();
  globalThis.__codexQuotaMotionCleanup?.();
  globalThis.__codexQuotaNoticeCleanup?.();
  globalThis.__codexQuotaLocalUsageCleanup?.();
  for (const key of Object.keys(globalThis)) if (key.startsWith("__codexQuotaApi") || key === "__codexQuotaUpdateApi") delete globalThis[key];
  document.getElementById("cq-settings")?.remove();
  globalThis.__codexQuotaGeometryCleanup?.();
  for (const id of ["codex-quota-trigger", "codex-quota-footer", "codex-quota-popover", "codex-official-usage-host", "codex-api-usage-host", "cq-inline-announcement"]) document.getElementById(id)?.remove();
  clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
  delete globalThis.__codexQuotaNetworkDiagnosis;
  const uiRevision = String(globalThis.__codexQuotaUiRevision = (globalThis.__codexQuotaUiRevision || 0) + 1);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const motions = new Map();
  let sharedPopover = null;
  let paneMotion = null;
  let localLayout = null;
  const refreshFeedbackTimers = new Map();
  const requestTimers = new Map();
  const requestEpoch = crypto.getRandomValues(new Uint32Array(2)).join("-");
  let requestSequence = 0;
  let manualRefresh = null;
  let alertGeneration = 0;
  let installRetryTimer = null;
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
    const style = getComputedStyle(button.closest(".codex-native-compact-usage"));
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
    // Hidden/detached elements cannot commit an animation's presentation styles.
    if (current.looping || !element.getClientRects().length) current.control.cancel();
    else current.control.stop();
    current.cleanup?.();
  };
  const finalStyle = (element, frames) => {
    for (const [key, value] of Object.entries(frames)) element.style[key] = String(Array.isArray(value) ? value[value.length - 1] : value);
  };
  const move = (element, frames, options = {}, cleanup) => {
    stopMotion(element);
    const instant = reducedMotion.matches || document.visibilityState !== "visible" || !element.getClientRects().length;
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
    finishLocalLayout();
    finishPaneMotion();
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
    usage: [["path", {d: "M2.5 12.5h11M4 9V5.5M8 9V2.5M12 9V7"}]],
    settings: [["path", {d: "M2.5 5h3M8.5 5h5M2.5 11h5M10.5 11h3"}], ["circle", {cx: "7", cy: "5", r: "1.5"}], ["circle", {cx: "9", cy: "11", r: "1.5"}]],
    done: [["path", {d: "m3.5 8.25 3 3 6.25-6.5"}]],
    warning: [["circle", {cx: "8", cy: "8", r: "5.5"}], ["path", {d: "M8 4.75v3.5M8 11.25h.01"}]],
    back: [["path", {d: "m9.75 3.5-4.5 4.5 4.5 4.5"}]],
    close: [["path", {d: "m4 4 8 8M12 4l-8 8"}]],
    calendar: [["rect", {x:"2.5",y:"3.5",width:"11",height:"10",rx:"2"}], ["path", {d:"M5.5 2v3M10.5 2v3M2.5 7h11M5.5 9.5h.01M8 9.5h.01M10.5 9.5h.01"}]],
  };
  const toolIcon = (name, className) => createElement(toolIcons[name], {
    class: className, viewBox: "0 0 16 16", width: "16", height: "16",
    "aria-hidden": "true", focusable: "false", "stroke-width": "1.5",
  });
  const pressFeedback = (button) => {
    // Keep tiny vector strokes at their optical size; tool buttons use :active color.
    if (button.matches(".cq-refresh,.cq-settings-button,.cq-local-usage-button")) return;
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
    else {
      const previous = fill.getBoundingClientRect().width;
      stopMotion(fill);
      finalStyle(fill, {width: target});
      const next = fill.getBoundingClientRect().width;
      if (previous && next && previous !== next) move(fill, {transform: [`scaleX(${previous / next})`, "scaleX(1)"]},
        {duration: .2, ease: [.2, .8, .2, 1]}, () => fill.style.removeProperty("transform"));
    }
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
    suspendInlineAlert();
    finishMotion();
    syncInlineAlert();
    document.querySelectorAll('.cq-actions button, #cq-settings button, #cq-settings a').forEach(button => button.cqRelease?.());
    document.querySelectorAll(".cq-refresh").forEach(refreshMotion);
  };
  reducedMotion.addEventListener("change", onMotionPreference);
  document.addEventListener("visibilitychange", onMotionPreference);
  window.addEventListener("blur", onMotionPreference);
  globalThis.__codexQuotaMotionCleanup = () => {
    disposed = true;
    removeNotice();
    clearInterval(installRetryTimer);
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
        loading: "Loading…",
        stale: "Update failed; showing last result",
        stalePrefix: "Update failed; showing data from ",
        staleSuffix: "",
        cooldownPrefix: "Unavailable; retry after ",
        cooldownSuffix: "",
        refresh: "Refresh usage",
        refreshing: "Refreshing…",
      };


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
  const releaseSeenKey = "codex-usage-card.release-seen.v1";
  const releaseBase = "https://github.com/DrFanghaiz/codex-usage-card/releases/";
  const releaseVersion = value => {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/.test(value)) return null;
    const parts=value.split(".").map(Number);return parts.every(part=>part<=2147483647)?parts:null;
  };
  const newerRelease = (a,b) => {
    const left=releaseVersion(a),right=releaseVersion(b);
    if(!left||!right)return false;
    for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i];
    return false;
  };
  const highestSeenRelease = (...values) => values.reduce((latest,value)=>releaseVersion(value) && (!latest || newerRelease(value,latest)) ? value : latest,null);
  const releaseDate = value => typeof value === "string" && value.length<=40 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  const validRelease = data => data && releaseVersion(data.currentVersion) &&
    (data.latestVersion===null ? data.releaseUrl===null && data.lastSuccessAt===null : releaseVersion(data.latestVersion) &&
      data.releaseUrl===releaseBase+"tag/v"+data.latestVersion && releaseDate(data.lastSuccessAt)) &&
    (data.lastAttemptAt===null || releaseDate(data.lastAttemptAt)) && releaseDate(data.nextCheckAt) &&
    (data.errorCode===null || data.errorCode==="UPDATE_CHECK_FAILED");
  let releaseState = validRelease(globalThis.__codexQuotaReleasePayload) ? globalThis.__codexQuotaReleasePayload : null;
  let releaseSeen = globalThis.__codexQuotaReleaseSeen || null;
  try {releaseSeen=localStorage.getItem(releaseSeenKey) || releaseSeen;} catch {}
  let releaseTimer=null, releaseDeadline=null, releaseRequest=null, releaseSequence=0;
  let releaseDue=0, releaseCheckFailed=Boolean(releaseState?.errorCode);
  const hasNewRelease = () => Boolean(releaseState && newerRelease(releaseState.latestVersion,releaseState.currentVersion));
  const syncReleaseUI = () => {
    const available=hasNewRelease(), panel=document.getElementById("cq-settings"),link=panel?.querySelector(".cq-release-link");
    if(available && link && document.visibilityState==="visible" && !panel.hidden && !panel.inert && panel.getAttribute("aria-hidden")!=="true" && panel.closest(":popover-open") && Number(getComputedStyle(panel).opacity)>.99 && visible(link)) {
      let stored=null;
      try {stored=localStorage.getItem(releaseSeenKey);} catch {}
      releaseSeen=highestSeenRelease(releaseSeen,stored,releaseState.latestVersion);globalThis.__codexQuotaReleaseSeen=releaseSeen;
      try {if(stored!==releaseSeen)localStorage.setItem(releaseSeenKey,releaseSeen);} catch {}
    }
    for(const button of document.querySelectorAll(".cq-settings-button")) {
      const unseen=available && (!releaseVersion(releaseSeen) || newerRelease(releaseState.latestVersion,releaseSeen));
      button.toggleAttribute("data-cq-update",unseen);
      button.title=words("额度卡设置","Usage card settings")+(unseen?words(" · 有新版本"," · Update available"):"");
      button.setAttribute("aria-label",button.title);
    }
    if(link) {
      link.href=available?releaseBase+"tag/v"+releaseState.latestVersion:releaseBase+"latest";
      link.firstElementChild.textContent=available?words(`发现 v${releaseState.latestVersion}`,`New v${releaseState.latestVersion}`)
        :releaseState?words(`当前 v${releaseState.currentVersion}`,`Current v${releaseState.currentVersion}`):words("版本更新","Updates");
      link.lastElementChild.textContent=available?words("查看新版","View release"):words("版本说明","Release notes");
      link.title=releaseCheckFailed?words("暂未确认最新版本；保留上次成功结果。","Latest version not confirmed; previous result retained.")
        :releaseState?.lastSuccessAt && Date.now()<Date.parse(releaseState.nextCheckAt)?available?words("查看更新说明与安装方式","View release notes and installation instructions")
        :newerRelease(releaseState.currentVersion,releaseState.latestVersion)?words("当前版本较新","Current version is newer")
        :words("已是最新稳定版","Latest stable version"):words("暂未确认最新版本","Latest version not confirmed");
      link.setAttribute("aria-label",`${link.firstElementChild.textContent} · ${link.lastElementChild.textContent} · ${link.title}`);
    }
  };
  const scheduleReleaseCheck = () => {
    clearTimeout(releaseTimer);releaseTimer=null;
    if(disposed || document.visibilityState!=="visible" || releaseRequest)return;
    releaseTimer=setTimeout(requestReleaseCheck,Math.min(86400000,Math.max(0,releaseDue-Date.now())));
  };
  const requestReleaseCheck = () => {
    if(disposed || document.visibilityState!=="visible" || releaseRequest)return;
    releaseRequest=`release-${requestEpoch}-${uiRevision}-${++releaseSequence}`;
    const id=releaseRequest;
    releaseDeadline=setTimeout(()=>{
      if(releaseRequest!==id)return;
      releaseRequest=null;releaseCheckFailed=true;releaseDue=Date.now()+86400000;
      if(releaseState) {releaseState={...releaseState,errorCode:"UPDATE_CHECK_FAILED",nextCheckAt:new Date(releaseDue).toISOString()};globalThis.__codexQuotaReleasePayload=releaseState;}
      syncReleaseUI();scheduleReleaseCheck();
    },20000);
    console.info("__codexQuotaReleaseRequest__",id);
  };
  globalThis.__codexQuotaUpdateRelease = (data,id) => {
    if(disposed || id!==releaseRequest || !validRelease(data))return;
    clearTimeout(releaseDeadline);releaseDeadline=null;releaseRequest=null;
    if(data.errorCode && releaseState?.latestVersion && (!data.lastSuccessAt || Date.parse(data.lastSuccessAt)<Date.parse(releaseState.lastSuccessAt)))
      data={...data,latestVersion:releaseState.latestVersion,releaseUrl:releaseState.releaseUrl,lastSuccessAt:releaseState.lastSuccessAt};
    releaseState={...data};globalThis.__codexQuotaReleasePayload=releaseState;
    releaseCheckFailed=Boolean(data.errorCode);releaseDue=Math.max(Date.now()+60000,Date.parse(data.nextCheckAt));
    syncReleaseUI();scheduleReleaseCheck();
  };
  const releaseVisibility = () => {
    if(document.visibilityState!=="visible"){clearTimeout(releaseTimer);releaseTimer=null;return;}
    syncReleaseUI();scheduleReleaseCheck();
  };
  const releaseStorage = event => {if(event.key===releaseSeenKey || event.key===null){releaseSeen=highestSeenRelease(releaseSeen,event.newValue);syncReleaseUI();}};
  document.addEventListener("visibilitychange",releaseVisibility);
  window.addEventListener("storage",releaseStorage);
  globalThis.__codexQuotaReleaseCleanup = () => {
    clearTimeout(releaseTimer);clearTimeout(releaseDeadline);releaseRequest=null;
    document.removeEventListener("visibilitychange",releaseVisibility);window.removeEventListener("storage",releaseStorage);
    delete globalThis.__codexQuotaUpdateRelease;
  };
  const requestErrorReasons = {
    AUTH_REQUIRED: words("请重新登录", "Sign in again"),
    RATE_LIMITED: words("服务端限流", "Rate limited"),
    REQUEST_TIMEOUT: words("刷新超时，可重试", "Refresh timed out; retry"),
    NETWORK_CONFIG_INVALID: words("网络配置无效，请检查设置", "Invalid network configuration; check settings"),
    NETWORK_CONFIG_UNREADABLE: words("无法读取网络配置", "Cannot read network configuration"),
    PROXY_CONNECTION_FAILED: words("无法连接代理，请检查代理服务", "Cannot connect to proxy; check the proxy service"),
    PROXY_AUTH_REQUIRED: words("代理要求身份验证", "Proxy authentication required"),
    CONNECTION_FAILED: words("无法连接额度服务", "Cannot connect to the quota service"),
    DNS_FAILED: words("域名解析失败，请检查网络", "DNS lookup failed; check the network"),
    TLS_FAILED: words("安全连接失败，请检查证书或代理", "Secure connection failed; check certificates or proxy"),
    ACCESS_DENIED: words("额度服务拒绝访问", "Quota service denied access"),
    NETWORK_ERROR: words("网络请求失败，可重试", "Network request failed; retry"),
    INVALID_RESPONSE: words("额度响应无效，可重试", "Invalid quota response; retry"),
  };
  const networkSources = {
    default: words("默认设置", "Default setting"), explicit: words("用户设置", "User setting"),
    "legacy-process-https": words("已迁移：进程 HTTPS 代理", "Migrated: process HTTPS proxy"),
    "legacy-user-https": words("已迁移：用户 HTTPS 代理", "Migrated: user HTTPS proxy"),
    "legacy-process-http": words("已迁移：进程 HTTP 代理", "Migrated: process HTTP proxy"),
    "legacy-user-http": words("已迁移：用户 HTTP 代理", "Migrated: user HTTP proxy"),
    "legacy-file": words("已迁移：旧代理文件", "Migrated: legacy proxy file"),
    "legacy-default": words("已迁移：旧默认代理", "Migrated: legacy default proxy"),
    unknown: words("未知", "Unknown"),
  };
  const sanitizeNetworkDiagnosis = (value) => {
    if (!value || !["system", "proxy", "unknown"].includes(value.NetworkMode) ||
        typeof value.ProxySource !== "string" || !Object.hasOwn(networkSources, value.ProxySource) ||
        (value.LastRequestError != null && (typeof value.LastRequestError !== "string" || !Object.hasOwn(requestErrorReasons, value.LastRequestError))) ||
        typeof value.NetworkCheckedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(value.NetworkCheckedAt) ||
        !Number.isFinite(Date.parse(value.NetworkCheckedAt)) ||
        new Date(value.NetworkCheckedAt).toISOString().slice(0, 19) !== value.NetworkCheckedAt.slice(0, 19)) return null;
    let endpoint = null;
    if (value.NetworkMode === "proxy" && value.ProxyEndpoint !== null) {
      if (typeof value.ProxyEndpoint !== "string") return null;
      try {
        const url = new URL(value.ProxyEndpoint);
        if (url.protocol !== "http:" || !url.hostname) return null;
        endpoint = `${url.protocol}//${url.hostname}:${url.port || "80"}`;
      } catch { return null; }
    }
    return {NetworkMode: value.NetworkMode, ProxySource: value.ProxySource, ProxyEndpoint: endpoint,
      LastRequestError: value.LastRequestError ?? null, NetworkCheckedAt: new Date(value.NetworkCheckedAt).toISOString()};
  };
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
  let inlineAlert = null;
  const inlineQueue = [];
  const pauseInlineTimer = () => {
    if (!inlineAlert) return;
    if (inlineAlert.started != null) inlineAlert.remaining = Math.max(0, inlineAlert.remaining - (performance.now() - inlineAlert.started));
    clearTimeout(inlineAlert.timer);
    inlineAlert.started = null;
  };
  const clearInlineVisual = () => {
    const trigger = document.getElementById("codex-quota-trigger");
    const visual = inlineAlert?.visual;
    for (const animation of visual?.animations || []) { animation.onfinish = null; animation.cancel(); }
    if (inlineAlert) inlineAlert.visual = null;
    trigger?.removeAttribute("data-cq-alert-visible");
    const layer = trigger?.querySelector(".cq-inline-alert");
    if (layer) { layer.hidden = true; layer.querySelector(".cq-inline-source")?.remove(); }
    const surface = trigger?.querySelector(".cq-inline-surface");
    if (surface) { surface.hidden = true; surface.style.removeProperty("opacity"); }
  };
  const captureInlineAlert = () => {
    const visual = inlineAlert?.visual, trigger = document.getElementById("codex-quota-trigger");
    if (!visual || reducedMotion.matches || document.visibilityState !== "visible") return null;
    const layer = trigger.querySelector(".cq-inline-alert"), surface = trigger.querySelector(".cq-inline-surface");
    const clone = layer.cloneNode(true);
    const originals = [layer, ...layer.querySelectorAll("*")], copies = [clone, ...clone.querySelectorAll("*")];
    // Freeze only our small owned layer, including the current WAAPI presentation frame.
    originals.forEach((node, index) => {
      const css = getComputedStyle(node), copy = copies[index];
      for (const name of ["display", "position", "left", "top", "right", "bottom", "width", "height", "box-sizing", "padding", "margin", "gap", "align-items", "justify-content", "flex", "font-family", "font-size", "font-weight", "font-style", "line-height", "font-variant-numeric", "font-feature-settings", "letter-spacing", "white-space", "color", "background", "border", "border-radius", "opacity", "transform", "transform-origin", "overflow", "visibility", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset"]) copy.style.setProperty(name, css.getPropertyValue(name));
      copy.removeAttribute("id");
      copy.style.transition = "none";
      copy.style.pointerEvents = "none";
    });
    const rect = layer.getBoundingClientRect(), css = getComputedStyle(surface);
    Object.assign(clone.style, {left: "0", top: "0", transformOrigin: "0 0", transform: `scale(${rect.width / layer.offsetWidth})`});
    const elapsed = Number(visual.animations?.[0]?.currentTime || 0);
    return {clone, rect, color: css.backgroundColor, border: css.borderColor, opacity: Number(css.opacity),
      progress: visual.generator ? visual.generator.next(elapsed).value : visual.initial,
      velocity: visual.generator ? visual.generator.velocity(elapsed) : 0};
  };
  const suspendInlineAlert = () => { pauseInlineTimer(); clearInlineVisual(); };
  const removeNotice = () => {
    suspendInlineAlert();
    inlineAlert = null;
    inlineQueue.length = 0;
    const trigger = document.getElementById("codex-quota-trigger");
    trigger?.removeAttribute("data-cq-alert");
    if (trigger?.cqBaseLabel) { trigger.setAttribute("aria-label", trigger.cqBaseLabel); trigger.title = trigger.cqBaseTitle; }
    const announcement = document.getElementById("cq-inline-announcement");
    if (announcement) announcement.textContent = "";
  };
  // Also disposes reminders from the previous UI revision during hot injection.
  globalThis.__codexQuotaNoticeCleanup = removeNotice;
  const nextInlineAlert = () => {
    suspendInlineAlert();
    inlineAlert = null;
    const next = inlineQueue.shift();
    if (next) inlineAlert = {item: next, remaining: 6000, started: null, visual: null, leaving: false};
    syncInlineAlert();
  };
  const updateInlineTimer = () => {
    pauseInlineTimer();
    const state = inlineAlert, trigger = document.getElementById("codex-quota-trigger");
    if (!state || state.leaving || !trigger || !visible(trigger) || document.visibilityState !== "visible" ||
        trigger.matches(":hover") || trigger.contains(document.activeElement) ||
        trigger.getAttribute("aria-expanded") === "true" || quotaShell?.popup.matches(":popover-open") || sharedPopover || paneMotion ||
        state.visual?.animations?.length) return;
    state.started = performance.now();
    state.timer = setTimeout(() => {
      pauseInlineTimer();
      if (inlineAlert !== state) return;
      state.leaving = true;
      animateInlineAlert(0);
    }, state.remaining);
  };
  const animateInlineAlert = target => {
    const state = inlineAlert, visual = state?.visual;
    if (!state) return;
    if (!visual) { if (!target) nextInlineAlert(); else updateInlineTimer(); return; }
    pauseInlineTimer();
    visual.target = target;
    const complete = () => {
      if (inlineAlert !== state || state.visual !== visual) return;
      for (const animation of visual.animations || []) { animation.onfinish = null; animation.cancel(); }
      visual.animations = [];
      visual.generator = null;
      visual.initial = target;
      for (const [node, frame] of visual.framesAt(target)) finalStyle(node, frame);
      if (!target) nextInlineAlert(); else updateInlineTimer();
    };
    if (reducedMotion.matches || document.visibilityState !== "visible") complete();
    else playSpring(visual, target, complete);
  };
  const syncInlineAlert = () => {
    const trigger = document.getElementById("codex-quota-trigger");
    if (!trigger || disposed) return;
    const state = inlineAlert;
    if (!state) {
      trigger.removeAttribute("data-cq-alert");
      if (trigger.cqBaseLabel) { trigger.setAttribute("aria-label", trigger.cqBaseLabel); trigger.title = trigger.cqBaseTitle; }
      return;
    }
    const latest = globalThis.__codexQuotaOfficialPayload?.windows?.find(item => item.label === state.item.window);
    // Never continue an old reset cycle's reminder with a new cycle's percentage.
    if (!latest || latest.resetAt !== state.item.resetAt) { nextInlineAlert(); return; }
    state.item.remaining = 100 - latest.usedPercent;
    const item = state.item;
    const label = `${item.label}${words(item.recovered ? "已恢复" : "剩余", item.recovered ? " replenished" : " remaining")}`;
    const text = `${label} ${formatPercent(item.remaining)}%`;
    trigger.dataset.cqAlert = item.recovered ? "recovery" : "low";
    trigger.setAttribute("aria-label", `${trigger.cqBaseLabel || ""} · ${text}`);
    trigger.title = `${trigger.cqBaseTitle || ""} · ${text}`;
    const announcement = document.getElementById("cq-inline-announcement");
    if (announcement && state.announced !== text) { announcement.textContent = text; state.announced = text; }
    if (!visible(trigger) || trigger.getAttribute("aria-expanded") === "true" || quotaShell?.popup.matches(":popover-open") || sharedPopover || paneMotion) {
      suspendInlineAlert(); return;
    }
    const layer = trigger.querySelector(".cq-inline-alert"), surface = trigger.querySelector(".cq-inline-surface");
    if (trigger.hasAttribute("data-cq-collapsed")) {
      clearInlineVisual(); trigger.setAttribute("data-cq-alert-visible", ""); updateInlineTimer(); return;
    }
    const normal = trigger.querySelector(trigger.hasAttribute("data-cq-graphical") ? ":scope > .cq-trigger-graphics" : ":scope > .cq-trigger-copy");
    const box = normal.getBoundingClientRect(), origin = trigger.getBoundingClientRect();
    const scale = origin.width / trigger.offsetWidth || 1;
    const width = box.width / scale;
    const key = [text, box.left, box.top, box.width, box.height, origin.left, origin.top, normal.innerHTML].join("|");
    if (state.visual?.key === key) { updateInlineTimer(); return; }
    const old = state.visual;
    const elapsed = Number(old?.animations?.[0]?.currentTime || 0);
    const initial = old?.generator ? old.generator.next(elapsed).value : old?.initial ?? state.resume?.progress ?? 0;
    const velocity = old?.generator ? old.generator.velocity(elapsed) : state.resume?.velocity || 0;
    state.resume = null;
    pauseInlineTimer(); clearInlineVisual();
    layer.hidden = false; surface.hidden = false;
    layer.style.left = ((box.left - origin.left) / scale - trigger.clientLeft) + "px";
    layer.style.top = ((trigger.clientHeight - 24) / 2) + "px";
    layer.style.width = width + "px";
    layer.querySelector(".cq-inline-label").textContent = label;
    layer.querySelector(".cq-inline-digits").textContent = formatPercent(item.remaining);
    const source = normal.cloneNode(true);
    source.removeAttribute("aria-hidden");
    source.classList.add("cq-inline-source");
    source.style.fontFamily = getComputedStyle(normal).fontFamily;
    layer.prepend(source);
    const incomingLabel = layer.querySelector(".cq-inline-label"), incomingValue = layer.querySelector(".cq-inline-value");
    const fromLabel = source.querySelector(item.window === "Weekly" ? ".cq-trigger-week-label" : ".cq-trigger-window-label");
    const fromValue = [...source.querySelectorAll("[data-cq-window]")].find(node => node.dataset.cqWindow === item.window);
    const labelX = fromLabel ? (fromLabel.getBoundingClientRect().left - box.left) / scale : 0;
    const valueX = fromValue ? (fromValue.getBoundingClientRect().left - box.left) / scale : width - incomingValue.offsetWidth;
    const destinationX = width - incomingValue.offsetWidth;
    const smooth = (p, start, end) => { const n = Math.max(0, Math.min(1, (p - start) / (end - start))); return n * n * (3 - 2 * n); };
    const framesAt = progress => {
      const p = Math.max(0, Math.min(1, progress));
      const frames = new Map([
        [surface, {opacity: smooth(p, .02, .85)}],
        [incomingLabel, {opacity: smooth(p, .15, .85), transform: `translate3d(${labelX * (1-p)}px,0,0)`}],
        [incomingValue, {opacity: smooth(p, .35, 1), transform: `translate3d(${(valueX-destinationX)*(1-p)}px,0,0) scale(${1-.07*(1-p)})`}],
      ]);
      for (const child of source.children.length ? source.children : [source]) {
        let transform = `translate3d(${-4*p}px,0,0)`;
        if (child === fromLabel) transform = `translate3d(${-labelX*p}px,0,0)`;
        if (child === fromValue) transform = `translate3d(${(destinationX-valueX)*p}px,0,0) scale(${1+.07*p})`;
        if (child.classList.contains("cq-trigger-weekly-bar")) transform = `scaleX(${1-p})`;
        frames.set(child, {opacity: 1-smooth(p, 0, .65), transform});
      }
      return frames;
    };
    state.visual = {key, initial, velocity, framesAt, target: state.leaving ? 0 : 1};
    trigger.setAttribute("data-cq-alert-visible", "");
    if (initial === 1 && !state.leaving) {
      for (const [node, frame] of framesAt(1)) finalStyle(node, frame);
      updateInlineTimer();
    } else animateInlineAlert(state.leaving ? 0 : 1);
  };
  const announceQuota = (message, details) => {
    for (const detail of details) {
      for (let i = inlineQueue.length - 1; i >= 0; i--) if (inlineQueue[i].window === detail.window) inlineQueue.splice(i, 1);
      if (inlineAlert?.item.window === detail.window) {
        inlineAlert.item = detail;
        inlineAlert.remaining = 6000;
        inlineAlert.started = null;
        inlineAlert.leaving = false;
        if (inlineAlert.visual) inlineAlert.visual.key = "";
      } else inlineQueue.push(detail);
    }
    if (!inlineAlert) nextInlineAlert(); else syncInlineAlert();
    if (preferences.system && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("Codex Usage Card", {body: message, tag: "codex-usage-card", silent: true}); }
      catch { /* The entry reminder remains available when the host blocks system notifications. */ }
    }
  };

  const checkAlerts = async (kind, data) => {
    if ((!preferences.alerts && !preferences.recovery) || document.visibilityState !== "visible") return;
    const scope = globalThis.__codexQuotaSessionScope;
    const generation = alertGeneration;
    if (!scope) return;
    const windows = data.windows;
    const run = () => {
      if (disposed || generation !== alertGeneration || scope !== globalThis.__codexQuotaSessionScope || document.visibilityState !== "visible") return;
      const key = "codex-usage-card.alerts.v2";
      let stored;
      try { stored = JSON.parse(localStorage.getItem(key) || "{}"); }
      catch { return; } // Shared storage is required to guarantee cross-window deduplication.
      const records = stored?.scope === scope && stored.records ? stored.records : {};
      const messages = [];
      const details = [];
      for (const item of windows || []) {
        if (!Number.isFinite(item.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100) continue;
        const remaining = 100 - item.usedPercent;
        const label = item.label === "Weekly" ? words("本周", "Weekly") : item.label === "5h" ? words("5 小时", "5h") : item.label;
        const detail = {label, window: item.label, remaining, resetAt: item.resetAt};
        const previous = records[item.label];
        const replenished = previous && remaining > previous.remaining &&
          item.resetAt > previous.resetAt;
        const cycleChanged = previous && item.resetAt > previous.resetAt;
        const sent = cycleChanged || replenished ? [] : previous?.sent || [];
        if (preferences.recovery && replenished && previous.remaining <= Math.max(...thresholds(), 0)) {
          messages.push(`${item.label}: ${words("额度已恢复，剩余", "Quota replenished, remaining")} ${formatPercent(remaining)}%`);
          details.push({...detail, recovered: true});
        }
        const crossed = preferences.alerts ? thresholds().filter(limit => remaining <= limit && !sent.includes(limit)) : [];
        if (crossed.length) {
          messages.push(`${item.label}: ${words("额度偏低，剩余", "Low quota, remaining")} ${formatPercent(remaining)}%`);
          details.push(detail);
          sent.push(...crossed);
        }
        records[item.label] = {remaining, resetAt: item.resetAt, sent};
      }
      try { localStorage.setItem(key, JSON.stringify({scope, records})); }
      catch { return; }
      if (messages.length) announceQuota(messages.join(" · "), details);
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
    const network = sanitizeNetworkDiagnosis(data);
    const unknown = words("未记录", "Not recorded");
    const networkLines = [
      [words("网络模式", "Network mode"), network?.NetworkMode === "system" ? words("系统网络", "System network") : network?.NetworkMode === "proxy" ? words("指定代理", "Explicit proxy") : unknown],
      [words("代理来源", "Proxy source"), network ? networkSources[network.ProxySource] : unknown],
      [words("代理地址", "Proxy endpoint"), network?.ProxyEndpoint || (network?.NetworkMode === "system" ? words("由 Windows 决定", "Managed by Windows") : unknown)],
      [words("最近请求错误", "Last request error"), network?.LastRequestError ? requestErrorReasons[network.LastRequestError] : network ? words("无", "None") : unknown],
      [words("网络记录时间", "Network checked at"), network ? new Date(network.NetworkCheckedAt).toLocaleString(navigator.language, {hour12: preferences.hour12}) : unknown],
    ];
    output.textContent = Object.entries(labels).map(([key, label]) => `${label}: ${data[key] === true
      ? words("正常", "OK") : data[key] === false ? words("未就绪", "Not ready") : words("未检查", "Not checked")}`).join("\n") +
      (Number.isInteger(data.WindowCount) ? `\n${words("可见入口／主窗口", "Visible entries / main windows")}: ${data.VisibleCardCount} / ${data.WindowCount}${data.UninspectedWindowCount ? ` (${words("未检查", "not checked")}: ${data.UninspectedWindowCount})` : ""}` : "") +
      (Array.isArray(data.StageCodes) && data.StageCodes.length ? "\n" + data.StageCodes.join(", ") : "") +
      "\n" + networkLines.map(([label, value]) => `${label}: ${value}`).join("\n");
  };

  const openSettings = (opener) => {
    const existing = document.getElementById("cq-settings");
    const popup = document.getElementById("codex-quota-popover");
    const host = opener.closest(`.${compactClass}`);
    if (!popup || !host) return;
    if (existing) { animatePane(host, existing, true); syncReleaseUI(); existing.querySelector("button").focus({preventScroll: true}); return; }
    const panel = document.createElement("div");
    panel.id = "cq-settings";
    panel.innerHTML = `<form method="dialog"><header><h2 id="cq-settings-title"></h2><button value="close" formnovalidate></button></header>
      <div class="cq-options"><div class="cq-option-group cq-display-options" role="group"><h3></h3></div><div class="cq-option-group cq-alert-options" role="group"><h3></h3></div></div>
      <div class="cq-tools"><button type="button" class="cq-doctor"></button><button type="button" class="cq-copy"></button><a class="cq-release-link" target="_blank" rel="noopener noreferrer" href="https://github.com/DrFanghaiz/codex-usage-card/releases/latest"><span></span><span></span></a></div>
      <p class="cq-settings-feedback" role="status"></p>
      <pre id="cq-diagnosis" role="status"></pre></form>`;
    panel.querySelector("h2").textContent = words("额度设置", "Usage settings");
    const back = panel.querySelector("header button");
    back.title = words("返回额度", "Back to quota");
    back.setAttribute("aria-label", back.title);
    back.append(toolIcon("back", "cq-back-icon"));
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
    for (const group of [displayOptions, alertOptions]) group.querySelector("h3").textContent = group.getAttribute("aria-label");
    const rowClass = "cq-setting-row";
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
      let changeSequence = 0;
      input.onchange = async () => {
        const sequence = ++changeSequence;
        if (key === "system" && input.checked) {
          let granted = false;
          try { granted = typeof Notification !== "undefined" && await Notification.requestPermission() === "granted"; }
          catch { /* Keep the switch off when the host rejects permission. */ }
          if (disposed || !panel.isConnected || sequence !== changeSequence || !input.checked) return;
          input.checked = granted;
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
    thresholdRow.classList.add("cq-threshold-row");
    thresholdRow.textContent = words("提醒阈值", "Thresholds");
    const input = document.createElement("input");
    input.name = "thresholds";
    input.setAttribute("aria-label", words("提醒阈值，百分比，逗号分隔", "Alert thresholds, percent, comma-separated"));
    input.value = preferences.thresholds;
    input.placeholder = "20,10";
    input.onchange = () => {
      if (!/^\d{1,2}(\s*,\s*\d{1,2}){0,3}$/.test(input.value) || input.value.split(",").some(value => Number(value) <= 0)) {
        input.setCustomValidity(words("输入 1–99，逗号分隔，最多四档。", "Enter 1–99, comma-separated, up to four thresholds."));
        input.reportValidity(); return;
      }
      input.setCustomValidity(""); preferences.thresholds = input.value; save();
    };
    const field = document.createElement("span");
    field.className = "cq-threshold-field";
    const unit = document.createElement("span");
    unit.textContent = "%";
    unit.setAttribute("aria-hidden", "true");
    field.append(input, unit);
    thresholdRow.append(field); alertOptions.querySelector("label").after(thresholdRow);
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
    panel.querySelector("form").onsubmit = event => {
      event.preventDefault();
      clearTimeout(globalThis.__codexQuotaDiagnosisTimer);
      animatePane(host, panel, false);
      opener.focus({preventScroll: true});
    };
    panel.hidden = true;
    popup.append(panel);
    animatePane(host, panel, true);
    syncReleaseUI();
    back.focus({preventScroll: true});
  };

  // Only the helper's matched public references can produce a weekly estimate.
  const localUsageBaselines = new Map();
  const localApiBaselines = new Map();
  let localReferencePlan="", localReferenceScope=globalThis.__codexQuotaSessionScope;
  try {
    const stored=JSON.parse(localStorage.getItem("codexQuotaReferencePlan") || "null");
    if(stored?.scope===localReferenceScope) localReferencePlan=stored.plan;
  } catch {}
  if (!["pro100","pro200","pro500"].includes(localReferencePlan)) localReferencePlan="";
  // OpenAI Standard short-context list prices, USD / 1M tokens, checked 2026-10-30.
  const localApiPrices = new Map([
    ["gpt-6-astra", [10, 1, 50, 12.5, 25]], ["gpt-6.1-sol", [2, .1, 10, 2.5, 5]],
    ["gpt-6.1-terra", [1, .05, 5, 1.25, 2.5]], ["gpt-6-luna", [.1, .01, .5, .125, .25]],
    ["gpt-6-sol", [2, .2, 10, 2.5, 2.5]], ["gpt-5.6-sol", [4, .4, 20, 5, 10]],
  ]);
  const localIssueLabels = {
    SOURCE_UNCONFIRMED: words("来源未确认", "Unconfirmed source"),
    BASELINE_MISSING: words("历史起点缺失", "Missing history baseline"),
    INVALID_TOKEN_EVENT: words("计数记录损坏", "Invalid token record"),
    INVALID_TIMESTAMP: words("记录日期无效", "Invalid timestamp"),
    FILE_UNREADABLE: words("日志无法读取", "Unreadable log"),
    CACHE_WRITE_UNRECORDED: words("写缓存计数缺失", "Cache-write count missing"),
  };
  const apiEquivalent = row => {
    const rates = localApiPrices.get(row.model);
    if (!rates) return null;
    const write = row.cacheWriteInputTokens || 0;
    const ordinary = row.inputTokens - row.cachedInputTokens - write;
    const common = ordinary * rates[0] + row.cachedInputTokens * rates[1] + row.outputTokens * rates[2];
    return [(common + write * rates[3]) / 1e6, (common + write * rates[4]) / 1e6];
  };
  const localQuotaEstimate = models => {
    // Compare the same models: these two views describe one workload, not additive or independent evidence.
    const covered=models.filter(row=>localUsageBaselines.has(row.model));
    const token=covered.length ? covered.reduce((sum,row)=>sum+row.totalTokens/localUsageBaselines.get(row.model)*100,0) : null;
    const priced=covered.map(row=>({row,cost:apiEquivalent(row)}));
    const api=covered.length && priced.every(({row,cost})=>cost && localApiBaselines.has(row.model))
      ? priced.reduce((sum,{row,cost})=>[sum[0]+cost[0]/localApiBaselines.get(row.model)*100,sum[1]+cost[1]/localApiBaselines.get(row.model)*100],[0,0]) : null;
    return {token,api,range:token===null ? null : api ? [Math.min(token,api[0]),Math.max(token,api[1])] : [token,token],partial:covered.length<models.length};
  };
  const localPercent = value => value>0 && value<.01 ? "<0.01" : new Intl.NumberFormat(navigator.language,{maximumFractionDigits:2}).format(value);
  const localEstimateText = estimate => {
    if(!estimate.range)return "—";
    const [low,high]=estimate.range.map(localPercent);return `≈ ${low}${low===high ? "" : `–${high}`}%`;
  };
  const moneyText = value => value > 0 && value < .01 ? "<$0.01" : new Intl.NumberFormat(navigator.language,{style:"currency",currency:"USD",currencyDisplay:"narrowSymbol"}).format(value);
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  let localUsageTimer, localUsageRequestId, localUsageSequence = 0;
  const localPageNames = ["overview","daily","details","recent"];
  const numberText = value => new Intl.NumberFormat(navigator.language, {maximumFractionDigits: 0}).format(value);
  const compactLocalTokens = value => {
    const units = isChinese ? [[1e8,"亿"],[1e4,"万"]] : [[1e9,"B"],[1e6,"M"],[1e3,"K"]];
    const [scale,unit] = units.find(([scale]) => value >= scale) || [1,""];
    const number = new Intl.NumberFormat(navigator.language,{maximumFractionDigits:scale === 1 ? 0 : value / scale >= 100 ? 1 : 2}).format(value / scale);
    return {number,unit,text:number + unit};
  };
  const localDayIndex = key => Date.parse(`${key}T00:00:00Z`) / 86400000;
  const localDayKey = index => new Date(index * 86400000).toISOString().slice(0,10);
  const validLocalModels = models => Array.isArray(models) && models.every(row => typeof row?.model === "string" &&
    ["inputTokens","cachedInputTokens","outputTokens","totalTokens"].every(key => Number.isSafeInteger(row[key]) && row[key] >= 0) &&
    (row.cacheWriteInputTokens == null || Number.isSafeInteger(row.cacheWriteInputTokens) && row.cacheWriteInputTokens >= 0) &&
    (row.cacheWriteKnown == null || typeof row.cacheWriteKnown === "boolean") &&
    row.cachedInputTokens + (row.cacheWriteInputTokens || 0) <= row.inputTokens && row.totalTokens === row.inputTokens + row.outputTokens);
  const validLocalIssues = issues => issues == null || Array.isArray(issues) && issues.every(issue => Object.hasOwn(localIssueLabels,issue?.code) &&
    Number.isSafeInteger(issue.count) && issue.count >= 0 && typeof issue.affectsTotals === "boolean" && typeof issue.dateUnknown === "boolean" &&
    (issue.missingTokens === null || Number.isSafeInteger(issue.missingTokens) && issue.missingTokens >= 0));
  const validLocalDaily = data => {
    if (data.daily == null) return true;
    if (!Array.isArray(data.daily)) return false;
    const dates = new Set();
    for (const day of data.daily) {
      if (typeof day?.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(day.date) || !Number.isFinite(localDayIndex(day.date)) ||
          localDayKey(localDayIndex(day.date)) !== day.date || day.date < data.start || day.date > data.end || dates.has(day.date) ||
          !validLocalModels(day.models) || !Number.isSafeInteger(day.eventCount) || day.eventCount < 0 || typeof day.partial !== "boolean" || !validLocalIssues(day.issues)) return false;
      dates.add(day.date);
    }
    const aggregate = models => {
      const totals = new Map();
      for (const row of models) {
        const sum = totals.get(row.model) || [0,0,0,0];
        [row.inputTokens,row.cachedInputTokens,row.cacheWriteInputTokens || 0,row.outputTokens].forEach((value,index)=>sum[index]+=value);
        totals.set(row.model,sum);
      }
      return totals;
    };
    const expected=aggregate(data.models), actual=aggregate(data.daily.flatMap(day=>day.models));
    return actual.size === expected.size && [...expected].every(([model,values])=>actual.has(model) &&
      values.every((value,index)=>Number.isSafeInteger(value) && value === actual.get(model)[index])) &&
      data.daily.reduce((sum,day)=>sum+day.eventCount,0) === data.eventCount;
  };
  const stopLocalMotions = root => {
    for (const node of [...motions.keys()]) if (node === root || root.contains(node)) stopMotion(node);
  };
  const finishLocalLayout = () => {
    const state = localLayout;
    if (!state) return;
    localLayout = null;
    for (const animation of state.animations) {animation.onfinish = null;animation.cancel();}
    for (const [node, styles] of state.styles) for (const [name,value,priority] of styles) {
      if (value) node.style.setProperty(name,value,priority);else node.style.removeProperty(name);
    }
    for (const ghost of state.ghosts) ghost.remove();
    state.popup.scrollTop=state.scroll;
    positionPopover();
  };
  const localBlocks = panel => [...panel.children].flatMap(node => node.matches(".cq-local-result") && !node.querySelector(".cq-local-page") ? [...node.children] : [node]);
  const localDetailBodies = panel => {
    for (const details of panel.querySelectorAll("details")) {
      if (details.querySelector(":scope > .cq-local-detail-body")) continue;
      const body = document.createElement("div");body.className = "cq-local-detail-body";
      body.append(...[...details.children].filter(node => node.tagName !== "SUMMARY"));details.append(body);
    }
  };
  const animateLocalLayout = (panel, change) => {
    if (paneMotion?.panel === panel) {
      if (paneMotion.open && paneMotion.settings) animatePane(paneMotion.host,panel,true,true,()=>{change();localDetailBodies(panel);});
      else {change();localDetailBodies(panel);}
      return;
    }
    const popup = panel.parentElement;
    const enabled = !panel.hidden && !paneMotion && !sharedPopover && popup?.matches(":popover-open") && !reducedMotion.matches && document.visibilityState === "visible";
    const oldBox = popup.getBoundingClientRect(), clip = parseFloat(getComputedStyle(popup).clipPath.match(/^inset\(([-\d.]+)px/)?.[1] || 0);
    const before = new Map(localBlocks(panel).filter(node=>node.getClientRects().length && !node.hasAttribute("data-cq-quiet"))
      .map(node => [node.tagName + node.className, node.getBoundingClientRect()]));
    const arrows = new Map([...panel.querySelectorAll(".cq-local-detail-arrow")].map(node => [node,getComputedStyle(node).transform]));
    const bodies = [...panel.querySelectorAll("details[open] > .cq-local-detail-body"),...(localLayout?.ghosts || [])].map(visible => ({node:visible.cqSource || visible,box:visible.getBoundingClientRect(),copy:visible.cloneNode(true),opacity:getComputedStyle(visible).opacity,clipPath:getComputedStyle(visible).clipPath}));
    finishLocalLayout();
    change();localDetailBodies(panel);positionPopover();
    if (!enabled || !panel.isConnected) return;
    const end = popup.getBoundingClientRect(), targets = new Map(localBlocks(panel).map(node=>[node,node.getBoundingClientRect()]));
    const panelBox = panel.getBoundingClientRect(), css = getComputedStyle(popup);
    const state = {popup,scroll:popup.scrollTop,animations:[],ghosts:[],styles:[[popup,["height","overflow"]],[panel,["position","left","top","width"]]]
      .map(([node,names])=>[node,names.map(name=>[name,node.style.getPropertyValue(name),node.style.getPropertyPriority(name)])])};
    popup.style.height = Math.max(oldBox.height - clip,end.height) + "px";
    popup.style.overflow = "clip";positionPopover();
    const box = popup.getBoundingClientRect(), from = oldBox.top + clip - box.top, to = end.top - box.top;
    Object.assign(panel.style,{position:"absolute",left:css.paddingLeft,top:(parseFloat(css.paddingTop)-state.scroll)+"px",width:panelBox.width+"px"});
    localLayout = state;
    const run = (node,frames) => {
      const animation = node.animate(frames,{duration:220,easing:"cubic-bezier(.2,.8,.2,1)",fill:"both"});
      state.animations.push(animation);return animation;
    };
    const clock = run(popup,{clipPath:[`inset(${Math.max(0,from)}px 0 0 round ${css.borderTopLeftRadius})`,`inset(${Math.max(0,to)}px 0 0 round ${css.borderTopLeftRadius})`]});
    run(panel,{transform:[`translateY(${from}px)`,`translateY(${to}px)`]});
    for (const [node, target] of targets) {
      const old = before.get(node.tagName + node.className);
      if (old) run(node,{transform:[`translateY(${old.top-target.top-oldBox.top-clip+end.top}px)`,"translateY(0px)"]});
      else if (target.height && !node.hasAttribute("data-cq-quiet")) run(node,{opacity:[.4,1],clipPath:["inset(0 0 100% 0)","inset(0)"]});
    }
    for (const [arrow, transform] of arrows) if (arrow.isConnected) run(arrow,{transform:[transform,getComputedStyle(arrow).transform]});
    for (const {node,box:bodyBox,copy,opacity,clipPath} of bodies) if (node.isConnected && !node.parentElement.open && !node.closest(".cq-local-page")?.inert) {
      copy.setAttribute("aria-hidden","true");copy.inert=true;copy.cqSource=node;
      copy.className=node.className+" "+node.parentElement.className;
      Object.assign(copy.style,{position:"absolute",left:(bodyBox.left-panelBox.left)+"px",top:(bodyBox.top-oldBox.top-clip-parseFloat(css.paddingTop)+state.scroll)+"px",width:bodyBox.width+"px",pointerEvents:"none",margin:"0",padding:"0",border:"0"});
      panel.append(copy);state.ghosts.push(copy);
      run(copy,{opacity:[opacity,0],clipPath:[clipPath==="none"?"inset(0)":clipPath,"inset(0 0 100% 0)"]});
    }
    for (const body of panel.querySelectorAll("details[open] > .cq-local-detail-body")) if (!body.closest(".cq-local-page")?.inert) {
      const prior = bodies.find(item=>item.node===body);
      if (!prior || Number(prior.opacity)<1 || prior.clipPath!=="none") run(body,{opacity:[prior?.opacity || .4,1],clipPath:[prior?.clipPath || "inset(0 0 100% 0)","inset(0)"]});
    }
    clock.onfinish = () => {if (localLayout===state) finishLocalLayout();};
  };
  const localBarSnapshots = root => [...root.querySelectorAll(".cq-local-day")].map(day=>{
    const bar = day.querySelector('.cq-local-day-bar[aria-hidden="true"]') || day.querySelector(".cq-local-day-bar");
    return {height:bar.getBoundingClientRect().height,opacity:Number(getComputedStyle(bar).opacity),copy:bar.cloneNode(true)};
  });
  const selectLocalPage = (panel, index, focus = false) => {
    const pages = [...panel.querySelectorAll(".cq-local-page")], previous = Number(panel.dataset.page || 0);
    index = Math.max(0, Math.min(pages.length - 1, index));
    panel.cqCloseCalendar?.(false);
    if (index === previous) {
      if (focus) panel.querySelector(`[data-local-page="${index}"]`)?.focus({preventScroll:true});
      return;
    }
    animateLocalLayout(panel, () => {
    panel.dataset.page = String(index);
    panel.querySelector(".cq-interval-controls").hidden=index!==3;
    panel.querySelector(".cq-interval-controls").cqPositionPresets?.();
    panel.querySelectorAll("[data-local-page]").forEach((button,i) => {
      button.setAttribute("aria-selected", String(i === index));button.tabIndex = i === index ? 0 : -1;
      if (focus && i === index) button.focus({preventScroll:true});
    });
    pages.forEach((page,i) => {
      const wasHidden = page.hidden, style = getComputedStyle(page);
      const from = wasHidden ? `translateX(${(index > previous ? 1 : -1) * 20}px)` : style.transform;
      const opacity = wasHidden ? 0 : Number(style.opacity);
      stopMotion(page);
      page.inert = i !== index;page.setAttribute("aria-hidden",String(i !== index));
      if (i === index) {
        page.hidden = false;
        page.querySelector(".cq-local-daily")?.cqRenderPage?.();
        move(page,{transform:[from === "none" ? "translateX(0px)" : from,"translateX(0px)"],opacity:[opacity,1]},
          {type:"spring",stiffness:420,damping:42,mass:1},()=>{page.style.removeProperty("transform");page.style.removeProperty("opacity");});
      } else if (!wasHidden) {
        move(page,{transform:[from === "none" ? "translateX(0px)" : from,`translateX(${(index > previous ? -1 : 1) * 20}px)`],opacity:[opacity,0]},
          {duration:.18},()=>{page.hidden=true;page.style.removeProperty("transform");page.style.removeProperty("opacity");});
      }
    });
    });
    if(index===3 && !panel.cqIntervalRequested){panel.cqIntervalRequested=true;panel.cqAppliedInterval=panel.cqGetInterval(true);requestLocalUsage(panel);}
  };
  const arrangeLocalPages = panel => {
    const result = panel.querySelector(".cq-local-result"), reference = panel.querySelector(".cq-local-reference");
    const nodes = [...result.children];
    const pages = localPageNames.map((name,index)=>{
      const page=document.createElement("section");page.className="cq-local-page";page.id=`cq-local-page-${name}`;
      page.tabIndex=0;
      page.setAttribute("role","tabpanel");page.setAttribute("aria-labelledby",`cq-local-tab-${name}`);
      page.hidden=index!==Number(panel.dataset.page || 0);page.inert=page.hidden;page.setAttribute("aria-hidden",String(page.hidden));
      result.append(page);return page;
    });
    for (const node of nodes) pages[node.matches(".cq-local-recent") ? 3 : node.matches(".cq-local-daily") ? 1 : node.matches(".cq-local-models,.cq-local-issues,.cq-local-excluded,.cq-local-estimate-methods") ? 2 : 0].append(node);
    if (reference) pages[2].append(reference);
    if (!pages[1].children.length) {
      const note=document.createElement("p");note.className="cq-local-page-note";note.textContent=words("读取完成后可查看每日用量", "Daily usage appears after reading logs");pages[1].append(note);
    }
    if (!pages[3].children.length) {
      const note=document.createElement("p");note.className="cq-local-page-note";note.textContent=words("选择起止时间，查看区间消耗", "Choose start and end times to measure usage");pages[3].append(note);
    }
  };
  const showLocalPlaceholder = (panel, loading) => {
    for (const [index,page] of [...panel.querySelectorAll(".cq-local-page")].entries()) {
    page.querySelector(".cq-local-placeholder,.cq-local-page-note")?.remove();
    if (index === 2 && loading) continue;
    const placeholder=document.createElement("div");
    placeholder.className="cq-local-placeholder";
    if (loading) {
      const skeleton=document.createElement("div");skeleton.className="cq-local-skeleton";skeleton.setAttribute("aria-hidden","true");
      skeleton.innerHTML='<i></i><i></i><i></i><i></i><i></i>';placeholder.append(skeleton);
    }
    const label=document.createElement("p");label.textContent=loading ? words("正在读取本机日志…", "Reading local logs…") : words("本机用量暂不可用", "Local usage unavailable");placeholder.append(label);
    if (!loading) {
      const retry=document.createElement("button");retry.type="button";retry.textContent=words("重试", "Retry");retry.onclick=()=>requestLocalUsage(panel);placeholder.append(retry);
    }
    page.prepend(placeholder);
    }
  };
  const renderLocalDaily = (data, result, addText, previousBars = []) => {
    const chart = addText("section", "cq-local-daily", "", result);
    chart.setAttribute("aria-label", words("每日 token 用量", "Daily token usage"));
    const heading = addText("div", "cq-local-chart-heading", "", chart);
    const dayDate=addText("span", "cq-local-day-date", "", heading);
    if (!data.daily) {addText("p", "cq-local-day-note", words("每日明细暂不可用，请更新 Helper。", "Daily details unavailable; update the helper."),chart);return;}
    const navigation = addText("span", "cq-local-chart-nav", "", heading);
    const previous = addText("button", "", "", navigation), next = addText("button", "", "", navigation);
    previous.type = next.type = "button";
    previous.append(toolIcon("back", ""));next.append(toolIcon("back", "cq-local-chart-next"));
    previous.setAttribute("aria-label", words("查看更早日期", "Earlier dates"));next.setAttribute("aria-label",words("查看更晚日期", "Later dates"));
    const detail = addText("div", "cq-local-day-detail", "", chart);
    detail.setAttribute("role","status");detail.setAttribute("aria-atomic","true");
    const pageLabel = addText("div", "cq-local-chart-scale", "", chart);
    const plot = addText("div", "cq-local-chart-plot", "", chart);
    plot.setAttribute("role","group");plot.setAttribute("aria-label",words("按日期选择用量", "Select a usage date"));
    const selection = addText("span", "cq-local-day-selection", "", plot);selection.setAttribute("aria-hidden","true");
    const legend = addText("div", "cq-local-chart-legend", "", chart);
    for (const [kind,label] of [["input",words("非缓存", "Uncached")],["cache",words("缓存", "Cached")],["output",words("输出", "Output")]]) {
      const item = addText("span", "", label, legend);item.dataset.kind = kind;
    }
    const first = localDayIndex(data.start), last = localDayIndex(data.end);
    let count = 5, chartWidth = 0;
    const days = new Map(data.daily.map(day=>[day.date,day]));
    let pageEnd = last, selected = data.end, shown = false;
    const dailyTotal = day => day?.models.reduce((sum,row)=>sum+row.totalTokens,0) || 0;
    const positionSelection = animated => {
      const button = plot.querySelector(`button[data-date="${selected}"]`), box = button.getBoundingClientRect(), area = plot.getBoundingClientRect();
      const current = getComputedStyle(selection).transform;
      stopMotion(selection);selection.style.width = Math.min(24,box.width)+"px";
      const target = `translateX(${box.left-area.left+(box.width-Math.min(24,box.width))/2}px)`;
      if (animated) move(selection,{transform:[current,target]},{duration:.2,ease:[.2,.8,.2,1]});else selection.style.transform=target;
    };
    const showDay = date => {
      const changed = shown && selected !== date;
      selected = date;
      for (const button of plot.querySelectorAll("button")) button.setAttribute("aria-pressed",String(button.dataset.date === date));
      positionSelection(shown);
      const day = days.get(date), tokens = dailyTotal(day);
      detail.replaceChildren();
      dayDate.textContent=`${date.replaceAll("-",".")}${day?.partial ? words(" · 统计不完整", " · Incomplete") : ""}`;
      const values = addText("div", "cq-local-day-values", "", detail);
      const token = addText("div", "", "", values), api = addText("div", "", "", values);
      const tokenValue = addText("strong", "", day?.eventCount ? compactLocalTokens(tokens).text : day?.partial ? words("暂不可用", "Unavailable") : words("无记录", "No records"), token);
      tokenValue.title = day?.eventCount ? `${numberText(tokens)} token` : tokenValue.textContent;
      addText("span", "", words("当日 token", "Daily tokens"), token);
      const priced = (day?.models || []).map(apiEquivalent).filter(Boolean);
      const cost = priced.reduce((sum,row)=>[sum[0]+row[0],sum[1]+row[1]],[0,0]);
      const costValue = addText("strong", "", priced.length ? `${moneyText(cost[0])}${cost[1] > cost[0] ? ` – ${moneyText(cost[1])}` : ""}`
        : day?.eventCount ? words("未计价", "Not priced") : "—", api);
      costValue.title = priced.length ? `${costValue.textContent} USD · ${words("估算", "Estimate")}` : costValue.textContent;
      const apiLabel = addText("span", "", words("API 等值", "API equivalent"), api);
      const unpriced = (day?.models || []).filter(row=>!localApiPrices.has(row.model)).reduce((sum,row)=>sum+row.totalTokens,0);
      if (unpriced || day?.models.some(row=>row.cacheWriteKnown === false)) {
        apiLabel.className="cq-local-partial";
        apiLabel.textContent = words("部分 API 等值", "Partial API eq.");
        costValue.title += words("；仅覆盖已有价格与计数", "; recorded counts with known prices only");
      }
      if (changed) {
        const css = getComputedStyle(detail), transform = css.transform, opacity = css.opacity;
        move(detail,{opacity:[Number(opacity)<1?Number(opacity):.6,1],transform:[transform!=="none"?transform:"translateY(3px)","translateY(0px)"]},
          {duration:.14,ease:[.2,.8,.2,1]},()=>{detail.style.removeProperty("opacity");detail.style.removeProperty("transform");});
      }
      shown = true;
    };
    const renderPage = () => {
      count = chart.clientWidth - 16 >= 168 ? 7 : 5;
      chartWidth = chart.getBoundingClientRect().width;
      const pageStart = Math.max(first,pageEnd-count+1);
      previous.disabled = pageStart <= first;next.disabled = pageEnd >= last;
      const oldBars = plot.querySelector(".cq-local-day") ? localBarSnapshots(plot) : previousBars;
      stopLocalMotions(plot);
      plot.replaceChildren(selection);
      const visible = [];
      for (let index=pageStart;index<=pageEnd;index++) visible.push(localDayKey(index));
      const maximum = Math.max(0,...visible.map(date=>dailyTotal(days.get(date))));
      pageLabel.textContent = pageStart===pageEnd ? "" : `${localDayKey(pageStart).slice(5).replace("-",".")} – ${localDayKey(pageEnd).slice(5).replace("-",".")}`;
      pageLabel.toggleAttribute("data-single",pageStart===pageEnd);
      addText("span", "", maximum ? `${compactLocalTokens(maximum).text} token` : words("无已知计数", "No recorded counts"), pageLabel);
      plot.style.gridTemplateColumns = `repeat(${visible.length},minmax(0,1fr))`;
      const bars=[];
      for (const [slot,date] of visible.entries()) {
        const day = days.get(date), total = dailyTotal(day), button = addText("button", "cq-local-day", "", plot);
        button.type = "button";button.dataset.date = date;
        button.setAttribute("aria-label",`${date} · ${day?.eventCount ? `${numberText(total)} token` : day?.partial ? words("暂不可用", "Unavailable") : words("无记录", "No records")}${day?.partial ? words(" · 统计不完整", " · Incomplete") : ""}`);
        button.title = button.getAttribute("aria-label");
        if (day?.eventCount) button.title += "\n" + [[words("非缓存输入", "Uncached input"),day.models.reduce((sum,row)=>sum+row.inputTokens-row.cachedInputTokens,0)],
          [words("缓存输入", "Cached input"),day.models.reduce((sum,row)=>sum+row.cachedInputTokens,0)],[words("输出", "Output"),day.models.reduce((sum,row)=>sum+row.outputTokens,0)]]
          .map(([label,value])=>`${label}: ${numberText(value)}`).join(" · ");
        button.setAttribute("aria-label",button.title.replaceAll("\n"," · "));
        const rail = addText("span", "cq-local-day-rail", "", button);
        const bar = addText("span", "cq-local-day-bar", "", rail);
        bar.style.height = (maximum && total ? total/maximum*100 : 0) + "%";
        if (total) for (const [kind,value] of [["input",day.models.reduce((sum,row)=>sum+row.inputTokens-row.cachedInputTokens,0)],
          ["cache",day.models.reduce((sum,row)=>sum+row.cachedInputTokens,0)],["output",day.models.reduce((sum,row)=>sum+row.outputTokens,0)]]) {
          const segment = addText("i", "", "", bar);segment.dataset.kind=kind;segment.style.flexGrow=String(value);segment.hidden=!value;
        }
        bars.push({bar,rail,slot});
        if (day?.partial) {button.dataset.partial="";addText("span","cq-local-day-incomplete","?",rail);}
        addText("span", "cq-local-day-label", date.slice(8), button);
        button.onclick = () => showDay(date);
        button.onkeydown = event => {
          let index = visible.indexOf(date);
          if (event.key === "ArrowLeft") index--;else if(event.key === "ArrowRight") index++;
          else if(event.key === "Home") index=0;else if(event.key === "End") index=visible.length-1;else return;
          event.preventDefault();index=Math.max(0,Math.min(visible.length-1,index));showDay(visible[index]);plot.querySelectorAll("button")[index].focus({preventScroll:true});
        };
      }
      // Measure only after every column exists, avoiding a layout flush per bar.
      const heights=bars.map(({bar})=>bar.getBoundingClientRect().height);
      bars.forEach(({bar,slot},index)=>{
        if (!heights[index]) return;
        bar.style.transform=`scaleY(${(oldBars[slot]?.height || 0)/heights[index]})`;bar.style.opacity=String(oldBars[slot]?.opacity ?? 1);
      });
      for (const [index,{bar,rail,slot}] of bars.entries()) {
        const height=heights[index];
        if (height) {
          // Seed the presentation synchronously so another click before RAF can retarget it.
          move(bar,{transform:[bar.style.transform,"scaleY(1)"],opacity:[Number(bar.style.opacity),1]},
            {duration:.24,ease:[.2,.8,.2,1]},()=>{bar.style.removeProperty("transform");bar.style.removeProperty("opacity");});
        }
        else if (oldBars[slot]?.height && !reducedMotion.matches) {
          const ghost = oldBars[slot].copy;ghost.setAttribute("aria-hidden","true");
          Object.assign(ghost.style,{position:"absolute",bottom:"0",height:oldBars[slot].height+"px",transform:"none",opacity:String(oldBars[slot].opacity)});
          rail.append(ghost);
          move(ghost,{transform:["scaleY(1)","scaleY(0)"],opacity:[oldBars[slot].opacity,0]},{duration:.2,ease:[.2,.8,.2,1]},()=>ghost.remove());
        }
      }
      showDay(selected >= visible[0] && selected <= visible.at(-1) ? selected : visible.at(-1));
    };
    previous.onclick = () => {pageEnd=Math.max(first,pageEnd-count);renderPage();};
    next.onclick = () => {pageEnd=Math.min(last,pageEnd+count);renderPage();};
    chart.cqRenderPage=renderPage;
    chart.cqResize=()=>{
      const width=chart.getBoundingClientRect().width;
      if (!width || width===chartWidth) return;
      const nextCount=chart.clientWidth-16>=168 ? 7 : 5;
      if (nextCount!==count) {
        const focusedDate=plot.contains(document.activeElement) ? document.activeElement.dataset.date : null;
        const selectedDay=localDayIndex(selected);
        if (selectedDay<pageEnd-nextCount+1) pageEnd=Math.min(last,selectedDay+nextCount-1);
        renderPage();
        if (focusedDate) (plot.querySelector(`button[data-date="${focusedDate}"]`) || plot.querySelector('[aria-pressed="true"]')).focus({preventScroll:true});
      } else chartWidth=width;
      positionSelection(false);
    };
    renderPage();
  };
  const closeLocalUsage = () => {
    const panel = document.getElementById("cq-local-usage");
    if (!panel) return;
    stopLocalMotions(panel);
    animatePane(panel.cqHost, panel, false);
    panel.cqOpener?.focus({preventScroll:true});
  };
  globalThis.__codexQuotaLocalUsageCleanup = () => {
    clearTimeout(localUsageTimer);
    finishLocalLayout();
    const panel = document.getElementById("cq-local-usage");
    if (panel) {stopLocalMotions(panel);panel.remove();}
    delete globalThis.__codexQuotaLocalUsageRange;
    delete globalThis.__codexQuotaUpdateLocalUsage;
  };
  const requestLocalUsage = (panel, change = () => {}, applyDates = false) => {
    const form = panel.querySelector("form");
    if(applyDates) {
    const today = localDate(new Date());
    for (const input of form.querySelectorAll("input")) {
      input.max = today;
      const value = input.value, index = localDayIndex(value);
      input.setCustomValidity(/^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(index) && localDayKey(index)===value && value>=input.min && value<=today
        ? "" : words("请输入 2022-01-01 至今天之间的有效日期", "Enter a valid date between 2022-01-01 and today"));
    }
    const start = form.elements.start.value, end = form.elements.end.value;
    if (!form.elements.end.validationMessage && start > end) form.elements.end.setCustomValidity(words("结束日期不能早于开始日期", "End date must not precede start date"));
    if (!form.reportValidity()) return;
    panel.cqDateRange={start,end};
    }
    const {start,end}=panel.cqDateRange;
    const interval=panel.cqAppliedInterval;
    if(panel.dataset.page==="3" && !interval)return;
    panel.cqCloseCalendar?.(false);
    clearTimeout(localUsageTimer);
    localUsageRequestId = `local-${uiRevision}-${++localUsageSequence}-${Date.now()}`;
    if(localReferenceScope!==globalThis.__codexQuotaSessionScope) {localReferencePlan="";localReferenceScope=globalThis.__codexQuotaSessionScope;}
    globalThis.__codexQuotaLocalUsageRange = {start, end, ...interval, ...(localReferencePlan ? {referencePlan:localReferencePlan} : {})};
    const result = panel.querySelector(".cq-local-result");
    animateLocalLayout(panel,()=>{
      change();
      if (!result.dataset.loaded) showLocalPlaceholder(panel,true);
      result.setAttribute("aria-busy", "true");
      const query=panel.querySelector('.cq-interval-actions button');query.textContent=words("读取中…", "Reading…");query.setAttribute("aria-busy","true");
      panel.querySelector(".cq-local-estimate-tag").textContent=words("读取中", "Reading");
      panel.querySelector(".cq-local-status").setAttribute("data-cq-quiet", "");
      panel.querySelector(".cq-local-status").textContent = words("正在读取本机日志…", "Reading local logs…");
    });
    const id = localUsageRequestId;
    localUsageTimer = setTimeout(() => globalThis.__codexQuotaUpdateLocalUsage?.({errorCode: "TIMEOUT"}, id), 60000);
    console.info("__codexQuotaLocalUsageRequest__", id);
  };
  globalThis.__codexQuotaUpdateLocalUsage = (data, requestId) => {
    const panel = document.getElementById("cq-local-usage");
    if (!panel || requestId !== localUsageRequestId) return;
    clearTimeout(localUsageTimer);
    const result = panel.querySelector(".cq-local-result"), status = panel.querySelector(".cq-local-status");
    result.setAttribute("aria-busy", "false");
    const query=panel.querySelector('.cq-interval-actions button');query.textContent=words("查询", "Apply");query.setAttribute("aria-busy","false");
    const range = globalThis.__codexQuotaLocalUsageRange;
    const valid = data && !data.errorCode && data.start === range?.start && data.end === range?.end &&
      (!range.intervalStart || data.interval?.start===range.intervalStart && data.interval?.end===range.intervalEnd) &&
      validLocalModels(data.models) &&
      Number.isSafeInteger(data.eventCount) && data.eventCount >= 0 && typeof data.partial === "boolean" &&
      validLocalIssues(data.issues) && validLocalDaily(data);
    if (!valid) {
      animateLocalLayout(panel,()=>{
      if (!result.dataset.loaded) showLocalPlaceholder(panel,false);
      panel.querySelector(".cq-local-estimate-tag").textContent=words("估算", "Estimate");
      status.removeAttribute("data-cq-quiet");
      status.setAttribute("data-cq-warning", "");
      status.textContent = result.dataset.loaded ? words("读取失败；保留上次结果，请重试。", "Read failed; previous results retained. Retry.")
        : words("暂不可用，请重试；旧版 Helper 可能需要更新。", "Unavailable; retry or update the helper.");
      });
      return;
    }
    const previousBars = localBarSnapshots(result);
    stopLocalMotions(result);
    result.dataset.loaded = "true";
    animateLocalLayout(panel, () => {
    panel.querySelector(".cq-local-estimate-tag").textContent=words("估算", "Estimate");
    const reference=panel.querySelector(".cq-local-reference");
    {
      const source=data.reference || {models:null,status:"unavailable",selectedPlan:null,planName:""}, entries=source.models && typeof source.models==="object" && !Array.isArray(source.models) ? Object.entries(source.models) : [];
      const apiEntries=source.apiModels && typeof source.apiModels==='object' && !Array.isArray(source.apiModels) ? Object.entries(source.apiModels) : [];
      const validReference=["ok","stale","snapshot","needs_plan","unavailable"].includes(source.status) &&
        [null,"plus","pro100","pro200","pro500"].includes(source.selectedPlan) &&
        (source.selectedPlan!=='pro200' || source.referenceKind==='legacy20x') &&
        entries.length<=16 && entries.every(([model,tokens])=>/^gpt-[a-z0-9.-]{1,60}$/.test(model) && Number.isFinite(tokens) && tokens>0 && tokens<1e14) &&
        (source.apiModels==null || typeof source.apiModels==='object' && !Array.isArray(source.apiModels) && apiEntries.length<=16 && apiEntries.every(([model,usd])=>entries.some(([name])=>name===model) && Number.isFinite(usd) && usd>0 && usd<1e9)) &&
        (source.referenceCheckFailed==null || typeof source.referenceCheckFailed==='boolean');
      localUsageBaselines.clear();localApiBaselines.clear();
      if(validReference) {for(const [model,tokens] of entries) localUsageBaselines.set(model,tokens);for(const [model,usd] of apiEntries)localApiBaselines.set(model,usd);}
      const weekly=reference.querySelector(".cq-local-weekly-reference"), table=weekly.querySelector("dl");
      table.replaceChildren();
      table.hidden=!localUsageBaselines.size;
      const label={plus:"Plus",pro100:"Pro $100",pro200:"Pro 20x",pro500:"Pro $500"}[source.selectedPlan];
      weekly.querySelector("strong").textContent=label ? words(`${label} 周参考`, `${label} weekly reference`) : words("周额度参考", "Weekly reference");
      weekly.querySelector('.cq-local-reference-heading > span').textContent=localApiBaselines.size ? 'Token / USD' : 'token';
      for(const [model,tokens] of localUsageBaselines) {
        const row=document.createElement("div"),name=document.createElement("dt"),value=document.createElement("dd");
        name.textContent=model.replace(/^gpt-/,"GPT-");value.textContent=compactLocalTokens(tokens).text;value.title=`${numberText(tokens)} token`;row.append(name,value);
        if(localApiBaselines.has(model)){row.dataset.dual="";const api=document.createElement('dd');api.textContent=moneyText(localApiBaselines.get(model));api.title=words('每周 API 等值参考','Weekly API-equivalent reference');row.append(api);}
        table.append(row);
      }
      const select=weekly.querySelector("select");select.hidden=source.planName!=="pro";select.value=localReferencePlan;
      const note=weekly.querySelector(".cq-local-reference-status");
      note.textContent=!validReference || source.status==="unavailable" ? words("参考数据暂不可用，次日自动重试。", "References unavailable; retries tomorrow.")
        :source.status==="needs_plan" ? ""
        :source.status==="snapshot" ? source.referenceCheckFailed ? words("旧档检查失败；使用参考快照", "Legacy check failed; using snapshot") : words("旧 20x 参考快照", "Legacy 20x reference snapshot")
        :source.status==="stale" ? words("更新失败；保留上次成功基准。", "Update failed; previous references retained.") : "";
      note.toggleAttribute('data-cq-warning',source.status==='stale' || Boolean(source.referenceCheckFailed));
      const link=weekly.querySelector("a");link.href="https://modeldial.com/subscriptions?period=week&view=insights";
      link.textContent=releaseDate(source.lastSuccessAt) ? `ModelDial · ${words("已核对", "Checked")} ${new Date(source.lastSuccessAt).toLocaleDateString()}`
        : /^\d{4}-\d\d-\d\d$/.test(source.referenceSnapshotAt || '') ? `ModelDial · ${source.referenceSnapshotAt}` : "ModelDial";
      link.title=[releaseDate(source.lastSuccessAt) ? words(`上次成功 ${new Date(source.lastSuccessAt).toLocaleString()}`, `Last success ${new Date(source.lastSuccessAt).toLocaleString()}`) : "",releaseDate(source.nextCheckAt) ? words(`下次检查 ${new Date(source.nextCheckAt).toLocaleString()}`, `Next check ${new Date(source.nextCheckAt).toLocaleString()}`) : ""].filter(Boolean).join(" · ");
    }
    panel.append(reference);
    result.replaceChildren();
    const totals = data.models.reduce((sum,row) => ({input:sum.input+row.inputTokens, cache:sum.cache+row.cachedInputTokens,
      output:sum.output+row.outputTokens, tokens:sum.tokens+row.totalTokens}), {input:0,cache:0,output:0,tokens:0});
    const covered = data.models.filter(row => localUsageBaselines.has(row.model));
    const excluded = data.models.filter(row => !localUsageBaselines.has(row.model)).reduce((sum,row) => sum+row.totalTokens,0);
    const estimate=localQuotaEstimate(data.models);
    const priced = data.models.map(row => ({row,cost:apiEquivalent(row)})).filter(item => item.cost);
    const cost = priced.reduce((sum,item)=>[sum[0]+item.cost[0],sum[1]+item.cost[1]],[0,0]);
    const unpriced = data.models.filter(row => !localApiPrices.has(row.model)).reduce((sum,row)=>sum+row.totalTokens,0);
    const issues = data.issues || [];
    const addText = (tag, className, text, parent = result) => {const node = document.createElement(tag); node.className = className; node.textContent = text; parent.append(node); return node;};
    const recent = addText("section", "cq-local-recent", "");
    recent.setAttribute("aria-label",words("区间周额度消耗", "Interval weekly consumption"));
    if(data.reference?.status==="needs_plan" && data.reference.planName==="pro") {
      const choosePlan=addText("button","cq-local-recent-plan",words("选择 Pro 套餐", "Choose Pro tier"),recent);
      choosePlan.type="button";choosePlan.onclick=()=>{reference.open=true;selectLocalPage(panel,2,true);reference.querySelector("select").focus({preventScroll:true});};
    }
    const row = data.interval;
    const historyErrors={HISTORY_WRITE_FAILED:words("历史保存失败", "History could not be saved"),HISTORY_READ_FAILED:words("历史暂不可读", "History could not be read"),HISTORY_CORRUPT:words("历史记录损坏", "History contains damaged records")};
    const validInterval = row && releaseDate(row.start) && releaseDate(row.end) && Date.parse(row.start)<Date.parse(row.end) &&
      validLocalModels(row.local?.models) && Number.isSafeInteger(row.local.eventCount) && row.local.eventCount>=0 &&
      typeof row.local.partial==="boolean" && row.account &&
      ["ok","partial","insufficient_history","reset","counter_decreased","unavailable"].includes(row.account.status) &&
      (row.account.hasGaps==null || typeof row.account.hasGaps==="boolean") &&
      (row.account.historyError==null || Object.hasOwn(historyErrors,row.account.historyError)) &&
      (row.account.usedPercent===null || Number.isFinite(row.account.usedPercent) && row.account.usedPercent>=0 && row.account.usedPercent<=100) &&
      (!["ok","partial"].includes(row.account.status) || row.account.usedPercent!==null && releaseDate(row.account.sampledStartAt) && releaseDate(row.account.sampledEndAt) &&
        Date.parse(row.account.sampledStartAt)>=Date.parse(row.start) && Date.parse(row.account.sampledStartAt)<Date.parse(row.account.sampledEndAt) && Date.parse(row.account.sampledEndAt)<=Date.parse(row.end));
    const intervalEstimate=validInterval ? localQuotaEstimate(row.local.models) : null;
    if (validInterval) {
      const stamp=value=>new Date(value).toLocaleString(navigator.language,{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
      const intervalStamp=(start,end)=>new Date(start).toDateString()===new Date(end).toDateString()
        ? `${stamp(start)} — ${new Date(end).toLocaleTimeString(navigator.language,{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}`
        : `${stamp(start)} — ${stamp(end)}`;
      const intervalLabel=addText("p","cq-local-interval-range",intervalStamp(row.start,row.end),recent);
      intervalLabel.title=`${row.start} — ${row.end}`;
      const values=addText("div","cq-local-recent-row","",recent);
      const local=addText("div","cq-local-recent-local","",values);
      addText("span","cq-local-metric-label",words("本机估算", "Local estimate"),local);
      const known=row.local.models.filter(model=>localUsageBaselines.has(model.model));
      const percent=value=>`${value>0 && value<.01 ? "<0.01" : new Intl.NumberFormat(navigator.language,{maximumFractionDigits:2}).format(value)}%`;
      const intervalValue=addText("strong","",localEstimateText(intervalEstimate),local);
      intervalValue.toggleAttribute('data-range',Boolean(intervalEstimate.api));
      intervalValue.title=intervalEstimate.token===null ? '' : `Token ${percent(intervalEstimate.token)}${intervalEstimate.api ? ` · API ${percent(intervalEstimate.api[0])}–${percent(intervalEstimate.api[1])}` : words(' · 仅 Token 口径',' · Token only')}`;
      if(intervalEstimate.token!==null && !intervalEstimate.api)addText('small','',words('仅 Token 口径','Token only'),local);
      const tokens=row.local.models.reduce((sum,model)=>sum+model.totalTokens,0);
      addText("small","",row.local.eventCount ? `${compactLocalTokens(tokens).text} token` : words("无记录", "No records"),local).title=`${numberText(tokens)} token`;
      if(row.local.partial || known.length>0 && known.length<row.local.models.length) addText("small","cq-local-partial",words("部分统计", "Partial coverage"),local);
      const priced=row.local.models.map(apiEquivalent).filter(Boolean);
      if(priced.length) {
        const cost=priced.reduce((sum,value)=>[sum[0]+value[0],sum[1]+value[1]],[0,0]);
        addText("small","",`API ≈ ${moneyText(cost[0])}${cost[1]>cost[0] ? ` – ${moneyText(cost[1])}` : ""}`,local);
        if(priced.length<row.local.models.length || row.local.models.some(model=>model.cacheWriteKnown===false))
          addText("small","cq-interval-api-coverage",words("API 未完整计价", "Partial API pricing"),local).title=words("无价格模型未计价；写缓存计数缺失时等值可能偏低。", "Unpriced models excluded; missing cache-write counts may understate API equivalent.");
      } else if(row.local.models.length) addText("small","",words("API 未计价", "API not priced"),local);
      const account=addText("div","cq-local-recent-account","",values);
      addText("span","cq-local-metric-label",words("账号实测", "Account measured"),account);
      const actual=["ok","partial"].includes(row.account.status) && row.account.usedPercent!==null;
      addText("strong","",actual ? percent(row.account.usedPercent) : "—",account);
      const states={insufficient_history:words("该区间采样不足", "Insufficient interval samples"),reset:words("跨重置周期", "Reset crossed"),counter_decreased:words("额度已校正", "Counter corrected"),unavailable:historyErrors[row.account.historyError] || words("历史暂不可用", "History unavailable")};
      addText("small","",actual ? row.account.status==="partial" ? words("仅覆盖部分区间", "Partial interval only") : words("完整覆盖", "Full coverage") : states[row.account.status],account);
      if(actual && row.account.status==="partial") {
        const coverage=addText("p","cq-interval-coverage","",recent);
        addText("span","",words("实测覆盖", "Measured coverage"),coverage);
        addText("span","cq-interval-sampled-range",intervalStamp(row.account.sampledStartAt,row.account.sampledEndAt),coverage);
      }
      account.toggleAttribute("data-cq-warning",row.account.status!=="ok" || Boolean(row.account.hasGaps || row.account.historyError));
      if(row.account.hasGaps)addText("small","cq-history-gap",words("采样存在间断", "Sampling has gaps"),account);
      if(row.account.historyError && row.account.status!=="unavailable")addText("small","cq-history-feedback",historyErrors[row.account.historyError],account);
      if(releaseDate(row.account.coverageStartAt) && releaseDate(row.account.coverageEndAt))
        account.title=words(`已有账号采样：${stamp(row.account.coverageStartAt)} — ${stamp(row.account.coverageEndAt)}`,`Available account samples: ${stamp(row.account.coverageStartAt)} — ${stamp(row.account.coverageEndAt)}`);
    } else addText("p","cq-local-page-note",words("区间结果暂不可用，请查询有效起止时间。", "Interval unavailable; apply valid start and end times."),recent);
    const dateLabel = addText("p", "cq-local-range-label", data.start === data.end ? data.start.replaceAll("-", ".")
      : `${data.start.replaceAll("-", ".")} – ${(data.start.slice(0,4) === data.end.slice(0,4) ? data.end.slice(5) : data.end).replaceAll("-", ".")}`);
    dateLabel.title = `${data.start} — ${data.end}`;
    const highlights = addText("div", "cq-local-highlights", "");
    const estimateRow = addText("div", "cq-local-estimate", "", highlights);
    addText("span", "cq-local-metric-label", words("周额度估算", "Weekly estimate"), estimateRow);
    const estimated = addText("strong", "", "", estimateRow);
    if (estimate.range) {
      addText("span", "cq-local-value-unit", "≈ ", estimated);
      const [low,high]=estimate.range.map(localPercent);
      const lower=addText('span','cq-local-estimate-bound','',estimated);
      addText("span", "cq-local-value-number",low,lower);
      let upper=lower;
      if(low!==high){estimated.dataset.range="";addText("span","cq-local-value-unit","–",lower);upper=addText('span','cq-local-estimate-bound','',estimated);addText("span","cq-local-value-number",high,upper);}
      addText("span", "cq-local-value-unit", "%", upper);
      if(!estimate.api)addText('small','cq-local-estimate-note',words('仅 Token 口径','Token only'),estimateRow);
      else if(estimate.partial)addText('small','cq-local-estimate-note cq-local-partial',words('部分模型','Partial models'),estimateRow);
    } else {estimated.textContent = words("未折算", "Not estimated");estimated.dataset.unavailable = "";}
    const methods=addText('details','cq-local-estimate-methods','');
    const methodsSummary=addText('summary','',words('估算拆分','Estimate breakdown'),methods);methodsSummary.append(toolIcon('back','cq-local-detail-arrow'));
    for(const [scope,part] of [[dateLabel.textContent,estimate],...(intervalEstimate ? [[words('区间','Interval'),intervalEstimate]] : [])]) {
      addText('p','cq-local-method-scope',scope,methods);
      const methodValues=addText('dl','cq-local-method-values','',methods);
      for(const [label,value] of [['Token',part.token===null ? '—' : `≈ ${localPercent(part.token)}%`],['API',part.api ? `≈ ${localPercent(part.api[0])}${localPercent(part.api[0])===localPercent(part.api[1]) ? '' : `–${localPercent(part.api[1])}`}%` : '—']]) {
        const pair=addText('div','','',methodValues);addText('dt','',label,pair);addText('dd','',value,pair);
      }
    }
    const costRow = addText("div", "cq-local-cost", "", highlights);
    addText("span", "cq-local-metric-label", words("API 等值", "API equivalent"), costRow);
    const costValue = addText("strong", "", "", costRow);
    if (priced.length) {
      addText("span", "cq-local-value-unit", "≈ ", costValue);
      const amount = value => {
        const part = addText("span", "cq-local-price-part", "", costValue);
        part.toggleAttribute("data-long", moneyText(value).length > 7);
        addText("span", "cq-local-value-unit", value > 0 && value < .01 ? "<$" : "$", part);
        addText("span", "cq-local-value-number", new Intl.NumberFormat(navigator.language,{minimumFractionDigits:2,maximumFractionDigits:2}).format(value > 0 && value < .01 ? .01 : value), part);
      };
      amount(cost[0]);
      if (cost[1] > cost[0]) {costValue.dataset.range = "";addText("span", "cq-local-value-unit", " – ", costValue);amount(cost[1]);}
      costValue.title = `${moneyText(cost[0])}${cost[1] > cost[0] ? ` – ${moneyText(cost[1])}` : ""} USD`;
    } else {costValue.textContent = words("未计价", "Not priced");costValue.dataset.unavailable = "";}
    if (priced.some(item => item.row.cacheWriteKnown === false)) addText("p", "cq-local-api-note", words("写缓存计数不完整，API 等值可能偏低。", "Cache-write counts are incomplete; API equivalent may be understated."));
    renderLocalDaily(data,result,addText,previousBars);
    const usageDetails = addText("details", "cq-local-usage-details", "");
    usageDetails.open=true;
    const usageSummary = addText("summary", "", "", usageDetails);
    addText("span", "", words("用量明细", "Usage breakdown"), usageSummary);
    addText("span", "cq-local-detail-meta", compactLocalTokens(totals.tokens).text, usageSummary);
    usageSummary.append(toolIcon("back", "cq-local-detail-arrow"));
    const usageGroup = addText("div", "cq-local-usage-group", "", usageDetails);
    const metrics = addText("dl", "cq-local-metrics", "", usageGroup);
    for (const [label,value] of [[words("总 token", "Total tokens"),totals.tokens],[words("输入", "Input"),totals.input],
      [words("其中缓存", "Cached input"),totals.cache],[words("输出", "Output"),totals.output]]) {
      const pair = addText("div", "", "", metrics); addText("dt", "", label, pair);
      const valueNode = addText("dd", "", "", pair);
      const {number,unit} = compactLocalTokens(value);
      addText("span", "", number, valueNode);
      if (unit) addText("span", "cq-local-token-unit", unit, valueNode);
      valueNode.title = `${numberText(value)} token`;
      valueNode.setAttribute("aria-label", valueNode.title);
    }
    const cacheRate = totals.input ? totals.cache / totals.input * 100 : null;
    const cache = addText("div", "cq-local-cache", "", usageGroup);
    const cacheLabel = addText("div", "cq-local-cache-label", "", cache);
    addText("span", "", words("缓存命中", "Cache hit rate"), cacheLabel);
    addText("span", "", cacheRate === null ? "—" : `${new Intl.NumberFormat(navigator.language,{maximumFractionDigits:1}).format(cacheRate)}%`, cacheLabel);
    const track = addText("div", "cq-local-cache-track", "", cache);
    track.setAttribute("role", cacheRate === null ? "img" : "meter");track.setAttribute("aria-label", words("输入 token 缓存命中率", "Input token cache hit rate"));
    if (cacheRate !== null) {track.setAttribute("aria-valuemin","0");track.setAttribute("aria-valuemax","100");track.setAttribute("aria-valuenow",String(cacheRate));}
    else track.setAttribute("aria-label", words("缓存命中率暂不可用，无输入记录", "Cache hit rate unavailable; no input records"));
    const cacheFill = addText("i", "", "", track);cacheFill.style.width = (cacheRate || 0) + "%";cacheFill.hidden = !cacheRate;
    const breakdown = addText("details", "cq-local-models", "");
    const modelSummary = addText("summary", "", "", breakdown);
    addText("span", "", words("模型 token 分布", "Tokens by model"), modelSummary);
    addText("span", "cq-local-detail-meta", String(data.models.length), modelSummary);
    modelSummary.append(toolIcon("back", "cq-local-detail-arrow"));
    for (const row of [...data.models].sort((a,b)=>b.totalTokens-a.totalTokens || a.model.localeCompare(b.model))) {
      const line = addText("div", "cq-local-model", "", breakdown);
      const name=row.model === "unknown" ? words("未知模型", "Unknown model") : row.model.replace(/^gpt-/, "GPT-");
      addText("span", "cq-local-model-name", name, line).title=name;
      const amount=addText("strong", "cq-local-model-value", compactLocalTokens(row.totalTokens).text, line);
      amount.title=`${numberText(row.totalTokens)} token`;amount.setAttribute("aria-label",amount.title);
      const share=totals.tokens ? row.totalTokens/totals.tokens*100 : null;
      const meter=addText("div", "cq-local-model-track", "", line);
      meter.setAttribute("role",share === null ? "img" : "meter");
      meter.setAttribute("aria-label",`${name} · ${words("占本机区间 token", "Share of local range tokens")}`);
      if(share!==null){meter.setAttribute("aria-valuemin","0");meter.setAttribute("aria-valuemax","100");meter.setAttribute("aria-valuenow",String(share));}
      const fill=addText("i", "", "", meter);fill.hidden=!share;fill.style.width=(share || 0)+"%";
      const percent=addText("span", "cq-local-model-share", share===null ? "—" : `${share>0 && share<.1 ? "<0.1" : new Intl.NumberFormat(navigator.language,{maximumFractionDigits:1}).format(share)}%`, line);
      percent.title=words("占所选区间本机 token 的比例", "Share of local tokens in the selected range");
    }
    const sameCoverage = excluded > 0 && data.models.every(row => localUsageBaselines.has(row.model) === localApiPrices.has(row.model));
    if (sameCoverage) addText("p", "cq-local-excluded", words(`未折算／计价 · ${compactLocalTokens(excluded).text} token`,
      `Not estimated / priced · ${compactLocalTokens(excluded).text} tokens`), breakdown).title=words(`${numberText(excluded)} token：无周基准与 API 价格。`, `${numberText(excluded)} tokens without a weekly reference or API price.`);
    else {
      if (excluded) addText("p", "cq-local-excluded", words(`未折算 · ${compactLocalTokens(excluded).text} token`,
        `Not estimated · ${compactLocalTokens(excluded).text} tokens`), breakdown).title=words(`${numberText(excluded)} token：无周参考基准。`, `${numberText(excluded)} tokens without a weekly reference.`);
      if (unpriced) addText("p", "cq-local-excluded", words(`未计价 · ${compactLocalTokens(unpriced).text} token`, `Not priced · ${compactLocalTokens(unpriced).text} tokens`), breakdown).title=words(`${numberText(unpriced)} token：无 API 价格。`, `${numberText(unpriced)} tokens without API prices.`);
    }
    const missing = issues.filter(issue => issue.affectsTotals);
    status.textContent = data.partial ? `${words("统计不完整", "Incomplete")}: ${missing.length ? missing.map(issue => `${localIssueLabels[issue.code]} ${numberText(issue.count)}`).join(" · ")
      : words("部分日志无法读取或归属，结果仅覆盖已识别记录。", "Some logs could not be read or attributed; identified records only.")}`
      : !data.eventCount ? words("该区间未找到可统计的官方用量记录。", "No countable official usage records in this range.")
      : words("仅本机日志；估算未按本账号校准。", "Local logs only; estimate not calibrated to this account.");
    status.toggleAttribute("data-cq-quiet", !data.partial && data.eventCount > 0);
    status.toggleAttribute("data-cq-warning", data.partial);
    if (issues.length) {
      const details = addText("details", "cq-local-issues", "");
      const summary = addText("summary", "", words("统计说明", "Coverage details"), details);
      summary.append(toolIcon("back", "cq-local-detail-arrow"));
      for (const issue of issues) addText("p", "", `${localIssueLabels[issue.code]}: ${numberText(issue.count)}${issue.missingTokens ? ` · ${numberText(issue.missingTokens)} token` : ""}${issue.dateUnknown ? words("（日期未知）", " (date unknown)") : ""}`, details);
    }
    arrangeLocalPages(panel);
    });
  };
  const installLocalCalendar = panel => {
    let form=panel.querySelector("form");const popup=panel.parentElement;
    const calendar=document.createElement("div");calendar.className="cq-local-calendar";calendar.hidden=true;
    calendar.setAttribute("role","dialog");calendar.setAttribute("aria-labelledby","cq-calendar-title");
    calendar.innerHTML='<div class="cq-calendar-heading"><button type="button" data-month="-1"></button><strong id="cq-calendar-title" aria-live="polite"></strong><button type="button" data-month="1"></button></div><div class="cq-calendar-grid" role="grid" aria-labelledby="cq-calendar-title"></div><div class="cq-calendar-footer"><button type="button" data-today></button><button type="button" data-close></button></div>';
    form.append(calendar);
    let active=null, month=0, focusDay=0;
    const bounds=()=>[localDayIndex(active.min),localDayIndex(localDate(new Date()))];
    const monthStart=index=>{const date=new Date(index*86400000);return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)/86400000;};
    const monthShift=(index,delta)=>{const date=new Date(index*86400000);return Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+delta,1)/86400000;};
    const close = (focus=true) => {
      if(calendar.hidden)return;
      calendar.hidden=true;stopLocalMotions(calendar);
      for(const button of form.querySelectorAll("[data-date-field]"))button.setAttribute("aria-expanded","false");
      if(focus)active?.focus({preventScroll:true});
    };
    panel.cqCloseCalendar=close;
    panel.cqPositionCalendar=()=>{
      if(calendar.hidden)return;
      const field=(active.closest('.cq-interval-endpoint') ? active : active.closest("label")).getBoundingClientRect(),area=form.getBoundingClientRect(),box=popup.getBoundingClientRect();
      const top=Math.max(box.top+8,Math.min(field.bottom+4,box.bottom-32-calendar.offsetHeight));
      calendar.style.top=(top-area.top)+"px";
    };
    const select=index=>{
      active.value=localDayKey(index);active.dispatchEvent(new Event("input",{bubbles:true}));active.dispatchEvent(new Event("change",{bubbles:true}));close();
    };
    const grid=calendar.querySelector('[role="grid"]');
    const draw=(focus=false)=>{
      const [min,max]=bounds(), today=localDate(new Date());
      calendar.querySelector("strong").textContent=new Intl.DateTimeFormat(navigator.language,{year:"numeric",month:"long",timeZone:"UTC"}).format(new Date(month*86400000));
      for(const button of calendar.querySelectorAll("[data-month]"))button.disabled=Number(button.dataset.month)<0 ? month<=monthStart(min) : month>=monthStart(max);
      grid.replaceChildren();
      const weekdays=document.createElement("div");weekdays.setAttribute("role","row");grid.append(weekdays);
      for(let i=0;i<7;i++){
        const label=document.createElement("span");label.setAttribute("role","columnheader");
        label.textContent=new Intl.DateTimeFormat(navigator.language,{weekday:"narrow",timeZone:"UTC"}).format(new Date(Date.UTC(2026,9,26+i)));weekdays.append(label);
      }
      const start=month-(new Date(month*86400000).getUTCDay()+6)%7;
      for(let row=0;row<6;row++){
        const line=document.createElement("div");line.setAttribute("role","row");grid.append(line);
        for(let column=0;column<7;column++){
          const index=start+row*7+column,date=localDayKey(index),button=document.createElement("button");
          button.type="button";button.setAttribute("role","gridcell");button.dataset.date=date;button.textContent=String(Number(date.slice(8)));
          button.setAttribute("aria-label",new Intl.DateTimeFormat(navigator.language,{dateStyle:"full",timeZone:"UTC"}).format(new Date(index*86400000)));
          button.setAttribute("aria-selected",String(date===active.value));button.tabIndex=index===focusDay?0:-1;
          button.disabled=index<min || index>max;button.toggleAttribute("data-other-month",monthStart(index)!==month);
          if(date===today)button.setAttribute("aria-current","date");
          button.onclick=()=>select(index);
          button.onkeydown=event=>{
            let next=index;
            if(event.key==='ArrowLeft')next--;else if(event.key==='ArrowRight')next++;
            else if(event.key==='ArrowUp')next-=7;else if(event.key==='ArrowDown')next+=7;
            else if(event.key==='Home')next-=column;else if(event.key==='End')next+=6-column;
            else if(event.key==='PageUp'||event.key==='PageDown'){
              const nextMonth=monthShift(index,event.key==='PageUp'?-1:1);
              next=nextMonth+Math.min(Number(date.slice(8)),monthShift(nextMonth,1)-nextMonth)-1;
            }else return;
            event.preventDefault();focusDay=Math.max(min,Math.min(max,next));month=monthStart(focusDay);draw(true);
          };
          line.append(button);
        }
      }
      panel.cqPositionCalendar();
      if(focus)grid.querySelector(`button[data-date="${localDayKey(focusDay)}"]`)?.focus({preventScroll:true});
    };
    for(const button of calendar.querySelectorAll("[data-month]")){
      const delta=Number(button.dataset.month);button.setAttribute("aria-label",delta<0?words("上个月","Previous month"):words("下个月","Next month"));
      button.append(toolIcon("back",delta>0?"cq-local-chart-next":""));
      button.onclick=()=>{month=monthShift(month,delta);const [min,max]=bounds();focusDay=Math.max(min,Math.min(max,month));draw();};
    }
    const today=calendar.querySelector("[data-today]"),dismiss=calendar.querySelector("[data-close]");
    today.textContent=words("今天","Today");today.onclick=()=>select(localDayIndex(localDate(new Date())));
    dismiss.textContent=words("关闭","Close");dismiss.onclick=()=>close();
    for(const button of panel.querySelectorAll("[data-date-field]")){
      button.setAttribute("aria-haspopup","dialog");button.setAttribute("aria-expanded","false");
      button.setAttribute("aria-label",["start","intervalStart"].includes(button.dataset.dateField)?words("选择开始日期","Choose start date"):words("选择结束日期","Choose end date"));
      button.append(toolIcon("calendar",""));
      const open=()=>{
        const input=button.closest('form').elements[button.dataset.dateField];
        if(!calendar.hidden && active===input){close();return;}
        close(false);form=input.form;form.append(calendar);active=input;const [min,max]=bounds(), value=localDayIndex(input.value);
        focusDay=Math.max(min,Math.min(max,Number.isFinite(value)?value:max));month=monthStart(focusDay);
        calendar.hidden=false;button.setAttribute("aria-expanded","true");draw(true);
        move(calendar,{opacity:[.6,1]},{duration:.12},()=>calendar.style.removeProperty("opacity"));
      };
      button.onclick=open;
      button.closest('form').elements[button.dataset.dateField].onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();open();}};
    }
    panel.addEventListener("keydown",event=>{if(event.key==='Escape'&&!calendar.hidden){event.preventDefault();event.stopPropagation();close();}});
    panel.addEventListener("pointerdown",event=>{if(!calendar.hidden&&!calendar.contains(event.target)&&!event.target.closest('[data-date-field]'))close(false);});
    panel.addEventListener("focusout",event=>{if(event.relatedTarget&&!form.contains(event.relatedTarget))close(false);});
  };
  const installIntervalControls = panel => {
    const form=panel.querySelector(".cq-interval-controls"), inputs=[form.elements.intervalStart,form.elements.intervalEnd], times=[form.elements.intervalStartTime,form.elements.intervalEndTime], sliders=[...form.querySelectorAll('[type="range"]')];
    const format=date=>`${localDate(date)} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}`;
    const parse=text=>{
      const match=/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(text.trim());
      if(!match)return null;
      const [,year,month,day,hour,minute,second="00"]=match, date=new Date(+year,+month-1,+day,+hour,+minute,+second);
      return format(date)===`${year}-${month}-${day} ${hour}:${minute}:${second}` && +year>=2022 ? date : null;
    };
    const now=new Date(Math.floor(Date.now()/1000)*1000);
    const set=(index,date)=>{inputs[index].value=localDate(date);times[index].value=format(date).slice(11);};
    set(0,new Date(now.getTime()-3600000));set(1,now);
    inputs.forEach((input,index)=>{
      input.min="2022-01-01";input.max=localDate(now);input.title=words("本地日期", "Local date");
      form.querySelector(`label[for="${input.id}"]`).textContent=index ? words("结束", "End") : words("开始", "Start");
      times[index].setAttribute("aria-label",index ? words("结束时间", "End time") : words("开始时间", "Start time"));
    });
    form.querySelector('[type="submit"]').textContent=words("查询", "Apply");
    form.setAttribute("aria-label",words("本地时间区间", "Interval in local time"));
    sliders.forEach((slider,index)=>slider.setAttribute("aria-label",index ? words("区间结束", "Interval end") : words("区间开始", "Interval start")));
    const presets=form.querySelector('.cq-interval-presets'), marker=document.createElement('span');
    marker.className='cq-interval-preset-marker';marker.hidden=true;marker.setAttribute('aria-hidden','true');presets.append(marker);
    presets.setAttribute('aria-label',words('快捷时长','Quick duration'));
    let selectedPreset=-1, markerTarget='';
    const positionPreset=(animated=false)=>{
      const target=presets.querySelector('[aria-pressed="true"]');
      if(!target || !presets.getClientRects().length){stopMotion(marker);marker.hidden=true;return;}
      const area=presets.getBoundingClientRect(),box=target.getBoundingClientRect(),scale=area.width/presets.offsetWidth;
      const width=box.width/scale+'px',transform=`translateX(${(box.left-area.left)/scale}px)`;
      if(!marker.hidden && marker.style.width===width && markerTarget===transform)return;
      const current=getComputedStyle(marker).transform, shown=!marker.hidden;stopMotion(marker);marker.hidden=false;marker.style.width=width;markerTarget=transform;
      if(animated && shown)move(marker,{transform:[current,transform]},{duration:.2,ease:[.2,.8,.2,1]});else marker.style.transform=transform;
    };
    form.cqPositionPresets=()=>positionPreset();
    const presetButtons=[5,10,30,60].map((minutes,index)=>{
      const button=document.createElement('button');button.type='button';button.dataset.intervalMinutes=String(minutes);button.textContent=minutes===60?'1h':minutes+'min';
      button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',minutes===60?words('最近一小时','Last hour'):words(`最近 ${minutes} 分钟`,`Last ${minutes} minutes`));
      button.onclick=()=>{panel.cqCloseCalendar?.(false);const end=new Date(Math.floor(Date.now()/1000)*1000);set(0,new Date(end.getTime()-minutes*60000));set(1,end);sync();};
      button.onkeydown=event=>{let next=index;if(event.key==='ArrowLeft')next=Math.max(0,index-1);else if(event.key==='ArrowRight')next=Math.min(3,index+1);else if(event.key==='Home')next=0;else if(event.key==='End')next=3;else return;event.preventDefault();presetButtons[next].focus({preventScroll:true});presetButtons[next].click();};
      presets.append(button);return button;
    });
    const read=(report=false)=>{
      const dates=inputs.map((input,index)=>parse(`${input.value.trim()} ${times[index].value.trim()}`));
      inputs.forEach((input,index)=>{
        input.setCustomValidity(parse(`${input.value.trim()} 00:00:00`) ? "" : words("请输入有效日期", "Enter a valid date"));
        times[index].setCustomValidity(dates[index] && dates[index].getTime()<=Date.now() ? "" : words("请输入有效时间，不得晚于现在", "Enter a valid time, no later than now"));
      });
      if(dates.every(Boolean) && dates[0]>=dates[1])inputs[1].setCustomValidity(words("结束时间必须晚于开始时间", "End must be later than start"));
      if(![...inputs,...times].every(input=>input.validity.valid)){if(report)form.reportValidity();return null;}
      return dates;
    };
    let lower,upper;
    const paint=()=>{
      const values=sliders.map(slider=>Number(slider.value));
      sliders.forEach((slider,index)=>slider.setAttribute("aria-valuetext",format(new Date(values[index]*1000))));
      const seconds=values[1]-values[0];
      form.querySelector("output").textContent=new Intl.NumberFormat(navigator.language,{maximumFractionDigits:2}).format(seconds>=3600 ? seconds/3600 : seconds/60)+ (seconds>=3600 ? words(" 小时", " h") : words(" 分钟", " min"));
      const next=[300,600,1800,3600].indexOf(seconds);
      if(next!==selectedPreset){selectedPreset=next;presetButtons.forEach((button,index)=>button.setAttribute('aria-pressed',String(index===next)));positionPreset(true);}
    };
    const sync=(dates=read())=>{
      if(!dates)return;
      const first=new Date(dates[0]),last=new Date(dates[1]);first.setHours(0,0,0,0);last.setHours(23,59,59,0);
      lower=first.getTime()/1000;upper=Math.min(Math.floor(Date.now()/1000),last.getTime()/1000);
      sliders.forEach((slider,index)=>{slider.min=String(lower);slider.max=String(upper);slider.value=String(dates[index].getTime()/1000);});paint();
    };
    for(const input of [...inputs,...times]){input.oninput=()=>[...inputs,...times].forEach(field=>field.setCustomValidity(""));input.onchange=()=>sync();}
    sliders.forEach((slider,index)=>{
      slider.oninput=()=>{
        slider.value=String(index ? Math.max(Number(slider.value),Number(sliders[0].value)+1) : Math.min(Number(slider.value),Number(sliders[1].value)-1));
        set(index,new Date(Number(slider.value)*1000));[...inputs,...times].forEach(input=>input.setCustomValidity(""));paint();
      };
    });
    panel.cqGetInterval=report=>{const dates=read(report);return dates ? {intervalStart:dates[0].toISOString(),intervalEnd:dates[1].toISOString()} : null;};
    form.onsubmit=event=>{
      event.preventDefault();const dates=read(true);if(!dates)return;sync(dates);
      const range=globalThis.__codexQuotaLocalUsageRange;
      if(form.querySelector('[type="submit"]').getAttribute('aria-busy')==='true' && dates[0].toISOString()===range?.intervalStart && dates[1].toISOString()===range?.intervalEnd)return;
      panel.cqAppliedInterval={intervalStart:dates[0].toISOString(),intervalEnd:dates[1].toISOString()};
      requestLocalUsage(panel);
    };
    sync();
  };
  const openLocalUsage = opener => {
    const popup = document.getElementById("codex-quota-popover"), host = opener?.closest(`.${compactClass}`);
    if (!popup || !host) return;
    let panel = document.getElementById("cq-local-usage");
    if (panel) { animatePane(host,panel,true); panel.querySelector("header button").focus({preventScroll:true}); return; }
    panel = document.createElement("section");
    panel.id = "cq-local-usage";
    panel.cqHost = host; panel.cqOpener = opener;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", "cq-local-title");
    panel.innerHTML = `<header><h2 id="cq-local-title"></h2><button type="button" class="cq-local-close"></button></header>
      <div class="cq-local-periods" role="group"><button type="button" data-period="today"></button><button type="button" data-period="week"></button><button type="button" data-period="custom"></button></div>
      <form class="cq-local-dates" hidden><label><span></span><span class="cq-local-date-field"><input type="text" name="start" placeholder="YYYY-MM-DD" autocomplete="off" required><button type="button" data-date-field="start"></button></span></label><label><span></span><span class="cq-local-date-field"><input type="text" name="end" placeholder="YYYY-MM-DD" autocomplete="off" required><button type="button" data-date-field="end"></button></span></label><button type="submit"></button></form>
      <div class="cq-local-tabs" role="tablist"></div>
      <form class="cq-interval-controls" hidden><div class="cq-interval-endpoints"><div class="cq-interval-endpoint"><div class="cq-interval-heading"><label for="cq-interval-start-date"></label><button type="button" data-date-field="intervalStart"></button></div><input id="cq-interval-start-date" name="intervalStart" type="text" placeholder="YYYY-MM-DD" autocomplete="off" inputmode="numeric" required><input name="intervalStartTime" type="text" placeholder="HH:mm:ss" autocomplete="off" inputmode="numeric" required><input type="range" name="fromSlider" step="1"></div><div class="cq-interval-endpoint"><div class="cq-interval-heading"><label for="cq-interval-end-date"></label><button type="button" data-date-field="intervalEnd"></button></div><input id="cq-interval-end-date" name="intervalEnd" type="text" placeholder="YYYY-MM-DD" autocomplete="off" inputmode="numeric" required><input name="intervalEndTime" type="text" placeholder="HH:mm:ss" autocomplete="off" inputmode="numeric" required><input type="range" name="toSlider" step="1"></div></div><div class="cq-interval-presets" role="group"></div><div class="cq-interval-actions"><output></output><button type="submit"></button></div></form>
      <div class="cq-local-result" role="region" aria-busy="false"></div><p class="cq-local-status" role="status"></p>
      <details class="cq-local-reference"><summary></summary><p></p></details>`;
    panel.querySelector("h2").textContent = words("用量统计", "Usage statistics");
    const tag = document.createElement("span");tag.className = "cq-local-estimate-tag";tag.textContent = words("估算", "Estimate");
    panel.querySelector("h2").after(tag);
    const close = panel.querySelector("header button");
    close.title = words("返回额度", "Back to quota"); close.setAttribute("aria-label",close.title);
    close.append(toolIcon("back", "")); close.onclick = closeLocalUsage;
    const form = panel.querySelector("form");
    form.querySelectorAll("label > span:first-child").forEach((node,index) => node.textContent = index ? words("至", "To") : words("从", "From"));
    form.querySelector('[type="submit"]').textContent = words("查询", "Apply");
    for (const input of form.querySelectorAll("input")) {
      input.min = "2022-01-01"; input.max = localDate(new Date());
      input.oninput = () => {input.setCustomValidity("");form.elements.end.setCustomValidity("");};
    }
    form.onsubmit = event => {event.preventDefault(); requestLocalUsage(panel,()=>{},true);};
    const tabs=panel.querySelector(".cq-local-tabs");tabs.setAttribute("aria-label",words("统计内容", "Statistics pages"));
    localPageNames.forEach((name,index)=>{
      const button=document.createElement("button");button.type="button";button.id=`cq-local-tab-${name}`;button.dataset.localPage=String(index);
      button.setAttribute("role","tab");button.setAttribute("aria-controls",`cq-local-page-${name}`);button.setAttribute("aria-selected",String(index===0));button.tabIndex=index===0?0:-1;
      button.textContent=[words("用量", "Overview"),words("每日", "Daily"),words("详情", "Details"),words("区间", "Interval")][index];
      button.onclick=()=>selectLocalPage(panel,index);
      button.onkeydown=event=>{let next=index;if(event.key==="ArrowRight")next=(index+1)%localPageNames.length;else if(event.key==="ArrowLeft")next=(index+localPageNames.length-1)%localPageNames.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=localPageNames.length-1;else return;event.preventDefault();selectLocalPage(panel,next,true);};
      tabs.append(button);
    });
    panel.querySelector(".cq-local-result").setAttribute("aria-label", words("用量统计结果", "Usage statistics results"));
    panel.querySelector("summary").textContent = words("估算依据", "References");
    panel.querySelector("summary").append(toolIcon("back", "cq-local-detail-arrow"));
    panel.querySelector("details p").textContent = words(
      "Token 与 API 分别按各模型用量 ÷ 对应周参考相加，取两口径最小至最大值；不是置信区间。参考并非官方上限，未按本账号校准。Pro 档位需自行确认。",
      "Token and API estimates each sum model usage ÷ matching weekly reference. The range spans both views, not a confidence interval. References are not official limits or account-calibrated. Confirm your Pro tier.");
    const reference=panel.querySelector(".cq-local-reference"), explanation=reference.querySelector("p");
    const referenceText=(tag,className,text,parent=reference)=>{const node=document.createElement(tag);node.className=className;node.textContent=text;parent.append(node);return node;};
    const weeklyReference=referenceText("section","cq-local-reference-section cq-local-weekly-reference","");
    const weeklyHeading=referenceText("div","cq-local-reference-heading","",weeklyReference);
    referenceText("strong","",words("周额度参考", "Weekly reference"),weeklyHeading);
    referenceText("span","","token",weeklyHeading);
    const baselineTable=referenceText("dl","cq-local-baselines","",weeklyReference);
    const planChoice=referenceText("select","cq-local-reference-plan","",weeklyReference);
    planChoice.hidden=true;planChoice.setAttribute("aria-label",words("Pro 参考套餐", "Pro reference tier"));
    for(const [value,label] of [["",words("选择 Pro 套餐", "Choose Pro tier")],["pro100","Pro $100"],["pro200","Pro $200 · 20x"],["pro500","Pro $500"]]) {
      const option=document.createElement("option");option.value=value;option.textContent=label;planChoice.append(option);
    }
    planChoice.value=localReferencePlan;
    planChoice.onchange=()=>{
      localReferencePlan=planChoice.value;
      try {localStorage.setItem("codexQuotaReferencePlan",JSON.stringify({scope:localReferenceScope,plan:localReferencePlan}));} catch {}
      requestLocalUsage(panel);
    };
    referenceText("p","cq-local-reference-status","",weeklyReference);
    const apiReference=referenceText("section","cq-local-reference-section","");
    const apiHeading=referenceText("div","cq-local-reference-heading","",apiReference);
    referenceText("strong","",words("API 等值", "API equivalent"),apiHeading);referenceText("span","","USD",apiHeading);
    for (const [parent,label,url] of [[weeklyReference,"ModelDial","https://modeldial.com/subscriptions?period=week&view=insights"],[apiReference,words("OpenAI 价格 · 2026.10.30", "OpenAI pricing · 2026.10.30"),"https://developers.openai.com/api/docs/pricing"]]) {
      const link=referenceText("a","",label,parent);link.href=url;link.target="_blank";link.rel="noopener noreferrer";
    }
    const caveats=referenceText("details","cq-local-caveats","");
    const caveatSummary=referenceText("summary","",words("口径与限制", "Scope and limitations"),caveats);
    caveatSummary.append(toolIcon("back","cq-local-detail-arrow"));caveats.append(explanation);
    for(const text of [
      words("账号实测为官方周额度采样差，含其他设备；历史只存本机，重启后恢复。缺失不补算，跨重置或校正不拼接。", "Account measurements are official weekly sample differences, including other devices. History stays local and survives restarts; gaps are not inferred and resets/corrections are not joined."),
      words("API 等值不是实付账单；写缓存时长未知时显示价格区间，不含长上下文、加速、地区与工具附加费。", "API equivalent is not a bill. Unknown cache-write retention shows a price range; long-context, speed, regional and tool fees are excluded."),
      words("日志仅限本机，可能含旧账号或导入记录。本周自本地周一开始；跨周期可超过 100%。", "Logs are local and may include old accounts or imports. Weeks start Monday locally; cross-cycle estimates may exceed 100%.")
    ]) referenceText("p","",text,caveats);
    const choose = period => {
      const now = new Date(), start = new Date(now);
      if (period === "week") start.setDate(start.getDate()-(start.getDay()+6)%7);
      for (const button of panel.querySelectorAll("[data-period]")) button.setAttribute("aria-pressed",String(button.dataset.period === period));
      panel.cqCloseCalendar?.(false);
      if (period !== "custom") {form.elements.start.value=localDate(start); form.elements.end.value=localDate(now); requestLocalUsage(panel,()=>{form.hidden=true;},true);}
      else {animateLocalLayout(panel,()=>{form.hidden=false;});form.elements.start.focus({preventScroll:true});}
      if (!paneMotion) positionPopover();
    };
    for (const button of panel.querySelectorAll("[data-period]")) {
      button.textContent = {today:words("今日", "Today"),week:words("本周", "This week"),custom:words("自选日期", "Date range")}[button.dataset.period];
      button.onclick = () => choose(button.dataset.period);
    }
    panel.addEventListener("click", event => {
      const summary = event.target.closest("summary");
      if (!summary || !panel.contains(summary)) return;
      event.preventDefault();
      animateLocalLayout(panel,()=>{summary.parentElement.open=!summary.parentElement.open;});
    });
    panel.addEventListener("toggle", () => {if (!paneMotion && !localLayout) positionPopover();},true);
    localDetailBodies(panel);
    arrangeLocalPages(panel);
    panel.hidden = true;
    popup.append(panel);
    installIntervalControls(panel);
    installLocalCalendar(panel);
    choose("today");
    animatePane(host,panel,true);
    close.focus({preventScroll:true});
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

  const quotaUsageFingerprint = (data) => JSON.stringify((data?.windows || []).map(window => [window.label, window.usedPercent]).sort(([a], [b]) => a.localeCompare(b)));

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
      #codex-quota-trigger, #codex-quota-popover, #cq-local-usage {
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
      #codex-quota-trigger[data-cq-dark], #codex-quota-popover[data-cq-dark], #cq-local-usage[data-cq-dark] {
        --cq-solid: var(--color-surface-elevated-secondary, var(--color-token-main-surface-primary, Canvas));
        --cq-ink: var(--color-text, var(--color-token-text-primary, CanvasText));
        --cq-muted: var(--color-text-secondary, var(--color-token-text-secondary, var(--cq-ink)));
        --cq-border: var(--color-border, color-mix(in srgb, var(--cq-ink) 12%, transparent));
        --cq-track: color-mix(in srgb, var(--cq-ink) 24%, var(--cq-solid));
        --cq-fill: color-mix(in srgb, var(--cq-ink) 65%, #8e4617);
        --cq-warning: var(--color-text-warning-surface, #e2bb78);
      }
      #codex-quota-footer { flex: none; box-sizing: border-box; padding: 0 8px; }
      #codex-quota-trigger { --cq-entry-border-width: 1px; display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; margin: 0; padding: 0 8px; border: var(--cq-entry-border-width) solid var(--cq-border); border-radius: var(--radius-sm, 6px); background: var(--cq-solid); box-shadow: 0 1px 3px #00000006; text-align: left; cursor: pointer; transition: background 110ms, border-color 110ms; }
      #codex-quota-trigger:is(:hover,[aria-expanded="true"]) { background: color-mix(in srgb, var(--cq-solid) 94%, var(--cq-ink)); border-color: var(--color-border-strong, var(--cq-border)); }
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
      #codex-quota-trigger[data-cq-collapsed] { width: 36px; height: 36px; flex: none; justify-content: center; padding: 8px; align-self: center; border: 0; border-radius: var(--cq-rail-radius, 12px); background: transparent; box-shadow: none; backdrop-filter: none; color: var(--color-text-tertiary, var(--cq-muted)); }
      #codex-quota-trigger[data-cq-collapsed]:is(:hover,[aria-expanded="true"]) { background: var(--cq-hover); color: var(--cq-ink); }
      #codex-quota-trigger[data-cq-collapsed] .cq-trigger-icon { display: block; width: 20px; height: 20px; }
      #codex-quota-trigger .cq-gauge-needle { transform-origin: 10px 11px; transition: transform 240ms cubic-bezier(.2,.8,.2,1); }
      #codex-quota-trigger .cq-gauge-needle[hidden] { display: none; }
      #codex-quota-trigger[data-cq-instant] .cq-gauge-needle { transition: none; }
      #codex-quota-trigger[data-cq-collapsed] :is(.cq-trigger-plan,.cq-trigger-copy,.cq-trigger-graphics,.cq-trigger-chevron) { display: none; }
      #codex-quota-trigger[data-cq-low]::after { content: ""; position: absolute; right: 3px; top: 3px; width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
      #codex-quota-trigger[data-cq-collapsed][data-cq-low]::after { right: auto; top: auto; margin: 23px 0 0 22px; }
      #codex-quota-popover { position: fixed; inset: auto; margin: 0; padding: 8px 0 8px 8px; max-width: none; max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; scrollbar-width: none; border: .8px solid var(--cq-border); border-radius: var(--radius-sm, 6px); background: var(--cq-solid); box-shadow: 0 4px 12px #302c2212, 0 16px 32px #302c2207; opacity: 0; transition: display 700ms allow-discrete, overlay 700ms allow-discrete; }
      #codex-quota-popover:not([data-cq-inplace]) { transition-duration: 180ms; }
      #codex-quota-popover[data-cq-rail-motion] { transition-duration: 700ms; }
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
      #codex-quota-popover .cq-settings-button { position: relative; }
      #codex-quota-popover .cq-settings-button[data-cq-update]::after { content: ""; position: absolute; right: 1px; top: 1px; width: 4px; height: 4px; border-radius: 50%; background: var(--cq-fill); outline: 1px solid var(--cq-solid); pointer-events: none; }
      #codex-quota-popover .cq-actions svg { display: block; width: 16px; height: 16px; stroke-width: 1.5; }
      #codex-quota-popover .cq-actions button { transition: background-color 120ms ease, color 120ms ease; }
      #codex-quota-popover .cq-actions button:active:not(:disabled) { background: color-mix(in srgb, var(--cq-ink) 12%, transparent); color: var(--cq-ink); transition-duration: 0s; }
      #codex-quota-popover .cq-collapse-button { position: absolute; z-index: 3; display: grid; place-items: center; width: 24px; height: 24px; padding: 6px; border-radius: 5px; color: var(--cq-muted); }
      #codex-quota-popover .cq-collapse-icon { width: 12px; height: 12px; transform: rotate(180deg); }
      #codex-quota-popover[data-cq-inplace] :is(#cq-settings,#cq-local-usage) { padding-bottom: 24px; }
      #codex-quota-popover[data-cq-pane] { overflow: clip; opacity: 1; transition-duration: 700ms; }
      #codex-quota-popover[data-cq-pane] > .cq-collapse-button { opacity: 1; }
      #codex-quota-popover[data-cq-inplace] .cq-rows > :last-child { padding-bottom: 0; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child .cq-reset { grid-area: 3 / 1 / 4 / -1; padding-right: 24px; min-height: 16px; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child[data-cq-secondary] .cq-reset { grid-row: 2; }
      #codex-quota-popover[data-cq-inplace] [data-cq-focal] .cq-rows > :last-child[data-cq-secondary] .cq-low { grid-row: 3; padding-right: 24px; }
      #codex-quota-popover[data-cq-inplace] :not([data-cq-focal]) > .cq-rows > :last-child { padding-right: 40px; }
      #codex-quota-popover[data-cq-morph] { background: transparent; border-color: transparent; box-shadow: none; backdrop-filter: none; overflow: visible; opacity: 1; pointer-events: auto; }
      #codex-quota-popover[data-cq-morph] > * { opacity: 1; }
      #codex-quota-popover .cq-shared-layer { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      #codex-quota-popover[data-cq-morph] > :is(#codex-official-usage-host,#cq-settings,#cq-local-usage) { position: relative; z-index: 1; }
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
      :is(#codex-quota-popover,#codex-quota-trigger) .cq-progress-fill { display: block; height: 100%; min-width: 3px; max-width: 100%; border-radius: inherit; background: var(--cq-fill); transform-origin: 0 50%; }
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
      #cq-local-usage { --cq-chart-input: #a46b40; --cq-chart-cache: #708771; --cq-chart-output: #6c8299; position: relative; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; color: var(--cq-ink); box-shadow: none; user-select: text; font-variant-numeric: tabular-nums; }
      #codex-quota-popover[data-cq-dark] #cq-local-usage { --cq-chart-input: #d3a879; --cq-chart-cache: #a1b49a; --cq-chart-output: #9cb2c8; }
      #cq-local-usage * { box-sizing: border-box; }
      #cq-local-usage [hidden] { display: none !important; }
      #cq-local-usage header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-bottom: 16px; padding: 0 var(--cq-control-right, 6px) 0 8px; }
      #cq-local-usage h2 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; letter-spacing: -.01em; }
      #cq-local-usage .cq-local-estimate-tag { margin-right: auto; color: var(--cq-ink); font-size: 13px; line-height: 16px; font-weight: 600; }
      #cq-local-usage button { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; padding: 4px 8px; min-height: 24px; font: inherit; font-size: 12px; color: var(--cq-ink); background: transparent; cursor: pointer; }
      #cq-local-usage button:hover { background: var(--cq-hover); }
      #cq-local-usage button:active { background: color-mix(in srgb,var(--cq-ink) 12%,transparent); }
      #cq-local-usage :is(button,input,summary):focus-visible { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #cq-local-usage .cq-local-close { flex: none; width: 24px; height: 24px; padding: 4px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-periods { display: flex; gap: 0; padding: 3px; margin: 0 16px 0 8px; border-radius: 7px; background: color-mix(in srgb,var(--cq-ink) 4%,transparent); }
      #cq-local-usage .cq-local-periods button { flex: 1; white-space: nowrap; }
      #cq-local-usage .cq-local-periods button[aria-pressed=true] { background: var(--cq-solid); box-shadow: 0 1px 3px #0001; font-weight: 600; }
      #cq-local-usage .cq-local-dates { position: relative; display: grid; grid-template-columns: 1fr; gap: 8px; margin: 16px 16px 0 8px; }
      #cq-local-usage .cq-local-dates label { display: grid; grid-template-columns: 16px 1fr; align-items: center; gap: 8px; min-width: 0; font-size: 11px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-dates label > span:first-child { display: block; }
      #cq-local-usage .cq-local-date-field { position: relative; display: block; min-width: 0; }
      #cq-local-usage input { display: block; min-width: 0; width: 100%; height: 28px; border: 1px solid var(--cq-border); border-radius: 6px; padding: 4px 8px; color: var(--cq-ink); background: var(--cq-solid); font: inherit; font-size: 11px; }
      #cq-local-usage .cq-local-date-field input { padding-right: 32px; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-local-date-field button { position: absolute; right: 2px; top: 2px; width: 24px; height: 24px; padding: 4px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-dates > button { background: var(--cq-hover); }
      #cq-local-usage .cq-local-calendar { position: absolute; z-index: 5; left: 0; right: 0; padding: 8px; background: var(--cq-solid); border: 1px solid var(--cq-border); border-radius: var(--radius-sm,6px); box-shadow: 0 4px 12px #302c2214; color: var(--cq-ink); }
      #cq-local-usage .cq-calendar-heading { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 8px; }
      #cq-local-usage .cq-calendar-heading strong { font-size: 12px; line-height: 24px; font-weight: 600; }
      #cq-local-usage .cq-calendar-heading button { width: 24px; height: 24px; padding: 4px; }
      #cq-local-usage .cq-calendar-grid > div { display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); gap: 2px; margin-bottom: 2px; }
      #cq-local-usage .cq-calendar-grid [role=columnheader] { text-align: center; color: var(--cq-muted); font-size: 11px; line-height: 20px; }
      #cq-local-usage .cq-calendar-grid button { min-width: 0; width: 100%; height: 24px; padding: 0; font-size: 11px; font-variant-numeric: tabular-nums; border-radius: 4px; }
      #cq-local-usage .cq-calendar-grid button[data-other-month] { color: var(--cq-muted); }
      #cq-local-usage .cq-calendar-grid button[aria-current=date] { text-decoration: underline; text-underline-offset: 3px; }
      #cq-local-usage .cq-calendar-grid button[aria-selected=true] { background: var(--cq-ink); color: var(--cq-solid); font-weight: 600; }
      #cq-local-usage .cq-local-calendar button:disabled { opacity: .28; cursor: default; }
      #cq-local-usage .cq-calendar-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 4px; border-top: 1px solid var(--cq-border); }
      #cq-local-usage .cq-calendar-footer button { color: var(--cq-muted); padding: 2px 4px; }
      @media (forced-colors: active) { #cq-local-usage .cq-local-calendar { background: Canvas; color: CanvasText; border-color: CanvasText; } #cq-local-usage .cq-calendar-grid button[aria-selected=true] { forced-color-adjust: none; background: Highlight; color: HighlightText; } }
      #cq-local-usage .cq-local-tabs { display: flex; gap: 8px; margin: 8px 16px 0 8px; border-bottom: 1px solid var(--cq-border); }
      #cq-local-usage .cq-local-tabs button { display: block; flex: 1; position: relative; padding: 4px 0 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cq-muted); border-radius: 0; }
      #cq-local-usage .cq-local-tabs button[aria-selected=true] { color: var(--cq-ink); font-weight: 600; }
      #cq-local-usage .cq-local-tabs button[aria-selected=true]::after { content: ""; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--cq-fill); }
      #cq-local-usage[data-page="3"] :is(.cq-local-periods,.cq-local-dates) { display: none; }
      #cq-local-usage[data-page="3"] .cq-local-estimate-tag { visibility: hidden; }
      #cq-local-usage .cq-interval-controls { position: relative; margin: 8px 16px 0 8px; }
      #cq-local-usage .cq-interval-endpoints { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8px; }
      #cq-local-usage .cq-interval-endpoint { min-width: 0; }
      #cq-local-usage .cq-interval-heading { display: flex; align-items: center; justify-content: space-between; min-height: 24px; color: var(--cq-muted); font-size: 11px; }
      #cq-local-usage .cq-interval-heading button { width: 24px; height: 24px; padding: 4px; color: var(--cq-muted); }
      #cq-local-usage .cq-interval-controls [type=text] { padding: 4px; margin-top: 4px; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-interval-controls [name$=Time] { font-size: 12px; font-weight: 500; }
      #cq-local-usage .cq-interval-endpoint [type=range] { appearance: none; width: 100%; height: 24px; margin: 4px 0 0; padding: 0; border: 0; opacity: 1; background: transparent; cursor: ew-resize; }
      #cq-local-usage .cq-interval-endpoint [type=range]::-webkit-slider-runnable-track { height: 2px; border-radius: 99px; background: var(--cq-track); }
      #cq-local-usage .cq-interval-endpoint [type=range]::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; margin-top: -7px; border: 2px solid var(--cq-solid); border-radius: 99px; background: var(--cq-ink); box-shadow: 0 1px 3px #0003; }
      #cq-local-usage .cq-interval-endpoint [type=range]:focus-visible { outline: 0; }
      #cq-local-usage .cq-interval-endpoint [type=range]:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #cq-local-usage .cq-interval-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; font-size: 11px; line-height: 20px; color: var(--cq-muted); }
      #cq-local-usage .cq-interval-presets { position: relative; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); margin-top: 8px; padding: 3px; border-radius: 7px; background: color-mix(in srgb,var(--cq-ink) 4%,transparent); }
      #cq-local-usage .cq-interval-presets button { position: relative; min-width: 0; padding: 4px 0; border-radius: 4px; font-size: 11px; line-height: 16px; white-space: nowrap; color: var(--cq-muted); }
      #cq-local-usage .cq-interval-presets button[aria-pressed=true] { color: var(--cq-ink); font-weight: 600; background: transparent; }
      #cq-local-usage .cq-interval-preset-marker { position: absolute; left: 0; top: 3px; bottom: 3px; border-radius: 4px; background: var(--cq-solid); box-shadow: 0 1px 3px #0001; pointer-events: none; }
      #cq-local-usage .cq-interval-actions output { margin-right: auto; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-interval-actions button { min-width: 72px; background: var(--cq-ink); color: var(--cq-solid); }
      #cq-local-usage .cq-interval-actions button:hover { background: color-mix(in srgb,var(--cq-ink) 88%,var(--cq-solid)); }
      @media (forced-colors: active) { #cq-local-usage .cq-interval-endpoint [type=range]::-webkit-slider-runnable-track { background: GrayText; forced-color-adjust: none; } #cq-local-usage .cq-interval-endpoint [type=range]::-webkit-slider-thumb { background: Highlight; border-color: Canvas; box-shadow: none; forced-color-adjust: none; } #cq-local-usage .cq-interval-preset-marker { background: Highlight; box-shadow: none; forced-color-adjust: none; } #cq-local-usage .cq-interval-presets button[aria-pressed=true] { color: HighlightText; forced-color-adjust: none; } }
      #cq-local-usage .cq-local-recent { padding-top: 16px; }
      #cq-local-usage .cq-local-recent-plan { margin-bottom: 8px; background: var(--cq-hover); }
      #cq-local-usage .cq-local-recent-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); column-gap: 16px; align-items: baseline; padding: 8px 0; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-local-recent-row > div { min-width: 0; }
      #cq-local-usage .cq-local-recent-row > :last-child { text-align: right; }
      #cq-local-usage .cq-local-interval-range { font-size: 11px; color: var(--cq-muted); line-height: 16px; margin: 0 0 8px; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-interval-coverage { display: grid; gap: 4px; margin: 12px 0 0; color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-recent-row strong { display: block; font-size: 16px; font-weight: 600; line-height: 24px; }
      #cq-local-usage .cq-local-recent-row strong { overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-recent-row strong[data-range] { font-size: 14px; }
      #cq-local-usage .cq-local-recent-row small { display: block; margin-top: 4px; font-size: 10px; line-height: 16px; color: var(--cq-muted); overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-recent .cq-local-page-note { font-size: 11px; margin: 16px 0 8px; }
      #cq-local-usage .cq-local-reference-plan { display: block; width: 100%; margin: 8px 0; min-height: 28px; border: 1px solid var(--cq-border); border-radius: 6px; padding: 4px 8px; background: var(--cq-solid); color: var(--cq-ink); font: inherit; font-size: 12px; }
      #cq-local-usage select:focus-visible { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #cq-local-usage .cq-local-reference-status:empty { display: none; }
      #cq-local-usage .cq-local-result { container-type: inline-size; position: relative; overflow: clip; }
      #cq-local-usage .cq-local-page { position: absolute; inset: 0; padding: 0 16px 0 8px; max-height: var(--cq-local-page-limit,320px); overflow-y: auto; overflow-x: hidden; scrollbar-width: none; overscroll-behavior: contain; overflow-anchor: none; }
      #cq-local-usage .cq-local-page[aria-hidden=false] { position: relative; inset: auto; }
      #cq-local-usage .cq-local-page-note { color: var(--cq-muted); font-size: 11px; line-height: 20px; margin: 24px 0; }
      #cq-local-usage .cq-local-placeholder { padding-top: 24px; color: var(--cq-muted); font-size: 11px; line-height: 20px; }
      #cq-local-usage .cq-local-placeholder p { margin: 16px 0 8px; }
      #cq-local-usage .cq-local-placeholder button { background: var(--cq-hover); }
      #cq-local-usage .cq-local-skeleton { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      #cq-local-usage .cq-local-skeleton i { display: block; height: 32px; border-radius: 4px; background: color-mix(in srgb,var(--cq-ink) 7%,transparent); }
      #cq-local-usage .cq-local-skeleton i:nth-child(n+3) { height: 16px; }
      #cq-local-usage .cq-local-skeleton i:last-child { grid-column: 1/-1; width: 72%; }
      #cq-local-usage .cq-local-range-label { margin: 16px 0; color: var(--cq-muted); font-size: 12px; line-height: 16px; }
      #cq-local-usage .cq-local-highlights { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; margin: 0 0 20px; }
      #cq-local-usage .cq-local-metric-label { display: block; color: var(--cq-muted); font-size: 12px; line-height: 16px; margin-bottom: 6px; }
      #cq-local-usage .cq-local-highlights strong { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 1px; font-weight: 650; line-height: 30px; letter-spacing: -.025em; }
      #cq-local-usage .cq-local-value-number { font-size: clamp(16px, 12cqi, 18px); }
      #cq-local-usage .cq-local-value-unit { font-size: 11px; font-weight: 500; letter-spacing: 0; }
      #cq-local-usage .cq-local-estimate-bound { display: inline-flex; align-items: baseline; white-space: nowrap; }
      #cq-local-usage .cq-local-estimate-note { display: block; color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-method-scope { color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-method-values { margin: 8px 0 12px; }
      #cq-local-usage .cq-local-method-values > div { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 8px; align-items: baseline; padding: 4px 0; }
      #cq-local-usage .cq-local-method-values dt { color: var(--cq-muted); font-size: 11px; }
      #cq-local-usage .cq-local-method-values dd { margin: 0; text-align: right; font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-price-part { display: inline-flex; align-items: baseline; white-space: nowrap; }
      #cq-local-usage .cq-local-price-part[data-long] .cq-local-value-number { font-size: 16px; }
      #cq-local-usage strong[data-range] .cq-local-value-number { font-size: 16px; }
      #cq-local-usage strong[data-unavailable] { font-size: 13px; font-weight: 500; letter-spacing: 0; }
      #cq-local-usage .cq-local-usage-group { padding: 12px; margin-bottom: 16px; border-radius: var(--radius-sm,6px); background: color-mix(in srgb,var(--cq-ink) 3%,transparent); }
      #cq-local-usage .cq-local-usage-details { border-top: 1px solid var(--cq-border); }
      #cq-local-usage #cq-local-page-overview > .cq-local-usage-details { border: 0; }
      #cq-local-usage #cq-local-page-overview > .cq-local-usage-details > summary { display: none; }
      #cq-local-usage #cq-local-page-overview .cq-local-range-label { margin: 12px 0 8px; }
      #cq-local-usage #cq-local-page-overview .cq-local-highlights { margin-bottom: 8px; }
      #cq-local-usage #cq-local-page-overview .cq-local-usage-group { padding: 8px; margin: 0; }
      #cq-local-usage #cq-local-page-overview .cq-local-metrics { gap: 8px 12px; }
      #cq-local-usage #cq-local-page-overview .cq-local-cache { margin-top: 8px; padding-top: 8px; }
      #cq-local-usage #cq-local-page-daily .cq-local-daily { margin: 8px 0 0; }
      #cq-local-usage #cq-local-page-daily .cq-local-day-detail { min-height: 0; margin: 8px 0 16px; }
      #cq-local-usage #cq-local-page-daily .cq-local-chart-plot, #cq-local-usage #cq-local-page-daily .cq-local-day { height: 96px; }
      #cq-local-usage #cq-local-page-daily .cq-local-chart-plot { background-size: 100% 76px; }
      #cq-local-usage #cq-local-page-daily .cq-local-day-rail, #cq-local-usage #cq-local-page-daily .cq-local-day-selection { height: 76px; }
      #cq-local-usage .cq-local-metrics { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px 12px; margin: 0; }
      #cq-local-usage .cq-local-metrics > div { display: flex; flex-direction: column-reverse; gap: 3px; }
      #cq-local-usage .cq-local-metrics dt { color: var(--cq-muted); font-size: 11px; line-height: 16px; }
      #cq-local-usage .cq-local-metrics dd { margin: 0; font-size: clamp(13px,8.8cqi,16px); line-height: 22px; font-weight: 600; letter-spacing: -.015em; overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-token-unit { font-size: 10px; font-weight: 500; margin-left: 2px; }
      #cq-local-usage .cq-local-cache { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--cq-border); }
      #cq-local-usage .cq-local-cache-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-cache-track { height: 3px; overflow: hidden; border-radius: 2px; background: var(--cq-track); }
      #cq-local-usage .cq-local-cache-track i { display: block; min-width: 2px; max-width: 100%; height: 100%; background: var(--cq-chart-cache); border-radius: inherit; }
      #cq-local-usage .cq-local-daily { margin: 0 0 16px; padding: 8px; border-radius: var(--radius-sm,6px); background: color-mix(in srgb,var(--cq-ink) 3%,transparent); }
      #cq-local-usage .cq-local-chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 500; }
      #cq-local-usage .cq-local-chart-nav { display: flex; gap: 4px; }
      #cq-local-usage .cq-local-chart-nav button { width: 24px; height: 24px; padding: 5px; }
      #cq-local-usage .cq-local-chart-nav svg { width: 14px; height: 14px; }
      #cq-local-usage .cq-local-chart-next { transform: rotate(180deg); }
      #cq-local-usage .cq-local-day-detail { min-height: 88px; margin: 8px 0 12px; }
      #cq-local-usage .cq-local-day-date { font-size: 11px; line-height: 16px; font-weight: 500; color: var(--cq-muted); }
      #cq-local-usage .cq-local-day-values { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
      #cq-local-usage .cq-local-day-values strong { display: block; font-size: clamp(12px,8cqi,16px); line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-day-values > div > span { display: block; font-size: 10px; line-height: 16px; color: var(--cq-muted); margin-top: 2px; }
      #cq-local-usage .cq-local-day-note { margin: 6px 0 0; color: var(--cq-muted); font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-chart-scale { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; font-size: 11px; line-height: 16px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-chart-scale[data-single] { justify-content: flex-end; }
      #cq-local-usage .cq-local-chart-plot { position: relative; isolation: isolate; display: grid; gap: 0; height: 110px; margin-top: 4px; background: repeating-linear-gradient(to top,transparent 0,transparent 29px,var(--cq-border) 29px,var(--cq-border) 30px); background-size: 100% 90px; background-repeat: no-repeat; }
      #cq-local-usage .cq-local-day-selection { position: absolute; top: 0; left: 0; height: 90px; border-radius: 4px; background: color-mix(in srgb,var(--cq-ink) 6%,transparent); pointer-events: none; z-index: -1; }
      #cq-local-usage .cq-local-day { position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; width: 100%; height: 110px; padding: 0 2px; border-radius: 4px; }
      #cq-local-usage .cq-local-day:hover, #cq-local-usage .cq-local-day[aria-pressed=true] { background: transparent; }
      #cq-local-usage .cq-local-day-rail { position: relative; display: flex; justify-content: center; align-items: flex-end; width: 100%; height: 90px; }
      #cq-local-usage .cq-local-day-bar { position: relative; display: flex; flex-direction: column; flex: none; width: min(14px,65%); border-radius: 2px 2px 0 0; overflow: hidden; transform-origin: center bottom; }
      #cq-local-usage .cq-local-day[aria-pressed=true] .cq-local-day-label { color: var(--cq-ink); font-weight: 600; }
      #cq-local-usage .cq-local-day[aria-pressed=true] .cq-local-day-bar { outline: 1px solid var(--cq-ink); outline-offset: 1px; }
      #cq-local-usage .cq-local-day-bar i { display: block; flex-basis: 0; min-height: 0; }
      #cq-local-usage [data-kind=input] { background: var(--cq-chart-input); }
      #cq-local-usage [data-kind=cache] { background: var(--cq-chart-cache); }
      #cq-local-usage [data-kind=output] { background: var(--cq-chart-output); }
      #cq-local-usage .cq-local-day-label { display: block; height: 20px; line-height: 20px; color: var(--cq-muted); font-size: 9px; }
      #cq-local-usage .cq-local-day-incomplete { position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%); color: var(--cq-ink); background: var(--cq-solid); border: 1px dashed currentColor; font-size: 9px; line-height: 12px; min-width: 12px; border-radius: 2px; }
      #cq-local-usage .cq-local-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; font-size: 9px; line-height: 14px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-chart-legend span { display: inline-flex; align-items: center; gap: 4px; background: transparent; }
      #cq-local-usage .cq-local-chart-legend span::before { content: ""; width: 5px; height: 5px; background: var(--cq-chart-input); border-radius: 1px; }
      #cq-local-usage .cq-local-chart-legend [data-kind=cache]::before { background: var(--cq-chart-cache); }
      #cq-local-usage .cq-local-chart-legend [data-kind=output]::before { background: var(--cq-chart-output); }
      #cq-local-usage .cq-local-models { border-top: 1px solid var(--cq-border); font-size: 11px; }
      #cq-local-usage .cq-local-model { display: grid; grid-template-columns: minmax(0,1fr) 64px; align-items: center; gap: 4px 8px; padding: 4px 0; font-size: 11px; line-height: 16px; }
      #cq-local-usage .cq-local-model-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      #cq-local-usage .cq-local-model-value { font-size: 12px; font-weight: 600; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-local-model-share { color: var(--cq-muted); font-size: 10px; text-align: right; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-local-model-track { height: 3px; border-radius: 2px; background: var(--cq-track); overflow: hidden; }
      #cq-local-usage .cq-local-model-track i { display: block; height: 100%; min-width: 2px; max-width: 100%; border-radius: inherit; background: var(--cq-muted); }
      #cq-local-usage .cq-local-models .cq-local-excluded { margin: 8px 0 12px; font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-api-note { color: var(--cq-muted); font-size: 10px; line-height: 16px; margin: 4px 0 0; }
      #cq-local-usage .cq-local-excluded, #cq-local-usage .cq-local-status, #cq-local-usage .cq-local-reference, #cq-local-usage .cq-local-issues { margin: 16px 0 0; color: var(--cq-muted); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-status { max-height: 48px; margin-top: 8px; overflow-y: auto; scrollbar-width: none; font-size: 10px; }
      #cq-local-usage .cq-local-status[data-cq-quiet] { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); }
      #cq-local-usage .cq-local-status:empty { display: none; }
      #cq-local-usage .cq-local-status { margin-right: 16px; margin-left: 8px; }
      #cq-local-usage .cq-local-reference { border-top: 1px solid var(--cq-border); padding-top: 0; margin: 0; }
      #cq-local-usage .cq-local-reference a { display: inline-block; margin: 8px 0 0; font-size: 10px; text-decoration: underline; text-underline-offset: 2px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-reference-section { margin: 8px 0 16px; font-size: 11px; line-height: 16px; }
      #cq-local-usage .cq-local-reference-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      #cq-local-usage .cq-local-reference-heading strong { color: var(--cq-ink); font-weight: 500; }
      #cq-local-usage .cq-local-reference-heading > span { font-size: 10px; }
      #cq-local-usage .cq-local-baselines { display: grid; gap: 8px; margin: 0; padding: 8px; border-radius: var(--radius-sm,6px); background: color-mix(in srgb,var(--cq-ink) 3%,transparent); }
      #cq-local-usage .cq-local-baselines > div { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: baseline; gap: 8px; }
      #cq-local-usage .cq-local-baselines > [data-dual] { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
      #cq-local-usage .cq-local-baselines > [data-dual] dt { grid-column: 1/-1; }
      #cq-local-usage .cq-local-baselines > [data-dual] dd:nth-child(2) { text-align: left; }
      #cq-local-usage .cq-local-baselines dt { color: var(--cq-muted); overflow-wrap: anywhere; }
      #cq-local-usage .cq-local-baselines dd { margin: 0; color: var(--cq-ink); font-size: 12px; font-weight: 600; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
      #cq-local-usage .cq-local-caveats { border-top: 1px solid var(--cq-border); }
      #cq-local-usage .cq-local-caveats > summary { font-size: 11px; color: var(--cq-muted); }
      #cq-local-usage .cq-local-caveats p { font-size: 10px; line-height: 16px; }
      #cq-local-usage .cq-local-status[data-cq-warning], #cq-local-usage .cq-local-reference-status[data-cq-warning], #cq-local-usage .cq-local-recent-account[data-cq-warning] > small:not(.cq-interval-sampled-range), #cq-local-usage .cq-local-day-values > div > .cq-local-partial, #cq-local-usage :is(.cq-local-partial,.cq-interval-api-coverage,.cq-local-api-note) { color: var(--cq-warning); }
      @media (forced-colors: active) { #cq-local-usage .cq-local-model-track { forced-color-adjust: none; background: GrayText; } #cq-local-usage .cq-local-model-track i { background: Highlight; } #cq-local-usage .cq-local-baselines { outline: 1px solid CanvasText; } }
      #cq-local-usage summary { display: flex; align-items: center; gap: 8px; min-height: 36px; list-style: none; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--cq-ink); }
      #cq-local-usage summary::-webkit-details-marker { display: none; }
      #cq-local-usage .cq-local-detail-meta { margin-left: auto; color: var(--cq-muted); font-size: 11px; font-weight: 400; }
      #cq-local-usage .cq-local-detail-arrow { flex: none; width: 12px; height: 12px; margin-left: auto; color: var(--cq-muted); transform: rotate(180deg); }
      #cq-local-usage .cq-local-detail-meta + .cq-local-detail-arrow { margin-left: 0; }
      #cq-local-usage details[open] > summary .cq-local-detail-arrow { transform: rotate(270deg); }
      @media (forced-colors: active) { #cq-local-usage .cq-local-usage-group { outline: 1px solid CanvasText; } #cq-local-usage .cq-local-cache-track { forced-color-adjust: none; background: GrayText; } #cq-local-usage .cq-local-cache-track i { background: Highlight; } }
      @media (forced-colors: active) { #cq-local-usage .cq-local-daily { outline: 1px solid CanvasText; } #cq-local-usage .cq-local-day-bar i, #cq-local-usage .cq-local-chart-legend span::before { forced-color-adjust: none; } #cq-local-usage [data-kind=input] { background: CanvasText; } #cq-local-usage [data-kind=cache] { background: Highlight; } #cq-local-usage [data-kind=output] { background: GrayText; } #cq-local-usage .cq-local-chart-legend [data-kind=input]::before { background: CanvasText; } #cq-local-usage .cq-local-chart-legend [data-kind=cache]::before { background: Highlight; } #cq-local-usage .cq-local-chart-legend [data-kind=output]::before { background: GrayText; } }
      #cq-local-usage .cq-local-detail-body p { margin: 8px 0 0; }
      #cq-settings { padding: 0; }
      #cq-settings header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin: 0 0 16px; padding: 0 var(--cq-control-right, 6px) 0 8px; }
      #cq-settings h2 { font-size: 14px; line-height: 20px; font-weight: 600; letter-spacing: -.01em; margin: 0; }
      #cq-settings header button { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 4px; border-radius: 6px; color: var(--cq-muted); }
      #cq-settings header svg { width: 16px; height: 16px; }
      #cq-settings :is(button,a):active { background: var(--cq-hover); color: var(--cq-ink); }
      #cq-settings .cq-settings-feedback { margin: 8px 16px 0 8px; color: var(--cq-muted); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
      #cq-settings .cq-settings-feedback:empty { display: none; }
      #cq-settings .cq-options { padding: 0 16px 0 8px; }
      #cq-settings .cq-option-group + .cq-option-group { margin-top: 8px; border-top: 1px solid var(--cq-border); padding-top: 16px; }
      #cq-settings h3 { margin: 0 0 8px; font-size: 11px; line-height: 16px; font-weight: 500; color: var(--cq-muted); }
      #cq-settings .cq-setting-row { display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; min-height: 32px; padding: 8px 0; gap: 8px; font-size: 12px; line-height: 16px; cursor: pointer; }
      #cq-settings .cq-threshold-row { color: var(--cq-muted); font-size: 11px; }
      #cq-settings :is(input,select) { min-width: 0; accent-color: var(--cq-ink); }
      #cq-settings .cq-threshold-field { position: relative; display: flex; align-items: center; flex: none; width: 72px; }
      #cq-settings .cq-threshold-field > span { position: absolute; right: 8px; pointer-events: none; font-size: 11px; }
      #cq-settings input:not([type=checkbox]) { width: 100%; height: 24px; padding: 0 20px 0 8px; border: 1px solid var(--cq-border); border-radius: 4px; background: color-mix(in srgb, var(--cq-ink) 3%, transparent); color: var(--cq-ink); font-size: 11px; font-variant-numeric: tabular-nums; }
      #cq-settings .cq-switch { position: relative; display: inline-flex; flex: none; width: 28px; height: 16px; }
      #cq-settings .cq-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
      #cq-settings .cq-switch-track { width: 28px; height: 16px; border-radius: 99px; background: #cfc9ba; pointer-events: none; transition: background 130ms ease; }
      #cq-settings .cq-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 99px; background: #fdfcf8; box-shadow: 0 1px 2px #20252240; transition: transform 130ms ease; }
      #cq-settings .cq-switch input:checked + .cq-switch-track { background: var(--cq-fill); }
      #cq-settings .cq-switch input:checked + .cq-switch-track::after { transform: translateX(12px); }
      #cq-settings .cq-switch input:focus-visible + .cq-switch-track { outline: 2px solid var(--cq-ink); outline-offset: 2px; }
      #cq-settings .cq-tools { display: flex; flex-wrap: wrap; align-items: center; column-gap: 16px; row-gap: 0; margin: 8px 16px 0 8px; padding-top: 8px; border-top: 1px solid var(--cq-border); font-size: 11px; line-height: 16px; color: var(--cq-muted); }
      #cq-settings .cq-tools :is(button,a) { display: inline-flex; align-items: center; min-height: 24px; padding: 0; border-radius: 4px; text-decoration: none; }
      #cq-settings .cq-tools .cq-release-link { flex-basis: 100%; min-width: 0; justify-content: space-between; gap: 8px; }
      #cq-settings .cq-release-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #cq-settings .cq-release-link span:last-child { flex: none; }
      @media (forced-colors: active) { #codex-quota-popover .cq-settings-button[data-cq-update]::after { forced-color-adjust: none; background: Highlight; outline-color: Canvas; } }
      #cq-settings pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.5 var(--default-font-family, sans-serif); margin: 8px 16px 0 8px; user-select: text; }
      #cq-settings pre:empty { display: none; }
      #codex-quota-trigger { position: relative; gap: 8px; font-variant-numeric: tabular-nums; --cq-alert-ink: #b42318; --cq-alert-label: #8f453e; --cq-alert-surface: #fbe4e1; --cq-alert-border: #dca29b; }
      #codex-quota-trigger[data-cq-dark] { --cq-alert-ink: #ff958c; --cq-alert-label: #e0aaa4; --cq-alert-surface: #4a2929; --cq-alert-border: #965654; }
      #codex-quota-trigger[data-cq-alert="recovery"] { --cq-alert-ink: var(--cq-ink); --cq-alert-label: var(--cq-muted); --cq-alert-surface: var(--cq-solid); --cq-alert-border: var(--cq-border); }
      #codex-quota-trigger > :is(.cq-trigger-plan,.cq-trigger-chevron,.cq-trigger-icon) { position: relative; z-index: 1; }
      :is(#codex-quota-trigger,#codex-quota-popover) .cq-plan-badge:is([data-cq-tier="pro"],[data-cq-tier="plus"]) { width: 30px; padding-inline: 0; text-align: center; }
      #codex-quota-trigger .cq-inline-surface { position: absolute; inset: -1px; border: 1px solid var(--cq-alert-border); border-radius: inherit; background: var(--cq-alert-surface); pointer-events: none; }
      #codex-quota-trigger .cq-inline-alert { position: absolute; height: 24px; display: flex; align-items: baseline; justify-content: space-between; overflow: hidden; pointer-events: none; z-index: 1; font-family: "Noto Sans SC", "Microsoft YaHei UI", "Segoe UI", sans-serif; line-height: 24px; white-space: nowrap; }
      #codex-quota-trigger .cq-inline-alert > :is(.cq-inline-label,.cq-inline-value) { position: relative; transform-origin: left center; }
      #codex-quota-trigger .cq-inline-label { font-size: 12px; font-weight: 400; color: var(--cq-alert-label); }
      #codex-quota-trigger .cq-inline-value { font-size: 14px; font-weight: 600; color: var(--cq-alert-ink); }
      #codex-quota-trigger .cq-inline-percent { margin-left: 1px; font-size: 11px; font-weight: 500; }
      #codex-quota-trigger .cq-inline-source { position: absolute; inset: 0; display: flex; align-items: center; width: 100%; height: 24px; }
      #codex-quota-trigger .cq-inline-source > * { transform-origin: left center; }
      #codex-quota-trigger[data-cq-alert-visible] > :is(.cq-trigger-copy,.cq-trigger-graphics) { visibility: hidden; }
      #codex-quota-trigger[data-cq-alert-visible]:not([data-cq-collapsed])::after { visibility: hidden; }
      #codex-quota-trigger[data-cq-collapsed][data-cq-alert-visible] { color: var(--cq-alert-ink); }
      #codex-quota-trigger :is(.cq-inline-alert,.cq-inline-surface)[hidden] { display: none; }
      #cq-inline-announcement { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; pointer-events: none; }
      @media (forced-colors: active) { #codex-quota-trigger[data-cq-alert] { --cq-alert-ink: CanvasText; --cq-alert-label: CanvasText; --cq-alert-surface: Canvas; --cq-alert-border: Highlight; } }
      #cq-refresh-message { position: fixed; inset: auto; margin: 0; width: max-content; max-width: min(280px, calc(100vw - 24px)); box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cq-border, ButtonBorder); border-radius: 8px; background: var(--cq-solid, Canvas); color: var(--cq-ink, CanvasText); font: 12px/1.5 var(--default-font-family, sans-serif); pointer-events: none; overflow-wrap: anywhere; }
      @media (prefers-reduced-motion: reduce) { #codex-quota-popover, #codex-quota-popover:popover-open, #codex-quota-trigger { transition: none; transform: none; } }
      @media (prefers-reduced-motion: reduce) { #codex-quota-trigger .cq-trigger-plan, #codex-quota-trigger .cq-trigger-copy, #codex-quota-trigger .cq-trigger-graphics, #codex-quota-trigger .cq-trigger-graphics > *, #codex-quota-trigger .cq-trigger-chevron { transition: none !important; } }
      @media (prefers-reduced-motion: reduce) { #codex-quota-trigger .cq-gauge-needle { transition: none; } }
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

  const quotaErrorCode = () => globalThis.__codexQuotaOfficialErrorCode || (globalThis.__codexQuotaOfficialError ? "UNAVAILABLE" : null);

  const quotaTiming = () => ({
    lastSuccessAt: Number(globalThis.__codexQuotaOfficialLastSuccessAt || 0),
    nextAttemptAt: Number(globalThis.__codexQuotaOfficialNextAutoAttemptAt || 0),
    cooldownUntil: Number(globalThis.__codexQuotaOfficialCooldownUntil || 0),
  });

  const recordQuotaInteraction = () => {
    const now = Date.now();
    globalThis.__codexQuotaLastInteractionAt = now;
    const {lastSuccessAt} = quotaTiming();
    if (!lastSuccessAt || quotaErrorCode()) return;
    globalThis.__codexQuotaOfficialNextAutoAttemptAt = lastSuccessAt + adaptiveRefreshDelayMs(now);
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
    const needsData = globalThis.__codexQuotaOfficialNeedsData === true;
    const loaded = globalThis.__codexQuotaOfficialLoaded === true;
    const {lastSuccessAt, cooldownUntil} = quotaTiming();
    if (globalThis.__codexQuotaAwaitingFreshSession && !data) return {busy: false, text: words("暂不可用，等待账户连接", "Unavailable; awaiting account connection")};
    if (needsData) return {busy: true, text: copy.refreshing};
    if (errorCode) {
      const reason = Object.hasOwn(requestErrorReasons, errorCode) ? requestErrorReasons[errorCode] : "";
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
          : copy.officialUnavailable,
      };
    }
    return {busy: false, text: null};
  };

  const setRefreshButtonState = (button, busy) => {
    const showingMessage = document.getElementById("cq-refresh-message")?.cqOwner === button;
    const kind = button.dataset.cqKind;
    const data = globalThis.__codexQuotaOfficialPayload;
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
    const busy = globalThis.__codexQuotaOfficialNeedsData === true;
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
      requestOfficialData(true);
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
    const usage = document.createElement("button");
    usage.type = "button";
    usage.className = "cq-local-usage-button";
    usage.title = words("本机用量与周额度估算", "Local usage and weekly quota estimate");
    usage.setAttribute("aria-label", usage.title);
    usage.setAttribute("aria-haspopup", "dialog");
    usage.append(toolIcon("usage", "cq-usage-icon"));
    usage.onclick = () => openLocalUsage(usage);
    actions.append(button, usage, settings);
    queueMicrotask(syncReleaseUI);
    return actions;
  };

  const setCardAccessibility = (card, busy) => {
    card.setAttribute("role", "region");
    card.removeAttribute("aria-live");
    card.removeAttribute("aria-atomic");
    card.setAttribute("aria-busy", String(busy));
    const error = quotaErrorCode("official");
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
      status.id = `cq-status-${"official"}`;
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
    const card = document.getElementById(officialHostId);
    const content = card?.querySelector(`.${compactContentClass}`);
    const retryAt = formatStatusTime(cooldownUntil);
    if (!card || !content || !retryAt) return;
    const data = globalThis.__codexQuotaOfficialPayload || nativeSnapshot;
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
  const timeRingMarkup = '<svg class="cq-time-ring" viewBox="0 0 18 18" role="img" focusable="false"><circle class="cq-ring-track" cx="9" cy="9" r="7"/><circle class="cq-ring-fill" cx="9" cy="9" r="7" pathLength="100"/></svg>';

  const setPlanBadge = (badge, label, tier = "") => {
    badge.hidden = !label;
    badge.textContent = label;
    badge.title = label;
    if (tier) badge.dataset.cqTier = tier;
    else delete badge.dataset.cqTier;
  };

  const renderGauge = (trigger, data) => {
    const needle = trigger.querySelector(".cq-gauge-needle");
    const windows = data?.windows || [];
    const limiting = windows.length && windows.every(item => Number.isFinite(item.usedPercent) && item.usedPercent >= 0 && item.usedPercent <= 100)
      ? windows.reduce((a, b) => a.usedPercent >= b.usedPercent ? a : b) : null;
    if (!limiting) {
      needle.setAttribute("hidden", "");
      needle.style.removeProperty("transform");
      delete needle.dataset.remaining;
      return "";
    }
    const remaining = 100 - limiting.usedPercent;
    // Left = empty, upright = half, right = full. The data is remaining quota,
    // independent of the elapsed-time rings in the expanded quota view.
    needle.style.transform = `rotate(${remaining * 1.8 - 90}deg)`;
    needle.dataset.remaining = String(remaining);
    needle.removeAttribute("hidden");
    return `${windowName(limiting.label)} ${copy.remainingAvailable} ${formatPercent(remaining)}%`;
  };

  const renderTrigger = (trigger, kind, data, summary) => {
    trigger.querySelector(".cq-trigger-copy").textContent = summary;
    const presentation = officialPresentation(data);
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
      const gaugeLabel = renderGauge(trigger, data);
      let description = planLabel ? `${planLabel} · ${summary}` : summary;
      if (trigger.hasAttribute("data-cq-collapsed") && gaugeLabel) description += ` · ${words("指针", "Needle")}: ${gaugeLabel}`;
      if (state.text) description += ` · ${state.text}`;
      trigger.setAttribute("aria-label", description + (low ? words("，额度偏低", ", low quota") : ""));
      trigger.title = description;
      trigger.cqBaseLabel = trigger.getAttribute("aria-label");
      trigger.cqBaseTitle = description;
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

  const clearQuotaRequest = (kind) => {
    clearTimeout(requestTimers.get(kind));
    requestTimers.delete(kind);
    const prefix = "__codexQuotaOfficial";
    delete globalThis[prefix + "RequestId"];
    delete globalThis[prefix + "RequestDeadline"];
  };

  const armRequestTimeout = (kind) => {
    clearTimeout(requestTimers.get(kind));
    requestTimers.delete(kind);
    const prefix = "__codexQuotaOfficial";
    const requestId = globalThis[prefix + "RequestId"];
    if (!requestId || disposed) return;
    const remaining = Number(globalThis[prefix + "RequestDeadline"] || 0) - Date.now();
    if (remaining <= 0) {
      clearQuotaRequest(kind);
      const receive = globalThis.__codexQuotaUpdateOfficial;
      receive({errorCode: "REQUEST_TIMEOUT"});
      return;
    }
    requestTimers.set(kind, setTimeout(() => armRequestTimeout(kind), remaining));
  };

  const beginQuotaRequest = (kind, manual) => {
    const prefix = "__codexQuotaOfficial";
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
    const pendingId = globalThis.__codexQuotaOfficialRequestId;
    if ((pendingId || requestId != null) && requestId !== pendingId) return false;
    const deadline = globalThis.__codexQuotaOfficialRequestDeadline;
    if (pendingId && Date.now() >= deadline) { armRequestTimeout(kind); return false; }
    clearQuotaRequest(kind);
    return true;
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
    const {nextAttemptAt, cooldownUntil} = quotaTiming();
    const nextAt = Math.max(nextAttemptAt, cooldownUntil);
    if (nextAt > 0 && Date.now() >= nextAt) {
      requestOfficialData();
      return;
    }
    scheduleAutoRefresh();
  };

  const scheduleAutoRefresh = () => {
    clearTimeout(globalThis.__codexQuotaAutoRefreshTimer);
    globalThis.__codexQuotaAutoRefreshTimer = null;
    if (document.visibilityState !== "visible") return;
    const loaded = globalThis.__codexQuotaOfficialLoaded === true;
    if (!loaded) return;
    const {lastSuccessAt, nextAttemptAt, cooldownUntil} = quotaTiming();
    const fallbackNextAt = lastSuccessAt ? lastSuccessAt + adaptiveRefreshDelayMs() : 0;
    const networkNextAt = Math.max(nextAttemptAt || fallbackNextAt, cooldownUntil);
    const now = Date.now();
    const timedCard = document.querySelector(`.${compactContentClass}[data-cq-layout="sidebar-v3"]`);
    const ringNextAt = timedCard ? now + (60000 - (now % 60000)) : Infinity;
    const nextAt = Math.min(networkNextAt || Infinity, ringNextAt);
    if (!Number.isFinite(nextAt)) return;
    globalThis.__codexQuotaAutoRefreshTimer = setTimeout(() => {
      globalThis.__codexQuotaAutoRefreshTimer = null;
      if (document.visibilityState !== "visible") return;
      const card = document.getElementById(officialHostId);
      if (card) applyOfficialTime(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot);
      refreshStaleData();
    }, Math.min(2147483647, Math.max(1000, nextAt - Date.now())));
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
      armRequestTimeout("official");
      const card = document.getElementById(officialHostId);
      if (card) applyOfficialTime(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot);
      recordQuotaInteraction("official");
      refreshStaleData();
    };
    globalThis.__codexQuotaAutoRefreshHandler = handler;
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", handler);
    armRequestTimeout("official");
    if (document.visibilityState === "visible") recordQuotaInteraction("official");
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
    if (data && Object.hasOwn(data, "network")) globalThis.__codexQuotaNetworkDiagnosis = sanitizeNetworkDiagnosis(data.network);
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
    const card = document.getElementById(officialHostId);
    if (card) renderOfficial(card, globalThis.__codexQuotaOfficialPayload || nativeSnapshot, quotaErrorCode("official"));
    if (awaitingSession && !globalThis.__codexQuotaAwaitingFreshSession) installLayout();
    scheduleAutoRefresh();
  };

  // These anchors are from the installed host shell, not the offline prototype.
  const columnSelector = ".sidebar-navigation";
  const railSelector = 'nav[data-app-navigation-rail="true"]';
  let anchors = null;
  let quotaShell = null;
  let nativeSnapshot = null;
  const clipsOverflow = value => /^(hidden|clip|scroll|auto)$/.test(value);
  const visibleRect = (node) => {
    if (!(node instanceof Element) || !node.isConnected || !node.getClientRects().length) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return null;
    let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return null;
      // The host can collapse by clipping a still full-width sidebar.
      if (parent !== node && style.display !== "contents" && (clipsOverflow(style.overflowX) || clipsOverflow(style.overflowY))) {
        const box = parent.getBoundingClientRect();
        const scaleX = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
        const scaleY = parent.offsetHeight ? box.height / parent.offsetHeight : 1;
        if (clipsOverflow(style.overflowX)) {
          const edge = box.left + parent.clientLeft * scaleX;
          left = Math.max(left, edge); right = Math.min(right, edge + parent.clientWidth * scaleX);
        }
        if (clipsOverflow(style.overflowY)) {
          const edge = box.top + parent.clientTop * scaleY;
          top = Math.max(top, edge); bottom = Math.min(bottom, edge + parent.clientHeight * scaleY);
        }
        if (right - left < 1 || bottom - top < 1) return null;
      }
    }
    return right - left >= 1 && bottom - top >= 1 ? {left, right, top, bottom, width: right - left, height: bottom - top} : null;
  };
  const visible = node => Boolean(visibleRect(node));
  const columnEntrySpace = (column, minimumWidth) => {
    const area = visibleRect(column);
    if (!area) return null;
    const rect = column.getBoundingClientRect(), style = getComputedStyle(column);
    const footer = getComputedStyle(quotaShell.footer);
    const scale = column.offsetWidth ? rect.width / column.offsetWidth : 1;
    const trigger = quotaShell.trigger, entry = getComputedStyle(trigger);
    const fixed = [...trigger.querySelectorAll(':scope > .cq-trigger-plan, :scope > .cq-trigger-chevron')].filter(node => !node.hidden);
    const fixedWidth = fixed.reduce((width, node) => width + (parseFloat(getComputedStyle(node).width) || node.getBoundingClientRect().width / scale), 0);
    // The badge and arrow cannot shrink with the central text, including while the rail hides them.
    const minimumEntry = (fixedWidth + fixed.length * parseFloat(entry.columnGap) + parseFloat(entry.paddingLeft) + parseFloat(entry.paddingRight) + 2 * parseFloat(entry.getPropertyValue('--cq-entry-border-width'))) * scale;
    const contentLeft = rect.left + (column.clientLeft + parseFloat(style.paddingLeft)) * scale;
    const contentRight = rect.left + (column.clientLeft + column.clientWidth - parseFloat(style.paddingRight)) * scale;
    const left = Math.max(contentLeft, area.left), right = Math.min(contentRight, area.right);
    // A sliver cannot host an entry. Wider partial columns can use their actual visible space.
    if (right - left - (parseFloat(footer.paddingLeft) + parseFloat(footer.paddingRight)) * scale < Math.max(minimumWidth, minimumEntry)) return null;
    return {marginLeft: (left - contentLeft) / scale, marginRight: (contentRight - right) / scale};
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
    const minimumWidth = profiles[0].getBoundingClientRect().width;
    let entrySpace = null;
    const column = [...document.querySelectorAll(columnSelector)].find(node => (entrySpace = columnEntrySpace(node, minimumWidth))) || null;
    return {rail, avatar, stack, column, entrySpace};
  };
  const positionPopover = () => {
    const popup = document.getElementById("codex-quota-popover");
    const trigger = document.getElementById("codex-quota-trigger");
    if (sharedPopover || paneMotion || localLayout || !popup?.matches(":popover-open") || !visible(trigger)) { syncInlineAlert(); return; }
    const rect = trigger.getBoundingClientRect();
    const column = anchors?.column ? visibleRect(anchors.column) : null;
    const leftEdge = column ? Math.max(12, column.left + 8) : 12;
    const rightEdge = column ? Math.min(innerWidth - 12, column.right - 8) : innerWidth - 12;
    const width = Math.max(0, Math.min(272, column ? column.width - 16 : 272, rightEdge - leftEdge));
    popup.style.width = width + "px";
    popup.querySelector('.cq-local-page[aria-hidden="false"] .cq-local-daily')?.cqResize?.();
    const bottom = column ? Math.min(rect.bottom, column.bottom, innerHeight) : innerHeight - 12;
    popup.style.maxHeight = Math.max(0, bottom - 12) + "px";
    const localPage=popup.querySelector('#cq-local-usage:not([hidden]) .cq-local-page[aria-hidden="false"]');
    if(localPage) {
      const scale=popup.getBoundingClientRect().width/popup.offsetWidth;
      const chrome=popup.scrollHeight+popup.offsetHeight-popup.clientHeight-localPage.offsetHeight;
      popup.style.setProperty("--cq-local-page-limit",Math.max(0,Math.min(320,(bottom-12)/scale-chrome))+"px");
    }
    const preferredLeft = column ? rect.right - width : rect.right + 8;
    popup.style.left = Math.max(leftEdge, Math.min(rightEdge - width, preferredLeft)) + "px";
    const height = popup.getBoundingClientRect().height;
    const top = column ? bottom - height : rect.bottom - height;
    popup.style.top = Math.max(12, Math.min(bottom - height, top)) + "px";
    const box = popup.getBoundingClientRect();
    const arrow = trigger.querySelector(".cq-trigger-chevron").getBoundingClientRect();
    const collapse = quotaShell.collapse;
    const controlLeft = column ? arrow.left + arrow.width / 2 - box.left - popup.clientLeft - 12 : popup.clientWidth - 30;
    collapse.style.left = controlLeft + "px";
    // Both right-hand tools share the measured entry arrow axis.
    const heading = popup.querySelector(":is(#cq-settings,#cq-local-usage):not([hidden]) header") || popup.querySelector(".cq-heading");
    if (heading?.getClientRects().length) popup.style.setProperty("--cq-control-right",
      (heading.getBoundingClientRect().right - box.left - popup.clientLeft - controlLeft - 24) + "px");
    collapse.style.top = (column ? arrow.top + arrow.height / 2 - box.top - popup.clientTop + popup.scrollTop - 12 : popup.scrollTop + popup.clientHeight - 30) + "px";
    document.getElementById("cq-local-usage")?.cqPositionCalendar?.();
    document.querySelector('.cq-interval-controls')?.cqPositionPresets?.();
    syncReleaseUI();
    syncInlineAlert();
  };
  const finishSharedPopover = () => {
    const state = sharedPopover;
    if (!state) return;
    sharedPopover = null;
    for (const animation of state.animations || []) { animation.onfinish = null; animation.cancel(); }
    state.layer?.remove();
    state.surface?.remove();
    for (const {from, to} of state.actors) {
      from.removeAttribute("data-cq-shared-hidden");
      to.removeAttribute("data-cq-shared-hidden");
    }
    for (const name of ["opacity", "clip-path"]) state.content.style.removeProperty(name);
    const {popup, trigger, collapse} = quotaShell;
    popup.removeAttribute("data-cq-morph");
    popup.removeAttribute("data-cq-rail-motion");
    collapse.firstElementChild.style.removeProperty("transform");
    const open = popup.matches(":popover-open");
    if (!open && inlineAlert && state.inlineSnapshot) inlineAlert.resume = state.inlineSnapshot;
    trigger.toggleAttribute("data-cq-replaced", open && !trigger.hasAttribute("data-cq-collapsed"));
    trigger.tabIndex = trigger.getAttribute("aria-expanded") === "true" && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
    collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
    collapse.title = collapse.getAttribute("aria-label");
    positionPopover();
  };

  const animateSharedPopover = (open) => {
    const {popup, trigger, collapse} = quotaShell;
    if (reducedMotion.matches || document.visibilityState !== "visible" || !visible(trigger)) {
      finishSharedPopover();
      return false;
    }
    if (!sharedPopover && trigger.hasAttribute("data-cq-collapsed")) {
      settlePopoverMotion();
      const content = [...popup.children].find(node => !node.hidden && node !== collapse);
      if (!content) return false;
      const rect = popup.getBoundingClientRect(), origin = trigger.getBoundingClientRect();
      const dx = Math.max(12 - rect.left, Math.min(innerWidth - 12 - rect.right, Math.max(-6, Math.min(6, origin.left - rect.left))));
      const dy = Math.max(12 - rect.top, Math.min(innerHeight - 12 - rect.bottom, Math.max(-6, Math.min(6, origin.bottom - rect.bottom))));
      // A transparent navigation icon has no material to receive a shrinking card.
      // Fade the intact panel and its contents together; retain the icon throughout.
      sharedPopover = {initial: open ? 0 : 1, rail: true, actors: [], content, column: anchors.column,
        signature: JSON.stringify((globalThis.__codexQuotaOfficialPayload || nativeSnapshot) || null),
        framesAt: value => {
          const p = Math.max(0, Math.min(1, value));
          return [[popup, {opacity: p, transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px)`}],
            [content, {opacity: 1}], [collapse, {opacity: 1}]];
        }};
      popup.setAttribute("data-cq-rail-motion", "");
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
      // Only actual corresponding data is shared. text/rail modes never invent actors.
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
      const inlineSnapshot = open ? inlineAlert?.opening : null;
      if (inlineAlert) inlineAlert.opening = null;
      const state = {initial: open ? 0 : 1, actors, layer, surface, content, column: anchors.column, inlineSnapshot,
        signature: JSON.stringify((globalThis.__codexQuotaOfficialPayload || nativeSnapshot) || null)};
      const offsetX = rect.left + popup.clientLeft, offsetY = rect.top + popup.clientTop;
      let inlineTint, inlineHandoff;
      if (inlineSnapshot) {
        inlineTint = document.createElement("div");
        Object.assign(inlineTint.style, {position: "absolute", inset: "0", borderRadius: "inherit", background: inlineSnapshot.color, border: `1px solid ${inlineSnapshot.border}`});
        surface.append(inlineTint);
        inlineHandoff = document.createElement("div");
        inlineHandoff.className = "cq-inline-handoff";
        Object.assign(inlineHandoff.style, {position: "absolute", left: "0", top: "0", width: inlineSnapshot.rect.width + "px", height: inlineSnapshot.rect.height + "px"});
        inlineHandoff.append(inlineSnapshot.clone);
        layer.prepend(inlineHandoff);
      }
      const startRadius = parseFloat(triggerStyle.borderTopLeftRadius) * origin.height / trigger.offsetHeight;
      const endRadius = parseFloat(surfaceStyle.borderTopLeftRadius);
      const mix = (a, b, p) => a + (b - a) * p;
      const number = actors.find(actor => actor.key === "weekly-digits");
      state.framesAt = value => {
        const frames = new Map();
        const frame = (element, style) => frames.set(element, {...frames.get(element), ...style});
        const p = Math.max(0, Math.min(1, value));
        const reveal = Math.min(1, p / .6);
        if (inlineSnapshot) {
          frame(inlineTint, {opacity: inlineSnapshot.opacity * (1-reveal)});
          frame(inlineHandoff, {opacity: 1-reveal, transform: `translate3d(${inlineSnapshot.rect.left-offsetX}px,${inlineSnapshot.rect.top-offsetY-8*p}px,0)`});
        }
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
          if (inlineSnapshot && key !== "plan") frame(node, {opacity: reveal});
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
    trigger.toggleAttribute("data-cq-replaced", !state.rail);
    // Native closed popovers leave hit testing before their visual exit finishes.
    // The invisible original entry must accept the next click/key during that exit.
    trigger.tabIndex = open && !state.rail ? -1 : 0;
    collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
    collapse.title = collapse.getAttribute("aria-label");
    playSpring(state, Number(open), () => { if (sharedPopover === state) finishSharedPopover(); });
    return true;
  };

  // Both navigation paths share one sampled spring and the browser's animation clock.
  const playSpring = (state, target, complete) => {
    const elapsed = Number(state.animations?.[0]?.currentTime || 0);
    const current = state.generator ? state.generator.next(elapsed).value : state.initial;
    const velocity = state.generator ? state.generator.velocity(elapsed) : state.velocity || 0;
    for (const animation of state.animations || []) { animation.onfinish = null; animation.cancel(); }
    const generator = spring({keyframes: [current, target], velocity,
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
    clock.onfinish = () => { if (state.animations[0] === clock) complete(); };
  };

  const settlePopoverMotion = () => {
    if (!quotaShell) return null;
    const {popup} = quotaShell;
    finishLocalLayout();
    const local = document.getElementById("cq-local-usage");
    if (local) stopLocalMotions(local);
    finishPaneMotion();
    finishSharedPopover();
    stopMotion(popup);
    for (const child of popup.children) stopMotion(child);
    positionPopover();
    return popup.getBoundingClientRect();
  };
  const animatePopover = (open) => {
    const {popup, trigger} = quotaShell;
    if (paneMotion) { animatePane(paneMotion.host, paneMotion.panel, paneMotion.settings, open); return; }
    if (localLayout) {
      const panel=document.getElementById("cq-local-usage");
      if (panel) {animatePane(panel.cqHost,panel,true,open);return;}
    }
    if (animateSharedPopover(open)) return;
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
    const content = [...popup.children].find(child => !child.hidden && child !== quotaShell.collapse);
    if (content) move(content, {opacity: open ? [0, 1] : [1, 0], transform: open ? ["translateY(4px)", "translateY(0px)"] : ["translateY(0px)", "translateY(4px)"]},
      {duration: open ? .16 : .08, delay: open ? .08 : 0, ease: [.2, .8, .2, 1]}, () => {
        content.style.removeProperty("opacity"); content.style.removeProperty("transform");
      });
    move(popup, {transform: open ? [offset, "translate(0px, 0px)"] : ["translate(0px, 0px)", offset], clipPath: open ? [seed, full] : [full, seed], opacity: [1, 1]},
      {duration: open ? .24 : .18, ease: [.2, .8, .2, 1]}, () => {
        for (const name of ["transform", "clip-path", "opacity"]) popup.style.removeProperty(name);
      });
  };
  const finishPaneMotion = () => {
    const state = paneMotion;
    if (!state) return;
    paneMotion = null;
    for (const animation of state.animations || []) { animation.onfinish = null; animation.cancel(); }
    const {popup, trigger, collapse} = quotaShell;
    popup.removeAttribute("data-cq-pane");
    popup.style.removeProperty("height");
    for (const node of [state.host, state.panel]) {
      for (const name of ["position", "left", "top", "width"]) node.style.removeProperty(name);
      node.inert = false;
      node.removeAttribute("aria-hidden");
    }
    state.host.hidden = state.open && state.settings;
    if (!state.host.hidden) state.panel.remove();
    trigger.toggleAttribute("data-cq-replaced", state.open && !trigger.hasAttribute("data-cq-collapsed"));
    trigger.tabIndex = state.open && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
    collapse.firstElementChild.style.removeProperty("transform");
    state.host.querySelectorAll(".cq-refresh").forEach(refreshMotion);
    positionPopover();
    syncReleaseUI();
  };
  const animatePane = (host, panel, settings, open = quotaShell.popup.matches(":popover-open"), change) => {
    const {popup, trigger, collapse} = quotaShell;
    let presentation = {}, heightVelocity = 0;
    if (change && paneMotion) {
      const previous=paneMotion, elapsed=Number(previous.animations?.[0]?.currentTime || 0);
      presentation=previous.frameAt(previous.generator.next(elapsed).value);
      heightVelocity=previous.generator.velocity(elapsed)*previous.heightDelta;
      finishPaneMotion();
      change();
    } else if (localLayout) {
      const box=popup.getBoundingClientRect(), clip=parseFloat(getComputedStyle(popup).clipPath.match(/^inset\(([-\d.]+)px/)?.[1] || 0);
      presentation.height=box.height-clip;
    }
    finishLocalLayout();
    if (!paneMotion) {
      const material = sharedPopover?.rail ? getComputedStyle(popup) : null;
      const matrix = material && new DOMMatrixReadOnly(material.transform);
      if (material) Object.assign(presentation,{opacity: Number(material.opacity), x: matrix.m41, y: matrix.m42});
      settlePopoverMotion();
      const initial = Number(host.hidden);
      const rects = [false, true].map(value => {
        host.hidden = value; panel.hidden = !value;
        positionPopover();
        return {box: popup.getBoundingClientRect(), content: (value ? panel : host).getBoundingClientRect()};
      });
      popup.style.height = Math.max(...rects.map(rect => rect.box.height),presentation.height || 0) + "px";
      positionPopover();
      const box = popup.getBoundingClientRect(), css = getComputedStyle(popup);
      for (const [index, node] of [host, panel].entries()) {
        node.hidden = false;
        Object.assign(node.style, {position: "absolute", left: css.paddingLeft, top: css.paddingTop, width: rects[index].content.width + "px"});
      }
      const endpoint = value => ({height: rects[Number(value)].box.height, quota: Number(!value), settings: Number(value), shift: Number(value), arrow: 180, opacity: 1, x: 0, y: 0});
      paneMotion = {host, panel, box, radius: css.borderTopLeftRadius, endpoint, current: {...endpoint(Boolean(initial)), ...presentation}, initial: 0,
        settings, open, column: anchors?.column};
      popup.setAttribute("data-cq-pane", "");
    }
    const state = paneMotion;
    const elapsed = Number(state.animations?.[0]?.currentTime || 0);
    const from = state.frameAt ? state.frameAt(state.generator.next(elapsed).value) : state.current;
    const rail = trigger.hasAttribute("data-cq-collapsed");
    const to = open ? state.endpoint(settings) : rail
      ? {...from, opacity: 0, x: Math.max(12 - state.box.left, -6)}
      : {...from, height: trigger.getBoundingClientRect().height, quota: 0, settings: 0, arrow: 0};
    // Carry the visible edge's velocity when retargeting, including mid-pane close/reopen.
    const distance = to.height - from.height;
    state.velocity = state.generator ? state.generator.velocity(elapsed) * (distance ? state.heightDelta / distance
      : to.opacity !== from.opacity ? (state.opacityDelta || 0) / (to.opacity - from.opacity) : 0) : distance ? heightVelocity/distance : 0;
    state.generator = null;
    state.initial = 0;
    state.heightDelta = distance;
    state.opacityDelta = to.opacity - from.opacity;
    state.settings = settings;
    state.open = open;
    state.frameAt = progress => Object.fromEntries(Object.keys(from).map(key => [key, from[key] + (to[key] - from[key]) * progress]));
    state.framesAt = progress => {
      const frame = state.frameAt(progress), y = state.box.height - frame.height;
      return [[popup, {clipPath: `inset(${Math.max(0, y)}px 0px 0px 0px round ${state.radius})`, opacity: Math.max(0, Math.min(1, frame.opacity)), transform: `translate(${frame.x}px, ${frame.y}px)`}],
        [host, {transform: `translate(${-8 * frame.shift}px, ${y}px)`, opacity: Math.max(0, frame.quota)}],
        [panel, {transform: `translate(${8 * (1 - frame.shift)}px, ${y}px)`, opacity: Math.max(0, frame.settings)}],
        [collapse.firstElementChild, {transform: `rotate(${frame.arrow}deg)`}]];
    };
    for (const [node, active] of [[host, !settings && open], [panel, settings && open]]) {
      node.inert = !active;
      if (active) node.removeAttribute("aria-hidden"); else node.setAttribute("aria-hidden", "true");
    }
    host.querySelectorAll(".cq-refresh-icon").forEach(stopMotion);
    trigger.toggleAttribute("data-cq-replaced", !trigger.hasAttribute("data-cq-collapsed"));
    trigger.tabIndex = open ? -1 : 0;
    if (reducedMotion.matches || document.visibilityState !== "visible" || !visible(trigger)) { finishPaneMotion(); return; }
    playSpring(state, 1, () => { if (paneMotion === state) finishPaneMotion(); });
  };
  const syncSurface = () => {
    const railStyle = getComputedStyle(anchors.rail);
    const dark = railStyle.colorScheme === "dark" || document.documentElement.classList.contains("dark") ||
      (railStyle.colorScheme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    for (const node of [document.getElementById("codex-quota-trigger"), document.getElementById("codex-quota-popover"), document.getElementById("cq-local-usage")].filter(Boolean)) {
      node.toggleAttribute("data-cq-dark", dark);
      node.style.colorScheme = dark ? "dark" : "light";
      // Scoped theme variables may live on the shell rather than :root.
      for (const name of ["--color-surface-elevated-secondary", "--color-token-main-surface-primary", "--color-text", "--color-token-text-primary", "--color-text-secondary", "--color-token-text-secondary", "--color-text-tertiary", "--color-text-warning-surface", "--color-border", "--color-border-strong", "--color-background-primary-ghost-hover", "--radius-sm", "--default-font-family"]) {
        const value = railStyle.getPropertyValue(name);
        if (value) node.style.setProperty(name, value);
        else node.style.removeProperty(name);
      }
      const navigationButton = anchors.rail.querySelector('button[aria-current], button:not(#codex-quota-trigger)');
      if (navigationButton) node.style.setProperty("--cq-rail-radius", getComputedStyle(navigationButton).borderRadius);
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
    const gauge = createElement([
      ["path", {d: "M3.5 15.25a8 8 0 1 1 13 0"}],
      ["path", {d: "M3.75 11h.75M10 4.5v.75M15.5 11h.75"}],
      ["path", {class: "cq-gauge-needle", hidden: "", d: "M10 11V7"}],
      ["circle", {cx: "10", cy: "11", r: "1", fill: "currentColor", stroke: "none"}],
    ], {class: "cq-trigger-icon", viewBox: "0 0 20 20", width: "20", height: "20", "stroke-width": "1.33", "aria-hidden": "true", focusable: "false"});
    trigger.append(gauge, badge, Object.assign(document.createElement("span"), {className: "cq-trigger-copy"}));
    const graphics = document.createElement("span");
    graphics.className = "cq-trigger-graphics";
    graphics.setAttribute("aria-hidden", "true");
    trigger.append(graphics, icon(ChevronUp, "cq-trigger-chevron"));
    const alertLayer = document.createElement("span");
    alertLayer.className = "cq-inline-alert";
    alertLayer.hidden = true;
    alertLayer.setAttribute("aria-hidden", "true");
    alertLayer.innerHTML = '<span class="cq-inline-label"></span><span class="cq-inline-value"><span class="cq-inline-digits"></span><span class="cq-inline-percent">%</span></span>';
    const alertSurface = document.createElement("span");
    alertSurface.className = "cq-inline-surface";
    alertSurface.hidden = true;
    alertSurface.setAttribute("aria-hidden", "true");
    trigger.append(alertSurface, alertLayer);
    const announcement = document.createElement("span");
    announcement.id = "cq-inline-announcement";
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-atomic", "true");
    document.body.append(announcement);
    for (const event of ["pointerenter", "pointerleave", "focusin"]) trigger.addEventListener(event, updateInlineTimer);
    trigger.addEventListener("focusout", () => queueMicrotask(updateInlineTimer));
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
      if (focusFromTrigger) [...popup.querySelectorAll("button:not(:disabled)")].find(button => button.getClientRects().length && !button.closest("[inert]"))?.focus({preventScroll: true});
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
      if (open) {
        if (inlineAlert && !sharedPopover && !paneMotion) inlineAlert.opening = captureInlineAlert();
        suspendInlineAlert();
      }
      focusFromTrigger = open && document.activeElement === trigger;
      for (const node of [trigger, popup]) node.toggleAttribute("data-cq-instant", document.visibilityState !== "visible");
      trigger.setAttribute("aria-expanded", String(open));
      collapse.setAttribute("aria-label", open ? words("收起额度", "Collapse quota") : words("展开额度", "Expand quota"));
      collapse.title = collapse.getAttribute("aria-label");
      trigger.toggleAttribute("data-cq-replaced", (open || Boolean(sharedPopover || paneMotion)) && !trigger.hasAttribute("data-cq-collapsed"));
      trigger.tabIndex = trigger.getAttribute("aria-expanded") === "true" && trigger.hasAttribute("data-cq-replaced") ? -1 : 0;
      if (open) {
        if (!sharedPopover && !paneMotion) settlePopoverMotion();
        openingPending = true;
        popup.toggleAttribute("data-cq-opening", !sharedPopover && !paneMotion && !reducedMotion.matches && document.visibilityState === "visible");
        // A mid-close reversal returns to the same pane and measured geometry.
        // Only a fresh opening returns from settings to the quota view.
        if (!sharedPopover && !paneMotion) {
          document.getElementById("cq-settings")?.remove();
          document.getElementById("cq-local-usage")?.remove();
          const host = popup.querySelector(`#${officialHostId}`);
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
    const trigger = ensureShell();
    anchors = findAnchors();
    const {footer, popup} = quotaShell;
    trigger.hidden = !anchors;
    footer.hidden = !anchors?.column;
    footer.style.marginLeft = anchors?.column ? anchors.entrySpace.marginLeft + "px" : "";
    footer.style.marginRight = anchors?.column ? anchors.entrySpace.marginRight + "px" : "";
    if (!anchors) { if (popup.matches(":popover-open")) popup.hidePopover(); syncInlineAlert(); return false; }
    const {column, avatar, rail, stack} = anchors;
    if (sharedPopover && sharedPopover.column !== column) finishSharedPopover();
    if (paneMotion && paneMotion.column !== column) finishPaneMotion();
    trigger.toggleAttribute("data-cq-collapsed", !column);
    popup.toggleAttribute("data-cq-inplace", Boolean(column));
    trigger.toggleAttribute("data-cq-replaced", Boolean(column && (popup.matches(":popover-open") || sharedPopover || paneMotion)));
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
  const quotaHost = () => {
    const id = officialHostId;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      host.className = compactClass;
      document.getElementById("codex-quota-popover").prepend(host);
    }
    return host;
  };
  const removeOfficialCard = () => { const card = document.getElementById(officialHostId); stopCardMotion(card); card?.remove(); };
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
    const data = globalThis.__codexQuotaOfficialPayload || readNativeQuota();
    if (native) native.setAttribute("data-codex-quota-source", "");
    renderOfficial(quotaHost(), data || null, quotaErrorCode());
    if (!globalThis.__codexQuotaOfficialLoaded) requestOfficialData();
  };
  const installLayout = () => {
    for (const element of [...motions.keys()]) if (!element.isConnected) stopMotion(element);
    for (const button of refreshFeedbackTimers.keys()) if (!button.isConnected) clearRefreshFeedback(button);
    renderLayout();
  };


  globalThis.__codexQuotaResetSession = () => {
    alertGeneration++;
    clearTimeout(localUsageTimer); localUsageRequestId = null;
    document.getElementById("cq-local-usage")?.remove();
    delete globalThis.__codexQuotaLocalUsageRange;
    delete globalThis.__codexQuotaNetworkDiagnosis;
    finishMotion();
    manualRefresh = null;
    clearQuotaRequest("official");
    for (const button of refreshFeedbackTimers.keys()) clearRefreshFeedback(button);
    clearTimeout(globalThis.__codexQuotaAutoRefreshTimer);
    for (const kind of ["Official"]) {
      for (const suffix of ["Payload", "ErrorCode", "Error", "UsageFingerprint", "LastSuccessAt", "NextAutoAttemptAt", "CooldownUntil", "NeedsData", "Loaded"]) {
        delete globalThis[`__codexQuota${kind}${suffix}`];
      }
    }
    removeNotice();
    nativeSnapshot = null;
    removeOfficialCard();
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
      renderOfficial(quotaHost(), null);
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
    const observed = new Map();
    const owned = '#codex-quota-footer, #codex-quota-trigger, #codex-quota-popover, #cq-refresh-message, #cq-inline-announcement';
    const hostSelector = `${railSelector}, ${columnSelector}, [role='status'].rounded-2xl`;
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (disposed || globalThis.__codexQuotaOfficialCardObserver !== observer) return;
        installLayout();
        observeAnchors();
      });
    };
    const observeAnchors = () => {
      const current = new Set(anchors ? [anchors.rail, anchors.stack, anchors.avatar, anchors.column].filter(Boolean) : []);
      const columns = [...document.querySelectorAll(columnSelector)];
      // Hidden/narrow candidates must still wake layout when their own width animates open.
      for (const column of columns) current.add(column);
      for (const anchor of [anchors?.rail, ...columns]) {
        for (let node = anchor?.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display !== "contents" && (clipsOverflow(style.overflowX) || clipsOverflow(style.overflowY))) current.add(node);
        }
      }
      for (const node of observed.keys()) if (!current.has(node)) { resize.unobserve(node); observed.delete(node); }
      for (const node of current) {
        const added = !observed.has(node);
        observed.set(node, node.getBoundingClientRect());
        if (added) resize.observe(node);
      }
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
    const resize = new ResizeObserver(entries => {
      // Initial ResizeObserver delivery is not a resize; don't repaint or end a
      // just-started morph unless an anchor actually differs from our last layout.
      if (entries.some(({target}) => {
        const previous = observed.get(target), current = target.getBoundingClientRect();
        return previous && ["x", "y", "width", "height"].some(key => previous[key] !== current[key]);
      })) onGeometryChange();
    });
    const popupResize = new ResizeObserver(positionPopover);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onStylesheetLoad = event => { if (event.target instanceof HTMLLinkElement && event.target.relList.contains("stylesheet")) schedule(); };
    window.addEventListener("resize", onGeometryChange);
    document.fonts?.ready.then(() => { if (!disposed) schedule(); });
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
    observeAnchors();
    requestAnimationFrame(() => { const popup = document.getElementById("codex-quota-popover"); if (!disposed && popup) popupResize.observe(popup); });
  };


  const install = () => {
    try {
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
            return get(parameter, fallback);
          }});
        };
        client.__codexNativeQuotaPatched = true;
      }
      installLayout();
      observeOfficialCards();
      installAutoRefresh();
      return true;
    } catch (error) { console.error("Codex quota UI installation failed", error); return false; }
  };
  scheduleReleaseCheck();
  if (install()) {
    if (restoreOpen && visible(document.getElementById("codex-quota-trigger"))) document.getElementById("codex-quota-trigger").click();
    return true;
  }
  let attempts = 0;
  installRetryTimer = setInterval(() => {
    if (disposed || install() || ++attempts >= 120) clearInterval(installRetryTimer);
  }, 250);
  return false;
})()
