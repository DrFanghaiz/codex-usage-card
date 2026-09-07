// Run with: node --test tests/native_patch_runtime.cjs (requires Playwright and Edge).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test, before, after} = require('node:test');
const {chromium} = require('playwright');

const source = readFileSync(process.env.QUOTA_SCRIPT || join(__dirname, '../native-patch/native_patch.js'), 'utf8');
const footer = '<div class="absolute inset-x-0 bottom-0 z-20"><div><button aria-haspopup="menu">Account</button></div></div>';
const apiPayload = {used: 25, remaining: 75, total: 100, unit: 'USD'};
let browser;
before(async () => { browser = await chromium.launch({headless: true, channel: 'msedge'}); });
after(async () => { await browser?.close(); });

async function pageFor(mode, native = false) {
  const page = await browser.newPage();
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
    assert.equal(await page.locator('#native .cq-remaining-value').innerText(), '58%');
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
      accent: rgba(getComputedStyle(rule, '::before').backgroundColor),
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

for (const host of themeHosts) {
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
  const host = themeHosts[0];
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
  const page = await pageFor('account');
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
      const card = page.locator('#codex-official-usage-host');
      assert.equal(await card.evaluate(element => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).backgroundColor !== 'rgba(0, 0, 0, 0)') return false;
        }
        return true;
      }), true, 'all card ancestors are transparent');
      assert.equal(await card.evaluate(element => getComputedStyle(element).getPropertyValue('--cq-sidebar').trim()), sidebar || 'Canvas');
      const appearance = await cardAppearance(page, '#codex-official-usage-host');
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
