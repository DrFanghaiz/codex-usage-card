// Run: node --test tests/native_patch_runtime.cjs (Playwright + Edge; synthetic data only).
const assert = require('node:assert/strict');
const {readFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const {test, before, after} = require('node:test');
const {chromium} = require('playwright');
const source = readFileSync(process.env.QUOTA_SCRIPT || join(__dirname, '../native-patch/native_patch.js'), 'utf8');
// Reduced November host fixture: native usage meter and profile share the bottom rail stack.
const shell = `<!doctype html><html lang="zh"><head><style>
*{box-sizing:border-box}body{margin:0;font:13px 'Segoe UI',sans-serif;display:flex;height:100vh;background:#f4f1e8}
:root{--spacing:.25rem;--radius-2xl:20px;color-scheme:light;--color-surface-elevated-secondary:#f5f3eb;--color-text:#202522;--color-text-secondary:#63675d;--color-border:#e1ded5;--color-background-primary-ghost-hover:#e3e0d8}
nav[data-app-navigation-rail]{width:51px;display:flex;flex-direction:column;align-items:center;padding-bottom:8px;background:#eae7de;flex:none}
.rail-top{flex:1}.w-9{width:36px}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.rail-stack{gap:8px}.profile{width:100%}
.sidebar-item button,#help{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;background:transparent}.rounded-full{display:block;width:24px;height:24px;border-radius:50%;background:#afbeb0}
.sidebar-navigation{position:relative;display:flex;flex-direction:column;width:238px;min-width:0;min-height:0;overflow:hidden;background:#f1eee4;flex:none}.contents{display:contents}.sidebar-navigation nav{display:flex;flex:1;min-height:0;flex-direction:column;padding:8px}.sidebar-navigation [data-app-action-sidebar-scroll]{flex:1;min-height:0;overflow:auto}.list-item{height:31px}main{flex:1;min-width:0}
#native-menu,#profile-menu{position:fixed;inset:auto;width:260px;left:60px;top:100px;margin:0;padding:16px;background:var(--color-surface-elevated-secondary);color:var(--color-text)}#profile-menu{width:228px}
[hidden]{display:none!important}@media(max-width:400px){.sidebar-navigation{width:220px}}
</style></head><body><nav data-app-navigation-rail="true"><div class="rail-top"><button id="collapse">折叠</button><button id="menu-trigger" popovertarget="native-menu">菜单</button></div><div class="relative shrink-0 w-9"><div class="flex items-center flex-col rail-stack"><div class="flex items-center flex-col"><button id="help" type="button" aria-label="用量" aria-haspopup="menu" aria-controls="native-menu" aria-description="每周用量：剩余72%" popovertarget="native-menu"><svg viewBox="0 0 28 28"><path pathLength="100" d="M14 2a12 12 0 1 1 0 24a12 12 0 1 1 0-24" fill="none" stroke="currentColor"></path></svg></button></div><div class="flex profile"><div class="sidebar-item"><div><button id="profile" type="button" aria-haspopup="menu" aria-controls="profile-menu" aria-expanded="false" popovertarget="profile-menu"><span><span id="avatar" class="rounded-full"></span></span></button></div></div></div></div></div></nav><div class="sidebar-navigation"><div class="contents"><nav role="navigation"><div>项目</div><div data-app-action-sidebar-scroll>${Array.from({length:80},(_,i)=>`<div class="list-item">项目 ${i}</div>`).join('')}</div></nav><div class="absolute inset-x-0 bottom-0 z-20"></div></div></div><main id="chat"><button id="outside">正文</button></main><div id="native-menu" role="menu" aria-labelledby="help" popover="auto">原生菜单</div><div id="profile-menu" role="menu" aria-labelledby="profile" popover="auto">头像菜单</div><script>document.getElementById("profile-menu").addEventListener("beforetoggle",event=>document.getElementById("profile").setAttribute("aria-expanded",String(event.newState==="open")));document.getElementById('collapse').onclick=()=>document.querySelector('.sidebar-navigation').hidden=!document.querySelector('.sidebar-navigation').hidden;</script></body></html>`;
const officialPayload = () => ({planName:'plus',windows:[{label:'5h',usedPercent:28,resetAt:Date.now()/1000+9000},{label:'Weekly',usedPercent:63,resetAt:Date.now()/1000+302400}]});
let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:'msedge'});});
after(async()=>{await browser?.close();});
async function setup(page,data=officialPayload()) {
  await page.evaluate(data=>{
    __codexQuotaMode='account';__codexQuotaSessionScope='synthetic-session';
    __codexQuotaOfficialLoaded=true;
    __codexQuotaOfficialLastSuccessAt=Date.now();
    if(data)__codexQuotaOfficialPayload=data;
    globalThis.layoutScans=0;
    const all=document.querySelectorAll.bind(document);
    document.querySelectorAll=selector=>{if(selector==='nav[data-app-navigation-rail="true"]')layoutScans++;return all(selector)};
  },data);
  await page.evaluate(source);await settle(page);
}
async function pageFor(data=officialPayload(),viewport={width:1024,height:720},options={}) {
  const page=await browser.newPage({reducedMotion:'reduce',locale:'zh-CN',viewport,...options});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.errors=errors;
  await page.setContent(shell);await setup(page,data);return page;
}
async function sharedPages(count=1,options={}) {
  const context=await browser.newContext({reducedMotion:'reduce',locale:'zh-CN',...options});
  await context.route('https://quota.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:shell}));
  const pages=[];
  for(let i=0;i<count;i++){const page=await context.newPage();await page.goto('https://quota.test/');await setup(page,null);pages.push(page);}
  return {context,pages};
}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForTimeout(70);}
async function open(page){await page.locator('#codex-quota-trigger').click();await settle(page);}
async function collapse(page){await page.locator('.cq-local-close').click();await settle(page);}
async function update(page,data){await page.evaluate(data=>__codexQuotaUpdateOfficial(data,globalThis.__codexQuotaOfficialRequestId),data);}
async function close(page){assert.deepEqual(page.errors||[],[]);await page.close();}
async function geometry(page){return page.evaluate(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};return {trigger:rect('#codex-quota-trigger'),avatar:rect('#avatar'),column:rect('.sidebar-navigation'),popup:rect('#codex-quota-popover'),rail:rect('[data-app-navigation-rail]'),help:rect('#help'),overflow:document.documentElement.scrollWidth>innerWidth}});}
async function finishAnimations(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.cq-shared-layer,#codex-quota-popover[data-cq-opening]'),null,{timeout:1200});await page.evaluate(()=>{for(const el of document.querySelectorAll('#codex-quota-popover,#codex-quota-trigger'))for(const animation of el.getAnimations({subtree:true}))if(animation.effect.getComputedTiming().endTime!==Infinity)animation.finish();});await settle(page);}
async function assertMotionClean(page){assert.deepEqual(await page.locator('#codex-quota-popover').evaluate(el=>({height:el.style.height,clip:el.style.clipPath,transform:el.style.transform,opacity:el.style.opacity,animations:el.getAnimations({subtree:true}).length,dirtyChildren:[...el.children].filter(child=>child.style.opacity||child.style.transform).map(child=>child.id),sharedLayers:document.querySelectorAll('.cq-shared-layer').length,hiddenEndpoints:document.querySelectorAll('[data-cq-shared-hidden]').length})),{height:'',clip:'',transform:'',opacity:'',animations:0,dirtyChildren:[],sharedLayers:0,hiddenEndpoints:0});}


const localUsagePayload=(range,overrides={})=>{
  const models=[{model:'gpt-6-astra',inputTokens:4000000,cachedInputTokens:3000000,outputTokens:380000,totalTokens:4380000},
    {model:'gpt-6.1-sol',inputTokens:23000000,cachedInputTokens:22000000,outputTokens:540000,totalTokens:23540000},
    {model:'gpt-6-sol',inputTokens:1200,cachedInputTokens:1000,outputTokens:300,totalTokens:1500}];
  const data={...range,models,eventCount:3,partial:false,hasLogs:true,issues:[],reference:{planName:'pro',selectedPlan:'pro200',referenceKind:'legacy20x',status:'ok',models:{'gpt-6-astra':438000000,'gpt-6.1-sol':2354000000},lastSuccessAt:'2026-10-28T00:00:00Z',nextCheckAt:'2026-10-29T00:00:00Z'},...overrides};
  if(!Object.hasOwn(overrides,'daily'))data.daily=data.eventCount||data.partial||data.issues.length?[{date:range.end,models:data.models,eventCount:data.eventCount,partial:data.partial,issues:data.issues}]:[];
  if(!Object.hasOwn(overrides,'interval'))data.interval={start:range.intervalStart,end:range.intervalEnd,local:{start:range.start,end:range.end,models:data.models,eventCount:data.eventCount,partial:data.partial,hasLogs:data.hasLogs,issues:data.issues,daily:data.daily},account:{status:'insufficient_history',usedPercent:null,sampledStartAt:null,sampledEndAt:null,coverageStartAt:null,coverageEndAt:null}};
  return data;
};
async function localUsageRequest(page){return page.evaluate(()=>({range:globalThis.__codexQuotaLocalUsageRange,id:globalThis.__codexQuotaLocalUsageTestRequestId}));}
async function showLocalUsage(page){await page.evaluate(()=>{const info=console.info;console.info=(...args)=>{if(args[0]==='__codexQuotaLocalUsageRequest__')globalThis.__codexQuotaLocalUsageTestRequestId=args[1];info.apply(console,args);};});await open(page);await settle(page);}
async function updateLocalUsage(page,data,id){await page.evaluate(({data,id})=>__codexQuotaUpdateLocalUsage(data,id),{data,id});await settle(page);}
async function fillInterval(form,start,end){for(const [name,value]of[['intervalStart',start],['intervalEnd',end]]){const [date,time]=value.split(/[ T]/);await form.locator(`[name=${name}]`).fill(date);await form.locator(`[name=${name}Time]`).fill(time);}}
async function applyCustom(page,start='2026-10-01 00:00:00',end='2026-10-14 23:59:59'){await page.locator('[data-period=custom]').click();const form=page.locator('.cq-interval-controls');await fillInterval(form,start,end);await form.locator('[type=submit]').click();await settle(page);return localUsageRequest(page);}
async function customDailyRange(page){await showLocalUsage(page);return applyCustom(page);}
async function openReferences(page){await page.locator('.cq-settings-button').click();await page.locator('[data-settings=reference]').click();const ref=page.locator('.cq-local-reference');if(!await ref.evaluate(el=>el.open))await ref.locator(':scope > summary').click();return ref;}
const dailyChartPayload=range=>{
  const a={model:'gpt-6.1-sol',inputTokens:1000000,cachedInputTokens:500000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:100000,totalTokens:1100000};
  const b={...a,inputTokens:2000000,cachedInputTokens:1000000,outputTokens:200000,totalTokens:2200000};
  const issue={code:'SOURCE_UNCONFIRMED',count:1,missingTokens:900,affectsTotals:true,dateUnknown:false};
  return localUsagePayload(range,{models:[{...a,inputTokens:3000000,cachedInputTokens:1500000,outputTokens:300000,totalTokens:3300000}],eventCount:2,partial:true,issues:[issue],daily:[{date:'2026-10-01',models:[a],eventCount:1,partial:false,issues:[]},{date:'2026-10-02',models:[b],eventCount:1,partial:false,issues:[]},{date:'2026-10-04',models:[],eventCount:0,partial:true,issues:[issue]}]});
};

test('preview grid separates the primary estimate, account readout and visible usage groups',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);const data=localUsagePayload(range);
  await updateLocalUsage(page,data,id);
  assert.equal(await page.locator('.cq-local-tabs,[role=tablist],.cq-local-page,.cq-local-dates').count(),0);
  assert.equal(await page.locator('[data-period]').count(),4);assert.match(await page.locator('.cq-local-recent-local').innerText(),/本机.*估算/);
  assert.match(await page.locator('.cq-local-recent-local strong').innerText(),/2/);
  assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'27,921,500 token');
  assert.match(await page.locator('.cq-local-cost strong').textContent(),/41\.60/);
  assert.equal(await page.locator('.cq-reading-mark').count(),0,'static reading marks are removed');
  const layout=await page.locator('.cq-local-result').evaluate(result=>{
    const primary=result.querySelector('.cq-local-primary-estimate'), label=result.querySelector('.cq-range-dates'), card=result.closest('#codex-quota-popover');
    return {font:getComputedStyle(primary).fontSize,weight:getComputedStyle(primary).fontWeight,alignment:getComputedStyle(primary).textAlign,
      sharedLeft:Math.abs(primary.getBoundingClientRect().left-label.getBoundingClientRect().left)<=2,
      inset:primary.getBoundingClientRect().left-card.getBoundingClientRect().left-parseFloat(getComputedStyle(card).borderLeftWidth)};
  });
  assert.deepEqual(layout,{font:'26px',weight:'700',alignment:'left',sharedLeft:true,inset:12});
  assert.equal(await page.locator('.cq-local-mix').isVisible(),true);
  const legendRows=await page.locator('.cq-local-mix .cq-local-composition-values > div').evaluateAll(nodes=>new Set(nodes.map(node=>node.getBoundingClientRect().top)).size);
  assert.equal(legendRows,1,'the compact legend fits the avatar-width card');
  assert.equal(await page.locator('header .cq-local-refresh').count(),1);
  assert.equal(await page.locator('.cq-local-models').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.cq-local-usage-details').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.cq-local-highlights').isVisible(),true);
  assert.equal(await page.locator('.cq-local-reference').isVisible(),false);
  assert.equal(await page.locator('.cq-interval-controls').isVisible(),false);
 }finally{await close(page);}
});

test('today and week produce one exact local-time range and refresh advances only that range',async()=>{
 const page=await pageFor(officialPayload(),{width:1024,height:800},{timezoneId:'Asia/Shanghai'});try{
  await page.clock.install({time:new Date('2026-11-04T12:30:00+08:00')});await showLocalUsage(page);let r=await localUsageRequest(page);
  assert.equal(r.range.start,'2026-11-04');assert.equal(r.range.end,'2026-11-04');assert.equal(r.range.intervalStart,'2026-11-03T16:00:00.000Z');
  assert.ok(Math.abs(Date.parse(r.range.intervalEnd)-Date.parse('2026-11-04T04:30:00Z'))<1000);
  await updateLocalUsage(page,localUsagePayload(r.range),r.id);await page.locator('[data-period=week]').click();r=await localUsageRequest(page);
  assert.equal(r.range.start,'2026-11-02');assert.equal(r.range.intervalStart,'2026-11-01T16:00:00.000Z');assert.equal(r.range.end,'2026-11-04');
  await updateLocalUsage(page,localUsagePayload(r.range),r.id);await page.clock.runFor(2000);await page.locator('.cq-local-refresh').click();const next=await localUsageRequest(page);
  assert.equal(next.range.intervalStart,r.range.intervalStart);assert.ok(Date.parse(next.range.intervalEnd)>Date.parse(r.range.intervalEnd));
 }finally{await close(page);}
});

test('reopening starts on today after a different range or an unfinished date edit',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:800},{timezoneId:'Asia/Shanghai'});try{
  await page.clock.install({time:new Date('2026-11-04T12:30:00+08:00')});
  await showLocalUsage(page);const first=await localUsageRequest(page);
  await updateLocalUsage(page,localUsagePayload(first.range),first.id);
  await page.locator('[data-period=week]').click();const week=await localUsageRequest(page);
  await updateLocalUsage(page,localUsagePayload(week.range),week.id);
  assert.equal(await page.locator('.cq-local-daily').isVisible(),true);
  await collapse(page);await open(page);
  const today=await localUsageRequest(page);
  assert.notEqual(today.id,week.id);
  assert.equal(today.range.intervalStart,first.range.intervalStart);
  assert.equal(await page.locator('[data-period][aria-pressed=true]').getAttribute('data-period'),'today');
  assert.equal(await page.locator('.cq-local-daily').count(),0);
  await updateLocalUsage(page,localUsagePayload(week.range),week.id);
  assert.equal(await page.locator('.cq-local-result').getAttribute('aria-busy'),'true');
  await updateLocalUsage(page,localUsagePayload(today.range),today.id);
  await page.locator('[data-period=custom]').click();
  await page.locator('[data-date-field=intervalEnd]').click();
  await collapse(page);await open(page);
  assert.equal(await page.locator('.cq-interval-controls').isVisible(),false);
  assert.equal(await page.locator('.cq-local-calendar').isVisible(),false);
  assert.equal((await localUsageRequest(page)).id,today.id);
  const custom=await applyCustom(page);
  await updateLocalUsage(page,localUsagePayload(custom.range),custom.id);
  await collapse(page);await open(page);
  assert.equal(await page.locator('[data-period][aria-pressed=true]').getAttribute('data-period'),'today');
  assert.equal((await localUsageRequest(page)).range.intervalStart,first.range.intervalStart);
 }finally{await close(page);}
});

test('the last ten minutes roll across midnight and the displayed result opens its own editable draft',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:800},{timezoneId:'Asia/Shanghai',locale:'en-US'});
 try {
  await page.clock.install({time:new Date('2026-11-04T00:05:00+08:00')});
  await showLocalUsage(page);
  const form=page.locator('.cq-interval-controls'),edit=page.locator('.cq-range-dates');
  await page.locator('[data-period=hour]').press('Enter');
  const first=await localUsageRequest(page);
  assert.equal(await form.isVisible(),false);
  assert.deepEqual([first.range.start,first.range.end],['2026-11-03','2026-11-04']);
  assert.equal(Date.parse(first.range.intervalEnd)-Date.parse(first.range.intervalStart),600000);
  await updateLocalUsage(page,localUsagePayload(first.range),first.id);
  await page.clock.runFor(2000);
  await page.locator('.cq-local-refresh').click();
  const refreshed=await localUsageRequest(page);
  assert.ok(Date.parse(refreshed.range.intervalStart)>Date.parse(first.range.intervalStart));
  assert.equal(Date.parse(refreshed.range.intervalEnd)-Date.parse(refreshed.range.intervalStart),600000);
  await updateLocalUsage(page,localUsagePayload(refreshed.range),refreshed.id);
  await page.locator('[data-period=week]').click();
  const loading=await localUsageRequest(page);
  await edit.press('Enter');
  assert.equal((await localUsageRequest(page)).id,loading.id);
  assert.equal(await edit.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('[data-period=week]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-period=custom]').getAttribute('aria-pressed'),'false');
  assert.equal(await form.locator('[name=intervalStart]').inputValue(),'2026-11-03');
  assert.equal(await form.locator('[name=intervalEnd]').inputValue(),'2026-11-04');
  assert.equal(await form.locator('[name=intervalStart]').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-period=custom]').click();
  assert.equal(await edit.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('[data-period=week]').getAttribute('aria-pressed'),'true');
  assert.equal((await localUsageRequest(page)).id,loading.id);
  await edit.click();
  await form.locator('[type=submit]').click();
  const applied=await localUsageRequest(page);
  assert.equal(await form.isVisible(),false);
  assert.equal(await edit.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('[data-period=custom]').evaluate(el=>el===document.activeElement),true);
  for(const name of ['intervalStart','intervalEnd']) {
    assert.equal(Date.parse(applied.range[name]),Math.floor(Date.parse(refreshed.range[name])/1000)*1000);
  }
  const marker=await page.locator('.cq-local-period-marker').boundingBox();
  const active=await page.locator('[data-period=custom]').boundingBox();
  assert.ok(Math.abs(marker.x-active.x)<1 && Math.abs(marker.width-active.width)<1);
  assert.equal(await page.locator('.cq-local-periods button').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth)),true);
 } finally {await close(page);}
});

test('custom editor, quick durations, calendar and fine sliders remain drafts until Apply',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:800});try{
  await showLocalUsage(page);let request=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(request.range),request.id);
  await page.locator('[data-period=custom]').click();const form=page.locator('.cq-interval-controls');
  assert.equal(await form.isVisible(),true);assert.equal((await localUsageRequest(page)).id,request.id);
  assert.equal(await page.locator('[data-period=today]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-period=custom]').getAttribute('aria-expanded'),'true');
  for(const minutes of [30,60,180,300]){await form.locator(`[data-interval-minutes="${minutes}"]`).click();assert.equal((await localUsageRequest(page)).id,request.id);const range=await page.evaluate(()=>document.getElementById('cq-local-usage').cqGetInterval(false));assert.equal(Date.parse(range.intervalEnd)-Date.parse(range.intervalStart),minutes*60000);}
  const fine=form.locator('.cq-interval-fine');assert.equal(await fine.evaluate(el=>el.open),false);await fine.locator('summary').click();assert.equal(await form.locator('[name=fromSlider]').isVisible(),true);assert.equal(await form.locator('[name=toSlider]').isVisible(),true);assert.deepEqual(await fine.locator('[type=range]').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).appearance)),['none','none']);
  await form.locator('[name=fromSlider]').focus();await page.keyboard.press('ArrowLeft');assert.equal((await localUsageRequest(page)).id,request.id);
  await fillInterval(form,'2026-10-01 08:13:21','2026-10-05 17:18:19');await form.locator('[data-date-field=intervalStart]').click();assert.equal(await page.locator('.cq-local-calendar').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.cq-local-calendar').isVisible(),false);assert.equal(await form.locator('[name=intervalStartTime]').inputValue(),'08:13:21');
  await form.locator('[type=submit]').click();request=await localUsageRequest(page);assert.equal(await form.isVisible(),false);assert.equal(request.range.start,'2026-10-01');assert.equal(request.range.end,'2026-10-05');assert.equal(Date.parse(request.range.intervalStart),Date.parse('2026-10-01T08:13:21'));
  assert.equal(await page.locator('[data-period=custom]').getAttribute('aria-pressed'),'true');
  await updateLocalUsage(page,localUsagePayload(request.range),request.id);assert.match(await page.locator('.cq-local-interval-range').getAttribute('title'),/2026-10-01/);
 }finally{await close(page);}
});

test('invalid drafts and stale or mismatched precise replies cannot replace applied results',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const old=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(old.range),old.id);const value=await page.locator('.cq-local-total strong').textContent();
  await page.locator('[data-period=custom]').click();const form=page.locator('.cq-interval-controls');
  for(const [start,end]of[['2026-10-05 00:00:00','2026-10-01 00:00:00'],['2026-02-30 00:00:00','2026-10-01 00:00:00'],['2030-01-01 00:00:00','2030-01-02 00:00:00']]){await fillInterval(form,start,end);await form.locator('[type=submit]').click();assert.equal((await localUsageRequest(page)).id,old.id);}
  await fillInterval(form,'2026-10-01 08:00:00','2026-10-02 09:00:00');await form.locator('[type=submit]').click();const current=await localUsageRequest(page);
  await updateLocalUsage(page,localUsagePayload(old.range),old.id);assert.equal(await page.locator('.cq-local-result').getAttribute('aria-busy'),'true');assert.equal(await page.locator('.cq-local-total strong').textContent(),value);
  const bad=localUsagePayload(current.range);bad.interval.end=old.range.intervalEnd;await updateLocalUsage(page,bad,current.id);assert.equal(await page.locator('.cq-local-total strong').textContent(),value);assert.match(await page.locator('.cq-local-status').innerText(),/读取失败/);
 }finally{await close(page);}
});

test('primary estimates, totals and daily bars use the exact interval rather than outer full-day summaries',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);let {range,id}=await applyCustom(page);const data=dailyChartPayload(range);
  data.models=[{model:'gpt-6.1-sol',inputTokens:990000000,cachedInputTokens:0,outputTokens:10000000,totalTokens:1000000000}];data.daily=[{date:range.end,models:data.models,eventCount:2,partial:true,issues:data.issues}];
  await updateLocalUsage(page,data,id);assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'3,300,000 token');await page.locator('.cq-local-chart-nav button').first().click();assert.equal(await page.locator('.cq-local-day[data-date="2026-10-02"]').count(),1);
  const current=await page.locator('.cq-local-total strong').textContent();const broken=dailyChartPayload(range);broken.interval.local.daily[0].models=[{...broken.interval.local.daily[0].models[0],outputTokens:1,totalTokens:1000001}];
  await updateLocalUsage(page,broken,id);assert.equal(await page.locator('.cq-local-total strong').textContent(),current);assert.match(await page.locator('.cq-local-status').innerText(),/读取失败/);
 }finally{await close(page);}
});

test('dual Token and API reference estimates preserve same-model envelopes, partial coverage and actual zero',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const reference={planName:'pro',selectedPlan:'pro200',referenceKind:'legacy20x',status:'snapshot',lastSuccessAt:null,referenceSnapshotAt:'2026-10-30',models:{'gpt-6-astra':849560154},apiModels:{'gpt-6-astra':1313.419998084}};
  const astra={model:'gpt-6-astra',inputTokens:1000000,cachedInputTokens:1000000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:1000000};
  const set=async(models,ref=reference)=>updateLocalUsage(page,localUsagePayload(range,{models,eventCount:1,reference:ref}),id);
  await set([astra]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0.08.*0.12/);
  await set([{...astra,cachedInputTokens:0}]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0.12.*0.76/);
  await set([astra,{...astra,model:'unknown-model'}]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0.08.*0.12/);assert.match(await page.locator('.cq-local-recent-local').innerText(),/1 \/ 2 个模型可估算/);assert.equal(await page.locator('.cq-local-recent-local .cq-local-partial').allTextContents().then(a=>a.some(x=>x.includes('部分统计'))),false);
  await set([{...astra,inputTokens:0,cachedInputTokens:0,totalTokens:0}]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0/);
  await set([{...astra,model:'unknown-model'}]);assert.doesNotMatch(await page.locator('.cq-local-recent-local strong').textContent(),/0%/);
 }finally{await close(page);}
});

test('other priced models use both API reference anchors without counting unknown models',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const reference={planName:'pro',selectedPlan:'pro200',referenceKind:'legacy20x',status:'snapshot',models:{'gpt-6-astra':10000000,'gpt-6.1-sol':20000000},apiModels:{'gpt-6-astra':100,'gpt-6.1-sol':200}};
  const terra={model:'gpt-6.1-terra',inputTokens:1000000,cachedInputTokens:0,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:1000000};
  const astra={...terra,model:'gpt-6-astra',cachedInputTokens:1000000};
  const set=async(models,ref=reference)=>updateLocalUsage(page,localUsagePayload(range,{models,eventCount:1,reference:ref}),id);
  await set([terra]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0.5.*1%/);
  assert.doesNotMatch(await page.locator('.cq-local-recent-local').innerText(),/间接估算/);
  assert.match(await page.locator('.cq-local-method-note').textContent(),/间接估算/);
  await set([astra,terra]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/1.5.*11%/);
  const review={...terra,model:'codex-auto-review'};
  await set([terra,review]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0.5.*1%/);assert.doesNotMatch(await page.locator('.cq-local-recent-local').innerText(),/个模型可估算/);
  assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'2,000,000 token');
  await set([review]);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0%/);assert.match(await page.locator('.cq-local-recent-local').innerText(),/审核不占周额度/);
  assert.match(await page.locator('.cq-local-cost').innerText(),/未计价/);
  await set([review,{...terra,model:'unknown-model'}]);assert.doesNotMatch(await page.locator('.cq-local-recent-local strong').textContent(),/0%/);
  await set([terra],{...reference,apiModels:{'gpt-6-astra':100}});assert.doesNotMatch(await page.locator('.cq-local-recent-local strong').textContent(),/0%/);
 }finally{await close(page)}
});

test('long dual-estimate ranges stay aligned inside a narrow 228px popup',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:800});try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const model={model:'gpt-6-astra',inputTokens:1000000,cachedInputTokens:1000000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:1000000};
  const data=localUsagePayload(range,{models:[model],eventCount:1,reference:{planName:'pro',selectedPlan:'pro200',referenceKind:'legacy20x',status:'snapshot',models:{'gpt-6-astra':1000000/1.0614},apiModels:{'gpt-6-astra':1/2.0909}}});
  await updateLocalUsage(page,data,id);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/106\.14.*209\.09/);
  assert.equal(await page.locator('.cq-local-primary-estimate').evaluate(el=>getComputedStyle(el).fontSize),'26px');
  assert.ok(Math.abs((await geometry(page)).popup.width-228)<1);

  const primary=await page.locator('.cq-local-recent-row strong').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),p=node.parentElement.getBoundingClientRect();return {text:node.textContent,width:node.clientWidth,scrollWidth:node.scrollWidth,left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right}}));
  for(const metric of primary)assert.ok(metric.scrollWidth<=metric.width+1&&metric.left>=metric.parentLeft-1&&metric.right<=metric.parentRight+1,JSON.stringify(metric));
  data.reference={...data.reference,models:{'gpt-6-astra':1000000/11.844},apiModels:{'gpt-6-astra':1/12.765}};
  await updateLocalUsage(page,data,id);assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/1,184\.4.*1,276\.5/);
  assert.equal(await page.locator('.cq-local-recent-local strong').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'four-digit ranges wrap at the bound without horizontal overflow');
  await page.screenshot({path:join(__dirname,'../.runtime-test/right-aligned-readings-20261104/synthetic-long-range.png')});

 }finally{await close(page);}
});

test('account sampling shows one compact readout and preserves missing and partial semantics',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const data=localUsagePayload(range);
  const segment={startAt:range.intervalStart,endAt:range.intervalEnd,usedPercent:0};
  const sample={sampledStartAt:segment.startAt,sampledEndAt:segment.endAt};
  const row=page.locator('.cq-local-recent-account');
  for(const [account,value,partial] of [
    [{...sample,status:'ok',usedPercent:0},'0百分点',false],
    [{...sample,status:'partial',usedPercent:0,crossReset:true,hasGaps:true,segments:[segment]},'0百分点',true],
    [{...sample,status:'partial',usedPercent:4,crossReset:true,segments:[segment]},'暂不可用',false],
    [{status:'insufficient_history',usedPercent:null},'采样不足',false],
    [undefined,'暂不可用',false]
  ]){
    data.interval.account=account;
    await updateLocalUsage(page,data,id);
    assert.match(await page.locator('.cq-local-recent-local strong').innerText(),/2%/);
    assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'27,921,500 token');
    assert.equal(await row.locator('strong').innerText(),value);
    assert.equal(await row.locator('.cq-account-partial').count(),Number(partial));
    const measured=value.endsWith('百分点');
    assert.equal(await row.locator('.cq-account-devices').count(),Number(measured));
    assert.equal(await row.locator(':scope > *').count(),measured?3:2);
    assert.doesNotMatch(await row.innerText(),/跨周期|有间断/);
    const rows=await page.locator('.cq-local-highlights > div').evaluateAll(nodes=>new Set(nodes.map(node=>node.getBoundingClientRect().top)).size);
    assert.equal(rows,1,'token and API equivalents fit together');
  }
 }finally{await close(page);}
});

test('local log quota is a dated observation independent of account sampling', async () => {
 const page = await pageFor(officialPayload(), {width: 390, height: 800});
 try {
  await showLocalUsage(page);
  const {range, id} = await applyCustom(page);
  const data = localUsagePayload(range);
  const logQuota = {firstAt: range.intervalStart, lastAt: range.intervalEnd, latestUsedPercent: 0};
  data.interval.logQuota = logQuota;
  await updateLocalUsage(page, data, id);
  const log = page.locator('.cq-local-log-quota');
  await page.locator('.cq-local-highlights').click();
  assert.equal(await log.isVisible(),true);
  assert.match(await log.innerText(), /日志记录[\s\S]*0%[\s\S]*账号未核验/);
  assert.equal(await page.locator('#cq-local-usage').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
  logQuota.latestUsedPercent = null;
  await updateLocalUsage(page, data, id);
  assert.equal(await log.locator('strong').innerText(), '—');
  assert.match(await log.innerText(), /读数不一致/);
  logQuota.lastAt = new Date(Date.parse(range.intervalEnd) + 1000).toISOString();
  await updateLocalUsage(page, data, id);
  assert.equal(await log.count(), 0);
 } finally { await close(page); }
});

test('first read shows a skeleton, retry is explicit and later loading retains the prior applied range',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);let r=await localUsageRequest(page);assert.equal(await page.locator('.cq-local-skeleton').isVisible(),true);
  await updateLocalUsage(page,{errorCode:'TIMEOUT'},r.id);assert.equal(await page.locator('.cq-local-skeleton').count(),0);assert.match(await page.locator('.cq-local-placeholder').innerText(),/暂不可用/);
  await page.locator('.cq-local-placeholder').getByRole('button',{name:'重试',exact:true}).click();r=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(r.range),r.id);
  const label=await page.locator('.cq-local-interval-range').getAttribute('title');await page.locator('[data-period=week]').click();const next=await localUsageRequest(page);assert.notEqual(next.id,r.id);assert.equal(await page.locator('.cq-local-interval-range').getAttribute('title'),label);assert.equal(await page.locator('.cq-local-skeleton').count(),0);
 }finally{await close(page);}
});

test('daily selection and keyboard navigation do not replace whole-range totals or issue another request',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await applyCustom(page);await updateLocalUsage(page,dailyChartPayload(range),id);const before=await page.locator('.cq-local-total strong').getAttribute('title');
  await page.locator('.cq-local-chart-nav button').first().click();await page.locator('.cq-local-day[data-date="2026-10-01"]').click();assert.match(await page.locator('.cq-local-day-detail').innerText(),/110万/);assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),before);
  const labels=await page.locator('.cq-local-day-values > div > span').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,width:node.getBoundingClientRect().width})));
  assert.deepEqual(labels.map(label=>label.text),['当日 token','API 等值']);
  assert.ok(labels.every(label=>label.width>0),'daily metric labels remain in the accessibility tree');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.cq-local-day[data-date="2026-10-02"]').getAttribute('aria-pressed'),'true');assert.equal((await localUsageRequest(page)).id,id);
  await page.locator('.cq-local-day[data-date="2026-10-04"]').click();assert.match(await page.locator('.cq-local-day-detail').innerText(),/暂不可用/);
 }finally{await close(page);}
});

test('composition and model folds preserve precise quantities and semantic shares without duplicate primary values',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(range),id);
  await page.locator('.cq-local-usage-details > summary').click();await page.locator('.cq-local-models > summary').click();
  assert.equal(await page.locator('.cq-local-usage-group .cq-local-composition-values > div').count(),3);assert.equal(await page.locator('.cq-local-day').count(),0);
  assert.equal(await page.locator('.cq-local-cache-track').getAttribute('role'),'meter');assert.match(await page.locator('.cq-local-cache-track').getAttribute('title'),/25,001,000.*2,000,200/);
  assert.equal(await page.locator('.cq-local-model').count(),3);assert.equal(await page.locator('.cq-local-model-share').count(),0);assert.equal(await page.locator('.cq-local-model-track[role=meter]').count(),3);
  await page.locator('.cq-local-usage-details > summary').click();await updateLocalUsage(page,localUsagePayload(range),id);
  assert.equal(await page.locator('.cq-local-usage-details').evaluate(el=>el.open),false);assert.equal(await page.locator('.cq-local-models').evaluate(el=>el.open),true);
  assert.equal((await localUsageRequest(page)).id,id);
 }finally{await close(page);}
});

test('reference selection lives in settings, preserves the selected exact range and stays singular through replies',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{const info=console.info;globalThis.__officialTests=[];console.info=(...args)=>{if(args[0]==='__codexQuotaOfficialRequest__')__officialTests.push(args[1]);info.apply(console,args);};});
  await showLocalUsage(page);let {range,id}=await localUsageRequest(page);const ref={planName:'pro',selectedPlan:null,status:'needs_plan',models:null,apiModels:null};
  await updateLocalUsage(page,localUsagePayload(range,{reference:ref}),id);assert.doesNotMatch(await page.locator('.cq-local-recent-local strong').innerText(),/0%/);
  await openReferences(page);assert.equal(await page.locator('#cq-settings .cq-local-reference').count(),1);
  await page.locator('.cq-local-reference-plan').selectOption('pro200');const next=await localUsageRequest(page);assert.equal(next.range.referencePlan,'pro200');assert.equal(next.range.intervalStart,range.intervalStart);
  for(let i=0;i<3;i++)await updateLocalUsage(page,localUsagePayload(next.range),next.id);assert.equal(await page.locator('.cq-local-estimate-methods').count(),1);
  const changed=localUsagePayload(next.range,{models:[{model:'gpt-6-astra',inputTokens:1000000,cachedInputTokens:1000000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:1000000}],eventCount:1});
  await updateLocalUsage(page,changed,next.id);
  const assertInside=frames=>{for(const frame of frames)assert.ok(frame.left>=11&&frame.top>=11&&frame.right<=1013&&frame.bottom<=709,JSON.stringify(frame));};
  assertInside([(await geometry(page)).popup]);await page.emulateMedia({reducedMotion:'no-preference'});await finishAnimations(page);
  const toggle=async(selector,rapid=false)=>{
   const sample=await page.locator(selector).evaluate(async(summary,rapid)=>{
    const popup=document.getElementById('codex-quota-popover'),frames=[];
    for(let i=0;i<20;i++){
     if(i===0||rapid&&(i===2||i===4))summary.click();
     const r=popup.getBoundingClientRect();frames.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom,animations:popup.getAnimations({subtree:true}).length});
     await new Promise(requestAnimationFrame);
    }
    return frames;
   },rapid);
   assert.ok(sample[0].animations>0,'settings disclosures must animate');assertInside(sample);await finishAnimations(page);await assertMotionClean(page);
  };
  const referenceSummary='#cq-settings .cq-local-reference > summary',methodsSummary='#cq-settings .cq-local-estimate-methods > summary';
  await toggle(referenceSummary);assert.equal(await page.locator('.cq-local-reference').evaluate(el=>el.open),false);
  await toggle(referenceSummary);await toggle(methodsSummary);await toggle(methodsSummary,true);assert.equal(await page.locator('.cq-local-estimate-methods').evaluate(el=>el.open),false);
  await toggle(referenceSummary,true);assert.equal(await page.locator('.cq-local-reference').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#cq-settings .cq-local-detail-body[aria-hidden=true]').count(),0);
  await page.locator('#cq-settings header button').click();await finishAnimations(page);assert.equal(await page.locator('.cq-local-reference').isVisible(),false);
  assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0\.23/);
  assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'1,000,000 token');assert.match(await page.locator('.cq-local-cost strong').textContent(),/1\.00/);
  assert.equal(await page.locator('.cq-local-reference').count(),1);assert.equal(await page.evaluate(()=>__officialTests.length),0);
  await page.locator('.cq-settings-button').click();await finishAnimations(page);assert.equal(await page.locator('#cq-settings .cq-local-reference').count(),1);
  await page.evaluate(()=>document.getElementById('codex-quota-popover').hidePopover());await finishAnimations(page);await open(page);await finishAnimations(page);
  assert.equal(await page.locator('.cq-local-reference').count(),1);assert.equal(await page.locator('#cq-local-usage .cq-local-reference').count(),1);assert.equal(await page.locator('.cq-local-reference').isVisible(),false);
  await page.locator('.cq-local-refresh').click();const reopened=await localUsageRequest(page);
  const afterClose=localUsagePayload(reopened.range,{models:[{model:'gpt-6-astra',inputTokens:2000000,cachedInputTokens:2000000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:2000000}],eventCount:1});
  await updateLocalUsage(page,afterClose,reopened.id);await finishAnimations(page);
  assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/0\.46/);
  assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'2,000,000 token');assert.match(await page.locator('.cq-local-cost strong').textContent(),/2\.00/);assert.equal(await page.locator('.cq-local-reference').count(),1);assert.equal(await page.evaluate(()=>__officialTests.length),0);
 }finally{await close(page);}
});

test('custom calendar respects theme, Escape, leap dates and viewport bounds without submitting',async()=>{
 for(const dark of [false,true]){const page=await pageFor(officialPayload(),{width:320,height:600},{deviceScaleFactor:1.25});try{
  if(dark)await page.addStyleTag({content:':root{color-scheme:dark;--color-surface-elevated-secondary:#262724;--color-text:#f1f1eb;--color-text-secondary:#b0b2a8;--color-border:#494b43}'});
  await showLocalUsage(page);const r=await localUsageRequest(page);await page.locator('[data-period=custom]').click();const form=page.locator('.cq-interval-controls');await fillInterval(form,'2024-02-29 08:13:21','2024-03-01 09:14:22');
  const dateTarget=await form.locator('[data-date-field=intervalStart]').boundingBox();assert.ok(dateTarget.width>=28&&dateTarget.height>=28);
  await form.locator('[name=intervalStart]').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('.cq-local-calendar').isVisible(),true);await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await form.locator('[name=intervalStartTime]').inputValue(),'08:13:21');assert.equal((await localUsageRequest(page)).id,r.id);
  await form.locator('[data-date-field=intervalEnd]').click();const bounds=await page.locator('.cq-local-calendar').boundingBox();const p=await page.locator('#codex-quota-popover').boundingBox();assert.ok(bounds.y>=p.y-1&&bounds.y+bounds.height<=p.y+p.height+1);
  const layout=await page.locator('.cq-local-calendar').evaluate(calendar=>{const c=calendar.getBoundingClientRect(),popup=calendar.closest('#codex-quota-popover'),p=popup.getBoundingClientRect(),s=getComputedStyle(popup);return {leftInset:c.left-p.left-parseFloat(s.borderLeftWidth),rightInset:p.right-c.right-parseFloat(s.borderRightWidth),columns:[...calendar.querySelectorAll('.cq-calendar-grid > [role=row]')].map(row=>row.children.length),cells:[...calendar.querySelectorAll('[role=gridcell]')].map(cell=>{const r=cell.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};}),overflow:calendar.scrollWidth-calendar.clientWidth};});
  assert.ok(Math.abs(layout.leftInset-12)<=1&&Math.abs(layout.rightInset-12)<=1,JSON.stringify({dark,...layout}));assert.equal(layout.columns.length,7);assert.ok(layout.columns.every(columns=>columns===7));assert.equal(layout.cells.length,42);assert.ok(layout.overflow<=1);
  for(const cell of layout.cells)assert.ok(cell.width>0&&cell.height>0&&cell.left>=bounds.x-1&&cell.right<=bounds.x+bounds.width+1&&cell.top>=bounds.y-1&&cell.bottom<=bounds.y+bounds.height+1,JSON.stringify({dark,cell,bounds}));
  console.log(JSON.stringify({calendarGeometry:{dark,leftInset:layout.leftInset,rightInset:layout.rightInset,rows:layout.columns.length,cells:layout.cells.length,overflow:layout.overflow}}));

  await page.keyboard.press('Escape');assert.equal(await page.locator('.cq-local-calendar').isVisible(),false);assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true);
 }finally{await close(page);}}
});

test('fold animations reverse on the visible frame and leave no layers after closing or reinjection',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:720},{reducedMotion:'no-preference'});try{
  await showLocalUsage(page);const r=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(r.range),r.id);await finishAnimations(page);
  await page.locator('.cq-local-usage-details > summary').click();await finishAnimations(page);
  const summary=page.locator('.cq-local-usage-details > summary');await summary.click();await page.waitForTimeout(40);await summary.click();await page.waitForTimeout(30);await summary.click();await finishAnimations(page);
  assert.equal(await page.locator('.cq-local-usage-group .cq-local-composition-track').isVisible(),false);await summary.press('Enter');await finishAnimations(page);
  assert.equal(await page.locator('.cq-local-usage-group .cq-local-composition-track').isVisible(),true);
  await collapse(page);await finishAnimations(page);await assertMotionClean(page);
  await page.evaluate(source);await settle(page);assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('.cq-shared-layer,.cq-shared-surface').count(),0);
 }finally{await close(page);}
});

test('empty, partial and tiny local usage remain distinct and session reset rejects old replies',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  await updateLocalUsage(page,localUsagePayload(range),id);
  const empty=localUsagePayload(range,{models:[],eventCount:0});
  await updateLocalUsage(page,empty,id);
  assert.equal(await page.locator('.cq-local-recent-local strong').innerText(),'无记录');
  assert.equal(await page.locator('.cq-local-summary-details').count(),0);
  assert.doesNotMatch(await page.locator('.cq-local-result').innerText(),/未计价|总 token/);
  await updateLocalUsage(page,localUsagePayload(range,{partial:true}),id);assert.match(await page.locator('.cq-local-status').innerText(),/统计不完整/);
  await updateLocalUsage(page,{errorCode:'LOCAL_USAGE_UNAVAILABLE'},id);assert.equal(await page.locator('.cq-local-status').innerText(),'读取失败，显示上次结果');assert.match(await page.locator('.cq-local-recent-local strong').innerText(),/2/);
  await updateLocalUsage(page,localUsagePayload(range,{models:[{model:'gpt-6-astra',inputTokens:1,cachedInputTokens:0,outputTokens:0,totalTokens:1}]}),id);assert.match(await page.locator('.cq-local-recent-local strong').innerText(),/<0\.01/);
  await page.evaluate(()=>__codexQuotaResetSession());assert.equal(await page.locator('#cq-local-usage').count(),0);await updateLocalUsage(page,localUsagePayload(range),id);assert.equal(await page.locator('#cq-local-usage').count(),0);
 }finally{await close(page);}
});

test('API equivalent retains cache-read/write ranges, rejects inconsistent counts and explains unpriced models',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const row={model:'gpt-6.1-sol',inputTokens:2000000,cachedInputTokens:1000000,cacheWriteInputTokens:500000,cacheWriteKnown:true,outputTokens:100000,totalTokens:2100000};
  await updateLocalUsage(page,localUsagePayload(range,{models:[row],partial:true,issues:[{code:'SOURCE_UNCONFIRMED',count:2,missingTokens:12345,affectsTotals:true,dateUnknown:false}]}),id);
  assert.match(await page.locator('.cq-local-cost strong').textContent(),/\$3\.35.*\$4\.60/);assert.equal(await page.locator('.cq-local-status').innerText(),'统计不完整');assert.match(await page.locator('.cq-local-status').getAttribute('title'),/来源未确认 2/);
  assert.equal(await page.locator('.cq-local-recent-local small').innerText(),'统计不完整');
  assert.equal(await page.locator('.cq-local-status[data-cq-quiet]').count(),1);
  await page.locator('.cq-local-issues summary').click();assert.match(await page.locator('.cq-local-issues').innerText(),/12,345 token/);
  await updateLocalUsage(page,localUsagePayload(range,{models:[{...row,cacheWriteKnown:false}]}),id);await openReferences(page);assert.match(await page.locator('.cq-local-api-reference').innerText(),/写缓存计数不完整/);await page.locator('#cq-settings header button').click();
  await updateLocalUsage(page,localUsagePayload(range,{models:[{...row,cacheWriteInputTokens:1500000}]}),id);assert.match(await page.locator('.cq-local-status').innerText(),/读取失败/);
  await updateLocalUsage(page,localUsagePayload(range,{models:[{...row,model:'unknown-model'}]}),id);assert.match(await page.locator('.cq-local-cost').innerText(),/未计价/);assert.equal(await page.locator('.cq-local-models .cq-local-excluded').count(),0);
  await openReferences(page);assert.match(await page.locator('.cq-local-weekly-reference .cq-local-excluded').textContent(),/无周参考/);assert.match(await page.locator('.cq-local-api-reference .cq-local-excluded').textContent(),/未计价/);
 }finally{await close(page);}
});

test('stale reference checks retain the confirmed tier and never fall back to an unmatched Pro baseline',async()=>{
 const page=await pageFor();try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);
  const reference={planName:'pro',selectedPlan:'pro100',status:'stale',lastSuccessAt:'2026-10-28T00:00:00Z',lastAttemptAt:'2026-10-29T00:00:00Z',nextCheckAt:'2026-10-30T00:00:00Z',models:{'gpt-6-astra':438000000,'gpt-6.1-sol':2354000000}};
  await updateLocalUsage(page,localUsagePayload(range,{reference}),id);await openReferences(page);assert.equal(await page.locator('.cq-local-reference-status').textContent(),'');
  const link=page.locator('.cq-modeldial-link');assert.match(await link.innerText(),/^ModelDial\s+更新失败 · 上次核对 /);assert.match(await link.getAttribute('title'),/上次成功.*上次尝试.*下次检查/);
  await updateLocalUsage(page,localUsagePayload(range,{reference:{...reference,status:'ok'}}),id);assert.match(await link.innerText(),/已核对/);
  for(const ref of [{...reference,models:{'gpt-6-astra':0}},undefined]){await updateLocalUsage(page,localUsagePayload(range,{reference:ref}),id);assert.equal(await page.locator('.cq-local-estimate-methods').evaluate(el=>el.hidden),true);assert.doesNotMatch(await page.locator('.cq-local-recent-local strong').textContent(),/0%/);}
 }finally{await close(page);}
});

test('model breakdown keeps exact accessible shares, aligned numbers and host-compatible themes',async()=>{
 for(const dark of [false,true]){const page=await pageFor(officialPayload(),{width:390,height:800},{deviceScaleFactor:1.25});try{
  if(dark)await page.addStyleTag({content:':root{color-scheme:dark;--color-surface-elevated-secondary:#262724;--color-text:#f1f1eb;--color-text-secondary:#b0b2a8;--color-border:#494b43}'});
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);const models=[{model:'codex-auto-review',inputTokens:40000,cachedInputTokens:20000,outputTokens:10000,totalTokens:50000},{model:'gpt-6-astra',inputTokens:140000,cachedInputTokens:100000,outputTokens:10000,totalTokens:150000},{model:'gpt-6.1-sol',inputTokens:700000,cachedInputTokens:600000,outputTokens:100000,totalTokens:800000}];
  await updateLocalUsage(page,localUsagePayload(range,{models}),id);await page.locator('.cq-local-highlights').click();await page.locator('.cq-local-models > summary').click();
  assert.deepEqual(await page.locator('.cq-local-model-value').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['800,000 token','150,000 token','50,000 token']);assert.deepEqual(await page.locator('.cq-local-model-track').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('aria-valuenow')))),[80,15,5]);
  const rows=await page.locator('.cq-local-model').evaluateAll(nodes=>nodes.map(el=>{const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}};return {name:rect(el.querySelector('.cq-local-model-name')),value:rect(el.querySelector('strong')),track:rect(el.querySelector('.cq-local-model-track')),fill:rect(el.querySelector('i'))}}));
  for(const row of rows)for(const [part,edge]of [['name','left'],['value','right'],['track','left'],['track','right']])assert.ok(Math.abs(row[part][edge]-rows[0][part][edge])<.5);
  rows.forEach((row,i)=>assert.ok(Math.abs(row.fill.width/row.track.width*100-[80,15,5][i])<.5));assert.equal(await page.locator('#cq-local-usage').evaluate(el=>el.scrollWidth-el.clientWidth),0);
  assert.equal(await page.locator('.cq-local-model-track i').evaluateAll(nodes=>new Set(nodes.map(n=>getComputedStyle(n).backgroundColor)).size),1);
  const palette=await page.locator('#cq-local-usage').evaluate(el=>{const local=getComputedStyle(el),popup=getComputedStyle(el.closest('#codex-quota-popover'));return {ink:local.color,localSurface:local.getPropertyValue('--cq-solid').trim().toLowerCase(),popupSurface:popup.getPropertyValue('--cq-solid').trim().toLowerCase(),popupInk:popup.getPropertyValue('--cq-ink').trim().toLowerCase()};});
  assert.deepEqual(palette,dark?{ink:'rgb(238, 238, 236)',localSurface:'#191918',popupSurface:'#191918',popupInk:'#eeeeec'}:{ink:'rgb(33, 32, 28)',localSurface:'#f9f9f8',popupSurface:'#f9f9f8',popupInk:'#21201c'});

  await updateLocalUsage(page,localUsagePayload(range,{models:[{...models[0],inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0}]}),id);assert.equal(await page.locator('.cq-local-model-track').getAttribute('role'),'img');assert.equal(await page.locator('.cq-local-model-track').getAttribute('aria-valuenow'),null);assert.equal(await page.locator('.cq-local-model-track i').getAttribute('hidden'),'');
 }finally{await close(page);}}
});

test('statistics inner motion retargets selection immediately and preserves exact values and requests',async()=>{
  const page=await pageFor(officialPayload(),{width:1024,height:1000});
  try {
    const {range,id}=await customDailyRange(page);await updateLocalUsage(page,dailyChartPayload(range),id);

    while(!await page.locator('.cq-local-day[data-date="2026-10-01"]').count())await page.getByRole('button',{name:'查看更早日期'}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});
    const sample=await page.evaluate(()=>{
      const plot=document.querySelector('.cq-local-chart-plot'),marker=plot.querySelector('.cq-local-day-selection');
      plot.querySelector('[data-date="2026-10-01"]').click();
      let animation=marker.getAnimations()[0];animation.pause();animation.currentTime=80;
      const before=marker.getBoundingClientRect().left;
      plot.querySelector('[data-date="2026-10-02"]').click();
      animation=marker.getAnimations()[0];animation.pause();animation.currentTime=0;
      const after=marker.getBoundingClientRect().left;
      return {before,after,pressed:plot.querySelector('[aria-pressed=true]').dataset.date,
        value:document.querySelector('.cq-local-day-detail strong').title,
        cost:document.querySelectorAll('.cq-local-day-detail strong')[1].textContent,
        frames:animation.effect.getKeyframes(),detail:document.querySelector('.cq-local-day-detail').getAnimations().length};
    });
    assert.ok(Math.abs(sample.before-sample.after)<.1,'retarget starts at current presentation');
    assert.equal(sample.pressed,'2026-10-02');assert.equal(sample.value,'2,200,000 token');assert.equal(sample.cost,'$4.10');
    assert.notEqual(sample.frames[0].transform,sample.frames.at(-1).transform);assert.ok(sample.detail);
    assert.equal((await localUsageRequest(page)).id,id);
    await page.emulateMedia({reducedMotion:'reduce'});await settle(page);
    assert.equal(await page.locator('#cq-local-usage').evaluate(el=>el.getAnimations({subtree:true}).length),0);
    await page.keyboard.press('ArrowLeft');
  } finally {await close(page);}
});

test('statistics chart range transitions use current bar heights and shrink empty slots without new requests',async()=>{
  const page=await pageFor(officialPayload(),{width:1024,height:1000});
  try {
    const {range,id}=await customDailyRange(page);await updateLocalUsage(page,dailyChartPayload(range),id);

    while(!await page.locator('.cq-local-day[data-date="2026-10-01"]').count())await page.getByRole('button',{name:'查看更早日期'}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});
    const shrinking=await page.evaluate(()=>{
      document.querySelector('[aria-label="查看更晚日期"]').click();
      const ghosts=[...document.querySelectorAll('.cq-local-day-bar[aria-hidden=true]')];
      const frames=ghosts.map(node=>node.getAnimations().flatMap(a=>a.effect.getKeyframes()).map(f=>f.transform));
      for(const ghost of ghosts)for(const a of ghost.getAnimations()){a.pause();a.currentTime=80;}
      const before=Number(getComputedStyle(ghosts[0]).opacity);
      document.querySelector('[aria-label="查看更早日期"]').click();
      document.querySelector('[aria-label="查看更晚日期"]').click();
      const ghost=document.querySelector('.cq-local-day-bar[aria-hidden=true]');
      const after=ghost.getAnimations().map(a=>a.effect.getKeyframes()).find(frames=>frames[0].opacity!==undefined)[0].opacity;
      return {frames,before,after};
    });
    assert.ok(shrinking.frames.length>0);assert.ok(shrinking.frames.some(frames=>frames.includes('scaleY(0)')));
    assert.ok(Math.abs(shrinking.before-shrinking.after)<.01,`rapid pagination carries the fading bar opacity: ${JSON.stringify(shrinking)}`);
    assert.equal((await localUsageRequest(page)).id,id);
    await page.emulateMedia({reducedMotion:'reduce'});await settle(page);
    assert.equal(await page.locator('.cq-local-day-bar[aria-hidden=true]').count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    const refreshed=await page.evaluate(({range,id,payload})=>{
      __codexQuotaUpdateLocalUsage(payload,id);
      const popup=document.getElementById('codex-quota-popover');
      return {animations:popup.getAnimations({subtree:true}).length,overflow:popup.scrollWidth-popup.clientWidth};
    },{range,id,payload:dailyChartPayload(range)});
    assert.ok(refreshed.animations>0);assert.equal(refreshed.overflow,0);
    await page.keyboard.press('Escape');await page.waitForTimeout(800);await assertMotionClean(page);
  } finally {await close(page);}
});

test('native-meter entry is singular, independent of sidebar width and never replaces official controls',async()=>{
  for(const dpr of [1,1.25,2]) {
    const page=await pageFor(officialPayload(),{width:1024,height:800},{deviceScaleFactor:dpr});
    try {
      for(const width of [238,.009,0,196]) {
        await page.locator('.sidebar-navigation').evaluate((el,width)=>el.style.width=width+'px',width);
        if(width===196)await page.locator('#help').evaluate(el=>{el.setAttribute('aria-label','Usage');el.setAttribute('aria-description','Weekly remaining 72%');});await settle(page);
        const view=await page.evaluate(()=>{
          const t=document.getElementById('codex-quota-trigger'),n=document.getElementById('help'),a=t.getBoundingClientRect(),b=n.getBoundingClientRect();
          return {kind:t.dataset.cqKind,siblings:t.parentElement===n.parentElement&&t.nextElementSibling===n,above:a.bottom<=b.top,center:Math.abs(a.left+a.width/2-b.left-b.width/2),clickable:t.contains(document.elementFromPoint(a.left+a.width/2,a.top+a.height/2)),footers:document.querySelectorAll('#codex-quota-footer').length,old:document.querySelectorAll('#codex-official-usage-host').length};
        });
        assert.deepEqual(view,{kind:'local',siblings:true,above:true,center:0,clickable:true,footers:0,old:0});
      }
      await showLocalUsage(page);const request=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(request.range),request.id);
      assert.equal(await page.locator('#cq-local-usage h2').innerText(),'本机用量');
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true);
      assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'27,921,500 token');
      assert.match(await page.locator('.cq-local-cost strong').textContent(),/41\.60/);
      assert.match(await page.locator('.cq-local-recent-local strong').textContent(),/2/,'the local quota estimate leads the main page');
      await page.locator('#help').click();assert.equal(await page.locator('#native-menu').evaluate(el=>el.matches(':popover-open')),true);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),false);
      await page.locator('#codex-quota-trigger').click();assert.equal(await page.locator('#native-menu').evaluate(el=>el.matches(':popover-open')),false);
    }finally{await close(page);}
  }
});

test('reinjection restores old native visibility markers without replacing host feature flags',async()=>{
  const page=await pageFor();
  try {
    await page.evaluate(()=>{
      const original=()=>({get:(name,fallback)=>fallback});
      globalThis.__originalLayer=original;globalThis.__STATSIG__={instance:()=>globalThis.__fixtureStatsig};globalThis.__fixtureStatsig={getLayer:original};
      const source=document.createElement('div');source.id='native-source';source.setAttribute('role','status');source.setAttribute('data-codex-quota-source','');source.textContent='native quota';document.body.append(source);
    });
    await page.evaluate(source);await settle(page);
    assert.equal(await page.locator('#native-source').isVisible(),true);
    assert.equal(await page.locator('#native-source').getAttribute('data-codex-quota-source'),null);
    assert.equal(await page.evaluate(()=>__fixtureStatsig.getLayer===__originalLayer),true);
    assert.equal(await page.locator('#codex-quota-trigger').count(),1);
    await showLocalUsage(page);const old=await localUsageRequest(page);
    await page.evaluate(()=>__codexQuotaResetSession());
    assert.equal(await page.locator('#cq-local-usage').count(),0);
    assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-kind'),'local');
    await updateLocalUsage(page,localUsagePayload(old.range),old.id);
    assert.equal(await page.locator('#cq-local-usage').count(),0);
    await page.evaluate(source);assert.equal(await page.locator('#codex-quota-trigger').count(),1);
  }finally{await close(page);}
});

test('rail popup supports keyboard, light dismissal and uninterrupted reversal with intact material',async()=>{
  const page=await pageFor(officialPayload(),{width:1024,height:800},{reducedMotion:'no-preference'});
  try {
    await page.locator('#codex-quota-trigger').focus();await page.keyboard.press('Enter');await page.waitForTimeout(45);
    assert.equal(await page.locator('#cq-local-usage').isVisible(),true);
    const origin=await page.locator('#codex-quota-trigger').boundingBox();
    const sample=await page.evaluate(()=>{
      const p=document.getElementById('codex-quota-popover'),animations=p.getAnimations();
      for(const a of animations){a.pause();a.currentTime=100;}
      const s=getComputedStyle(p);const result={opacity:Number(s.opacity),transform:s.transform,radius:s.borderTopLeftRadius,background:s.backgroundColor,animations:animations.length};
      p.hidePopover();return result;
    });
    assert.ok(sample.animations>0);assert.ok(sample.opacity>0&&sample.opacity<1);
    assert.equal(sample.radius,'22px');assert.doesNotMatch(sample.transform,/scale/);
    await page.waitForTimeout(40);
    await page.locator('#codex-quota-trigger').click();await page.waitForTimeout(30);
    assert.deepEqual(await page.locator('#codex-quota-trigger').boundingBox(),origin,'entry remains stationary and clickable throughout');
    await finishAnimations(page);assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true);
    await page.keyboard.press('Escape');await finishAnimations(page);
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Space');await finishAnimations(page);
    await page.locator('#outside').click();await finishAnimations(page);
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),false);
    await page.emulateMedia({reducedMotion:'reduce'});await open(page);
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  }finally{await close(page);}
});

test('local refresh keeps prior results and never emits an extra official quota request',async()=>{
  const page=await pageFor();
  try {
    await page.evaluate(()=>{const info=console.info;globalThis.__officialTests=[];console.info=(...args)=>{if(args[0]==='__codexQuotaOfficialRequest__')__officialTests.push(args[1]);info.apply(console,args);};});
    await showLocalUsage(page);let request=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(request.range),request.id);
    const value=await page.locator('.cq-local-total strong').textContent();
    await page.locator('.cq-local-refresh').click();const refresh=await localUsageRequest(page);
    assert.notEqual(refresh.id,request.id);assert.equal(await page.locator('.cq-local-total strong').textContent(),value);
    assert.equal(await page.locator('.cq-local-refresh').isDisabled(),true);
    await updateLocalUsage(page,{errorCode:'TIMEOUT'},refresh.id);
    assert.equal(await page.locator('.cq-local-refresh').isDisabled(),false);assert.equal(await page.locator('.cq-local-total strong').textContent(),value);
    assert.equal(await page.locator('.cq-local-status').innerText(),'读取失败，显示上次结果');
    assert.equal(await page.evaluate(()=>__officialTests.length),0);
  }finally{await close(page);}
});


test('low quota has a shape cue and exposes details on rail hover and keyboard focus',async()=>{
 const {context,pages:[page]}=await sharedPages();
 try {
  await open(page);await page.locator('.cq-settings-button').click();
  await page.locator('label').filter({has:page.locator('input[name=alerts]')}).click();
  await page.locator('#cq-settings header button').click();await collapse(page);
  const trigger=page.locator('#codex-quota-trigger'),original=await trigger.boundingBox();
  await page.mouse.move(400,200);
  const data=officialPayload();data.windows.find(item=>item.label==='Weekly').usedPercent=94;
  await update(page,data);await page.locator('#codex-quota-trigger[data-cq-alert-visible]').waitFor();
  assert.deepEqual(await trigger.boundingBox(),original);
  assert.equal(await trigger.evaluate(node=>getComputedStyle(node,'::after').content),'"!"');
  assert.match(await trigger.getAttribute('aria-label'),/本周剩余 6%/);
  const hint=page.locator('#cq-refresh-message[role=tooltip]');
  await trigger.hover();assert.match(await hint.innerText(),/本周剩余 6%/);
  const bounds=await hint.boundingBox(),view=page.viewportSize();
  assert.ok(bounds.x>=7 && bounds.y>=7 && bounds.x+bounds.width<=view.width-7 && bounds.y+bounds.height<=view.height-7);
  await page.mouse.move(400,200);assert.equal(await hint.count(),0);
  await page.keyboard.press('Tab');await trigger.focus();assert.match(await hint.innerText(),/本周剩余 6%/);
  await trigger.press('Escape');assert.equal(await hint.count(),0);
  await trigger.press('Enter');await settle(page);
  assert.equal(await hint.count(),0);
  assert.equal(await page.locator('#codex-quota-popover').evaluate(node=>node.matches(':popover-open')),true);
 } finally {await context.close();}
});

test('every rail exit frame keeps content attached to the fading material',async()=>{
  const page=await pageFor(officialPayload(),{width:1024,height:800},{reducedMotion:'no-preference'});
  try {
    await showLocalUsage(page);const request=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(request.range),request.id);await finishAnimations(page);
    const frames=await page.evaluate(()=>{
      const p=document.getElementById('codex-quota-popover'),content=document.getElementById('cq-local-usage');p.hidePopover();
      const animations=p.getAnimations().filter(a=>a.effect.getTiming().duration>0);
      for(const a of animations)a.pause();
      const duration=Math.max(...animations.map(a=>a.effect.getTiming().duration));
      return [0,.1,.3,.5,.8,.95].map(fraction=>{
        for(const a of animations)a.currentTime=duration*fraction;
        const a=getComputedStyle(p),b=getComputedStyle(content),r=p.getBoundingClientRect();
        return {fraction,opacity:Number(a.opacity),content:Number(b.opacity),display:a.display,height:r.height,background:a.backgroundColor,transform:a.transform};
      });
    });
    for(const frame of frames) {
      assert.equal(frame.content,1,JSON.stringify(frame));assert.notEqual(frame.display,'none');assert.ok(frame.height>100);
      assert.doesNotMatch(frame.transform,/scale/);assert.doesNotMatch(frame.background,/rgba\([^)]*, 0\)$/);
    }
    assert.ok(frames[0].opacity>frames.at(-1).opacity);await finishAnimations(page);await assertMotionClean(page);
  }finally{await close(page);}
});

const releasePayload=(overrides={})=>({currentVersion:'2.7.0',latestVersion:'2.8.0',releaseUrl:'https://github.com/DrFanghaiz/codex-usage-card/releases/tag/v2.8.0',lastSuccessAt:new Date().toISOString(),lastAttemptAt:new Date().toISOString(),nextCheckAt:new Date(Date.now()+86400000).toISOString(),errorCode:null,...overrides});
async function releaseProbe(page){
  await page.evaluate(()=>{const info=console.info;globalThis.__releaseRequests=[];console.info=(...args)=>{if(args[0]==='__codexQuotaReleaseRequest__')__releaseRequests.push(args[1]);info.apply(console,args);};});
  await page.evaluate(source);await settle(page);return page.evaluate(()=>__releaseRequests.at(-1));
}
async function replyRelease(page,data,id){await page.evaluate(({data,id})=>__codexQuotaUpdateRelease(data,id),{data,id});await settle(page);}

test('version reminders stay in settings, reject unsafe metadata and acknowledge only a visible row',async()=>{
  const page=await pageFor();
  try {
    const id=await releaseProbe(page);await open(page);const data=releasePayload();
    await replyRelease(page,{...data,releaseUrl:'https://example.invalid/update'},id);
    assert.equal(await page.locator('.cq-settings-button[data-cq-update]').count(),0);
    const bounds=await page.locator('.cq-settings-button').boundingBox();
    await replyRelease(page,data,id);assert.deepEqual(await page.locator('.cq-settings-button').boundingBox(),bounds);
    assert.equal(await page.locator('.cq-settings-button[data-cq-update]').count(),1);
    assert.equal(await page.locator('[popover]:popover-open').count(),1);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.locator('.cq-settings-button').evaluate(el=>el.click());
    assert.equal(await page.locator('.cq-settings-button[data-cq-update]').count(),1);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await settle(page);
    assert.equal(await page.locator('.cq-settings-button[data-cq-update]').count(),0);
    assert.equal(await page.evaluate(()=>globalThis.__codexQuotaReleaseSeen),'2.8.0');
    assert.equal(await page.locator('.cq-release-link').getAttribute('href'),data.releaseUrl);
  }finally{await close(page);}
});


test('DPR and CSS zoom preserve the native-sized popup gap, clipping and independent entry',async()=>{
  for(const dpr of [1,1.25,2])for(const zoom of [.8,1,1.25,2]) {
    const page=await pageFor(officialPayload(),{width:720,height:800},{deviceScaleFactor:dpr});
    try {
      await page.evaluate(zoom=>{document.body.style.zoom=String(zoom);document.body.style.height=(innerHeight/zoom)+'px';document.querySelector('.sidebar-navigation').style.width='.009px';},zoom);await settle(page);
      await showLocalUsage(page);const request=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(request.range),request.id);
      const g=await geometry(page);
      assert.ok(g.popup.left>=12-1&&g.popup.right<=720-12+1&&g.popup.top>=12-1&&g.popup.bottom<=800-12+1,JSON.stringify({dpr,zoom,g}));
      assert.ok(Math.abs(g.popup.left-g.trigger.right-4*zoom)<1,`native gap drifted at DPR ${dpr}, zoom ${zoom}: ${JSON.stringify(g)}`);
      assert.ok(Math.abs(g.popup.width-228*zoom)<1);
      assert.ok(g.trigger.bottom<=g.help.top);
    }finally{await close(page);}
  }
});

test('replaced native anchors and streamed main content preserve a single stable entry without observer loops',async()=>{
  const page=await pageFor();
  try {
    await page.evaluate(()=>{
      const n=document.getElementById('help'),copy=n.cloneNode(true);copy.id='help';n.replaceWith(copy);
      const stream=document.createElement('div');stream.id='synthetic-stream';document.getElementById('chat').append(stream);
      for(let i=0;i<50;i++)stream.textContent='token '+i;
    });await settle(page);
    assert.equal(await page.locator('#codex-quota-trigger').count(),1);
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(t=>t.nextElementSibling===document.getElementById('help')),true);
    const scans=await page.evaluate(()=>layoutScans);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>layoutScans),scans);
    await page.evaluate(()=>document.getElementById('help').remove());await settle(page);
    assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true,'older host fallback is still a rail entry, never a footer');
    assert.equal(await page.locator('#codex-quota-footer').count(),0);
  }finally{await close(page);}
});


test('late notification permission cannot override a newer toggle or resurrect a disposed settings view',async()=>{
  for(const action of ['turn-off','other-window','reinjection','leave-settings']){
    const {context,pages:[page,other]}=await sharedPages(action==='other-window'?2:1);try{
      await update(page,officialPayload());await open(page);await page.locator('.cq-settings-button').click();await page.locator('[name=alerts]').check();
      await page.evaluate(()=>Object.defineProperty(Notification,'requestPermission',{configurable:true,value:()=>new Promise(resolve=>globalThis.permissionReply=resolve)}));
      await page.locator('[name=system]').check();
      if(action==='turn-off')await page.locator('[name=system]').uncheck();
      else if(action==='other-window'){
        await other.evaluate(()=>localStorage.setItem('codex-usage-card.settings.v2',JSON.stringify({system:false})));
        await page.waitForFunction(()=>!document.querySelector('[name=system]').checked);
      }
      else if(action==='reinjection')await page.evaluate(source);
      else await page.locator('#cq-settings header button').click();
      await page.evaluate(()=>permissionReply('granted'));await settle(page);
      assert.equal(await page.locator('#codex-quota-trigger').count(),1);
      assert.equal(await page.locator('#codex-quota-popover').count(),1);
      assert.notEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('codex-usage-card.settings.v2')||'{}').system),true);
      if(action==='turn-off'||action==='other-window')assert.equal(await page.locator('[name=system]').isChecked(),false);
      else assert.equal(await page.locator('#cq-settings').count(),0);
    }finally{await context.close();}
  }
});



test('self-drawn switches expose only relevant controls and survive host reset and synced preferences',async()=>{
  const {context,pages:[page,other]}=await sharedPages(2);try{
    await page.addStyleTag({content:'input[type=checkbox]{appearance:none;background:transparent;border:0}'});
    await update(page,officialPayload());await open(page);await page.locator('.cq-settings-button').click();
    assert.equal(await page.locator('#cq-settings input[type=checkbox][role=switch]').count(),3);
    assert.equal(await page.locator('[name=hour12]').count(),0,'a retired quota-time preference must not occupy this statistics UI');
    assert.equal(await page.locator('[name=thresholds]').isVisible(),false);
    assert.equal(await page.locator('[name=system]').isVisible(),false);
    assert.equal(await page.locator('.cq-copy').isVisible(),false);
    const alerts=page.locator('[name=alerts]'),track=page.locator('[name=alerts] + .cq-switch-track');
    const off=await track.evaluate(el=>getComputedStyle(el).backgroundColor);
    await alerts.focus();await page.keyboard.press('Space');assert.equal(await alerts.isChecked(),true);
    assert.equal(await page.locator('[name=thresholds]').isVisible(),true);
    assert.equal(await page.locator('[name=system]').isVisible(),true);
    for(const current of await page.locator('.cq-switch-track:visible').all()){
      const box=await current.boundingBox();assert.equal(box.width,40);assert.equal(box.height,24);
      assert.equal(await current.evaluate(el=>getComputedStyle(el,'::after').width),'20px');assert.equal(await current.evaluate(el=>getComputedStyle(el,'::after').height),'20px');
    }
    assert.notEqual(await track.evaluate(el=>getComputedStyle(el).backgroundColor),off);
    assert.equal(await track.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el,'::after').transform).m41),16);
    assert.equal(await track.evaluate(el=>getComputedStyle(el).outlineWidth),'2px');
    assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').transitionDuration),'0s');
    await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').transitionDuration),'0.13s');await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=> 'denied'}));
    await page.locator('[name=system]').click();await page.waitForFunction(()=>document.querySelector('[name=system]').checked===false);
    assert.equal(await page.locator('[name=system] + .cq-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor),off);
    await other.evaluate(()=>{const key='codex-usage-card.settings.v2';localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)),alerts:false}));});
    await page.waitForFunction(()=>document.querySelector('[name=alerts]').checked===false);assert.equal(await track.evaluate(el=>getComputedStyle(el).backgroundColor),off);
    assert.equal(await page.locator('[name=thresholds]').isVisible(),false);
    assert.equal(await page.locator('[name=system]').isVisible(),false);
    assert.equal(await track.evaluate(el=>{const transform=getComputedStyle(el,'::after').transform;return transform==='none'?0:new DOMMatrixReadOnly(transform).m41}),0);
    await page.locator('[name=recovery]').check();assert.equal(await page.locator('[name=system]').isVisible(),true);
    assert.equal(await page.locator('[name=thresholds]').isVisible(),false,'recovery alerts do not enable low-quota thresholds');
    await alerts.check();
    assert.ok(await page.locator('.cq-threshold-row').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth)>0));
    assert.equal(await page.locator('.cq-tools').isVisible(),false);
    await page.emulateMedia({forcedColors:'active'});assert.equal(await track.isVisible(),true);
    assert.notEqual(await track.evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('[name=system] + .cq-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor));
    await page.emulateMedia({forcedColors:'none'});
    await page.locator('[data-settings=tools]').click();
    await page.locator('.cq-doctor').click();await page.evaluate(()=>__codexQuotaUpdateDiagnosis({errorCode:'TIMEOUT'}));assert.equal(await page.locator('.cq-copy').isVisible(),false);
    await page.locator('.cq-doctor').click();await page.evaluate(()=>__codexQuotaUpdateDiagnosis({CardVisible:false,StageCodes:['CARD_NOT_VISIBLE']}));assert.match(await page.locator('#cq-diagnosis').innerText(),/CARD_NOT_VISIBLE/);
    assert.equal(await page.locator('.cq-copy').isVisible(),true,'a successful diagnostic response can be copied even when it reports an unhealthy entry');
    await page.locator('#cq-settings header button').click();assert.equal(await page.locator('.cq-settings-button').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(source);await page.locator('.cq-settings-button').click();assert.equal(await page.locator('[name=alerts]').isChecked(),true);assert.equal(await page.locator('#codex-quota-popover').count(),1);
  }finally{await context.close();}
});

test('background account samples reject mismatched and old-session callbacks independently of the local popup',async()=>{
  const page=await pageFor(null);
  try {
    await page.evaluate(()=>{delete globalThis.__codexQuotaOfficialLoaded;globalThis.__codexQuotaOfficialNextAutoAttemptAt=0;});
    await page.evaluate(source);await settle(page);
    const first=await page.evaluate(()=>__codexQuotaOfficialRequestId);assert.equal(typeof first,'string');
    const good=officialPayload();
    await page.evaluate(data=>__codexQuotaUpdateOfficial(data,'retired-request'),good);
    assert.equal(await page.evaluate(()=>globalThis.__codexQuotaOfficialPayload||null),null);
    await page.evaluate(({data,id})=>__codexQuotaUpdateOfficial(data,id),{data:good,id:first});
    assert.deepEqual(await page.evaluate(()=>__codexQuotaOfficialPayload),good);
    await showLocalUsage(page);const local=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(local.range),local.id);
    await page.evaluate(()=>{globalThis.__codexQuotaSessionScope='second-account';__codexQuotaResetSession();});
    await page.evaluate(source);await settle(page);
    const second=await page.evaluate(()=>__codexQuotaOfficialRequestId);assert.notEqual(second,first);
    await page.evaluate(({data,id})=>__codexQuotaUpdateOfficial(data,id),{data:good,id:first});
    assert.equal(await page.evaluate(()=>globalThis.__codexQuotaOfficialPayload||null),null);
    const failure={errorCode:'UNAVAILABLE',retryAt:new Date(Date.now()+60000).toISOString()};
    await page.evaluate(({data,id})=>__codexQuotaUpdateOfficial(data,id),{data:failure,id:second});
    assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true);assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-kind'),'local');
    assert.ok(await page.evaluate(()=>__codexQuotaOfficialCooldownUntil>Date.now()));
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),false);
  }finally{await close(page);}
});


test('viewed versions persist across reinjection and cannot regress between two windows',async()=>{
  const {context,pages}=await sharedPages(2);
  try {
    for(const page of pages){const id=await releaseProbe(page);await open(page);await replyRelease(page,releasePayload(),id);assert.equal(await page.locator('.cq-settings-button[data-cq-update]').count(),1);}
    await pages[0].locator('.cq-settings-button').click();await pages[1].waitForFunction(()=>!document.querySelector('.cq-settings-button[data-cq-update]'));
    assert.equal(await pages[0].evaluate(()=>localStorage.getItem('codex-usage-card.release-seen.v1')),'2.8.0');
    await pages[0].locator('#cq-settings header button').click();
    const id=await releaseProbe(pages[1]);await replyRelease(pages[1],releasePayload({latestVersion:'2.9.0',releaseUrl:'https://github.com/DrFanghaiz/codex-usage-card/releases/tag/v2.9.0'}),id);
    assert.equal(await pages[1].locator('.cq-settings-button[data-cq-update]').count(),1);
    await pages[1].locator('.cq-settings-button').click();await pages[0].waitForFunction(()=>localStorage.getItem('codex-usage-card.release-seen.v1')==='2.9.0');
    await pages[0].locator('.cq-settings-button').click();
    for(const page of pages)assert.equal(await page.evaluate(()=>localStorage.getItem('codex-usage-card.release-seen.v1')),'2.9.0','an older cached window cannot lower the read version');
    await pages[0].evaluate(source);await settle(pages[0]);assert.equal(await pages[0].locator('.cq-settings-button[data-cq-update]').count(),0);
  }finally{for(const page of pages)await close(page);await context.close();}
});


test('week chart keeps seven local-day slots, distinguishes missing logs and excludes future days from interaction',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:800},{timezoneId:'Asia/Shanghai'});try{
  await page.clock.install({time:new Date('2026-11-04T12:30:00+08:00')});await showLocalUsage(page);
  await page.locator('[data-period=week]').click();const {range,id}=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(range),id);
  assert.equal(await page.locator('.cq-local-daily').isVisible(),true);
  const slots=page.locator('.cq-local-chart-plot > .cq-local-day[data-date]');
  assert.deepEqual(await slots.evaluateAll(nodes=>nodes.map(n=>n.dataset.date)),['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  assert.equal(await slots.locator('button').count(),0,'slot elements themselves represent past/current buttons; no nested future actions');
  for(const date of ['2026-11-02','2026-11-03']){
   const slot=page.locator(`.cq-local-day[data-date="${date}"]`);assert.equal(await slot.evaluate(el=>el.tagName),'BUTTON');assert.match(await slot.getAttribute('aria-label'),/无记录/);
   await slot.click();assert.match(await page.locator('.cq-local-day-detail').innerText(),/无记录/);assert.doesNotMatch(await page.locator('.cq-local-day-detail strong').first().innerText(),/^0(?:\D|$)/);
  }
  const selected=await page.locator('.cq-local-day[aria-pressed=true]').getAttribute('data-date');
  const future=page.locator('.cq-local-day[data-date]');
  const states=await future.evaluateAll(nodes=>nodes.filter(n=>n.dataset.date>'2026-11-04').map(n=>({date:n.dataset.date,tag:n.tagName,role:n.getAttribute('role'),tab:n.tabIndex,pointer:getComputedStyle(n).pointerEvents})));
  assert.equal(states.length,4);for(const state of states){assert.notEqual(state.tag,'BUTTON');assert.notEqual(state.role,'button');assert.ok(state.tab<0);assert.equal(state.pointer,'none');}
  await future.evaluateAll(nodes=>nodes.filter(n=>n.dataset.date>'2026-11-04').forEach(n=>n.dispatchEvent(new MouseEvent('click',{bubbles:true}))));
  assert.equal(await page.locator('.cq-local-day[aria-pressed=true]').getAttribute('data-date'),selected);assert.equal((await localUsageRequest(page)).id,id);
  const zero={model:'gpt-6-astra',inputTokens:0,cachedInputTokens:0,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:0,totalTokens:0};
  const withZero=localUsagePayload(range,{eventCount:4});withZero.interval.local.daily=[{date:'2026-11-02',models:[zero],eventCount:1,partial:false,issues:[]},{...withZero.interval.local.daily[0],eventCount:3}];
  await updateLocalUsage(page,withZero,id);await page.locator('.cq-local-day[data-date="2026-11-02"]').click();assert.match(await page.locator('.cq-local-day-detail strong').first().innerText(),/^0/);assert.doesNotMatch(await page.locator('.cq-local-day-detail').innerText(),/无记录/);assert.equal((await localUsageRequest(page)).id,id);

 }finally{await close(page);}
});

test('first-read skeleton provides content at a comparable height before the result arrives',async()=>{
 for(const period of ['today','week']){const page=await pageFor(officialPayload(),{width:390,height:1000},{timezoneId:'Asia/Shanghai'});try{
  await page.clock.install({time:new Date('2026-11-04T12:30:00+08:00')});await showLocalUsage(page);
  if(period==='week')await page.locator('[data-period=week]').click();const {range,id}=await localUsageRequest(page);
  assert.equal(await page.locator('.cq-local-skeleton').isVisible(),true);const before=(await geometry(page)).popup.height;

  const row={model:'gpt-6-astra',inputTokens:1000000,cachedInputTokens:500000,cacheWriteInputTokens:0,cacheWriteKnown:true,outputTokens:100000,totalTokens:1100000};
  const payload=localUsagePayload(range,{models:[row],eventCount:1});
  await updateLocalUsage(page,payload,id);const after=(await geometry(page)).popup.height;
  console.log(JSON.stringify({skeletonGeometry:{period,before,after,delta:after-before}}));
  assert.ok(before>180&&Math.abs(after-before)<=60,`${period}: skeleton height ${before}, data height ${after}`);
  assert.equal(await page.locator('.cq-local-skeleton').count(),0);assert.equal(await page.locator('.cq-local-total strong').getAttribute('title'),'1,100,000 token');
 }finally{await close(page);}}
});

test('settings body scrolls inside the anchored popup without visible scrollbars or a moving header',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:420});try{
  await showLocalUsage(page);const {range,id}=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(range),id);
  await openReferences(page);await settle(page);
  const reference=page.locator('#cq-settings .cq-local-reference');
  assert.equal(await reference.evaluate(el=>el.open),true);
  assert.equal(await page.locator('[data-settings=reference]').getAttribute('aria-pressed'),'true');
  await page.locator('#cq-settings .cq-local-estimate-methods > summary').click();await page.locator('#cq-settings .cq-local-caveats > summary').click();await settle(page);
  const body=page.locator('#cq-settings .cq-settings-body'),header=page.locator('#cq-settings header');
  const before=await header.boundingBox();
  const info=await body.evaluate(el=>{const s=getComputedStyle(el);const before=el.scrollTop;el.scrollTop=el.scrollHeight;return {overflow:s.overflowY,scrollbar:s.scrollbarWidth,webkit:getComputedStyle(el,'::-webkit-scrollbar').width,height:el.clientHeight,total:el.scrollHeight,before,after:el.scrollTop};});
  assert.ok(['auto','scroll'].includes(info.overflow),JSON.stringify(info));assert.equal(info.scrollbar,'none');assert.equal(info.webkit,'0px');assert.ok(info.total>info.height&&info.after>info.before,JSON.stringify(info));
  const after=await header.boundingBox();assert.ok(Math.abs(before.y-after.y)<.5,'settings title stays anchored while its body scrolls');
  const popup=(await geometry(page)).popup;assert.ok(popup.top>=11&&popup.bottom<=409&&popup.left>=11&&popup.right<=379,JSON.stringify(popup));
  await page.locator('#cq-settings header button').click();await page.locator('.cq-settings-button').click();await settle(page);
  assert.equal(await page.locator('#cq-settings .cq-settings-body').evaluate(el=>el.scrollTop),0);
 }finally{await close(page);}
});


test('popup uses the avatar menu width across host zoom and ignores the wider quota menu',async()=>{
 for(const zoom of [1,1.25,1.5]){const page=await pageFor(officialPayload(),{width:720,height:800});try{
  await page.evaluate(zoom=>{document.body.style.zoom=String(zoom);document.body.style.height=(innerHeight/zoom)+'px';},zoom);await settle(page);
  await page.locator('#help').click();await settle(page);
  await page.locator('#codex-quota-trigger').click();await settle(page);
  assert.ok(Math.abs((await geometry(page)).popup.width-228*zoom)<1,'the quota menu does not supply the width');
  await collapse(page);
  for(const width of [228,248]){
   await page.locator('#profile-menu').evaluate((el,width)=>el.style.width=width+'px',width);
   await page.locator('#profile').click();await settle(page);
   const nativeWidth=(await page.locator('#profile-menu').boundingBox()).width;
   await page.locator('#codex-quota-trigger').click();await settle(page);
   assert.equal(await page.locator('#profile-menu').evaluate(el=>el.matches(':popover-open')),false);
   const popup=(await geometry(page)).popup;
   assert.ok(Math.abs(popup.width-nativeWidth)<1,JSON.stringify({zoom,width,nativeWidth,popup}));
   assert.ok(popup.left>=11&&popup.right<=709);
   await collapse(page);
  }
 }finally{await close(page);}}
});

test('account tier survives helper reinjection and stays isolated between accounts',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{__codexQuotaSessionScope='account-a-first';__codexQuotaReferencePlan='pro200'});
  await page.evaluate(source);await settle(page);await showLocalUsage(page);
  let {range,id}=await localUsageRequest(page);assert.equal(range.referencePlan,'pro200');
  await updateLocalUsage(page,localUsagePayload(range),id);
  await openReferences(page);
  assert.equal(await page.locator('.cq-local-reference-plan').inputValue(),'pro200');
  await page.locator('.cq-local-reference-plan').selectOption('pro100');
  ({range,id}=await localUsageRequest(page));assert.equal(range.referencePlan,'pro100');assert.equal(range.saveReferencePlan,true);
  await updateLocalUsage(page,{...localUsagePayload(range),referencePlanSaveError:true},id);
  assert.match(await page.locator('.cq-local-reference-status').textContent(),/保存失败/);
  await page.evaluate(()=>{__codexQuotaSessionScope='account-a-restarted';__codexQuotaReferencePlan='pro100'});
  await page.evaluate(source);await settle(page);await showLocalUsage(page);
  ({range}=await localUsageRequest(page));assert.equal(range.referencePlan,'pro100');
  await page.evaluate(()=>{__codexQuotaSessionScope='account-b';__codexQuotaReferencePlan=''});
  await page.evaluate(source);await settle(page);await showLocalUsage(page);
  ({range}=await localUsageRequest(page));assert.equal(range.referencePlan,'');
 }finally{await close(page)}
});

test('previous-message summaries use the same single-turn quota lookup',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{
   const info=console.info;globalThis.turnRequests=[];
   console.info=(...args)=>{if(args[0]==='__codexQuotaTurnUsageRequest__')turnRequests.push({id:args[1],query:structuredClone(__codexQuotaTurnUsageQuery)});info.apply(console,args)};
   document.querySelector('#chat').innerHTML=`<div data-content-search-turn-key="turn-zh"><div class="text-size-chat text-secondary"><button>上 1,089 条消息</button></div></div><div data-content-search-turn-key="turn-en"><div class="text-size-chat text-secondary"><button>1 previous message</button></div></div><div data-content-search-turn-key="turn-en-many"><div class="text-size-chat text-secondary"><button>23 previous messages</button></div></div><div data-content-search-turn-key="turn-worked"><div class="text-size-chat text-secondary"><button>用时 1m</button></div></div><div data-content-search-turn-key="unrelated"><div class="text-size-chat text-secondary"><button>上 89 条消息记录</button></div></div>`;
  });
  await page.waitForFunction(()=>turnRequests.length===1);const req=await page.evaluate(()=>turnRequests[0]);
  assert.deepEqual(req.query.turnIds,['turn-zh','turn-en','turn-en-many','turn-worked']);
  const reference={status:'ok',planName:'plus',selectedPlan:'plus',models:{'gpt-6-astra':10000000},apiModels:{'gpt-6-astra':100}};
  const row=id=>({turnId:id,models:[{model:'gpt-6-astra',inputTokens:100000,cachedInputTokens:50000,outputTokens:10000,totalTokens:110000}],eventCount:1,partial:false,issues:[],status:'complete'});
  await page.evaluate(({req,reference,rows})=>__codexQuotaUpdateTurnUsage({reference,turns:rows},req.id),{req,reference,rows:[row('turn-zh'),{...row('turn-en'),models:[],eventCount:0,status:'unavailable'},row('turn-en-many'),row('turn-worked')]});
  assert.match(await page.locator('[data-content-search-turn-key="turn-zh"] .cq-turn-usage').innerText(),/估算.*%/);
  assert.match(await page.locator('[data-content-search-turn-key="turn-en"] .cq-turn-usage').innerText(),/暂不可用/);
  assert.equal(await page.locator('[data-content-search-turn-key="unrelated"] .cq-turn-usage').count(),0);
  await page.locator('[data-content-search-turn-key="unrelated"] button').evaluate(button=>{button.firstChild.data='上89条消息'});
  await page.waitForFunction(()=>turnRequests.length===2);const changed=await page.evaluate(()=>turnRequests[1]);
  assert.deepEqual(changed.query.turnIds,['unrelated']);
  await page.evaluate(({changed,reference,row})=>__codexQuotaUpdateTurnUsage({reference,turns:[row]},changed.id),{changed,reference,row:{...row('unrelated'),models:[],eventCount:0,status:'unavailable'}});
  assert.match(await page.locator('[data-content-search-turn-key="unrelated"] .cq-turn-usage').innerText(),/暂不可用/);
  await page.locator('[data-content-search-turn-key="turn-worked"] button').evaluate(button=>{button.textContent='上3条消息'});
  await page.waitForTimeout(300);assert.equal(await page.locator('[data-content-search-turn-key="turn-worked"] .cq-turn-usage').count(),1);
  assert.equal(await page.evaluate(()=>turnRequests.length),2);
 }finally{await close(page)}
});

test('scrolling unchanged turns does not rewrite quota labels',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{
   const info=console.info;globalThis.turnRequests=[];
   console.info=(...args)=>{if(args[0]==='__codexQuotaTurnUsageRequest__')turnRequests.push(args[1]);info.apply(console,args)};
   document.querySelector('#chat').innerHTML='<div data-content-search-turn-key="stable-turn"><div class="text-size-chat text-secondary"><button>用时 1m</button></div></div>';
  });
  await page.waitForFunction(()=>turnRequests.length===1);
  await page.evaluate(()=>__codexQuotaUpdateTurnUsage({reference:{status:'ok',planName:'plus',selectedPlan:'plus',models:{'gpt-6-astra':10000000},apiModels:{'gpt-6-astra':100}},turns:[{turnId:'stable-turn',models:[{model:'gpt-6-astra',inputTokens:100000,cachedInputTokens:50000,outputTokens:10000,totalTokens:110000}],eventCount:1,partial:false,issues:[],status:'complete'}]},turnRequests[0]));
  await page.waitForFunction(()=>document.querySelector('.cq-turn-usage')?.textContent.includes('%'));
  await page.waitForTimeout(300);
  await page.evaluate(()=>{globalThis.labelChanges=0;const label=document.querySelector('.cq-turn-usage');globalThis.labelChangeObserver=new MutationObserver(records=>labelChanges+=records.length);labelChangeObserver.observe(label,{attributes:true,childList:true,subtree:true,characterData:true})});
  for(let i=0;i<3;i++){await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));await page.waitForTimeout(260)}
  assert.equal(await page.evaluate(()=>labelChanges),0,'unchanged scroll must not rewrite label text or attributes');
  assert.equal(await page.evaluate(()=>turnRequests.length),1,'unchanged scroll must not query logs again');
 }finally{await close(page)}
});

test('turn estimates follow native duration controls and reject stale or incomplete replies',async()=>{
 const page=await pageFor();try{
  await page.evaluate(()=>{
   const info=console.info;globalThis.turnRequests=[];
   console.info=(...args)=>{if(args[0]==='__codexQuotaTurnUsageRequest__')turnRequests.push({id:args[1],query:structuredClone(__codexQuotaTurnUsageQuery)});info.apply(console,args);};
   const chat=document.querySelector('#chat');chat.innerHTML=`<style>
     #chat .text-size-chat {font:430 14px/21px sans-serif}
     #chat .text-size-chat button {display:inline-flex;align-items:center;vertical-align:middle;border:0;padding:0;font:inherit;color:rgba(42,39,35,.494)}
     #chat .tabular-nums {font-variant-numeric:tabular-nums}
     </style>
     <div data-content-search-turn-key="turn-1"><div class="text-size-chat text-secondary"><button><span class="text-inherit tabular-nums">用时 8m 56s</span><svg width="12" height="12" aria-hidden="true"></svg></button></div></div>
     <div data-content-search-turn-key="turn-2"><div class="text-size-chat text-secondary"><button><span><span class="text-inherit tabular-nums">上 23 条消息</span></span><svg width="12" height="12" aria-hidden="true"></svg></button></div></div>`;
  });
  await page.waitForFunction(()=>turnRequests.length===1);const req=await page.evaluate(()=>turnRequests[0]);
  assert.deepEqual(req.query.turnIds,['turn-1','turn-2']);
  const model={model:'gpt-6-astra',inputTokens:100000,cachedInputTokens:50000,outputTokens:10000,totalTokens:110000};
  const reference={status:'ok',planName:'plus',selectedPlan:'plus',models:{'gpt-6-astra':10000000},apiModels:{'gpt-6-astra':100}};
  const row=(turnId,other={})=>({turnId,models:[model],eventCount:1,partial:false,issues:[],status:'complete',...other});
  await page.evaluate(({req,reference,row1,row2})=>__codexQuotaUpdateTurnUsage({reference,turns:[row1,row2]},req.id),{req,reference,row1:row('turn-1'),row2:row('turn-2',{partial:true})});
  await page.waitForTimeout(300);
  assert.match(await page.locator('[data-content-search-turn-key="turn-1"] .cq-turn-usage').innerText(),/估算.*%/);
  assert.match(await page.locator('[data-content-search-turn-key="turn-2"] .cq-turn-usage').innerText(),/不完整/);
  assert.equal(await page.locator('.cq-turn-usage').count(),2);
  for(const zoom of [1,1.25,1.5]){
   await page.locator('#chat').evaluate((chat,zoom)=>{chat.style.zoom=zoom},zoom);
   const rows=await page.locator('.cq-turn-usage').evaluateAll(labels=>labels.map(label=>{
    const text=label.previousElementSibling.querySelector('.text-inherit');
    const metrics=node=>{
     const range=document.createRange();range.selectNodeContents(node);
     const rect=range.getBoundingClientRect(),s=getComputedStyle(node);
     return {top:rect.top,bottom:rect.bottom,typography:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.fontVariantNumeric,s.color]};
    };
    return [metrics(label),metrics(text)];
   }));
   for(const [label,native] of rows){
    assert.deepEqual(label.typography,native.typography);
    assert.ok(Math.abs(label.top-native.top)<.5 && Math.abs(label.bottom-native.bottom)<.5,JSON.stringify({zoom,label,native}));
   }
  }
  assert.equal(await page.evaluate(()=>turnRequests.length),1);
  await page.evaluate(()=>{document.querySelector('[data-content-search-turn-key="turn-1"]').remove();const e=document.createElement('div');e.dataset.contentSearchTurnKey='turn-3';e.innerHTML='<div class="text-size-chat text-secondary"><button>用时 1m</button></div>';document.querySelector('#chat').append(e);});
  await page.waitForFunction(()=>turnRequests.length===2);const next=await page.evaluate(()=>turnRequests[1]);
  assert.deepEqual(next.query.turnIds,['turn-3']);
  await page.evaluate(({req,reference,row1})=>__codexQuotaUpdateTurnUsage({reference,turns:[row1]},req.id),{req,reference,row1:row('turn-3')});
  assert.doesNotMatch(await page.locator('[data-content-search-turn-key="turn-3"] .cq-turn-usage').innerText(),/%/);
  await page.evaluate(({next,reference,row3})=>__codexQuotaUpdateTurnUsage({reference,turns:[row3]},next.id),{next,reference,row3:row('turn-3',{models:[{...model,model:'unknown-model'}]})});
  assert.match(await page.locator('[data-content-search-turn-key="turn-3"] .cq-turn-usage').innerText(),/缺少基准/);
  await page.evaluate(()=>{document.querySelector('[data-content-search-turn-key="turn-3"]').dataset.contentSearchTurnKey='turn-4';});
  await page.waitForFunction(()=>turnRequests.length===3);const recycled=await page.evaluate(()=>turnRequests[2]);
  assert.deepEqual(recycled.query.turnIds,['turn-4']);
  assert.doesNotMatch(await page.locator('[data-content-search-turn-key="turn-4"] .cq-turn-usage').innerText(),/%/);
  const proxyReference={...reference,models:{...reference.models,'gpt-6.1-sol':20000000},apiModels:{...reference.apiModels,'gpt-6.1-sol':200}};
  const terra={...model,model:'gpt-6.1-terra'};
  await page.evaluate(({recycled,reference,row4})=>__codexQuotaUpdateTurnUsage({reference,turns:[row4]},recycled.id),{recycled,reference:proxyReference,row4:row('turn-4',{models:[terra,{...terra,model:'codex-auto-review'}]})});
  assert.match(await page.locator('[data-content-search-turn-key="turn-4"] .cq-turn-usage').innerText(),/间接估算.*%/);
  assert.doesNotMatch(await page.locator('[data-content-search-turn-key="turn-4"] .cq-turn-usage').innerText(),/不完整/);
  assert.match(await page.locator('[data-content-search-turn-key="turn-4"] .cq-turn-usage').getAttribute('title'),/Astra 和 Sol/);
  assert.match(await page.locator('[data-content-search-turn-key="turn-4"] .cq-turn-usage').getAttribute('title'),/审核不占周额度/);
  await page.evaluate(()=>{document.querySelector('[data-content-search-turn-key="turn-4"]').dataset.contentSearchTurnKey='turn-5'});
  await page.waitForFunction(()=>turnRequests.length===4);const exempt=await page.evaluate(()=>turnRequests[3]);
  await page.evaluate(({exempt,reference,row5})=>__codexQuotaUpdateTurnUsage({reference,turns:[row5]},exempt.id),{exempt,reference:proxyReference,row5:row('turn-5',{models:[{...terra,model:'codex-auto-review'}]})});
  assert.match(await page.locator('[data-content-search-turn-key="turn-5"] .cq-turn-usage').innerText(),/估算.*0%/);
  assert.doesNotMatch(await page.locator('[data-content-search-turn-key="turn-5"] .cq-turn-usage').innerText(),/不完整/);
  await page.evaluate(()=>{__codexQuotaSessionScope='another-account';__codexQuotaResetSession();});
  await page.waitForFunction(()=>turnRequests.length===5);const third=await page.evaluate(()=>turnRequests[4]);
  await page.evaluate(({next,reference,row2})=>__codexQuotaUpdateTurnUsage({reference,turns:[row2]},next.id),{next,reference,row2:row('turn-2')});
  assert.doesNotMatch(await page.locator('[data-content-search-turn-key="turn-2"] .cq-turn-usage').innerText(),/%/);
  await page.evaluate(id=>__codexQuotaUpdateTurnUsage({errorCode:'LOCAL_USAGE_UNAVAILABLE'},id),third.id);
  assert.match(await page.locator('[data-content-search-turn-key="turn-2"] .cq-turn-usage').innerText(),/暂不可用/);
 }finally{await close(page);}
});


test('shared columns, selection markers and popup animation edges align under CSS zoom',async()=>{
 for (const zoom of [1.25,1.5]) {
  const page=await pageFor(officialPayload(),{width:720,height:800},{locale:'en-US',deviceScaleFactor:1.25,timezoneId:'Asia/Shanghai'});
  try {
   await page.clock.install({time:new Date('2026-11-18T12:30:00+08:00')});
   await page.evaluate(zoom=>{document.body.style.zoom=String(zoom);document.body.style.height=(innerHeight/zoom)+'px';},zoom);
   await showLocalUsage(page);const {range,id}=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(range),id);
   await page.locator('[data-period=custom]').click();await page.locator('[data-interval-minutes="60"]').click();
   const alignment=await page.evaluate(()=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect(), center=r=>r.top+r.height/2;
    const compare=(first,second,edges)=>Math.max(...edges.map(edge=>Math.abs(rect(first)[edge]-rect(second)[edge])));
    return {
     date:compare('[name=intervalStart]','[name=intervalEnd]',['left','right']),
     time:compare('[name=intervalStartTime]','[name=intervalEndTime]',['left','right']),
     icons:Math.abs(center(rect('.cq-settings-button svg'))-center(rect('.cq-local-refresh svg'))),
     period:compare('[data-period][aria-pressed=true]','.cq-local-period-marker',['left','top','right','bottom']),
     preset:compare('[data-interval-minutes][aria-pressed=true]','.cq-interval-preset-marker',['left','top','right','bottom']),
    };
   });
   for(const [name,error] of Object.entries(alignment))assert.ok(error<.2,`${zoom} ${name} is off by ${error}px`);
   await page.locator('[data-period=custom]').click();await page.emulateMedia({reducedMotion:'no-preference'});
   const compareFrames=async(selector,pane,reverse=false)=>{
    const result=await page.evaluate(({selector,pane,reverse})=>{
     const popup=document.getElementById('codex-quota-popover');
     const sample=()=>{
      const r=popup.getBoundingClientRect(),style=getComputedStyle(popup),scale=r.width/parseFloat(style.width);
      const edges=/^inset\(([^)]*?)(?: round|\))/.exec(style.clipPath)?.[1].split(' ').map(parseFloat);
      return {top:r.top+(edges?.[0]||0)*scale,bottom:r.bottom-(edges?.[2]??edges?.[0]??0)*scale,width:r.width,pane:document.querySelector(pane)?.getBoundingClientRect().width};
     };
     const pause=time=>{for(const a of popup.getAnimations()){a.pause();a.currentTime=time;}};
     const button=document.querySelector(selector),before=sample();button.click();pause(0);const after=sample();
     if(!reverse)return {before,after};
     pause(75);const midpoint=sample();button.click();pause(0);return {before,after,midpoint,reversed:sample()};
    },{selector,pane,reverse});
    for(const [first,last] of [[result.before,result.after],...(reverse?[[result.midpoint,result.reversed]]:[])]) {
     for(const edge of ['top','bottom','width'])assert.ok(Math.abs(first[edge]-last[edge])<.75,JSON.stringify({zoom,edge,first,last}));
     assert.ok(last.pane<=last.width&&last.width-last.pane<4,JSON.stringify({zoom,last}));
    }
    await finishAnimations(page);await assertMotionClean(page);
   };
   await compareFrames('.cq-local-highlights','#cq-local-usage',true);
   await compareFrames('.cq-settings-button','#cq-settings');
   await page.emulateMedia({reducedMotion:'reduce'});
   const settingsError=await page.locator('.cq-settings-tabs').evaluate(tabs=>Math.abs(tabs.querySelector('button[aria-pressed=true]').getBoundingClientRect().left-tabs.querySelector('i').getBoundingClientRect().left));
   assert.ok(settingsError<.2);
   await page.locator('#cq-settings header button').click();await page.locator('[data-period=week]').click();
   const week=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(week.range),week.id);
   const chartError=await page.locator('.cq-local-chart-plot').evaluate(plot=>{
    const center=node=>{const rect=node.getBoundingClientRect();return rect.left+rect.width/2;};
    return Math.abs(center(plot.querySelector('.cq-local-day-selection'))-center(plot.querySelector('[aria-pressed=true]')));
   });
   assert.ok(chartError<.2,`${zoom} chart marker is off by ${chartError}px`);
  } finally {await close(page);}
 }
});

test('settings inherits the visible opening frame when today loads mid-animation',async()=>{
 const page=await pageFor(officialPayload(),{width:720,height:800},{reducedMotion:'no-preference'});
 try {
  await page.evaluate(()=>{
   const info=console.info;
   console.info=(...args)=>{if(args[0]==='__codexQuotaLocalUsageRequest__')globalThis.__codexQuotaLocalUsageTestRequestId=args[1];info.apply(console,args);};
  });
  await page.locator('#codex-quota-trigger').click();
  await page.waitForFunction(()=>document.querySelector('#codex-quota-popover[data-cq-rail-motion]'));
  const {range,id}=await localUsageRequest(page);
  const frames=await page.evaluate(({payload,id})=>{
   const popup=document.getElementById('codex-quota-popover');
   const hold=(animation,time)=>{animation.pause();animation.currentTime=time;};
   const sample=()=>{
    const r=popup.getBoundingClientRect(),css=getComputedStyle(popup);
    const inset=/^inset\(([^)]*?)(?: round|\))/.exec(css.clipPath)?.[1].split(' ').map(parseFloat);
    return {left:r.left,top:r.top+(inset?.[0]||0),bottom:r.bottom-(inset?.[2]??inset?.[0]??0),opacity:Number(css.opacity)};
   };
   for(const animation of popup.getAnimations())hold(animation,75);
   __codexQuotaUpdateLocalUsage(payload,id);
   const resize=popup.getAnimations().find(animation=>animation.effect.getKeyframes()[0].clipPath);
   if(resize)hold(resize,55);
   const before=sample();document.querySelector('.cq-settings-button').click();
   for(const animation of popup.getAnimations())hold(animation,0);
   return {before,after:sample(),resize:Boolean(resize)};
  },{payload:localUsagePayload(range),id});
  assert.equal(frames.resize,true,'a reply during opening still animates the height');
  for(const edge of ['top','bottom','left','opacity'])assert.ok(Math.abs(frames.before[edge]-frames.after[edge])<(edge==='opacity'?.01:.75),JSON.stringify({edge,...frames}));
  await finishAnimations(page);await assertMotionClean(page);
 } finally {await close(page);}
});

test('preview panes follow their content and keep the full date editor reachable in short windows',async()=>{
 const page=await pageFor(officialPayload(),{width:390,height:720},{timezoneId:'Asia/Shanghai'});try{
  await page.clock.install({time:new Date('2026-11-04T12:30:00+08:00')});
  await showLocalUsage(page);let {range,id}=await localUsageRequest(page);await updateLocalUsage(page,localUsagePayload(range),id);
  const today=(await geometry(page)).popup;
  await page.locator('[data-period=week]').click();({range,id}=await localUsageRequest(page));await updateLocalUsage(page,localUsagePayload(range),id);
  const week=(await geometry(page)).popup;assert.ok(week.height>today.height&&week.width===today.width);
  await page.locator('.cq-settings-button').click();await settle(page);
  const settings=(await geometry(page)).popup;assert.ok(settings.height<today.height&&settings.width===today.width);
  for(const section of ['reference','tools','alerts']){
   await page.locator(`[data-settings=${section}]`).click();
   assert.equal(await page.locator(`[data-settings=${section}]`).getAttribute('aria-pressed'),'true');
  }
  await page.locator('#cq-settings header button').click();
  await page.setViewportSize({width:390,height:360});await settle(page);
  await page.locator('[data-period=custom]').click();await page.locator('[data-date-field=intervalEnd]').click();await settle(page);
  const small=(await geometry(page)).popup;
  assert.ok(small.top>=11&&small.bottom<=349&&small.height<=336,JSON.stringify(small));
  const scroller=page.locator('.cq-local-body');
  assert.ok(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight&&getComputedStyle(el).scrollbarWidth==='none'));
  await page.locator('.cq-local-calendar [data-close]').click();await page.locator('.cq-interval-actions [type=submit]').click();
  assert.notEqual((await localUsageRequest(page)).id,id);
 }finally{await close(page);}
});
