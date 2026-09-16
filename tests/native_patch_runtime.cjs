// Run with: node --test tests/native_patch_runtime.cjs (requires Playwright and Edge).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test, before, after} = require('node:test');
const {chromium} = require('playwright');
const {RefreshCw} = require('lucide');

const source = readFileSync(process.env.QUOTA_SCRIPT || join(__dirname, '../native-patch/native_patch.js'), 'utf8');
const footer = '<div class="absolute inset-x-0 bottom-0 z-20"><div><button aria-haspopup="menu">Account</button></div></div>';
const apiPayload = {used: 25, remaining: 75, total: 100, unit: 'USD'};
let browser;
before(async () => { browser = await chromium.launch({headless: true, channel: 'msedge'}); });
after(async () => { await browser?.close(); });

async function sharedPages(count = 1) {
  const context = await browser.newContext({reducedMotion: 'reduce'});
  await context.route('https://quota.test/**', route => route.fulfill({contentType: 'text/html', body: footer}));
  const pages = [];
  for (let index = 0; index < count; index++) {
    const page = await context.newPage();
    await page.goto('https://quota.test/');
    await page.evaluate(() => { globalThis.__codexQuotaMode = 'account'; globalThis.__codexQuotaSessionScope = 'synthetic-session'; });
    await page.evaluate(source);
    pages.push(page);
  }
  return {context, pages};
}

test('official settings persist without obsolete display controls and return keyboard focus', async () => {
  const {context, pages: [page]} = await sharedPages();
  try {
    await page.evaluate(() => __codexQuotaUpdateOfficial({planName: 'pro', windows: [{label: 'Weekly', usedPercent: 23, resetAt: 1900000000}]}, globalThis.__codexQuotaOfficialRequestId));
    await page.locator('.cq-settings-button').click();
    const height = (await page.locator('#cq-settings').boundingBox()).height;
    assert.equal(await page.locator('#cq-settings input[role=switch]').count(), 4);
    assert.equal(await page.locator('#cq-settings [name=remaining], #cq-settings [name=compact], #cq-settings [name=transparency]').count(), 0);
    await page.locator('input[name=hour12]').check();
    assert.equal((await page.locator('#cq-settings').boundingBox()).height, height);
    await page.locator('.cq-doctor').click();
    await page.evaluate(() => __codexQuotaUpdateDiagnosis({TaskActionMatches: true, HelperWindowless: true, CdpEndpointFound: true, MainPageFound: true, CardVisible: false, StageCodes: ['CARD_NOT_VISIBLE']}));
    assert.match(await page.locator('#cq-diagnosis').innerText(), /CARD_NOT_VISIBLE/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'cq-settings-button');
    assert.equal(await page.locator('.cq-number-value').innerText(), '23');
    assert.equal(await page.locator('#codex-official-usage-host').evaluate(node => getComputedStyle(node).backdropFilter), 'none');
    await page.evaluate(source);
    await page.locator('.cq-settings-button').click();
    assert.equal(await page.locator('input[name=hour12]').isChecked(), true);
    assert.equal(await page.locator('.cq-settings-button').count(), 1);
  } finally { await context.close(); }
});

test('simultaneous windows alert once per threshold and only confirm real replenishment', async () => {
  const {context, pages} = await sharedPages(2);
  try {
    const update = (page, used, reset = 1900000000) => page.evaluate(({used, reset}) => __codexQuotaUpdateOfficial({planName: 'pro', windows: [{label: 'Weekly', usedPercent: used, resetAt: reset}]}, globalThis.__codexQuotaOfficialRequestId), {used, reset});
    await Promise.all(pages.map(page => update(page, 85)));
    await pages[0].waitForTimeout(80);
    assert.equal((await Promise.all(pages.map(page => page.locator('#cq-notice').count()))).reduce((a, b) => a + b), 1);
    await Promise.all(pages.map(page => page.evaluate(() => document.getElementById('cq-notice')?.remove())));
    await Promise.all(pages.map(page => update(page, 86)));
    await pages[0].waitForTimeout(50);
    assert.equal((await Promise.all(pages.map(page => page.locator('#cq-notice').count()))).reduce((a, b) => a + b), 0);
    await update(pages[0], 95);
    await pages[0].waitForTimeout(50);
    assert.match(await pages[0].locator('#cq-notice').innerText(), /5%/);
    await pages[0].evaluate(() => document.getElementById('cq-notice').remove());
    await update(pages[0], 95, 1900600000);
    await pages[0].waitForTimeout(50);
    assert.doesNotMatch(await pages[0].locator('#cq-notice').innerText(), /replenished|已恢复/);
    await update(pages[0], 5, 1901200000);
    await pages[0].waitForTimeout(50);
    assert.match(await pages[0].locator('#cq-notice').innerText(), /replenished|已恢复/);
  } finally { await context.close(); }
});

test('session reset hides old account values until a fresh response', async () => {
  const page = await pageFor('account', true);
  try {
    await page.evaluate(() => __codexQuotaResetSession());
    await page.waitForTimeout(60);
    assert.equal(await page.locator('#native').isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.__codexQuotaOfficialPayload), undefined);
    await page.evaluate(() => __codexQuotaUpdateOfficial({planName: 'pro', windows: [{label: 'Weekly', usedPercent: 61, resetAt: 1900000000}]}, globalThis.__codexQuotaOfficialRequestId));
    await page.waitForTimeout(60);
    assert.equal(await page.locator('#native').isVisible(), true);
    assert.equal(await page.locator('#native .cq-number-value').innerText(), '61');
  } finally { await page.close(); }
});

test('auth and rate-limit failures remain distinct while retaining marked old data', async () => {
  const page = await pageFor('api');
  try {
    await page.evaluate(() => __codexQuotaUpdateApi({errorCode: 'AUTH_REQUIRED'}));
    assert.match(await page.locator('#codex-api-usage-host').innerText(), /Sign in again|重新登录/);
    await page.evaluate(() => __codexQuotaUpdateApi({errorCode: 'RATE_LIMITED', retryAfterSeconds: 120}));
    assert.match(await page.locator('#codex-api-usage-host').innerText(), /Rate limited|服务端限流/);
    assert.equal(await page.locator('.cq-number-value').innerText(), '75');
  } finally { await page.close(); }
});

test('native settings changes settle without repeated layout rebuilds', async () => {
  const page = await pageFor('account', true);
  try {
    await page.locator('.cq-settings-button').click();
    await page.locator('input[name=hour12]').check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const scans = await page.evaluate(() => layoutScans);
    const content = await page.locator('#native .codex-native-compact-usage-content').elementHandle();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => layoutScans), scans);
    assert.equal(await content.evaluate(el => el.isConnected), true);
    assert.equal(await page.locator('#native .cq-number-value').innerText(), '20');
  } finally { await page.close(); }
});

test('recovery alerts work independently and queued old-session alerts are discarded', async () => {
  const {context, pages: [page]} = await sharedPages();
  try {
    await page.locator('.cq-settings-button').click();
    await page.locator('input[name=alerts]').uncheck();
    await page.keyboard.press('Escape');
    await page.evaluate(() => __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:95,resetAt:1900000000}]}, globalThis.__codexQuotaOfficialRequestId));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#cq-notice').count(), 0);
    await page.evaluate(() => __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:5,resetAt:1900600000}]}, globalThis.__codexQuotaOfficialRequestId));
    await page.waitForTimeout(50);
    assert.match(await page.locator('#cq-notice').innerText(), /replenished|已恢复/);
    await page.evaluate(() => {
      document.getElementById('cq-notice').remove();
      navigator.locks.request('codex-usage-card.alerts', () => new Promise(resolve => { globalThis.releaseQuotaLock = resolve; }));
    });
    await page.waitForFunction(() => typeof globalThis.releaseQuotaLock === 'function');
    await page.evaluate(() => {
      __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:5,resetAt:1901200000}]}, globalThis.__codexQuotaOfficialRequestId);
      __codexQuotaSessionScope = 'other-session';
      __codexQuotaResetSession();
      releaseQuotaLock();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#cq-notice').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-usage-card.alerts.v2')).records.Weekly.resetAt), 1900600000);
  } finally { await context.close(); }
});

test('same-valued Plus reply restores native card after session reset', async () => {
  const page = await pageFor('account', true);
  try {
    const payload = {planName:'plus',windows:[{label:'5h',usedPercent:23,resetAt:1900000000},{label:'Weekly',usedPercent:41,resetAt:1900600000}]};
    await page.evaluate(data => __codexQuotaUpdateOfficial(data, globalThis.__codexQuotaOfficialRequestId), payload);
    await page.evaluate(() => __codexQuotaResetSession());
    await page.waitForTimeout(50);
    await page.evaluate(data => __codexQuotaUpdateOfficial(data, globalThis.__codexQuotaOfficialRequestId), payload);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#native').isVisible(), true);
    assert.equal(await page.locator('#codex-official-usage-host').count(), 0);
  } finally { await page.close(); }
});

async function pageFor(mode, native = false) {
  const page = await browser.newPage({reducedMotion: 'reduce'});
  await page.setContent(`<main id="chat"></main>${footer}${native ? '<div id="native" role="status" class="rounded-2xl border bg-token-main-surface-primary"><progress max="100" value="20"></progress><span class="font-medium">80%</span><div class="text-sm text-token-text-secondary">Resets at 20:00</div></div>' : ''}`);
  await page.evaluate(({mode, apiPayload}) => {
    globalThis.__codexQuotaMode = mode;
    globalThis.__codexQuotaApiLoaded = true;
    globalThis.__codexQuotaApiPayload = apiPayload;
    globalThis.__codexQuotaOfficialLoaded = true;
    globalThis.__codexQuotaOfficialPayload = {
      planName: 'pro', windows: [{label: 'Weekly', usedPercent: 20, resetAt: Date.now() / 1000 + 86400}],
    };
    globalThis.layoutScans = 0;
    const queryAll = document.querySelectorAll.bind(document);
    document.querySelectorAll = (selector) => {
      if (selector === 'div.absolute.inset-x-0.bottom-0.z-20') globalThis.layoutScans++;
      return queryAll(selector);
    };
  }, {mode, apiPayload});
  await page.evaluate(source);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
  return page;
}

async function settleMotion(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' || animation.playState === 'pending'));
}

test('cold document injection waits for the DOM and installs once after reload', async () => {
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  try {
    await page.route('https://quota.test/**', route=>route.fulfill({contentType:'text/html',body:footer}));
    const init="globalThis.__codexQuotaMode='account';globalThis.__codexQuotaOfficialLoaded=true;globalThis.__codexQuotaOfficialPayload={planName:'pro',windows:[{label:'Weekly',usedPercent:23,resetAt:1900600000}]};";
    await page.addInitScript({content:init+source+';'+source});
    await page.goto('https://quota.test/');
    await page.waitForSelector('.cq-settings-button');
    assert.equal(await page.locator('#codex-official-usage-host').count(),1);
    assert.equal(await page.locator('#codex-quota-color-probe').count(),1);
    await page.reload();
    await page.waitForSelector('.cq-settings-button');
    assert.equal(await page.locator('#codex-official-usage-host').count(),1);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('Motion buttons recover after long presses and refresh animations stop on completion', async () => {
  const page=await pageFor('api');
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    const button=page.locator('.cq-settings-button');
    await button.dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
    await button.dispatchEvent('pointerup');
    await settleMotion(page);
    assert.equal(await button.evaluate(el=>el.style.transform),'');
    await button.dispatchEvent('keydown',{key:' '});
    await page.waitForTimeout(150);
    await button.dispatchEvent('keyup',{key:' '});
    await settleMotion(page);
    assert.equal(await button.evaluate(el=>el.style.transform),'');
    const refresh=page.locator('.cq-refresh');
    await refresh.click();
    await page.waitForTimeout(120);
    assert.ok(await refresh.locator('.cq-refresh-icon').evaluate(el=>el.getAnimations().length>0));
    await page.evaluate(()=>__codexQuotaUpdateApi(__codexQuotaApiPayload, globalThis.__codexQuotaApiRequestId));
    await settleMotion(page);
    assert.equal(await refresh.locator('.cq-refresh-icon').evaluate(el=>el.style.transform),'');
    assert.equal(await refresh.isDisabled(),false);
  } finally { await page.close(); }
});

test('Motion layout reverses without scaling text or leaving a fixed height after reduced motion', async () => {
  const page=await pageFor('api');
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('.cq-settings-button').click();
    await settleMotion(page);
    const card=page.locator('#codex-api-usage-host');
    const regular=(await card.boundingBox()).height;
    const toggle=page.locator('input[name=compact]');
    await toggle.check();
    await page.waitForTimeout(60);
    const scale=await card.locator('.cq-number').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return [m.a,m.d]});
    assert.deepEqual(scale,[1,1]);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(80);
    assert.equal(await card.evaluate(el=>el.style.height),'');
    await toggle.uncheck();
    assert.equal((await card.boundingBox()).height,regular);
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(let index=0;index<6;index++) { await toggle.evaluate(el=>el.click()); await page.waitForTimeout(35); }
    await settleMotion(page);
    assert.equal(await card.evaluate(el=>el.style.height),'');
    assert.equal((await card.boundingBox()).height,regular);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.getElementById('cq-settings'));
  } finally { await page.close(); }
});

test('Motion modal handles interrupted close and reinjection of native fallback without a transparent blocker', async () => {
  const page=await pageFor('account',true);
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>__codexQuotaUpdateOfficial({planName:'team',windows:[{label:'5h',usedPercent:21,resetAt:1900000000},{label:'Weekly',usedPercent:31,resetAt:1900600000}]}));
    await page.evaluate(source);
    await page.locator('.cq-settings-button').click();
    await settleMotion(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(35);
    await page.evaluate(()=>document.querySelector('.cq-settings-button').click());
    await settleMotion(page);
    assert.equal(await page.locator('#cq-settings').evaluate(el=>el.open),true);
    assert.equal(await page.locator('#cq-settings').evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.keyboard.press('Escape');
    await page.evaluate(source);
    await page.waitForFunction(()=>!document.getElementById('cq-settings'));
    assert.equal(await page.locator('#cq-settings').count(),0);
    await page.locator('.cq-settings-button').click();
    await settleMotion(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.getElementById('cq-settings'));
    assert.equal(await page.evaluate(()=>document.activeElement?.className),'cq-settings-button');
  } finally { await page.close(); }
});

test('quota updates reuse visible DOM and Lucide icons without restarting progress from zero', async () => {
  for (const mode of ['account','api']) {
    const page=await pageFor(mode);
    try {
      await page.emulateMedia({reducedMotion:'no-preference'});
      const number=await page.locator('.cq-number-value').elementHandle();
      const fill=await page.locator('.cq-progress-fill').elementHandle();
      const refresh=await page.locator('.cq-refresh').elementHandle();
      await page.evaluate(mode=>mode==='api'?__codexQuotaUpdateApi({used:40,remaining:60,total:100,unit:'USD'}):__codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:40,resetAt:1900600000}]}),mode);
      await settleMotion(page);
      for(const handle of [number,fill,refresh])assert.equal(await handle.evaluate(el=>el.isConnected),true);
      assert.equal(await refresh.evaluate(el=>el.querySelector('svg path').getAttribute('d')), RefreshCw.find(([tag])=>tag==='path')[1].d);
      assert.equal(await page.evaluate(()=>document.querySelectorAll('script[src]').length),0);
    } finally { await page.close(); }
  }
});

test('chat streaming does not rescan quota layout', async () => {
  const page = await pageFor('account');
  try {
    const scans = await page.evaluate(() => layoutScans);
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => document.getElementById('chat').append(document.createElement('span')));
    }
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => layoutScans) - scans, 0);
  } finally { await page.close(); }
});

test('final official layout preserves both windows and restores motion without changing geometry', async () => {
  for (const native of [false, true]) for (const plus of [false, true]) {
    const {context, pages: [page]} = await sharedPages();
    try {
      await page.addStyleTag({content: 'body { margin:0; width:264px; font-family:Arial,sans-serif } .bottom-0 { width:100% }'});
      await page.evaluate(({native,plus}) => {
        localStorage.setItem('codex-usage-card.settings.v2', JSON.stringify({compact:true,remaining:true,transparency:'blur'}));
        if (native) document.body.insertAdjacentHTML('beforeend', `<div id="native" role="status" class="rounded-2xl border bg-token-main-surface-primary"><progress max="100" value="23"></progress>${plus ? '<progress max="100" value="41"></progress>' : ''}<span class="font-medium">77%</span><div class="text-sm text-token-text-secondary">Resets at 20:00</div></div>`);
      }, {native,plus});
      const payload = {planName: plus ? 'plus' : 'pro', windows: plus
        ? [{label:'5h', usedPercent:23, resetAt:1900000000}, {label:'Weekly', usedPercent:41, resetAt:1900600000}]
        : [{label:'Weekly', usedPercent:23, resetAt:1900600000}]};
      await page.evaluate(data => __codexQuotaUpdateOfficial(data, globalThis.__codexQuotaOfficialRequestId), payload);
      await page.evaluate(source);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await settleMotion(page);
      const card = page.locator(native ? '#native' : '#codex-official-usage-host');
      assert.equal(await card.locator('[data-cq-variant]').getAttribute('data-cq-variant'), plus ? 'final-plus-v1' : 'final-weekly-v1');
      assert.equal(await card.locator('.cq-number-value').innerText(), '23');
      assert.equal(await card.locator('.cq-title').isVisible(), true);
      assert.equal(await card.locator('.cq-title-wrap > .cq-plan').count(), 1);
      assert.equal(await card.locator('.cq-remaining-value, .cq-thread-meta, .cq-thread-foot, .cq-clock, .cq-reset-value').count(), 0);
      assert.equal(await card.locator('.cq-time-ring').count(), plus ? 2 : 1);
      const size = await card.boundingBox();
      assert.ok(Math.abs(size.width - 248) <= 1);
      assert.ok(Math.abs(size.height - (plus ? 96 : 72)) <= 1, `expected ${plus ? 96 : 72}px, got ${size.height}`);
      if (plus) {
        assert.equal(await card.locator('.cq-week-used').innerText(), '41%');
        assert.equal(await card.locator('.cq-week-rule').getAttribute('aria-valuenow'), '41');
      }
      const button=card.locator('.cq-settings-button');
      await button.dispatchEvent('pointerdown');
      await page.waitForTimeout(120);
      assert.ok(await button.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).a<1));
      await button.dispatchEvent('pointerup');
      await settleMotion(page);
      assert.equal(await button.evaluate(el=>el.style.transform),'');
      await card.locator('.cq-refresh').click();
      assert.equal((await card.boundingBox()).height,size.height);
      assert.ok(await card.locator('.cq-refresh-icon').evaluate(el=>el.getAnimations().length>0));
      payload.windows[0].usedPercent=37;
      const moving = await page.evaluate(data=>{
        __codexQuotaUpdateOfficial(data, globalThis.__codexQuotaOfficialRequestId);
        return document.querySelector('.cq-thread-rule .cq-progress-fill').getAnimations().length;
      },payload);
      assert.ok(moving>0);
      assert.equal(await card.locator('.cq-number-value').innerText(),'37');
      assert.equal(await card.locator('.cq-thread-rule').getAttribute('aria-valuenow'),'37');
      await settleMotion(page);
      assert.equal(await card.locator('.cq-thread-rule .cq-progress-fill').evaluate(el=>el.style.width),'37%');
      assert.equal(await card.evaluate(el=>el.getAnimations({subtree:true}).length),0);
      assert.equal(await card.locator('.cq-refresh-icon').evaluate(el=>el.style.transform),'');
      await card.locator('.cq-settings-button').click();
      await settleMotion(page);
      assert.equal(await page.locator('#cq-settings [name=remaining], #cq-settings [name=compact], #cq-settings [name=transparency]').count(),0);
      await page.keyboard.press('Escape');
      await settleMotion(page);
      assert.equal((await card.boundingBox()).height,size.height);
    } finally { await context.close(); }
  }
});

test('official progress reverses smoothly and settles to low-usage dots when motion is reduced', async () => {
  const page = await pageFor('account');
  try {
    const update = value => page.evaluate(value => __codexQuotaUpdateOfficial({planName:'plus',windows:[
      {label:'5h',usedPercent:value,resetAt:1900000000},
      {label:'Weekly',usedPercent:value,resetAt:1900600000},
    ]}),value);
    await update(20);
    await page.emulateMedia({reducedMotion:'no-preference'});
    const card=page.locator('#codex-official-usage-host');
    const height=(await card.boundingBox()).height;
    const fills=card.locator('.cq-progress-fill');
    await update(80);
    await page.waitForTimeout(40);
    const widths=await fills.evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().width));
    await update(0);
    const reversed=await fills.evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().width));
    assert.ok(reversed.every((width,index)=>width>=widths[index]-2),'reversal must start from the visible width');
    await page.emulateMedia({reducedMotion:'reduce'});
    await settleMotion(page);
    assert.deepEqual(await fills.evaluateAll(elements=>elements.map(el=>el.style.width)),['0%','0%']);
    assert.ok((await fills.nth(0).boundingBox()).width>=3);
    assert.ok((await fills.nth(1).boundingBox()).width>=1.5);
    assert.equal((await card.boundingBox()).height,height);
    await card.locator('.cq-refresh').click();
    assert.equal(await card.evaluate(el=>el.getAnimations({subtree:true}).length),0);
  } finally { await page.close(); }
});

test('time rings use each real reset window and retain visible low-usage fills', async () => {
  const page=await pageFor('account');
  try {
    const now=1900000000;
    await page.evaluate(now=>{ Date.now=()=>now*1000; },now);
    for (const elapsed of [0,50,100]) {
      await page.evaluate(({now,elapsed})=>__codexQuotaUpdateOfficial({planName:'plus',windows:[
        {label:'5h',usedPercent:0,resetAt:now+18000*(1-elapsed/100)},
        {label:'Weekly',usedPercent:0,resetAt:now+604800*(1-elapsed/100)}
      ]}),{now,elapsed});
      const rings=page.locator('.cq-time-ring');
      assert.equal(await rings.count(),2);
      for(const ring of await rings.all()) {
        const fill=ring.locator('.cq-ring-fill');
        assert.equal(await fill.getAttribute('pathLength'),'100');
        const dash=(await fill.getAttribute('stroke-dasharray')).split(/[ ,]+/).map(Number);
        assert.ok(Math.abs(dash[0]-elapsed)<.01);
        assert.ok(Math.abs(dash[1]-(100-elapsed))<.01);
        assert.equal(await ring.locator('.cq-ring-track').count(),1);
      }
      assert.equal(await page.locator('.cq-thread-rule').getAttribute('aria-valuenow'),'0');
      assert.ok((await page.locator('.cq-thread-rule .cq-progress-fill').boundingBox()).width>=3);
      assert.ok((await page.locator('.cq-week-rule .cq-progress-fill').boundingBox()).width>=1.5);
      const expected=await page.evaluate(({now,elapsed})=>({
        time:new Intl.DateTimeFormat(navigator.language,{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date((now+18000*(1-elapsed/100))*1000)),
        date:new Intl.DateTimeFormat(navigator.language,{month:/^zh\b/i.test(navigator.language)?'long':'short',day:'numeric'}).format(new Date((now+604800*(1-elapsed/100))*1000))
      }),{now,elapsed});
      assert.equal(await page.locator('.cq-thread-main .cq-reset-date-value').innerText(),expected.time);
      assert.equal(await page.locator('.cq-week-reset-date').innerText(),expected.date);
    }
  } finally { await page.close(); }
});

test('time rings catch up on visibility restore during server cooldown without a request', async () => {
  const page = await pageFor('account');
  try {
    await page.evaluate(() => {
      globalThis.testNow = Date.now();
      Date.now = () => testNow;
      __codexQuotaUpdateOfficial({planName:'plus', windows:[
        {label:'5h', usedPercent:24, resetAt:testNow/1000+9000},
        {label:'Weekly', usedPercent:1, resetAt:testNow/1000+302400},
      ]});
      __codexQuotaUpdateOfficial({errorCode:'RATE_LIMITED', retryAfterSeconds:7200});
      Object.defineProperty(document, 'visibilityState', {configurable:true, get:()=> 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => __codexQuotaAutoRefreshTimer), null);
    await page.evaluate(() => {
      testNow += 3600000;
      Object.defineProperty(document, 'visibilityState', {configurable:true, get:()=> 'visible'});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const elapsed = await page.locator('.cq-thread-main .cq-ring-fill').getAttribute('stroke-dasharray');
    assert.equal(Number(elapsed.split(' ')[0]), 70);
    assert.equal(await page.evaluate(() => __codexQuotaOfficialNeedsData), false);
  } finally { await page.close(); }
});

test('native time ring does not invent elapsed time from a reset clock label alone', async () => {
  const page=await browser.newPage({reducedMotion:'reduce'});
  try {
    await page.setContent(`${footer}<div id="native" role="status" class="rounded-2xl border bg-token-main-surface-primary"><progress max="100" value="20"></progress><span class="font-medium">80%</span><div class="text-sm text-token-text-secondary">Resets at 20:00</div></div>`);
    await page.evaluate(()=>{__codexQuotaMode='account';__codexQuotaOfficialLoaded=true;});
    await page.evaluate(source);
    const ring=page.locator('#native .cq-time-ring');
    assert.equal(await ring.locator('.cq-ring-track').count(),1);
    assert.equal(await ring.locator('.cq-ring-fill').getAttribute('stroke-dasharray'),null);
    assert.equal(await ring.locator('.cq-ring-fill').evaluate(el=>getComputedStyle(el).display),'none');
    assert.doesNotMatch(await ring.getAttribute('aria-label'),/elapsed\s+\d|已流逝\s*\d/);
    assert.equal(await page.locator('#native .cq-number-value').innerText(),'20');
  } finally { await page.close(); }
});

test('compact preference persists and API compact progress shows used instead of remaining', async () => {
  const {context, pages:[page]} = await sharedPages();
  try {
    await page.evaluate(() => { __codexQuotaMode='api'; __codexQuotaUpdateApi({used:25,remaining:75,total:100,unit:'USD'}); });
    await page.evaluate(source);
    await page.locator('.cq-settings-button').click();
    await page.locator('input[name=compact]').check();
    await page.keyboard.press('Escape');
    await page.evaluate(source);
    const card=page.locator('#codex-api-usage-host');
    assert.equal(await card.locator('.cq-number-value').innerText(), '25');
    assert.equal(await card.locator('.cq-rule').getAttribute('aria-valuenow'), '25');
    assert.doesNotMatch(await card.innerText(), /75|remaining|剩余/i);
    assert.match(await card.getAttribute('aria-label'), /25%/);
    const height=(await card.boundingBox()).height;
    await card.locator('.cq-refresh').click();
    assert.equal((await card.boundingBox()).height,height);
    await page.evaluate(() => __codexQuotaUpdateApi({used:40,remaining:60,total:100,unit:'USD'}, globalThis.__codexQuotaApiRequestId));
    assert.equal(await card.locator('.cq-number-value').innerText(), '40');
    await card.locator('.cq-settings-button').click();
    assert.equal(await page.locator('input[name=compact]').isChecked(),true);
    await page.locator('input[name=compact]').uncheck();
    await page.keyboard.press('Escape');
    assert.equal(await card.locator('.cq-number-value').innerText(),'60');
  } finally { await context.close(); }
});

test('API compact settings synchronize across windows without dropping unknown quota windows', async () => {
  const {context, pages} = await sharedPages(2);
  try {
    for(const page of pages) {
      await page.evaluate(()=>{ __codexQuotaMode='api'; __codexQuotaUpdateApi({used:25,remaining:75,total:100,unit:'USD'}); });
      await page.evaluate(source);
    }
    await pages[0].locator('.cq-settings-button').click();
    await pages[0].locator('input[name=compact]').check();
    await pages[0].keyboard.press('Escape');
    await pages[1].waitForFunction(()=>document.querySelector('#codex-api-usage-host [data-cq-density="compact"]'));
    await pages[1].evaluate(()=>{ __codexQuotaMode='account'; });
    await pages[1].evaluate(source);
    await pages[1].evaluate(()=>__codexQuotaUpdateOfficial({planName:'other',windows:[{label:'Daily',usedPercent:15,resetAt:1900000000},{label:'Monthly',usedPercent:35,resetAt:1900600000}]}, globalThis.__codexQuotaOfficialRequestId));
    const card=pages[1].locator('#codex-official-usage-host');
    assert.match(await card.innerText(),/Daily/);
    assert.match(await card.innerText(),/Monthly/);
    assert.equal(await card.locator('progress').count(),2);
    assert.equal(await card.locator('.cq-ring-fill').count(),0,'unknown windows must not invent an elapsed fraction');
    await pages[1].evaluate(()=>{ __codexQuotaMode='api'; __codexQuotaUpdateApi({used:15,remaining:85,unit:'USD'}); });
    await pages[1].evaluate(source);
    assert.equal(await pages[1].locator('#codex-api-usage-host [data-cq-density="compact"]').count(),0);
    assert.match(await pages[1].locator('#codex-api-usage-host').innerText(),/85/);
  } finally { await context.close(); }
});

test('instant unchanged manual replies show completion without delaying data or resizing the card', async () => {
  for (const [mode,native] of [['account',false],['account',true],['api',false]]) {
    const page=await pageFor(mode,native);
    try {
      const card=page.locator(native ? '#native' : mode==='api' ? '#codex-api-usage-host' : '#codex-official-usage-host');
      const height=(await card.boundingBox()).height;
      await page.evaluate(mode=>{
        globalThis.testRequests=0;
        console.info=(message, requestId)=>{
          if (message===(mode==='api'?'__codexQuotaApiRequest__':'__codexQuotaOfficialRequest__')) {
            testRequests++;
            if(mode==='api') __codexQuotaUpdateApi(__codexQuotaApiPayload, requestId);
            else __codexQuotaUpdateOfficial(__codexQuotaOfficialPayload, requestId);
          }
        };
      },mode);
      for(let click=0;click<2;click++) {
        await card.locator('.cq-refresh').evaluate(button=>button.click());
        assert.equal(await card.locator('.cq-refresh').isDisabled(),false);
        assert.equal(await card.locator('.cq-refresh-done').isVisible(),true);
        assert.match(await card.locator('.cq-refresh').getAttribute('aria-label'),/Quota unchanged|额度未变化/);
        assert.match(await page.locator('#cq-refresh-message').innerText(),/Quota unchanged|额度未变化/);
        assert.equal((await card.boundingBox()).height,height);
      }
      assert.equal(await page.evaluate(()=>testRequests),2);
      await page.waitForFunction(()=>!document.querySelector('.cq-refresh[data-cq-refreshed]'));
      assert.equal(await card.locator('.cq-refresh-icon').isVisible(),true);
      // A background reply must not show a manual-success checkmark.
      await page.evaluate(mode=>mode==='api'?__codexQuotaUpdateApi(__codexQuotaApiPayload):__codexQuotaUpdateOfficial(__codexQuotaOfficialPayload),mode);
      assert.equal(await card.locator('.cq-refresh-done').isVisible(),false);
      await page.evaluate(mode=>{
        console.info=(_, requestId)=>mode==='api'
          ? __codexQuotaUpdateApi({...__codexQuotaApiPayload, used:26, remaining:74}, requestId)
          : __codexQuotaUpdateOfficial({...__codexQuotaOfficialPayload, windows:__codexQuotaOfficialPayload.windows.map(window=>({...window, usedPercent:21}))}, requestId);
      },mode);
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      assert.match(await card.locator('.cq-refresh').getAttribute('aria-label'),/Updated|已更新/);
      assert.match(await page.locator('#cq-refresh-message').innerText(),/Updated|已更新/);
      assert.equal(await card.locator('.cq-number-value').innerText(),mode==='api'?'74':'21');
      assert.equal((await card.boundingBox()).height,height);
      await page.evaluate(mode=>{
        console.info=(_, requestId)=>mode==='api'?__codexQuotaUpdateApi({errorCode:'RATE_LIMITED',retryAfterSeconds:60}, requestId):__codexQuotaUpdateOfficial({errorCode:'RATE_LIMITED',retryAfterSeconds:60}, requestId);
      },mode);
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      assert.equal(await card.locator('.cq-refresh-done').isVisible(),false);
      assert.match(await card.locator('.cq-status').textContent(),/Rate limited|服务端限流/);
      assert.match(await page.locator('#cq-refresh-message').innerText(),/Rate limited|服务端限流/);
      assert.equal(await card.locator('.cq-refresh[data-cq-error]').count(),1);
      assert.equal((await card.boundingBox()).height,height);
    } finally {await page.close();}
  }
});

test('request deadlines survive reinjection and late replies cannot finish a retry', async () => {
  for (const [mode,native] of [['account',false],['account',true],['api',false]]) {
    const page=await pageFor(mode,native);
    const prefix=mode==='api'?'Api':'Official';
    try {
      const clockNow=await page.evaluate(()=>Date.now());
      await page.clock.install({time:new Date(clockNow)});
      await page.clock.pauseAt(new Date(clockNow+1000));
      await page.evaluate(()=>{ globalThis.testRequests=[]; console.info=(marker,id)=>testRequests.push({marker,id}); });
      const card=page.locator(native?'#native':mode==='api'?'#codex-api-usage-host':'#codex-official-usage-host');
      const height=(await card.boundingBox()).height;
      const originalNumber=await card.locator('.cq-number-value').innerText();
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      const first=await page.evaluate(prefix=>({id:globalThis[`__codexQuota${prefix}RequestId`],deadline:globalThis[`__codexQuota${prefix}RequestDeadline`],now:Date.now()}),prefix);
      assert.equal(typeof first.id,'string');
      assert.ok(first.id.length>0);
      assert.equal(first.deadline-first.now,25000);
      await page.clock.fastForward(10000);
      await page.evaluate(source);
      assert.deepEqual(await page.evaluate(prefix=>({id:globalThis[`__codexQuota${prefix}RequestId`],deadline:globalThis[`__codexQuota${prefix}RequestDeadline`]}),prefix),{id:first.id,deadline:first.deadline});
      assert.equal(await page.evaluate(()=>testRequests.length),1,'reinjection must not duplicate the pending request');
      await page.clock.fastForward(14999);
      assert.equal(await card.locator('.cq-refresh').isDisabled(),true);
      await page.clock.fastForward(1);
      assert.equal(await page.evaluate(prefix=>globalThis[`__codexQuota${prefix}ErrorCode`],prefix),'REQUEST_TIMEOUT');
      assert.equal(await card.locator('.cq-refresh').isDisabled(),false);
      assert.equal(await card.locator('.cq-number-value').innerText(),originalNumber);
      assert.equal((await card.boundingBox()).height,height);
      // A reply after expiry cannot erase the error or replace the retained value.
      await page.evaluate(({mode,id})=>mode==='api'
        ? __codexQuotaUpdateApi({used:90,remaining:10,total:100,unit:'USD'},id)
        : __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:90,resetAt:1900000000}]},id),{mode,id:first.id});
      assert.equal(await card.locator('.cq-number-value').innerText(),originalNumber);
      assert.equal(await page.evaluate(prefix=>globalThis[`__codexQuota${prefix}ErrorCode`],prefix),'REQUEST_TIMEOUT');
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      const secondId=await page.evaluate(prefix=>globalThis[`__codexQuota${prefix}RequestId`],prefix);
      assert.notEqual(secondId,first.id);
      assert.equal(await page.evaluate(()=>testRequests.length),2);
      for(const id of [first.id,null,'wrong-request']) {
        await page.evaluate(({mode,id})=>mode==='api'
          ? __codexQuotaUpdateApi({used:90,remaining:10,total:100,unit:'USD'},id)
          : __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:90,resetAt:1900000000}]},id),{mode,id});
        assert.equal(await card.locator('.cq-refresh').isDisabled(),true);
        assert.equal(await card.locator('.cq-number-value').innerText(),originalNumber);
      }
      await page.evaluate(({mode,id})=>mode==='api'
        ? __codexQuotaUpdateApi({used:30,remaining:70,total:100,unit:'USD'},id)
        : __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:30,resetAt:1900000000}]},id),{mode,id:secondId});
      assert.equal(await card.locator('.cq-refresh').isDisabled(),false);
      assert.equal(await card.locator('.cq-number-value').innerText(),mode==='api'?'70':'30');
      assert.equal(await card.locator('.cq-refresh[data-cq-error]').count(),0);
      assert.equal((await card.boundingBox()).height,height);
    } finally { await page.close(); }
  }
});

test('visibility restore expires sleeping requests and exposes errors without growing populated cards', async () => {
  for (const mode of ['account','api']) {
    const page=await pageFor(mode);
    try {
      const clockNow=await page.evaluate(()=>Date.now());
      await page.clock.install({time:new Date(clockNow)});
      await page.clock.pauseAt(new Date(clockNow+1000));
      const card=page.locator(mode==='api'?'#codex-api-usage-host':'#codex-official-usage-host');
      const height=(await card.boundingBox()).height;
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      await page.evaluate(()=>{
        Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.setSystemTime(await page.evaluate(()=>Date.now()+26000));
      await page.evaluate(()=>{
        Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await card.locator('.cq-refresh').isDisabled(),false);
      assert.equal((await card.boundingBox()).height,height);
      assert.match(await card.locator('.cq-status').textContent(),/timed out|超时/i);
      assert.equal(await card.locator('.cq-status').getAttribute('aria-live'),'polite');
      const refresh=card.locator('.cq-refresh');
      await refresh.focus();
      assert.equal(await page.locator('body > #cq-refresh-message').count(),1);
      assert.equal(await page.locator('#cq-refresh-message').evaluate(node=>node.matches(':popover-open')),true);
      assert.match(await page.locator('#cq-refresh-message').innerText(),/timed out|超时/i);
      await page.locator('#chat').dispatchEvent('scroll');
      assert.equal(await page.locator('#cq-refresh-message').evaluate(node=>node.matches(':popover-open')),true,'unrelated chat scrolling must preserve the refresh message');
      const description=await refresh.getAttribute('aria-describedby');
      assert.ok(description);
      assert.match(await page.locator(`#${description}`).textContent(),/timed out|超时/i);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#cq-refresh-message').count(),0);
      assert.equal(await refresh.evaluate(button=>button===document.activeElement),true);
      await page.locator('button[aria-haspopup="menu"]').focus();
      await refresh.dispatchEvent('pointerenter');
      assert.equal(await page.locator('#cq-refresh-message').evaluate(node=>node.matches(':popover-open')),true);
      assert.equal((await card.boundingBox()).height,height);
    } finally { await page.close(); }
  }
});

test('a reply after the absolute deadline cannot bypass a suspended timeout callback', async () => {
  for (const mode of ['account','api']) {
    const page=await pageFor(mode);
    try {
      const clockNow=await page.evaluate(()=>Date.now());
      await page.clock.install({time:new Date(clockNow)});
      await page.clock.pauseAt(new Date(clockNow+1000));
      const card=page.locator(mode==='api'?'#codex-api-usage-host':'#codex-official-usage-host');
      const originalNumber=await card.locator('.cq-number-value').innerText();
      await card.locator('.cq-refresh').evaluate(button=>button.click());
      await page.clock.setSystemTime(await page.evaluate(()=>Date.now()+26000));
      await page.evaluate(mode=>mode==='api'
        ? __codexQuotaUpdateApi({used:90,remaining:10,total:100,unit:'USD'},globalThis.__codexQuotaApiRequestId)
        : __codexQuotaUpdateOfficial({planName:'pro',windows:[{label:'Weekly',usedPercent:90,resetAt:1900000000}]},globalThis.__codexQuotaOfficialRequestId),mode);
      assert.equal(await card.locator('.cq-number-value').innerText(),originalNumber);
      assert.equal(await card.locator('.cq-refresh').isDisabled(),false);
      assert.match(await card.locator('.cq-status').textContent(),/timed out|超时/i);
    } finally { await page.close(); }
  }
});

test('refresh keeps populated Pro, Plus and API cards at the same height', async () => {
  for (const [mode, native, plus] of [['account', true, false], ['account', false, false], ['account', true, true], ['account', false, true], ['api', false, false]]) {
    const page = await pageFor(mode, native);
    try {
      if (plus) await page.evaluate(() => __codexQuotaUpdateOfficial({planName: 'plus', windows: [
        {label: '5h', usedPercent: 20, resetAt: 1900000000},
        {label: 'Weekly', usedPercent: 40, resetAt: 1900600000},
      ]}));
      const card = page.locator(native ? '#native' : mode === 'api' ? '#codex-api-usage-host' : '#codex-official-usage-host');
      const before = await card.boundingBox();
      const contentBefore = await card.innerText();
      await card.locator('.cq-refresh').click();
      const during = await card.boundingBox();
      assert.equal(during.height, before.height, `${mode}/${native}/${plus}`);
      assert.equal(await card.innerText(), contentBefore);
      assert.equal(await card.locator('.cq-refresh').isDisabled(), true);
      assert.match(await card.locator('.cq-refresh').getAttribute('aria-label'), /刷新中|Refreshing/);
      assert.equal(await card.getAttribute('aria-busy'), 'true');
      await page.evaluate(mode => mode === 'api'
        ? __codexQuotaUpdateApi(__codexQuotaApiPayload, globalThis.__codexQuotaApiRequestId)
        : __codexQuotaUpdateOfficial(__codexQuotaOfficialPayload, globalThis.__codexQuotaOfficialRequestId), mode);
      assert.equal((await card.boundingBox()).height, before.height);
      assert.equal(await card.locator('.cq-refresh').isDisabled(), false);
    } finally { await page.close(); }
  }
});

test('API card returns after sidebar replacement and stays singular on reinjection', async () => {
  const page = await pageFor('api');
  try {
    await page.evaluate(() => document.querySelector('.bottom-0').remove());
    await page.evaluate(footer => document.body.insertAdjacentHTML('beforeend', footer), footer);
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#codex-api-usage-host').count(), 1);
    assert.equal(await page.locator('#codex-api-usage-host').isVisible(), true);
    await page.evaluate(source);
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#codex-api-usage-host').count(), 1);
  } finally { await page.close(); }
});

test('API reply during missing sidebar retains data and schedules refresh', async () => {
  const page = await pageFor('api');
  try {
    await page.evaluate(() => document.querySelector('.bottom-0').remove());
    await page.waitForTimeout(80);
    await page.evaluate(data => globalThis.__codexQuotaUpdateApi(data), {...apiPayload, used: 40, remaining: 60});
    assert.equal(await page.evaluate(() => Boolean(globalThis.__codexQuotaAutoRefreshTimer)), true);
    await page.evaluate(footer => document.body.insertAdjacentHTML('beforeend', footer), footer);
    await page.waitForTimeout(80);
    assert.match(await page.locator('#codex-api-usage-host').innerText(), /60/);
  } finally { await page.close(); }
});

test('native progress changes still update the displayed quota without an observer loop', async () => {
  const page = await pageFor('account', true);
  try {
    await page.evaluate(() => { document.querySelector('#native progress').value = 42; });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#native .cq-number-value').innerText(), '42');
    assert.equal(await page.locator('#native .cq-thread-rule').getAttribute('aria-valuenow'), '42');
    const scans = await page.evaluate(() => layoutScans);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => layoutScans), scans);
  } finally { await page.close(); }
});

test('hiding the sidebar hides a native card and showing it restores the card', async () => {
  const page = await pageFor('account', true);
  try {
    await page.evaluate(() => { document.querySelector('.bottom-0').style.display = 'none'; });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#native').isVisible(), false);
    await page.evaluate(() => { document.querySelector('.bottom-0').style.display = ''; });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#native').isVisible(), true);
  } finally { await page.close(); }
});

test('API mode hides the native source and keeps only the API card visible', async () => {
  const page = await pageFor('api', true);
  try {
    assert.equal(await page.locator('#native').isVisible(), false);
    assert.equal(await page.locator('#codex-api-usage-host').isVisible(), true);
    assert.equal(await page.locator('#codex-api-usage-host').getAttribute('data-codex-api-source'), null);
    const scans = await page.evaluate(() => layoutScans);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => layoutScans), scans);
  } finally { await page.close(); }
});

test('Plus windows remain synchronized after plan switching and native updates', async () => {
  const page = await pageFor('account', true);
  try {
    await page.evaluate(() => globalThis.__codexQuotaUpdateOfficial({planName: 'plus', windows: [
      {label: 'Weekly', usedPercent: 31, resetAt: Date.now() / 1000 + 86400},
      {label: '5h', usedPercent: 47, resetAt: Date.now() / 1000 + 7200},
    ]}));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#native .cq-number-value').innerText(), '47');
    assert.equal(await page.locator('#native .cq-week-used').innerText(), '31%');
    await page.evaluate(() => { document.querySelector('#native progress[data-cq-window-label="Weekly"]').value = 35; });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#native .cq-number-value').innerText(), '47');
    assert.equal(await page.locator('#native .cq-week-used').innerText(), '35%');
  } finally { await page.close(); }
});

test('switching to API while collapsed does not retain the official hidden marker', async () => {
  const page = await pageFor('account', true);
  try {
    await page.evaluate(() => { document.querySelector('.bottom-0').style.display = 'none'; });
    await page.waitForTimeout(80);
    await page.evaluate(() => { globalThis.__codexQuotaMode = 'api'; });
    await page.evaluate(source);
    await page.evaluate(() => { document.querySelector('.bottom-0').style.display = ''; });
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#codex-api-usage-host').isVisible(), true);
    assert.equal(await page.locator('#native').isVisible(), false);
  } finally { await page.close(); }
});

const themeHosts = [
  {name: 'native official', mode: 'account', native: true, selector: '#native'},
  {name: 'fallback official', mode: 'account', native: false, selector: '#codex-official-usage-host'},
  {name: 'API', mode: 'api', native: false, selector: '#codex-api-usage-host'},
];

// Backgrounds from docs/color-selection-study-2026-09-07.md. The midpoint
// deliberately supplies an unreadable foreground to exercise correction.
const themes = [
  {name: 'warm gray', sidebar: '#eae7de', ink: '#1c1917'},
  {name: 'white', sidebar: '#ffffff', ink: '#1c1917'},
  {name: 'cool light gray', sidebar: '#edf1f6', ink: '#1c1917'},
  {name: 'graphite', sidebar: '#22252a', ink: '#f3f4f6'},
  {name: 'warm charcoal', sidebar: '#302c29', ink: '#f3f4f6'},
  {name: 'deep blue', sidebar: '#1f2d40', ink: '#f3f4f6'},
  {name: 'pale gray green', sidebar: '#e0e8df', ink: '#1c1917'},
  {name: 'gray purple', sidebar: '#e9e4f1', ink: '#1c1917'},
  {name: 'warm rose gray', sidebar: '#f0e4e2', ink: '#1c1917'},
  {name: 'strong blue', sidebar: '#254ccc', ink: '#e2eaff'},
  {name: 'near black', sidebar: '#050505', ink: '#f3f4f6'},
  {name: 'middle gray', sidebar: '#777e85', ink: '#7b8187'},
];

async function prepareThemePage(host) {
  const page = await pageFor(host.mode, host.native);
  await page.addStyleTag({content: `
    body { margin: 0; width: 264px; font-family: Arial, sans-serif;
      background: var(--color-token-side-bar-background, var(--vscode-sideBar-background));
      color: var(--color-token-text-primary); }
    .bottom-0 { width: 100%; }
    :root {
      --color-background-elevated-primary-opaque: #ffffff;
      --vscode-sideBar-background: #a020f0;
      --vscode-foreground: #a020f0;
      --color-token-side-bar-background: #eae7de;
      --color-token-text-primary: #1c1917;
      --color-text-secondary-solid: #888888;
      --codex-base-accent: #2f6f6b;
    }
  `});
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<span id="theme-probe">Unmodified host UI</span>'));
  await settleTheme(page);
  return page;
}

async function settleTheme(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function themeSource(page) {
  return page.evaluate(() => ({
    root: document.documentElement.getAttribute('style'),
    body: document.body.getAttribute('style'),
    probe: document.getElementById('theme-probe').outerHTML,
    probeColor: getComputedStyle(document.getElementById('theme-probe')).color,
  }));
}

async function cardAppearance(page, selector) {
  return page.locator(selector).evaluate(card => {
    const style = getComputedStyle(card);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgba = value => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const rect = card.getBoundingClientRect();
    const parent = card.parentElement.getBoundingClientRect();
    const rule = card.querySelector('.cq-thread-rule, .cq-rule');
    const text = [...card.querySelectorAll('*')].filter(element =>
      element.getClientRects().length && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    ).map(element => {
      const backgrounds = [];
      for (let ancestor = element; ancestor !== card; ancestor = ancestor.parentElement) {
        backgrounds.unshift(rgba(getComputedStyle(ancestor).backgroundColor));
      }
      return {label: element.className, color: rgba(getComputedStyle(element).color), backgrounds};
    });
    return {
      background: rgba(style.backgroundColor),
      sidebar: rgba(getComputedStyle(document.body).backgroundColor),
      sourceInk: rgba(getComputedStyle(document.body).getPropertyValue('--color-token-text-primary')),
      color: rgba(style.color),
      accent: rgba(getComputedStyle(rule.querySelector('.cq-progress-fill')).backgroundColor),
      refresh: rgba(getComputedStyle(card.querySelector('.cq-refresh')).color),
      text,
      image: style.backgroundImage,
      blur: style.backdropFilter,
      shadow: style.boxShadow,
      fits: rect.left >= parent.left && rect.right <= parent.right + 1 && card.scrollWidth <= card.clientWidth + 1,
    };
  });
}

const composite = (front, back) => front.slice(0, 3).map((channel, index) => channel * front[3] / 255 + back[index] * (1 - front[3] / 255));
const luminance = rgb => rgb.map(channel => channel / 255).map(channel =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (front, back) => {
  const values = [luminance(composite(front, back)), luminance(back)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

function assertReadable(appearance, label) {
  const base = composite(appearance.background, appearance.sidebar);
  const surfaces = [base, composite([255, 255, 255, 255 * 0.025], base)];
  for (const surface of surfaces) {
    assert.ok(contrast(appearance.color, surface) >= 4.5, `${label}: main text contrast`);
    for (const text of appearance.text) {
      const background = text.backgrounds.reduce((back, front) => composite(front, back), surface);
      assert.ok(contrast(text.color, background) >= 4.5, `${label}: ${text.label} contrast ${contrast(text.color, background).toFixed(3)}`);
    }
    assert.ok(contrast(appearance.refresh, surface) >= 3, `${label}: refresh icon contrast`);
    assert.ok(contrast(appearance.accent, surface) >= 3, `${label}: progress contrast`);
  }
  if (surfaces.every(surface => contrast(appearance.sourceInk, surface) >= 4.5 && appearance.text.every(text =>
    contrast(appearance.sourceInk, text.backgrounds.reduce((back, front) => composite(front, back), surface)) >= 4.5
  ))) {
    assert.deepEqual(appearance.color, appearance.sourceInk, `${label}: preserve the readable theme foreground`);
  }
}

for (const host of themeHosts.filter(host => host.mode === 'api')) {
  test(`${host.name} tonal surface follows twelve themes, stays independent of accent and remains readable`, async () => {
    const page = await prepareThemePage(host);
    try {
      const backgrounds = [];
      const originalCard = await page.locator(host.selector).elementHandle();
      for (const theme of themes) {
        const sourceBefore = await page.evaluate(theme => {
          const style = document.body.style;
          style.setProperty('--color-token-side-bar-background', theme.sidebar);
          style.setProperty('--color-token-text-primary', theme.ink);
          style.setProperty('--codex-base-accent', '#2f6f6b');
          return {
            root: document.documentElement.getAttribute('style'),
            body: document.body.getAttribute('style'),
            probe: document.getElementById('theme-probe').outerHTML,
            probeColor: getComputedStyle(document.getElementById('theme-probe')).color,
          };
        }, theme);
        await settleTheme(page);
        const appearance = await cardAppearance(page, host.selector);
        assert.ok(appearance.background[3] > 0 && appearance.background[3] < 255, 'glass keeps a translucent tint');
        assert.equal(appearance.blur, 'blur(18px)');
        assertReadable(appearance, theme.name);
        assert.deepEqual(await themeSource(page), sourceBefore, 'theme correction stays inside the quota card');
        backgrounds.push(appearance.background.slice(0, 3));
        if (theme.name === 'white' || theme.name === 'near black') {
          assert.ok(Math.max(...appearance.background.slice(0, 3)) - Math.min(...appearance.background.slice(0, 3)) <= 1, 'neutral backgrounds stay neutral');
        }
        await page.evaluate(() => document.body.style.setProperty('--codex-base-accent', '#e963c5'));
        await settleTheme(page);
        const newAccent = await cardAppearance(page, host.selector);
        assert.deepEqual(newAccent.background, appearance.background, 'changing accent does not recolor the card surface');
        assertReadable(newAccent, `${theme.name}, alternate accent`);
      }
      assert.equal(new Set(backgrounds.map(color => color.join(','))).size, themes.length);

      await page.evaluate(() => document.body.style.setProperty('--color-token-side-bar-background', '#777777'));
      await settleTheme(page);
      const neutralGray = await cardAppearance(page, host.selector);
      assert.ok(Math.max(...neutralGray.background.slice(0, 3)) - Math.min(...neutralGray.background.slice(0, 3)) <= 1, 'middle neutral gray stays neutral with a colored accent');
      assertReadable(neutralGray, 'neutral middle gray');

      await page.evaluate(() => {
        document.body.style.removeProperty('--color-token-side-bar-background');
        document.documentElement.style.setProperty('--color-token-side-bar-background', 'initial');
      });
      await settleTheme(page);
      const fallback = await cardAppearance(page, host.selector);
      assert.ok(fallback.background[0] > fallback.background[1] && fallback.background[2] > fallback.background[1], 'VS Code sidebar token supplies the fallback tint');
      await page.evaluate(() => document.body.style.setProperty('--vscode-sideBar-background', '#204020'));
      await settleTheme(page);
      const changedFallback = await cardAppearance(page, host.selector);
      assert.ok(changedFallback.background[1] > changedFallback.background[0], 'fallback sidebar changes also update the tint');

      for (const width of [264, 220, 180]) {
        await page.evaluate(width => { document.body.style.width = `${width}px`; }, width);
        assert.equal((await cardAppearance(page, host.selector)).fits, true, `card fits a ${width}px sidebar`);
      }
      assert.equal(await page.locator('#codex-native-compact-usage-style').count(), 1);
      assert.equal(await page.locator(host.selector).count(), 1);
      assert.equal(await originalCard.evaluate(card => card.isConnected), true, 'theme changes preserve the original card DOM');
    } finally { await page.close(); }
  });

  test(`${host.name} keeps requested blur under reduced transparency and respects contrast`, async () => {
    const page = await prepareThemePage(host);
    try {
      await page.addStyleTag({content: `
        .system-surface { backdrop-filter: blur(6px); }
        @media (prefers-reduced-transparency: reduce) { .system-surface { backdrop-filter: none; } }
      `});
      await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="system-surface">Other UI</div>'));
      const session = await page.context().newCDPSession(page);
      for (const feature of [
        {name: 'prefers-reduced-transparency', value: 'reduce'},
        {name: 'prefers-contrast', value: 'more'},
        {name: 'forced-colors', value: 'active'},
      ]) {
        await session.send('Emulation.setEmulatedMedia', {features: [feature]});
        assert.equal(await page.evaluate(feature => matchMedia(`(${feature.name}: ${feature.value})`).matches, feature), true);
        const appearance = await cardAppearance(page, host.selector);
        if (feature.name === 'prefers-reduced-transparency') {
          assert.ok(appearance.background[3] < 255, 'quota card opts into translucency');
          assert.match(appearance.blur, /blur\(18px\)/);
          assert.equal(await page.locator('.system-surface').evaluate(e => getComputedStyle(e).backdropFilter), 'none', 'other UI still follows reduced transparency');
          assert.notEqual(appearance.image, 'none');
          assert.notEqual(appearance.shadow, 'none');
        } else {
          assert.equal(appearance.background[3], 255, `${feature.name} uses an opaque surface`);
          assert.equal(appearance.blur, 'none');
          assert.equal(appearance.image, 'none');
          assert.equal(appearance.shadow, 'none');
        }
      }
      await session.send('Emulation.setEmulatedMedia', {features: []});
      const restored = await cardAppearance(page, host.selector);
      assert.ok(restored.background[3] < 255);
      assert.match(restored.blur, /blur\(/);
    } finally { await page.close(); }
  });
}

test('replacing a host theme stylesheet updates card colors without an observer loop', async () => {
  const host = themeHosts.find(host => host.mode === 'api');
  const page = await prepareThemePage(host);
  try {
    const stylesheet = await page.addStyleTag({content: ':root { --color-token-side-bar-background: #ffffff; --color-token-text-primary: #1c1917; }'});
    await stylesheet.evaluate(style => { style.id = 'host-theme'; });
    await settleTheme(page);
    const previous = await cardAppearance(page, host.selector);
    const rootBefore = await page.locator('html').getAttribute('style');
    const bodyBefore = await page.locator('body').getAttribute('style');
    const declaration = ':root { --color-token-side-bar-background: #22252a; --color-token-text-primary: #f3f4f6; --codex-base-accent: #a5c8eb; }';
    await page.locator('#host-theme').evaluate((style, declaration) => { style.textContent = declaration; }, declaration);
    await settleTheme(page);
    const appearance = await cardAppearance(page, host.selector);
    assert.notDeepEqual(appearance.background, previous.background);
    assertReadable(appearance, 'stylesheet replacement');
    assert.equal(await page.locator('#host-theme').textContent(), declaration, 'the host stylesheet is not rewritten');
    assert.equal(await page.locator('html').getAttribute('style'), rootBefore);
    assert.equal(await page.locator('body').getAttribute('style'), bodyBefore);
    assert.equal(await page.locator('#theme-probe').evaluate(element => getComputedStyle(element).color), 'rgb(243, 244, 246)');
    const scans = await page.evaluate(() => layoutScans);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => layoutScans), scans, 'theme synchronization stops after applying the change');
    assert.equal(await page.locator('#codex-native-compact-usage-style').count(), 1);
    assert.equal(await page.locator(host.selector).count(), 1);
  } finally { await page.close(); }
});

test('dark system colors remain dark through transparent ancestors and missing sidebar tokens', async () => {
  const page = await pageFor('api');
  try {
    await page.addStyleTag({content: `
      html { color-scheme: dark; background: transparent;
        --color-token-text-primary: CanvasText;
        --color-text-secondary-solid: CanvasText;
        --codex-base-accent: Highlight; }
      body { background: transparent; }
    `});
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<span id="system-color-reference" style="color:CanvasText;background:Canvas">System colors</span>'));
    const reference = await page.locator('#system-color-reference').evaluate(element => ({
      background: getComputedStyle(element).backgroundColor.match(/\d+/g).map(Number),
      color: getComputedStyle(element).color,
    }));
    assert.ok(luminance(reference.background) < 0.1, 'the browser resolves dark Canvas');
    for (const sidebar of ['transparent', null]) {
      await page.evaluate(sidebar => {
        if (sidebar) document.documentElement.style.setProperty('--color-token-side-bar-background', sidebar);
        else document.documentElement.style.removeProperty('--color-token-side-bar-background');
      }, sidebar);
      await settleTheme(page);
      const card = page.locator('#codex-api-usage-host');
      assert.equal(await card.evaluate(element => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).backgroundColor !== 'rgba(0, 0, 0, 0)') return false;
        }
        return true;
      }), true, 'all card ancestors are transparent');
      assert.equal(await card.evaluate(element => getComputedStyle(element).getPropertyValue('--cq-sidebar').trim()), sidebar || 'Canvas');
      const appearance = await cardAppearance(page, '#codex-api-usage-host');
      const surface = composite(appearance.background, reference.background);
      assert.ok(luminance(surface) < 0.1, 'transparent and missing sidebar colors must not produce a white card');
      assert.equal(await card.evaluate(element => getComputedStyle(element).color), reference.color, 'CanvasText follows the card color scheme');
      assert.ok(contrast(appearance.color, composite([255, 255, 255, 255 * 0.025], surface)) >= 4.5);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(source);
      await settleTheme(page);
    }
    assert.equal(await page.locator('#codex-quota-color-probe').count(), 1, 'reinjection reuses the color probe');
    assert.equal(await page.locator('#codex-quota-color-probe').isVisible(), false);
    const scans = await page.evaluate(() => layoutScans);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => layoutScans), scans, 'color probing does not create an observer loop');
  } finally { await page.close(); }
});

for (const host of themeHosts.filter(host => host.mode === 'account')) {
  test(`${host.name} keeps the final warm-paper appearance without changing host themes`, async () => {
    const page=await prepareThemePage(host);
    try {
      const original=await page.locator(host.selector).elementHandle();
      for(const theme of themes) {
        await page.evaluate(theme=>{
          document.body.style.setProperty('--color-token-side-bar-background',theme.sidebar);
          document.body.style.setProperty('--color-token-text-primary',theme.ink);
          document.body.style.setProperty('--codex-base-accent','#e963c5');
        },theme);
        const before=await themeSource(page);
        await settleTheme(page);
        const appearance=await cardAppearance(page,host.selector);
        assert.deepEqual(appearance.background,[251,248,241,255]);
        assert.deepEqual(appearance.color,[28,25,23,255]);
        assert.deepEqual(appearance.accent,[142,70,23,255]);
        assert.deepEqual(appearance.refresh,[158,153,139,255]);
        assert.equal(appearance.image,'none');
        assert.equal(appearance.blur,'none');
        assert.notEqual(appearance.shadow,'none');
        assert.deepEqual(await themeSource(page),before);
      }
      for(const width of [264,220,180]) {
        await page.evaluate(width=>{document.body.style.width=`${width}px`;},width);
        assert.equal((await cardAppearance(page,host.selector)).fits,true,`fits ${width}px sidebar`);
      }
      await page.emulateMedia({forcedColors:'active'});
      const accessible=await cardAppearance(page,host.selector);
      assert.equal(accessible.blur,'none');
      assert.equal(accessible.image,'none');
      assert.ok(contrast(accessible.color,accessible.background.slice(0,3))>=4.5, `forced-colors foreground ${accessible.color}, background ${accessible.background}`);
      assert.equal(await original.evaluate(el=>el.isConnected),true);
    } finally { await page.close(); }
  });
}
