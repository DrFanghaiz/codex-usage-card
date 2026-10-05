// Run: node --test tests/native_patch_runtime.cjs (Playwright + Edge; synthetic data only).
const assert = require('node:assert/strict');
const {readFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const {test, before, after} = require('node:test');
const {chromium} = require('playwright');
const source = readFileSync(process.env.QUOTA_SCRIPT || join(__dirname, '../native-patch/native_patch.js'), 'utf8');
// Reduced fixture of the installed 26.924 shell: no prototype selectors or layout constants in the patch.
const shell = `<!doctype html><html lang="zh"><head><style>
*{box-sizing:border-box}body{margin:0;font:13px 'Segoe UI',sans-serif;display:flex;height:100vh;background:#f4f1e8}
:root{color-scheme:light;--color-surface-elevated-secondary:#f5f3eb;--color-text:#202522;--color-text-secondary:#63675d;--color-border:#e1ded5;--color-background-primary-ghost-hover:#e3e0d8}
nav[data-app-navigation-rail]{width:51px;display:flex;flex-direction:column;align-items:center;padding-bottom:8px;background:#eae7de;flex:none}
.rail-top{flex:1}.w-9{width:36px}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.rail-stack{gap:8px}.profile{width:100%}
.sidebar-item button,#help{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;background:transparent}.rounded-full{display:block;width:24px;height:24px;border-radius:50%;background:#afbeb0}
.sidebar-navigation{position:relative;display:flex;flex-direction:column;width:238px;min-width:0;min-height:0;overflow:hidden;background:#f1eee4;flex:none}.contents{display:contents}.sidebar-navigation nav{display:flex;flex:1;min-height:0;flex-direction:column;padding:8px}.sidebar-navigation [data-app-action-sidebar-scroll]{flex:1;min-height:0;overflow:auto}.list-item{height:31px}main{flex:1;min-width:0}
#native-menu{position:fixed;inset:auto;left:60px;top:100px;margin:0;padding:16px;background:var(--color-surface-elevated-secondary);color:var(--color-text)}
[hidden]{display:none!important}@media(max-width:400px){.sidebar-navigation{width:220px}}
</style></head><body><nav data-app-navigation-rail="true"><div class="rail-top"><button id="collapse">折叠</button><button id="menu-trigger" popovertarget="native-menu">菜单</button></div><div class="relative shrink-0 w-9"><div class="flex items-center flex-col rail-stack"><div class="flex items-center flex-col"><button id="help">?</button></div><div class="flex profile"><div class="sidebar-item"><div><button id="profile"><span><span id="avatar" class="rounded-full"></span></span></button></div></div></div></div></div></nav><div class="sidebar-navigation"><div class="contents"><nav role="navigation"><div>项目</div><div data-app-action-sidebar-scroll>${Array.from({length:80},(_,i)=>`<div class="list-item">项目 ${i}</div>`).join('')}</div></nav><div class="absolute inset-x-0 bottom-0 z-20"></div></div></div><main id="chat"><button id="outside">正文</button></main><div id="native-menu" popover="auto">原生菜单</div><script>document.getElementById('collapse').onclick=()=>document.querySelector('.sidebar-navigation').hidden=!document.querySelector('.sidebar-navigation').hidden;</script></body></html>`;
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
async function sharedPages(count=1) {
  const context=await browser.newContext({reducedMotion:'reduce',locale:'zh-CN'});
  await context.route('https://quota.test/**',route=>route.fulfill({contentType:'text/html',body:shell}));
  const pages=[];
  for(let i=0;i<count;i++){const page=await context.newPage();await page.goto('https://quota.test/');await setup(page,null);pages.push(page);}
  return {context,pages};
}
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForTimeout(70);}
async function open(page){await page.locator('#codex-quota-trigger').click();await settle(page);}
async function collapse(page){await page.locator('.cq-collapse-button').click();await settle(page);}
async function update(page,data){await page.evaluate(data=>__codexQuotaUpdateOfficial(data,globalThis.__codexQuotaOfficialRequestId),data);}
async function close(page){assert.deepEqual(page.errors||[],[]);await page.close();}
async function geometry(page){return page.evaluate(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};return {trigger:rect('#codex-quota-trigger'),avatar:rect('#avatar'),column:rect('.sidebar-navigation'),popup:rect('#codex-quota-popover'),rail:rect('[data-app-navigation-rail]'),help:rect('#help'),overflow:document.documentElement.scrollWidth>innerWidth}});}
async function motionSnapshot(page,selector){return page.evaluate(async selector=>{
  if(selector)document.querySelector(selector).click();
  await new Promise(requestAnimationFrame);
  const popup=document.getElementById('codex-quota-popover'),trigger=document.getElementById('codex-quota-trigger');
  const animations=[...popup.getAnimations({subtree:true}),...trigger.getAnimations({subtree:true})];
  for(const animation of animations){animation.pause();animation.currentTime=0;}
  const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
  const box=rect(popup),style=getComputedStyle(popup),inset=style.clipPath.match(/^inset\((.*?)\s*(?:round\b|\))/);
  const parts=inset?inset[1].trim().split(/\s+/).map(Number.parseFloat):[0];
  const [top,right=top,bottom=top,left=right]=parts;
  return {box,trigger:rect(trigger),clip:style.clipPath,visible:{left:box.left+left,right:box.right-right,top:box.top+top,bottom:box.bottom-bottom},height:popup.style.height,
    animations:animations.map(a=>({target:a.effect.target.id||a.effect.target.className,duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay,frames:a.effect.getKeyframes()}))};
},selector);}
async function finishAnimations(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.cq-shared-layer,#codex-quota-popover[data-cq-opening]'),null,{timeout:1200});await page.evaluate(()=>{for(const el of document.querySelectorAll('#codex-quota-popover,#codex-quota-trigger'))for(const animation of el.getAnimations({subtree:true}))animation.finish();});await settle(page);}
async function sharedSnapshot(page,selector){return page.evaluate(async selector=>{
  if(selector){document.querySelector(selector).click();await Promise.resolve();}
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}};
  const popup=document.getElementById('codex-quota-popover'),box=rect(popup),surface=document.querySelector('.cq-shared-surface')||popup,surfaceBox=rect(surface),style=getComputedStyle(surface),inset=style.clipPath.match(/^inset\((.*?)\s*(?:round\b|\))/);
  const parts=inset?inset[1].trim().split(/\s+/).map(Number.parseFloat):[0], [top,right=top,bottom=top,left=right]=parts;
  return {box,trigger:rect(document.getElementById('codex-quota-trigger')),visible:{left:surfaceBox.left+left,right:surfaceBox.right-right,top:surfaceBox.top+top,bottom:surfaceBox.bottom-bottom},
    arrow:rect(document.querySelector('.cq-collapse-icon')),settings:rect(document.querySelector('.cq-settings-button')),originArrow:rect(document.querySelector('.cq-trigger-chevron')),
    actors:Object.fromEntries([...document.querySelectorAll('.cq-shared-layer [data-cq-shared-key]')].map(el=>[el.dataset.cqSharedKey,rect(el)])),
    digitOrigin:rect(document.querySelector('.cq-trigger-graphics [data-cq-window="Weekly"] .cq-trigger-digits')),digitTarget:rect(document.querySelector('.cq-quota-row[data-cq-window="Weekly"] .cq-value-digits')),
    percentTarget:rect(document.querySelector('.cq-quota-row[data-cq-window="Weekly"] .cq-value-percent')),surfaceTransform:getComputedStyle(popup).transform};
},selector);}
function assertCompositorMotion(snapshot){
  assert.ok(snapshot.animations.length>0,'motion must exist when allowed');
  for(const animation of snapshot.animations)for(const frame of animation.frames){assert.equal('height' in frame,false);assert.equal('top' in frame,false);assert.doesNotMatch(frame.transform||'',/\bscale(?:3d|X|Y|Z)?\(/i);}
}
async function assertEntryCovered(page){
  const appearance=await page.locator('#codex-quota-trigger').evaluate(el=>{
    const s=getComputedStyle(el),transparent=color=>color==='transparent'||/rgba\([^)]*, 0\)$|\/ 0\)$/.test(color);
    return {background:transparent(s.backgroundColor),border:s.borderTopStyle==='none'||parseFloat(s.borderTopWidth)===0||transparent(s.borderTopColor),shadow:s.boxShadow,blur:s.backdropFilter,pointer:s.pointerEvents,tabIndex:el.tabIndex,opacity:s.opacity,
      children:[...el.querySelectorAll('.cq-trigger-plan,.cq-trigger-copy,.cq-trigger-graphics,.cq-trigger-icon,.cq-trigger-chevron')].filter(child=>getComputedStyle(child).display!=='none').every(child=>{let opacity=1;for(let n=child;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return opacity===0;})};
  });
  assert.deepEqual(appearance,{background:true,border:true,shadow:'none',blur:'none',pointer:'none',tabIndex:-1,opacity:'1',children:true},'expanded entry is only a geometry placeholder, with no remaining surface or chevron');
}
async function assertMotionClean(page){assert.deepEqual(await page.locator('#codex-quota-popover').evaluate(el=>({height:el.style.height,clip:el.style.clipPath,transform:el.style.transform,opacity:el.style.opacity,animations:el.getAnimations({subtree:true}).length,dirtyChildren:[...el.children].filter(child=>child.style.opacity||child.style.transform).map(child=>child.id),sharedLayers:document.querySelectorAll('.cq-shared-layer').length,hiddenEndpoints:document.querySelectorAll('[data-cq-shared-hidden]').length})),{height:'',clip:'',transform:'',opacity:'',animations:0,dirtyChildren:[],sharedLayers:0,hiddenEndpoints:0});}

test('17 acceptance checks at 1716/1024/390/320px use measured geometry',async()=>{
  for(const width of [1716,1024,390,320]){
    const page=await pageFor(officialPayload(),{width,height:870});
    try{
      const trigger=page.locator('#codex-quota-trigger');const popup=page.locator('#codex-quota-popover');
      assert.equal(await popup.isVisible(),false,'production default is collapsed');
      let identity=await trigger.elementHandle();
      let g=await geometry(page);assert.ok(Math.abs(g.trigger.top-g.avatar.top)<=1); // 1
      const originalTop=g.trigger.top;
      await page.locator('[data-app-action-sidebar-scroll]').evaluate(el=>el.scrollTop=el.scrollHeight);
      g=await geometry(page);assert.equal(g.trigger.top,originalTop); // 2
      assert.ok(await page.locator('.list-item').last().evaluate(el=>el.getBoundingClientRect().bottom<=document.getElementById('codex-quota-trigger').getBoundingClientRect().top));
      await open(page);assert.equal(await trigger.getAttribute('aria-expanded'),'true'); // 3
      g=await geometry(page);assert.ok(g.popup.height<=180,`height ${g.popup.height}`); // 4
      assert.ok(g.popup.left>=12&&g.popup.top>=12&&g.popup.right<=width-12&&g.popup.bottom<=870);assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1); // 5
      assert.equal(g.popup.width,Math.min(272,g.column.width-16));assert.ok(g.popup.left>=g.column.left&&g.popup.right<=g.column.right); // 6
      await page.locator('.cq-settings-button').click();assert.equal(await page.locator('#codex-official-usage-host').isVisible(),false);assert.equal(await page.locator('#cq-settings').isVisible(),true);const settingsGeometry=await geometry(page);assert.ok(Math.abs(settingsGeometry.popup.bottom-settingsGeometry.trigger.bottom)<1);await page.locator('#cq-settings header button').click(); // 7
      await collapse(page);assert.equal(await popup.isVisible(),false); // 8
      await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:63,resetAt:1900600000}]});await open(page);assert.equal(await page.locator('.cq-quota-row').count(),1);assert.doesNotMatch(await trigger.innerText(),/5h/);assert.ok((await geometry(page)).popup.height<g.popup.height); // 9
      await page.evaluate(()=>__codexQuotaResetSession());assert.match(await trigger.innerText(),/暂不可用/);await update(page,officialPayload());await page.evaluate(source);await open(page);identity=await trigger.elementHandle();assert.equal(await trigger.getAttribute('data-cq-kind'),'official'); // 10
      await update(page,{errorCode:'UNAVAILABLE'});assert.match(await popup.innerText(),/63%/);assert.match(await popup.innerText(),/更新失败.*上次成功/s); // 11
      assert.equal((await geometry(page)).overflow,false); // 12
      await page.locator('#collapse').click();await settle(page);assert.equal(await identity.evaluate(el=>el.parentElement.classList.contains('rail-stack')),true); // 13
      g=await geometry(page);assert.ok(g.trigger.bottom<=g.help.top); // 14
      assert.ok(g.trigger.left>=g.rail.left&&g.trigger.right<=g.rail.right); // 15
      await open(page);g=await geometry(page);assert.ok(g.popup.left>=12&&g.popup.top>=12&&g.popup.right<=width-12&&g.popup.bottom<=858); // 16
      await page.locator('#collapse').click();await settle(page);g=await geometry(page);assert.ok(Math.abs(g.trigger.top-g.avatar.top)<=1);assert.equal(await trigger.evaluate(el=>el.parentElement.id),'codex-quota-footer');assert.equal(await trigger.count(),1); // 17
    }finally{await close(page);}
  }
});

test('alignment follows different avatar sizes, bottom gaps, column resize and short windows',async()=>{
  const page=await pageFor();try{
    await page.addStyleTag({content:'#avatar{width:29px;height:29px}nav[data-app-navigation-rail]{padding-bottom:19px}.sidebar-navigation{width:300px}'});await settle(page);
    let g=await geometry(page);assert.ok(Math.abs(g.trigger.top-g.avatar.top)<=1);
    await open(page);assert.equal((await geometry(page)).popup.width,272);
    await page.evaluate(()=>{const shell=document.createElement('div');shell.id='scaled-shell';document.body.prepend(shell);for(const el of [...document.body.children])if(el!==shell&&!el.id.startsWith('codex-quota')&&el.tagName!=='SCRIPT')shell.append(el)});
    for(const zoom of [1.1,1.25]){
      await page.locator('#scaled-shell').evaluate((el,zoom)=>el.style.cssText=`display:flex;zoom:${zoom};width:calc(100vw / ${zoom});height:calc(100vh / ${zoom})`,zoom);await settle(page);
      g=await geometry(page);assert.ok(Math.abs(g.trigger.top-g.avatar.top)<=1,`zoom ${zoom} alignment ${g.trigger.top-g.avatar.top}`);
      assert.ok(Math.abs(g.trigger.height-32*zoom)<.05);assert.equal(g.popup.width,Math.min(272,g.column.width-16));assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1);
      assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-graphical'),'plus');
      assert.ok(await page.locator('.cq-trigger-graphics').evaluate(el=>el.scrollWidth<=el.clientWidth),'graphical content must fit at host zoom');
    }
    await page.setViewportSize({width:320,height:180});await settle(page);
    g=await geometry(page);assert.ok(Math.abs(g.trigger.top-g.avatar.top)<=1);assert.ok(g.popup.top>=12&&g.popup.bottom<=180);assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1);
    await page.locator('.cq-settings-button').click();assert.ok(await page.locator('#codex-quota-popover').evaluate(el=>el.scrollHeight>el.clientHeight));g=await geometry(page);assert.ok(g.popup.top>=12&&Math.abs(g.popup.bottom-g.trigger.bottom)<1);
  }finally{await close(page);}
});

test('Enter/Space, native popover exclusion, Escape focus and outside focus are consistent',async()=>{
  const page=await pageFor();try{
    const t=page.locator('#codex-quota-trigger'),p=page.locator('#codex-quota-popover');
    await t.focus();await page.keyboard.press('Enter');await settle(page);assert.equal(await p.isVisible(),true);assert.ok(await p.evaluate(el=>el.contains(document.activeElement)),'opening transfers focus away from the covered entry');assert.equal(await t.evaluate(el=>el.tabIndex),-1);
    await page.keyboard.press('Tab');assert.ok(await p.evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Escape');assert.equal(await p.isVisible(),false);assert.equal(await t.getAttribute('aria-expanded'),'false');assert.equal(await t.evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Space');await settle(page);assert.equal(await p.isVisible(),true);assert.equal(await page.locator('.cq-actions button').count(),2);assert.equal(await page.locator('#codex-quota-popover > .cq-collapse-button').count(),1);await collapse(page);assert.equal(await p.isVisible(),false);assert.equal(await t.evaluate(el=>el===document.activeElement),true);assert.equal(await t.evaluate(el=>el.tabIndex),0);await open(page);
    await page.getByRole('button',{name:'收起额度',exact:true}).focus();await page.keyboard.press('Enter');await settle(page);assert.equal(await p.isVisible(),false);assert.equal(await t.evaluate(el=>el===document.activeElement),true);await open(page);
    await page.locator('#outside').click();assert.equal(await p.isVisible(),false);assert.equal(await page.locator('#outside').evaluate(el=>el===document.activeElement),true);
    await open(page);await page.locator('#menu-trigger').click();assert.equal(await p.isVisible(),false);assert.equal(await page.locator('#native-menu').isVisible(),true);
    await open(page);assert.equal(await page.locator('#native-menu').isVisible(),false);
    await page.locator('.cq-settings-button').click();await page.keyboard.press('Escape');assert.equal(await t.evaluate(el=>el===document.activeElement),true);
  }finally{await close(page);}
});

test('rapid reversal, reduced motion and reinjection never duplicate the shell',async()=>{
  const page=await pageFor();try{
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(let i=0;i<9;i++){await page.locator('#codex-quota-trigger').evaluate(el=>el.click());await page.waitForTimeout(20);}
    await page.waitForTimeout(300);assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.evaluate(source);await settle(page);assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('#codex-quota-popover').count(),1);
    await page.emulateMedia({reducedMotion:'reduce'});await collapse(page);await open(page);
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.getAnimations({subtree:true}).length),0);
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  }finally{await close(page);}
});

test('M opening grows in place from the measured entry without a spare surface; rail mode retains its icon',async()=>{
  for(const [collapsed,columnWidth] of [[false,238],[false,300],[true,238]]){
    const page=await pageFor();try{
      await page.addStyleTag({content:`#avatar{width:29px;height:29px}nav[data-app-navigation-rail]{padding-bottom:17px}.sidebar-navigation{width:${columnWidth}px}`});await settle(page);
      if(collapsed){await page.locator('#collapse').click();await settle(page);}
      await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      let first;
      if(collapsed)first=await motionSnapshot(page,'#codex-quota-trigger');
      else first=await sharedSnapshot(page,'#codex-quota-trigger');
      if(collapsed){
        assertCompositorMotion(first);
        const material=first.animations.find(a=>a.target==='codex-quota-popover'&&a.frames.some(f=>f.opacity!==undefined));
        assert.ok(material,'rail opening fades a complete floating panel');
        assert.equal(Number(material.frames[0].opacity),0);
        assert.equal(first.clip,'none','a transparent icon must not create a tiny material tile');
      }else assert.ok(first.actors['weekly-digits'],'column opening must carry the existing weekly number');
      if(!collapsed)for(const edge of ['left','right','top','bottom'])assert.ok(Math.abs(first.visible[edge]-first.trigger[edge])<1.5,`column ${columnWidth}px ${edge}: ${first.visible[edge]} vs ${first.trigger[edge]}`);
      await finishAnimations(page);await assertMotionClean(page);
      assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true,'doctor must still see the entry');
      assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>getComputedStyle(el).opacity),'1');
      if(!collapsed){
        const g=await geometry(page);assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1,'expanded card replaces the original bottom edge');
        await assertEntryCovered(page);
      }else{
        assert.equal(await page.locator('.cq-trigger-icon').evaluate(el=>getComputedStyle(el).opacity),'1');
        assert.notEqual(await page.locator('#codex-quota-trigger').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
      }
      if(collapsed){
        const closing=await motionSnapshot(page,'#codex-quota-trigger');assertCompositorMotion(closing);
        const material=closing.animations.find(a=>a.target==='codex-quota-popover'&&a.frames.some(f=>f.opacity!==undefined));
        assert.equal(Number(material.frames.at(-1).opacity),0);
      }else{
        const closing=await sharedSnapshot(page,'.cq-collapse-button');
        assert.ok(closing.actors['weekly-digits'],'closing carries the weekly number back to the entry');
      }
      await finishAnimations(page);assert.equal(await page.locator('#codex-quota-popover').isVisible(),false);await assertMotionClean(page);
      if(!collapsed){assert.ok(await page.locator('.cq-trigger-graphics [data-cq-window],.cq-trigger-chevron').evaluateAll(els=>els.every(el=>{let opacity=1;for(let n=el;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return opacity===1;})));assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>el.tabIndex),0);assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>getComputedStyle(el).backdropFilter),'blur(18px)');}
    }finally{await close(page);}
  }
});

test('every sampled rail exit frame fades intact material with its content and supports reversal',async()=>{
  for(const dark of [false,true])for(const pane of ['quota','settings','mid-settings','opening-settings']){
    const page=await pageFor();try{
      if(dark){await page.addStyleTag({content:':root{color-scheme:dark;--color-surface-elevated-secondary:#272a23;--color-text:#f1f3e8;--color-text-secondary:#c7cbbb;--color-border:#42473a}'});await settle(page);}
      await page.locator('#collapse').click();await settle(page);await open(page);
      if(pane==='settings')await page.locator('.cq-settings-button').click();
      if(pane==='opening-settings'){await page.locator('#codex-quota-trigger').click();await settle(page);}
      await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      if(pane==='mid-settings'){await page.locator('.cq-settings-button').click();await page.waitForTimeout(50);}
      if(pane==='opening-settings'){
        await page.locator('#codex-quota-trigger').evaluate(el=>el.click());await page.waitForTimeout(80);
        const handoff=await page.evaluate(()=>{
          const popup=document.getElementById('codex-quota-popover');
          const pose=()=>{const s=getComputedStyle(popup),m=new DOMMatrixReadOnly(s.transform),r=popup.getBoundingClientRect();return {alpha:Number(s.opacity),x:m.m41,y:m.m42,bottom:r.bottom}};
          const before=pose();document.querySelector('.cq-settings-button').click();return {before,after:pose()};
        });
        assert.ok(handoff.before.alpha>0&&handoff.before.alpha<.95,'navigation interrupts a real partial entrance');
        for(const key of ['alpha','x','y','bottom'])assert.ok(Math.abs(handoff.before[key]-handoff.after[key])<.015,`settings retains current material ${key}`);
        await finishAnimations(page);
      }
      const result=await page.evaluate(async pane=>{
        const popup=document.getElementById('codex-quota-popover'),content=document.getElementById(pane==='quota'?'codex-official-usage-host':'cq-settings');
        const pose=()=>{const s=getComputedStyle(popup),r=popup.getBoundingClientRect();return {alpha:Number(s.opacity),width:r.width,height:r.height,clip:s.clipPath,contentAlpha:Number(getComputedStyle(content).opacity),x:r.x,y:r.y}};
        popup.hidePopover();const tracks=popup.getAnimations({subtree:true});for(const a of tracks){a.pause();a.currentTime=0;}
        const duration=Math.max(...tracks.filter(a=>a.constructor.name!=='CSSTransition').map(a=>a.effect.getTiming().duration));
        const frames=[];
        for(let time=0;time<duration;time+=1000/60){for(const a of tracks)a.currentTime=Math.min(time,a.effect.getTiming().duration*.999);frames.push(pose());}
        for(const a of tracks)a.currentTime=duration*.28;
        const before=pose();popup.showPopover();await Promise.resolve();const after=pose();
        return {frames,before,after};
      },pane);
      const first=result.frames[0];assert.ok(first.alpha>.99&&first.contentAlpha>0,'exit starts with its actual visible content');
      for(let i=1;i<result.frames.length;i++){
        const frame=result.frames[i],previous=result.frames[i-1];
        assert.ok(frame.alpha<=previous.alpha+.0001,'material opacity decreases every frame');
        assert.ok(Math.abs(frame.width-first.width)<.1&&Math.abs(frame.height-first.height)<.1,'no material shrinks into a white tile or strip');
        assert.equal(frame.clip,first.clip);assert.ok(Math.abs(frame.contentAlpha-first.contentAlpha)<.001,'content and material leave together');
        assert.ok(Math.abs(frame.x-first.x)<=6.01&&Math.abs(frame.y-first.y)<=6.01,'only a restrained drift toward the icon');
      }
      assert.ok(result.frames.at(-1).alpha<.002,'material disappears before native cleanup');
      assert.ok(Math.abs(result.before.alpha-result.after.alpha)<.015,'reversal keeps current alpha');
      assert.ok(Math.abs(result.before.x-result.after.x)<.15&&Math.abs(result.before.y-result.after.y)<.15,'reversal keeps current position');
      assert.equal(await page.locator('.cq-trigger-icon').evaluate(el=>getComputedStyle(el).opacity),'1');
      await finishAnimations(page);await page.locator('#codex-quota-trigger').click();await finishAnimations(page);
      await assertMotionClean(page);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>!el.hasAttribute('data-cq-rail-motion')&&!el.hasAttribute('data-cq-pane')&&getComputedStyle(el).opacity==='0'),true);
    }finally{await close(page);}
  }
});

test('shared Pro and Plus elements move and scale continuously while the toggle stays fixed at DPR 1.25',async()=>{
  for(const planName of ['pro','plus']){
    const data=officialPayload();data.planName=planName;data.windows[1].usedPercent=11;if(planName==='pro')data.windows.shift();
    const page=await pageFor(data,{width:1024,height:720},{deviceScaleFactor:1.25});try{
      await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      const first=await sharedSnapshot(page,'#codex-quota-trigger');
      for(const key of ['plan','weekly-digits','weekly-percent','weekly-track','weekly-ring'])assert.ok(first.actors[key],`${planName} shares ${key}`);
      if(planName==='plus')for(const key of ['5h-digits','5h-percent'])assert.ok(first.actors[key],`Plus shares ${key}`);
      for(const edge of ['left','top','width','height'])assert.ok(Math.abs(first.actors['weekly-digits'][edge]-first.digitOrigin[edge])<1.5,`weekly digits start at their real ${edge}`);
      const mutationProbe=await page.locator('.cq-shared-layer').evaluateHandle(layer=>{
        const probe={count:0};probe.observer=new MutationObserver(records=>probe.count+=records.length);
        probe.observer.observe(layer,{attributes:true,attributeFilter:['style'],subtree:true});return probe;
      });
      const sharedNodes=await page.locator('.cq-shared-layer [data-cq-shared-key]').elementHandles();
      const frames=[first];
      for(let i=0;i<4;i++){await page.waitForTimeout(35);frames.push(await sharedSnapshot(page));}
      const styleMutations=await mutationProbe.evaluate(probe=>{const count=probe.count+probe.observer.takeRecords().length;probe.observer.disconnect();return count;});await mutationProbe.dispose();
      assert.equal(styleMutations,0,'native shared motion must not write per-frame style attributes and wake host observers');
      const moving=frames.filter(frame=>frame.actors['weekly-digits']);assert.ok(moving.length>=3,'shared content persists across several rendered frames');
      for(const frame of moving){
        for(const axis of ['cx','cy'])assert.ok(Math.abs(frame.arrow[axis]-first.originArrow[axis])<1,`${planName} toggle ${axis} must not move`);
        assert.ok(frame.surfaceTransform==='none'||/^matrix\(1, 0, 0, 1,/.test(frame.surfaceTransform),'the surface must not scale its text');
      }
      assert.ok(moving.some(frame=>Math.abs(frame.actors['weekly-digits'].top-first.digitOrigin.top)>3&&Math.abs(frame.actors['weekly-digits'].top-first.digitTarget.top)>3),'weekly number traverses the space between layouts');
      assert.ok(moving.some(frame=>frame.actors['weekly-digits'].height>first.digitOrigin.height+1&&frame.actors['weekly-digits'].height<first.digitTarget.height-1),'weekly digits enlarge during the move');
      for(const node of sharedNodes)assert.equal(await node.evaluate(el=>el.isConnected),true,'the same shared actors persist during the move');
      await finishAnimations(page);await assertMotionClean(page);
      const last=await sharedSnapshot(page);
      for(const axis of ['cx','cy'])assert.ok(Math.abs(last.arrow[axis]-first.originArrow[axis])<1);
      assert.ok(last.digitTarget.height>last.percentTarget.height,'percent sign retains its own smaller type size');
      assert.equal(await page.locator('.cq-quota-row[data-cq-window="Weekly"] .cq-value-digits').innerText(),'11');
    }finally{await close(page);}
  }
});

test('shared motion reverses from the current geometry and repeated clicks use one stationary control',async()=>{
  const page=await pageFor({planName:'pro',windows:[{label:'Weekly',usedPercent:11,resetAt:Date.now()/1000+302400}]});try{
    await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
    const initial=await sharedSnapshot(page,'#codex-quota-trigger');await page.waitForTimeout(90);
    const reversal=await page.evaluate(()=>{
      const actor=()=>document.querySelector('.cq-shared-layer [data-cq-shared-key="weekly-digits"]'),rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}};
      const original=actor(),before=rect(original);document.querySelector('.cq-collapse-button').click();
      return {before,after:rect(actor()),sameActor:actor()===original,open:document.getElementById('codex-quota-popover').matches(':popover-open')};
    });
    assert.equal(reversal.open,false);assert.equal(reversal.sameActor,true,'reversal reuses the moving visual identity');
    for(const edge of ['left','top','width','height'])assert.ok(Math.abs(reversal.before[edge]-reversal.after[edge])<1.5,`reversal does not jump ${edge}: ${reversal.before[edge]} -> ${reversal.after[edge]}`);
    for(const [point,dx,dy] of [['center',0,0],['left edge',-11,0],['right edge',11,0],['top edge',0,-11],['bottom edge',0,11]]){
      const x=initial.originArrow.cx+dx,y=initial.originArrow.cy+dy;
      for(let i=0;i<6;i++){
        await page.mouse.click(x,y);
        const state=await page.evaluate(({x,y})=>{const popup=document.getElementById('codex-quota-popover'),trigger=document.getElementById('codex-quota-trigger');return {open:popup.matches(':popover-open'),expanded:trigger.getAttribute('aria-expanded'),tabIndex:trigger.tabIndex,hitTrigger:document.elementFromPoint(x,y)?.closest('button')===trigger};},{x,y});
        const expected=i%2===0;
        assert.equal(state.open,expected,`${point} click ${i+1} must immediately ${expected?'open':'close'} during motion`);
        assert.equal(state.expanded,String(expected));assert.equal(state.tabIndex,expected?-1:0,'native closed state restores entry keyboard access before animation finishes');
        if(!expected)assert.equal(state.hitTrigger,true,`${point} must hit the original entry while its closing animation continues`);
        await page.waitForTimeout(35);
      }
    }
    for(const key of ['Space','Enter']){
      assert.equal(await page.locator('.cq-shared-layer').count(),1,'keyboard reversal starts during the closing animation');
      await page.locator('#codex-quota-trigger').focus();await page.keyboard.press(key);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true,`${key} reopens the native popover during closing`);
      await page.waitForTimeout(35);await page.mouse.click(initial.originArrow.cx,initial.originArrow.cy);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),false,'the same arrow remains interactive during keyboard-started opening');
      assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>el.tabIndex),0);
    }
    await finishAnimations(page);await assertMotionClean(page);
    assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('.cq-collapse-button').count(),1);
    assert.equal(await page.locator('#codex-quota-trigger').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>el.tabIndex),0);
  }finally{await close(page);}
});

test('shared visual state is discarded on session, data, motion preference and layout interruptions',async()=>{
  for(const interruption of ['session','data','sameQuotaPlan','reduce','hidden','reinject','settings','resize']){
    const page=await pageFor();try{
      await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      await sharedSnapshot(page,'#codex-quota-trigger');await page.waitForTimeout(60);
      assert.equal(await page.locator('.cq-shared-layer').count(),1,`${interruption} interrupts active motion`);
      if(interruption==='session'){
        const state=await page.evaluate(()=>{__codexQuotaResetSession();return {layers:document.querySelectorAll('.cq-shared-layer').length,text:document.getElementById('codex-quota-trigger').innerText,open:document.getElementById('codex-quota-popover').matches(':popover-open')}});
        assert.equal(state.layers,0,'old-account visual data is removed synchronously');assert.equal(state.open,false);assert.match(state.text,/额度\s+暂不可用/);assert.doesNotMatch(state.text,/Plus|63%|28%/);
      }else if(interruption==='data')await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:72,resetAt:Date.now()/1000+302400}]});
      else if(interruption==='sameQuotaPlan'){
        const state=await page.evaluate(()=>{__codexQuotaUpdateOfficial({...__codexQuotaOfficialPayload,planName:'team'},globalThis.__codexQuotaOfficialRequestId);return {actors:document.querySelectorAll('.cq-shared-layer [data-cq-shared-key]').length,plan:document.querySelector('.cq-plan').textContent};});
        assert.deepEqual(state,{actors:0,plan:'team'},'a plan-only update must synchronously remove obsolete shared actors');
      }
      else if(interruption==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
      else if(interruption==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      else if(interruption==='reinject')await page.evaluate(source);
      else if(interruption==='settings')await page.locator('.cq-settings-button').evaluate(el=>el.click());
      else await page.locator('.sidebar-navigation').evaluate(el=>el.style.width='280px');
      await finishAnimations(page);await assertMotionClean(page);
      assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('#codex-quota-popover').count(),1);
      if(interruption==='data')assert.equal(await page.locator('.cq-value-digits').first().innerText(),'72');
      if(interruption==='sameQuotaPlan'){
        const g=await geometry(page);assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1,'same-quota plan changes keep the measured bottom alignment');
        assert.equal(await page.locator('.cq-plan').innerText(),'team');
      }
      if(interruption==='settings')assert.equal(await page.locator('#cq-settings').isVisible(),true);
      if(interruption==='hidden')await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
      await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.getElementById('codex-quota-popover').hidePopover());
      await update(page,officialPayload());await open(page);await assertMotionClean(page);
      assert.equal(await page.locator('.cq-settings-button').isVisible(),true);
    }finally{await close(page);}
  }
  const settingsPage=await pageFor();try{
    await open(settingsPage);await settingsPage.locator('.cq-settings-button').click();
    const panel=await settingsPage.locator('#cq-settings').elementHandle();
    await settingsPage.emulateMedia({reducedMotion:'no-preference'});await settle(settingsPage);
    await settingsPage.locator('.cq-collapse-button').evaluate(el=>el.click());await settingsPage.waitForTimeout(70);
    const before=await sharedSnapshot(settingsPage),surface=await settingsPage.locator('.cq-shared-surface').elementHandle();
    const reversed=await sharedSnapshot(settingsPage,'.cq-collapse-button');
    assert.equal(await panel.evaluate(el=>el.isConnected),true,'reversing a settings close retains the same pane');
    assert.equal(await surface.evaluate(el=>el.isConnected),true,'reversal retains the settings surface');
    assert.equal(await settingsPage.locator('#codex-official-usage-host').evaluate(el=>el.hidden),true,'quota content must not flash through a reversed settings morph');
    for(const edge of ['top','left','width','height'])assert.ok(Math.abs(reversed.box[edge]-before.box[edge])<1,'reversal does not replace settings geometry');
    await finishAnimations(settingsPage);await assertMotionClean(settingsPage);
    assert.equal(await settingsPage.locator('#cq-settings').isVisible(),true);
    assert.ok(await settingsPage.locator('#codex-quota-popover').evaluate(el=>el.contains(document.activeElement)),'reopening settings transfers focus into the visible pane');
    await settingsPage.locator('.cq-collapse-button').evaluate(el=>el.click());await finishAnimations(settingsPage);
    await settingsPage.locator('#codex-quota-trigger').click();await finishAnimations(settingsPage);
    assert.equal(await settingsPage.locator('#cq-settings').count(),0,'a fresh opening after complete close returns to quota');
    assert.equal(await settingsPage.locator('.cq-settings-button').isVisible(),true);await assertMotionClean(settingsPage);
  }finally{await close(settingsPage);}
  {
    const page=await pageFor();try{
      await page.locator('.sidebar-navigation').evaluate(el=>el.style.width='140px');await settle(page);
      await page.emulateMedia({reducedMotion:'no-preference'});await sharedSnapshot(page,'#codex-quota-trigger');
      assert.equal(await page.locator('.cq-shared-layer [data-cq-shared-key="weekly-digits"]').count(),0,'text fallback must not invent a shared number');
      await finishAnimations(page);await assertMotionClean(page);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true);
    }finally{await close(page);}
  }
});

test('M settings transitions use fixed measured bounds and interruptions restore clean native state',async()=>{
  const page=await pageFor();try{
    await open(page);await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
    let oldHeight=(await geometry(page)).popup.height;
    for(const selector of ['.cq-settings-button','#cq-settings header button']){
      const transition=await motionSnapshot(page,selector);assertCompositorMotion(transition);
      assert.ok(transition.animations.some(a=>a.target==='codex-quota-popover'&&a.duration>240&&a.frames.some(f=>f.clipPath)));
      await finishAnimations(page);const g=await geometry(page),newHeight=g.popup.height;assert.ok(Math.abs(g.popup.bottom-g.trigger.bottom)<1,'settings and quota views share the original bottom edge');await assertEntryCovered(page);
      assert.ok(Math.abs(Number.parseFloat(transition.height)-Math.max(oldHeight,newHeight))<=1,'settings morph fixes the larger measured height once');
      await assertMotionClean(page);oldHeight=newHeight;
    }
    for(const interruption of ['close','reinject','reduce','hidden','session']){
      await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      if(!await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')))await open(page);
      await motionSnapshot(page,'.cq-settings-button');
      if(interruption==='close'){
        await page.locator('#codex-quota-trigger').evaluate(el=>el.click());
        await page.locator('#cq-settings header button').evaluate(el=>el.click());
      }else if(interruption==='reinject')await page.evaluate(source);
      else if(interruption==='reduce')await page.emulateMedia({reducedMotion:'reduce'});
      else if(interruption==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      else await page.evaluate(()=>__codexQuotaResetSession());
      if(interruption==='reduce'||interruption==='hidden'){
        await settle(page);
        for(const method of ['hidePopover','showPopover'])assert.equal(await page.evaluate(async method=>{document.getElementById('codex-quota-popover')[method]();await Promise.resolve();return document.getElementById('codex-quota-trigger').getAnimations({subtree:true}).length;},method),0,`${interruption} entry changes must be immediate`);
      }
      await finishAnimations(page);await assertMotionClean(page);
      assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true);assert.equal(await page.locator('#codex-quota-popover').count(),1);
      if(interruption==='hidden')await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>document.getElementById('codex-quota-popover').hidePopover());
      await update(page,officialPayload());await open(page);await assertMotionClean(page);
      assert.equal(await page.locator('.cq-settings-button').isVisible(),true,'next opening must recover the quota view');
    }
  }finally{await close(page);}
});

test('settings navigation preserves presentation and input through natural playback, reverse and close',async()=>{
  const page=await pageFor();try{
    await open(page);await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
    const snapshot=()=>{
      const p=document.getElementById('codex-quota-popover'),box=p.getBoundingClientRect(),clip=getComputedStyle(p).clipPath;
      return {height:box.height-(parseFloat(clip.match(/^inset\(([^ ]+)/)?.[1])||0),
        quota:Number(getComputedStyle(document.getElementById('codex-official-usage-host')).opacity),
        settings:Number(getComputedStyle(document.getElementById('cq-settings')).opacity)};
    };
    await page.locator('.cq-settings-button').evaluate(el=>el.click());
    await page.waitForTimeout(45);
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.hasAttribute('data-cq-pane')),true);
    const natural=await page.evaluate(snapshot);assert.ok(natural.settings>0&&natural.settings<1,'new content actually fades during natural playback');assert.ok(natural.quota>0&&natural.quota<1,'outgoing content stays visible while fading');
    for(const action of ['back','settings','close','open']){
      const pair=await page.evaluate(({source,action})=>{
        const take=eval('('+source+')'),before=take();
        const selectors={back:'#cq-settings header button',settings:'.cq-settings-button',close:'.cq-collapse-button',open:'#codex-quota-trigger'};
        document.querySelector(selectors[action]).click();
        return Promise.resolve().then(()=>({before,after:take()}));
      },{source:snapshot.toString(),action});
      assert.ok(Math.abs(pair.before.height-pair.after.height)<1,`${action} must not jump to the endpoint`);
      for(const key of ['quota','settings'])assert.ok(Math.abs(pair.before[key]-pair.after[key])<.03,`${action} must not restart the fade`);
      await page.waitForTimeout(35);
    }
    await finishAnimations(page);await assertMotionClean(page);
    assert.equal(await page.locator('#cq-settings').isVisible(),true);
    assert.equal(await page.locator('#codex-official-usage-host').evaluate(el=>el.hidden&&!el.inert),true);
    assert.equal(await page.locator('#cq-settings').evaluate(el=>!el.inert),true);
    await page.locator('#cq-settings header button').click();await finishAnimations(page);
    assert.equal(await page.locator('#cq-settings').count(),0);
    // Pointer hit testing can end the settings tool's existing 120ms hover fade
    // when the moving pane settles; that feedback is separate from pane playback.
    await page.waitForTimeout(130);
    await assertMotionClean(page);
  }finally{await close(page);}
});

test('settings spacing, columns and small-window access stay aligned without visible scrollbars',async()=>{
  for(const width of [238,220,180]){
    const page=await pageFor();try{
      await page.locator('.sidebar-navigation').evaluate((el,width)=>el.style.width=width+'px',width);await settle(page);await open(page);await page.locator('.cq-settings-button').click();
      const layout=await page.evaluate(()=>{
        const p=document.getElementById('codex-quota-popover'),q=s=>document.querySelector(s).getBoundingClientRect(),title=q('#cq-settings h2'),back=q('#cq-settings header button'),arrow=q('.cq-collapse-button');
        const rows=[...document.querySelectorAll('#cq-settings label')];
        return {left:[title.x,...rows.map(r=>r.getBoundingClientRect().left)],right:rows.map(r=>r.lastElementChild.getBoundingClientRect().right),
          axis:back.x+back.width/2-arrow.x-arrow.width/2,overflow:p.scrollWidth-p.clientWidth,bars:getComputedStyle(p).scrollbarWidth,
          title:getComputedStyle(document.querySelector('#cq-settings h2')).fontWeight,tools:getComputedStyle(document.querySelector('.cq-tools')).fontSize};
      });
      assert.ok(Math.max(...layout.left)-Math.min(...layout.left)<.1);assert.ok(Math.max(...layout.right)-Math.min(...layout.right)<.1);
      assert.ok(Math.abs(layout.axis)<.1);assert.equal(layout.overflow,0);assert.equal(layout.bars,'none');assert.equal(layout.title,'600');assert.equal(layout.tools,'11px');
    }finally{await close(page);}
  }
});

test('real pointer input can reverse a mid-settings close and rail exit retains its spring',async()=>{
  for(const rail of [false,true]){
    const page=await pageFor();try{
      if(rail){await page.locator('#collapse').click();await settle(page);}
      await open(page);await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
      await page.locator('.cq-settings-button').click();await page.waitForTimeout(40);
      const panel=await page.locator('#cq-settings').elementHandle(),arrow=await page.locator('.cq-collapse-button').boundingBox();
      await page.mouse.click(arrow.x+arrow.width/2,arrow.y+arrow.height/2);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),false);
      await page.waitForTimeout(rail?220:35);
      assert.equal(await page.locator('.cq-collapse-button').evaluate(el=>getComputedStyle(el).opacity),'1','fixed arrow stays drawn during pane exit');
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>getComputedStyle(el).display!=='none'),true,'rail must not cut the spring at 180ms');
      const entry=await page.locator('#codex-quota-trigger').boundingBox();
      await page.mouse.click(rail?entry.x+entry.width/2:arrow.x+arrow.width/2,rail?entry.y+entry.height/2:arrow.y+arrow.height/2);
      assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>el.matches(':popover-open')),true);
      assert.equal(await panel.evaluate(el=>el.isConnected),true,'pointer reversal keeps the current settings pane');
      await finishAnimations(page);assert.equal(await page.locator('#cq-settings').isVisible(),true);
    }finally{await close(page);}
  }
});

test('graphical entries follow real windows, localize warnings, reuse nodes and fall back at narrow widths',async()=>{
  const page=await pageFor();try{
    const trigger=page.locator('#codex-quota-trigger'),graphics=trigger.locator('.cq-trigger-graphics');
    const badge=trigger.locator('.cq-trigger-plan');
    assert.equal(await badge.innerText(),'Plus');assert.equal(await badge.getAttribute('data-cq-tier'),'plus');assert.equal(await badge.getAttribute('aria-hidden'),'true');
    assert.equal(await badge.evaluate(el=>getComputedStyle(el).backgroundImage),'none');
    assert.ok((await badge.boundingBox()).x+(await badge.boundingBox()).width<(await graphics.boundingBox()).x);
    assert.equal(await trigger.getAttribute('data-cq-graphical'),'plus');assert.equal((await trigger.boundingBox()).height,32);
    assert.equal(await graphics.getAttribute('aria-hidden'),'true');assert.equal(await graphics.locator('.cq-time-ring').count(),1);
    assert.equal((await graphics.locator('.cq-trigger-weekly-bar').boundingBox()).width,24);assert.equal(await trigger.locator('.cq-trigger-chevron').isVisible(),true);
    assert.match(await trigger.getAttribute('aria-label'),/Plus.*已用.*5h.*本周/);
    await open(page);
    const headerBadge=page.locator('#codex-quota-popover .cq-plan-badge');
    const badgeStyle=el=>{const s=getComputedStyle(el);return [s.height,s.padding,s.borderWidth,s.borderRadius,s.fontSize,s.fontWeight,s.letterSpacing,s.backgroundColor,s.color]};
    assert.equal(await headerBadge.innerText(),'Plus');assert.deepEqual(await headerBadge.evaluate(badgeStyle),await badge.evaluate(badgeStyle),'entry and heading share the same badge component');
    const reused=await page.locator('#codex-quota-trigger, .cq-trigger-plan, .cq-trigger-graphics, .cq-trigger-graphics [data-cq-window], .cq-trigger-weekly-bar, .cq-trigger-time .cq-time-ring, .cq-quota-row').elementHandles();
    for(const [five,weekly] of [[99,40],[40,97],[99,97],[20,40]]){
      const data=officialPayload();data.windows[0].usedPercent=five;data.windows[1].usedPercent=weekly;await update(page,data);await settle(page);
      for(const [label,used] of [['5h',five],['Weekly',weekly]]){
        const number=graphics.locator(`[data-cq-window="${label}"]`);
        assert.equal(await number.evaluate(el=>el.classList.contains('cq-warning')),used>=80,`${label} warning must follow its own quota`);
      }
      assert.equal(await graphics.locator('.cq-trigger-weekly-bar').evaluate(el=>el.classList.contains('cq-warning')),weekly>=80);
      const rows=page.locator('.cq-quota-row');
      for(const [index,used] of [weekly,five].entries()){
        const row=rows.nth(index);assert.equal(await row.evaluate(el=>el.hasAttribute('data-cq-low')),used>=80);
        assert.equal(await row.locator('.cq-value').evaluate(el=>getComputedStyle(el).color),used>=80?'rgb(152, 96, 28)':'rgb(32, 37, 34)');
        assert.equal(await row.locator('.cq-value-group .cq-low').isVisible(),used>=80);
        if(used>=80)assert.match(await row.locator('.cq-value-group').textContent(),new RegExp(`已用\\s*${used}%.*剩余可用\\s*${100-used}%`));
      }
      for(const handle of reused)assert.equal(await handle.evaluate(el=>el.isConnected),true,'a value update must reuse its nodes');
    }
    await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:59,resetAt:Date.now()/1000+302400}]});await settle(page);
    assert.equal(await trigger.getAttribute('data-cq-graphical'),'pro');assert.equal((await graphics.locator('.cq-trigger-weekly-bar').boundingBox()).width,42);
    assert.equal(await badge.textContent(),'Pro');assert.equal(await badge.getAttribute('data-cq-tier'),'pro');
    assert.equal(await headerBadge.innerText(),'Pro');assert.deepEqual(await headerBadge.evaluate(badgeStyle),await badge.evaluate(badgeStyle));
    assert.equal(await headerBadge.evaluate(el=>getComputedStyle(el).color),await graphics.locator('.cq-progress-fill').evaluate(el=>getComputedStyle(el).backgroundColor),'Pro uses the quota accent, independent of warning');
    assert.equal(await graphics.locator('[data-cq-window="5h"]').count(),0);
    await collapse(page);const bar=await graphics.locator('.cq-trigger-weekly-bar').elementHandle();
    await page.locator('.sidebar-navigation').evaluate(el=>el.style.width='140px');await settle(page);
    assert.equal(await trigger.getAttribute('data-cq-graphical'),null);assert.equal((await trigger.boundingBox()).height,30);
    assert.equal(await trigger.locator('.cq-trigger-copy').isVisible(),true);assert.equal(await graphics.isVisible(),false);assert.equal(await bar.evaluate(el=>el.isConnected),true);
    assert.equal(await badge.isVisible(),true,'plan remains available in narrow text fallback');assert.match(await trigger.getAttribute('aria-label'),/Pro.*已用.*本周/);
    assert.ok(Math.abs((await geometry(page)).trigger.top-(await geometry(page)).avatar.top)<=1);
    const scans=await page.evaluate(()=>layoutScans);await settle(page);assert.equal(await page.evaluate(()=>layoutScans),scans,'narrow fallback must settle');
    await page.locator('.sidebar-navigation').evaluate(el=>el.style.width='238px');await settle(page);
    assert.equal(await trigger.getAttribute('data-cq-graphical'),'pro');assert.equal((await trigger.boundingBox()).height,32);
    assert.ok(Math.abs((await geometry(page)).trigger.top-(await geometry(page)).avatar.top)<=1);
    for(const data of [{planName:'plus',windows:[{label:'Weekly',usedPercent:30,resetAt:1900600000}]},{planName:'pro',windows:[{label:'5h',usedPercent:20,resetAt:1900600000}]},{planName:'team',windows:[{label:'Weekly',usedPercent:40,resetAt:1900600000}]}]){
      await update(page,data);await settle(page);assert.equal(await trigger.getAttribute('data-cq-graphical'),null);assert.equal((await trigger.boundingBox()).height,30);
      assert.equal(await graphics.locator('.cq-time-ring,.cq-trigger-weekly-bar').count(),0);
      assert.equal(await badge.isVisible(),data.planName!=='team');assert.equal(await badge.getAttribute('data-cq-tier'),data.planName==='team'?null:data.planName);
      assert.equal(await headerBadge.textContent(),data.planName==='team'?'team':data.planName==='plus'?'Plus':'Pro');
      assert.match(await trigger.innerText(),new RegExp(data.windows[0].label==='5h'?'5h':'本周'));assert.equal(await page.locator('.cq-quota-row').count(),1);
    }
    await update(page,officialPayload());await page.locator('#collapse').click();await settle(page);
    assert.equal(await badge.isVisible(),false,'rail stays a single icon');assert.match(await trigger.getAttribute('aria-label'),/^Plus/);
  }finally{await close(page);}
});

test('rail gauge matches navigation and tracks the limiting official remaining window',async()=>{
  const payload=used=>({planName:'pro',windows:[{label:'Weekly',usedPercent:used,resetAt:Date.now()/1000+302400}]});
  const page=await pageFor(payload(50));try{
    await page.locator('#collapse').click();await settle(page);
    const trigger=page.locator('#codex-quota-trigger'),needle=page.locator('.cq-gauge-needle'),identity=await needle.elementHandle();
    const style=await trigger.evaluate(el=>{const s=getComputedStyle(el),g=el.querySelector('.cq-trigger-icon');return {background:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow,blur:s.backdropFilter,size:g.getBoundingClientRect().width,viewBox:g.getAttribute('viewBox'),stroke:g.getAttribute('stroke-width')}});
    assert.deepEqual(style,{background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none',blur:'none',size:20,viewBox:'0 0 20 20',stroke:'1.33'});
    for(const remaining of [0,50,100]){
      await update(page,payload(100-remaining));
      const pose=await needle.evaluate(el=>{const p=new DOMPoint(10,7).matrixTransform(el.getCTM());return {x:p.x,y:p.y,remaining:Number(el.dataset.remaining),hidden:el.hasAttribute('hidden')}});
      assert.equal(pose.remaining,remaining);assert.equal(pose.hidden,false);
      assert.ok(Math.abs(pose.x-({0:6,50:10,100:14}[remaining]))<.01);assert.ok(Math.abs(pose.y-(remaining===50?7:11))<.01);
      assert.equal(await identity.evaluate(el=>el===document.querySelector('.cq-gauge-needle')),true);
    }
    await update(page,{planName:'plus',windows:[{label:'Weekly',usedPercent:20,resetAt:Date.now()/1000+302400},{label:'5h',usedPercent:85,resetAt:Date.now()/1000+9000}]});
    assert.equal(await needle.getAttribute('data-remaining'),'15');assert.match(await trigger.getAttribute('title'),/指针: 5h 剩余可用 15%/);
    await update(page,{errorCode:'RATE_LIMITED',retryAfterSeconds:120});
    assert.equal(await needle.getAttribute('data-remaining'),'15');assert.match(await trigger.getAttribute('title'),/更新失败.*上次成功/);
    await page.evaluate(()=>__codexQuotaResetSession());
    assert.equal(await needle.getAttribute('hidden'),'');assert.equal(await needle.getAttribute('data-remaining'),null);
    await update(page,payload(50));await page.emulateMedia({reducedMotion:'no-preference'});
    await update(page,payload(0));await page.waitForTimeout(50);
    const halfway=await needle.evaluate(el=>new DOMPoint(10,7).matrixTransform(el.getCTM()).x);assert.ok(halfway>10&&halfway<14,'needle moves through intermediate positions');
    await update(page,payload(100));await page.waitForTimeout(270);
    assert.ok(Math.abs(await needle.evaluate(el=>new DOMPoint(10,7).matrixTransform(el.getCTM()).x)-6)<.01);
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await needle.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  }finally{await close(page);}
});

test('official used bars and time rings derive independently from real timestamps',async()=>{
  const page=await pageFor();try{
    await open(page);const now=1900000000;await page.evaluate(now=>Date.now=()=>now*1000,now);
    for(const elapsed of [0,50,100]){
      await update(page,{planName:'plus',windows:[{label:'5h',usedPercent:1,resetAt:now+18000*(1-elapsed/100)},{label:'Weekly',usedPercent:3,resetAt:now+604800*(1-elapsed/100)}]});
      assert.equal(await page.locator('#codex-quota-trigger .cq-ring-fill').count(),1);
      assert.equal(await page.locator('#codex-quota-popover .cq-ring-fill').count(),2);
      for(const fill of await page.locator('.cq-ring-fill').all())assert.deepEqual((await fill.getAttribute('stroke-dasharray')).split(' ').map(Number),[elapsed,100-elapsed]);
      assert.deepEqual(await page.locator('.cq-rule').evaluateAll(els=>els.map(el=>el.getAttribute('aria-valuenow'))),['3','1']);
      for(const fill of await page.locator('.cq-progress-fill').all())assert.ok((await fill.boundingBox()).width>=3);
      assert.equal(await page.locator('.cq-rule').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 216, 196)');
      assert.equal(await page.locator('.cq-progress-fill').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(142, 70, 23)');
      for(const ring of await page.locator('.cq-time-ring').all()){
        assert.equal((await ring.boundingBox()).width,await ring.evaluate(el=>el.closest('[data-cq-secondary]')?9:10));assert.equal(await ring.locator('.cq-ring-track').evaluate(el=>getComputedStyle(el).strokeWidth),'2.75px');
      }
      for(const number of await page.locator('.cq-value-number,.cq-trigger-graphics [data-cq-window]').all())assert.equal(await number.evaluate(el=>getComputedStyle(el).fontWeight),'600');
      assert.equal(await page.locator('.cq-value-label').first().evaluate(el=>getComputedStyle(el).fontWeight),'400');
    }
    await update(page,{planName:'team',windows:[{label:'Daily',usedPercent:12,resetAt:now+2000},{label:'Monthly',usedPercent:27,resetAt:now+3000},{label:'Weekly',usedPercent:97,resetAt:now+4000}]});
    assert.equal(await page.locator('.cq-quota-row').count(),3);assert.equal(await page.locator('.cq-time-ring').count(),1);assert.match(await page.locator('.cq-value-group .cq-low:not([hidden])').innerText(),/剩余可用 3%/);
  }finally{await close(page);}
});

test('quota fills interpolate without layout animation and hidden cancellation stays safe',async()=>{
  const data={planName:'pro',windows:[{label:'Weekly',usedPercent:16,resetAt:Date.now()/1000+302400}]};
  const page=await pageFor(data,{width:1024,height:720},{reducedMotion:'no-preference'});try{
    await open(page);await finishAnimations(page);
    const fill=page.locator('.cq-quota-row .cq-progress-fill');const previous=(await fill.boundingBox()).width;
    await page.evaluate(data=>__codexQuotaUpdateOfficial({...data,windows:[{...data.windows[0],usedPercent:55}]}),data);
    const middle=await fill.evaluate(el=>{
      const motion=el.getAnimations()[0];motion.pause();motion.currentTime=100;
      const result={width:el.getBoundingClientRect().width,target:parseFloat(getComputedStyle(el).width),keys:motion.effect.getKeyframes().flatMap(frame=>Object.keys(frame))};motion.play();return result;
    });
    assert.ok(middle.width>previous&&middle.width<middle.target,'the displayed fill moves continuously between real values');
    assert.ok(middle.keys.includes('transform'));assert.equal(middle.keys.includes('width'),false,'intermediate frames must not relayout the track');
    await page.evaluate(()=>{document.getElementById('codex-official-usage-host').hidden=true;__codexQuotaResetSession();});
    assert.deepEqual(page.errors,[],'reset safely cancels a finite animation after its target becomes unrendered');
    await update(page,data);
    const inactive=await page.locator('.cq-quota-row .cq-progress-fill').evaluate(el=>el.getAnimations().length);
    assert.equal(inactive,0,'hidden quota changes update final values without invisible animations');
  }finally{await close(page);}
});

test('X focal rows preserve window identity, elapsed clocks and semantics at narrow widths',async()=>{
  const page=await pageFor();try{
    await open(page);
    const now=Date.now();await page.clock.install({time:new Date(now)});await page.clock.pauseAt(new Date(now+1000));
    const data={planName:'plus',windows:[{label:'5h',usedPercent:28,resetAt:now/1000+18000*.25},{label:'Weekly',usedPercent:63,resetAt:now/1000+604800*.75}]};
    await update(page,data);
    const rows=page.locator('.cq-quota-row');
    assert.deepEqual(await rows.evaluateAll(els=>els.map(el=>el.dataset.cqWindow)),['Weekly','5h']);
    assert.equal(await rows.first().locator('.cq-label').innerText(),'本周 · 已用');
    assert.equal(await rows.first().locator('.cq-value-number').evaluate(el=>getComputedStyle(el).fontSize),'20px');
    assert.equal(await rows.nth(1).locator('.cq-value-number').evaluate(el=>getComputedStyle(el).fontSize),'13px');
    assert.equal(await rows.first().locator('.cq-value-percent').evaluate(el=>getComputedStyle(el).fontSize),'11px');
    assert.equal(await page.locator('.cq-reset-suffix').first().innerText(),'重置');
    assert.equal(await page.locator('.cq-status').count(),0);assert.equal(await page.locator('.cq-collapse-button').count(),1);
    for(const advance of [0,60000,'restore']){
      if(advance==='restore'){
        await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
        await page.clock.fastForward(60000);
        await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
      }else if(advance)await page.clock.fastForward(advance);
      for(const [index,label,duration] of [[0,'Weekly',604800],[1,'5h',18000]]){
        const row=rows.nth(index),item=data.windows.find(w=>w.label===label);
        const expected=await page.evaluate(({resetAt,duration})=>(1-(resetAt-Date.now()/1000)/duration)*100,{resetAt:item.resetAt,duration});
        assert.ok(Math.abs(Number((await row.locator('.cq-ring-fill').getAttribute('stroke-dasharray')).split(' ')[0])-expected)<.001,`${label} clock must stay paired after reorder`);
        assert.equal(await row.locator('.cq-rule').getAttribute('aria-valuenow'),String(item.usedPercent));
      }
    }
    await page.clock.resume();
    for(const locale of ['zh-CN','en-US']){
      if(locale==='en-US'){
        await page.evaluate(()=>Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'en-US'}));await page.evaluate(source);await settle(page);
      }
      for(const used of [63,100]){
        await update(page,{...data,windows:data.windows.map(w=>({...w,usedPercent:used}))});
        for(const width of [238,220,140]){
          await page.locator('.sidebar-navigation').evaluate((el,width)=>el.style.width=width+'px',width);await settle(page);
          const overflow=await rows.evaluateAll(els=>els.map(el=>({client:el.clientWidth,scroll:el.scrollWidth})));
          assert.ok(overflow.every(r=>r.scroll<=r.client+1),`focal rows must fit ${locale} ${used}% at ${width}px: ${JSON.stringify(overflow)}`);
          const g=await geometry(page);assert.ok(g.popup.left>=g.column.left&&g.popup.right<=g.column.right);
        }
      }
    }
  }finally{await close(page);}
});

test('reinjection removes retired API state and can only request official quota',async()=>{
  const page=await pageFor();try{
    await page.evaluate(()=>{
      __codexQuotaApiPayload={remaining:75,total:100};__codexQuotaApiLoaded=true;
      __codexQuotaApiRequestTimer=setTimeout(()=>{throw new Error('retired API timer ran');},60000);
      __codexQuotaUpdateApi=()=>{};
      document.body.insertAdjacentHTML('beforeend','<div id="codex-api-usage-host">stale API balance</div>');
      requests=[];console.info=(marker,id)=>requests.push({marker,id});
    });
    await page.evaluate(source);await settle(page);
    assert.deepEqual(await page.evaluate(()=>Object.keys(globalThis).filter(key=>key.startsWith('__codexQuotaApi')||key==='__codexQuotaUpdateApi')),[]);
    assert.equal(await page.locator('#codex-api-usage-host').count(),0);
    assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-kind'),'official');
    await open(page);await page.locator('.cq-refresh').click();
    assert.deepEqual(await page.evaluate(()=>requests.map(request=>request.marker)),['__codexQuotaOfficialRequest__']);
    await update(page,officialPayload());
  }finally{await close(page);}
});

test('unavailable and invalid responses never invent zero or erase previous successful data',async()=>{
  const page=await pageFor(null);try{
    await open(page);
    assert.match(await page.locator('#codex-quota-trigger').innerText(),/暂不可用/);assert.equal(await page.locator('.cq-rule').count(),0);assert.equal(await page.locator('#codex-quota-trigger .cq-time-ring,.cq-trigger-weekly-bar').count(),0);
    await update(page,officialPayload());
    assert.equal(await page.locator('.cq-status').count(),0);assert.equal(await page.locator('.cq-refresh').getAttribute('aria-describedby'),null);
    const readyHeight=(await geometry(page)).popup.height;assert.equal(await page.locator('.cq-title').innerText(),'额度');
    const summary=await page.locator('#codex-quota-trigger').innerText();
    for(const data of [{errorCode:'AUTH_REQUIRED'},{errorCode:'RATE_LIMITED',retryAfterSeconds:60},{errorCode:'REQUEST_TIMEOUT'},{planName:'pro',windows:[{label:'Weekly',usedPercent:NaN,resetAt:10}]}]){
      await update(page,data);assert.equal(await page.locator('#codex-quota-trigger').innerText(),summary);assert.match(await page.locator('.cq-status').innerText(),/更新失败.*上次成功/s);
      assert.equal(await page.locator('.cq-title').innerText(),'更新失败');assert.equal((await geometry(page)).popup.height,readyHeight,'errors must not add a row or change height');
      assert.equal(await page.locator('.cq-status').evaluate(el=>getComputedStyle(el).clipPath),'inset(50%)');
      await page.locator('.cq-refresh').focus();assert.match(await page.locator('#cq-refresh-message').innerText(),/更新失败.*上次成功/s);await page.locator('.cq-settings-button').focus();
    }
    await update(page,officialPayload());assert.equal(await page.locator('.cq-title').innerText(),'额度');assert.equal(await page.locator('.cq-status').count(),0);
  }finally{await close(page);}
});

test('refresh icons preserve continuous native motion and crossfade real results without scaling buttons',async()=>{
  const page=await pageFor({planName:'pro',windows:[{label:'Weekly',usedPercent:11,resetAt:Date.now()/1000+302400}]});try{
    await open(page);await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);
    const refresh=page.locator('.cq-refresh'),spinner=refresh.locator('.cq-refresh-icon');
    assert.equal(await spinner.evaluate(el=>el.tagName),'SPAN','an HTML layer owns native rotation');
    const layers=refresh.locator('.cq-refresh-idle,.cq-refresh-icon,.cq-refresh-done,.cq-refresh-warning');
    assert.equal(await layers.count(),4);
    const layout=await layers.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {display:getComputedStyle(el).display,cx:r.left+r.width/2,cy:r.top+r.height/2}}));
    assert.ok(layout.every(layer=>layer.display!=='none'&&Math.abs(layer.cx-layout[0].cx)<.1&&Math.abs(layer.cy-layout[0].cy)<.1),'all glyph layers occupy the same fixed slot');
    await page.evaluate(()=>{requests=[];replyImmediately=true;console.info=(marker,id)=>{requests.push({marker,id});if(replyImmediately&&marker==='__codexQuotaOfficialRequest__')__codexQuotaUpdateOfficial(__codexQuotaOfficialPayload,id);};});
    const box=await refresh.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(35);
    assert.equal(await refresh.evaluate(el=>getComputedStyle(el).transform),'none');assert.equal((await refresh.boundingBox()).width,24);
    await page.mouse.up();assert.equal(await refresh.getAttribute('data-cq-refreshed'),'unchanged','a synchronous real response must still show its result');assert.equal(await refresh.isDisabled(),false);
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.cq-refresh-done')).opacity)>.95);
    assert.match(await refresh.getAttribute('aria-label'),/额度未变化/);
    const settings=page.locator('.cq-settings-button'),settingsBox=await settings.boundingBox();await page.mouse.move(settingsBox.x+12,settingsBox.y+12);await page.mouse.down();await page.waitForTimeout(35);
    assert.equal(await settings.evaluate(el=>getComputedStyle(el).transform),'none');assert.equal((await settings.boundingBox()).width,24);await page.mouse.move(settingsBox.x-30,settingsBox.y);await page.mouse.up();
    await page.evaluate(()=>replyImmediately=false);await refresh.click();await page.waitForTimeout(160);
    assert.equal(await refresh.isDisabled(),true);
    const spin=await spinner.evaluateHandle(el=>el.getAnimations().find(a=>a.effect.getKeyframes().some(frame=>frame.transform!==undefined)));
    assert.equal(await spin.evaluate(animation=>animation?.playState),'running');const beforeTime=await spin.evaluate(animation=>animation.currentTime);
    await page.evaluate(()=>document.documentElement.classList.add('refresh-rerender'));await settle(page);
    assert.equal(await spin.evaluate(animation=>document.querySelector('.cq-refresh-icon').getAnimations().includes(animation)),true,'same-busy rerender must reuse the active spin');
    assert.ok(await spin.evaluate(animation=>animation.currentTime)>beforeTime,'same-busy rerender preserves the animation clock');
    const mutations=await spinner.evaluateHandle(el=>{const probe={count:0};probe.observer=new MutationObserver(records=>probe.count+=records.length);probe.observer.observe(el,{subtree:true,attributes:true,attributeFilter:['style']});return probe;});
    await page.waitForTimeout(120);assert.equal(await mutations.evaluate(probe=>{const count=probe.count+probe.observer.takeRecords().length;probe.observer.disconnect();return count;}),0,'native spinner must not write per-frame styles');await mutations.dispose();
    const completed=await page.evaluate(()=>{const button=document.querySelector('.cq-refresh'),glyph=button.querySelector('.cq-refresh-icon'),before=getComputedStyle(glyph).transform;__codexQuotaUpdateOfficial({...__codexQuotaOfficialPayload,windows:__codexQuotaOfficialPayload.windows.map(w=>({...w,usedPercent:42}))},globalThis.__codexQuotaOfficialRequestId);return {before,after:getComputedStyle(glyph).transform,result:button.dataset.cqRefreshed};});
    assert.equal(completed.result,'updated');assert.notEqual(completed.before,'none');assert.equal(completed.after,completed.before,'busy completion keeps the current angle until the rotating layer fades out');
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const crossfade=await layers.evaluateAll(els=>{const transitions=els.flatMap(el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(frame=>frame.opacity!==undefined)));for(const a of transitions){a.pause();a.currentTime=Number(a.effect.getTiming().duration)/2;}const result={transitions:transitions.length,layers:els.map(el=>({name:el.getAttribute('class'),opacity:Number(getComputedStyle(el).opacity),display:getComputedStyle(el).display}))};for(const a of transitions)a.play();return result;});
    assert.ok(crossfade.transitions>=2,'busy and result glyphs crossfade');
    for(const name of ['cq-refresh-icon','cq-refresh-done']){const layer=crossfade.layers.find(layer=>layer.name.includes(name));assert.ok(layer.opacity>0&&layer.opacity<1,`${name} remains visible through the handoff`);}
    assert.ok(crossfade.layers.every(layer=>layer.display!=='none'));
    await page.waitForFunction(()=>{const glyph=document.querySelector('.cq-refresh-icon');return Number(getComputedStyle(glyph).opacity)===0&&!glyph.getAnimations().some(a=>a.effect.getKeyframes().some(frame=>frame.transform!==undefined));});
    assert.equal(await spinner.evaluate(el=>el.style.transform),'');await spin.dispose();
    await refresh.click();await page.waitForTimeout(120);assert.equal(await refresh.isDisabled(),true);
    const rotating=()=>spinner.evaluate(el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(frame=>frame.transform!==undefined)).length);
    assert.equal(await rotating(),1);await page.emulateMedia({reducedMotion:'reduce'});await settle(page);assert.equal(await rotating(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);assert.equal(await rotating(),1);
    const hiddenCount=await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));return document.querySelector('.cq-refresh-icon').getAnimations().filter(a=>a.effect.getKeyframes().some(frame=>frame.transform!==undefined)).length;});assert.equal(hiddenCount,0);
    await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await settle(page);assert.equal(await rotating(),1);
    const closeCount=await page.evaluate(()=>{document.getElementById('codex-quota-popover').hidePopover();return document.querySelector('.cq-refresh-icon').getAnimations().filter(a=>a.effect.getKeyframes().some(frame=>frame.transform!==undefined)).length;});assert.equal(closeCount,0,'closing immediately stops the spinner even while the surface animates');
    await page.emulateMedia({reducedMotion:'reduce'});await settle(page);await open(page);
    await update(page,{errorCode:'AUTH_REQUIRED'});assert.equal(await refresh.isDisabled(),false);assert.match(await refresh.getAttribute('aria-label'),/更新失败.*上次成功/);
    assert.equal(await refresh.locator('.cq-refresh-warning').evaluate(el=>getComputedStyle(el).opacity),'1');assert.equal(await refresh.locator('.cq-refresh-done').evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await page.locator('.cq-value-digits').innerText(),'42','failed refresh retains the last successful value');
  }finally{await close(page);}
});

test('hidden quota updates and settings preserve safe motion lifecycle and Back navigation',async()=>{
  const data={planName:'pro',windows:[{label:'Weekly',usedPercent:14,resetAt:Date.now()/1000+302400}]};
  const page=await pageFor(data,{width:1024,height:720},{reducedMotion:'no-preference'});try{
    await update(page,{...data,windows:[{...data.windows[0],usedPercent:42}]});await page.waitForTimeout(260);
    assert.deepEqual(page.errors,[],'updating a closed card must not commit styles on an unrendered element');
    await open(page);await finishAnimations(page);
    assert.equal(await page.locator('.cq-value-digits').innerText(),'42','opening shows the latest hidden update');
    await page.locator('.cq-refresh').click();await page.waitForTimeout(160);
    const spinning=()=>page.locator('.cq-refresh-icon').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running'&&a.effect.getKeyframes().some(f=>f.transform!==undefined)).length);
    assert.equal(await spinning(),1);
    await page.locator('.cq-settings-button').click();await page.waitForTimeout(220);
    assert.equal(await spinning(),0,'a refresh indicator must not spin behind the settings pane');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
    await page.locator('#cq-settings header button').click();await finishAnimations(page);
    assert.equal(await page.locator('.cq-refresh').isDisabled(),true);assert.equal(await spinning(),1,'returning to a still-busy card resumes the indicator');
    await page.locator('.cq-settings-button').click();await page.waitForTimeout(220);
    await page.locator('input[name=thresholds]').fill('0');await page.locator('input[name=hour12]').click();
    assert.equal(await page.locator('input[name=thresholds]').evaluate(el=>el.validity.valid),false);
    await page.locator('#cq-settings header button').click();await finishAnimations(page);
    assert.equal(await page.locator('#cq-settings').count(),0,'Back must remain usable with an invalid unsaved threshold');
    assert.equal(await spinning(),1);
  }finally{await close(page);}
});

test('request deadlines, cooldown, late responses and reinjection keep existing request isolation',async()=>{
  const page=await pageFor();try{
    await open(page);const now=Date.now();await page.clock.install({time:new Date(now)});await page.clock.pauseAt(new Date(now+1000));
    await page.evaluate(()=>{requests=[];console.info=(marker,id)=>requests.push({marker,id})});
    const prior=await page.locator('#codex-quota-trigger').innerText();
    const readyHeight=(await geometry(page)).popup.height;
    await page.locator('.cq-refresh').evaluate(el=>el.click());
    assert.equal(await page.locator('.cq-title').innerText(),'刷新中…');assert.equal((await geometry(page)).popup.height,readyHeight,'refresh must not change height');
    const first=await page.evaluate(()=>({id:__codexQuotaOfficialRequestId,deadline:__codexQuotaOfficialRequestDeadline}));
    await page.clock.fastForward(10000);await page.evaluate(source);
    assert.equal(await page.evaluate(()=>__codexQuotaOfficialRequestDeadline),first.deadline);assert.equal(await page.evaluate(()=>requests.length),1);
    await page.clock.fastForward(15000);assert.equal(await page.locator('.cq-refresh').isDisabled(),false);assert.match(await page.locator('.cq-status').innerText(),/更新失败.*超时/);assert.equal(await page.locator('#codex-quota-trigger').innerText(),prior);
    await page.locator('.cq-refresh').evaluate(el=>el.click());
    const second=await page.evaluate(()=>__codexQuotaOfficialRequestId);assert.notEqual(second,first.id);
    await page.evaluate(id=>__codexQuotaUpdateOfficial({errorCode:'AUTH_REQUIRED'},id),first.id);assert.equal(await page.locator('.cq-refresh').isDisabled(),true);
    await update(page,officialPayload());assert.equal(await page.locator('.cq-refresh').isDisabled(),false);
    assert.equal(await page.locator('.cq-status').count(),0);assert.equal(await page.locator('.cq-refresh').getAttribute('data-cq-refreshed'),'unchanged');
    const successfulRequests=await page.evaluate(()=>requests.length);
    await page.clock.fastForward(1999);assert.equal(await page.locator('.cq-status').count(),0);assert.equal(await page.locator('.cq-refresh').getAttribute('data-cq-refreshed'),'unchanged');
    await page.clock.fastForward(1);assert.equal(await page.locator('.cq-status').count(),0);assert.equal(await page.locator('.cq-refresh').getAttribute('data-cq-refreshed'),null);
    assert.equal(await page.evaluate(()=>requests.length),successfulRequests,'feedback expiry must not request data');
    await update(page,{errorCode:'RATE_LIMITED',retryAfterSeconds:120});const count=await page.evaluate(()=>requests.length);
    await page.locator('.cq-refresh').evaluate(el=>el.click());assert.equal(await page.evaluate(()=>requests.length),count);assert.match(await page.locator('.cq-status').innerText(),/更新失败.*上次成功/s);
    await page.clock.fastForward(120000);assert.equal(await page.evaluate(()=>requests.length),count+1);
  }finally{await close(page);}
});

test('long official cooldowns keep the server deadline without overflowing browser timers',async()=>{
  const page=await pageFor();try{
    const scheduled=await page.evaluate(()=>{
      globalThis.cooldownSchedules=[];const original=setTimeout;
      globalThis.setTimeout=(callback,delay,...args)=>{cooldownSchedules.push(delay);return original(callback,delay,...args);};
      const now=Date.now();__codexQuotaUpdateOfficial({errorCode:'RATE_LIMITED',retryAfterSeconds:3000000});
      return {delay:cooldownSchedules[0],until:__codexQuotaOfficialCooldownUntil,now};
    });
    assert.ok(scheduled.delay>0&&scheduled.delay<=2147483647,'each timer delay must fit the browser signed 32-bit millisecond range');
    assert.ok(scheduled.until-scheduled.now>=3000000000,'capping one timer must not shorten the server cooldown');
    await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>cooldownSchedules.length),1,'long cooldown must sleep instead of spinning an overflow loop');
  }finally{await close(page);}
});

test('entry and popover clocks advance while closed and cooling down, then catch up after visibility restore',async()=>{
  const page=await pageFor();try{
    const now=Date.now();await page.clock.install({time:new Date(now)});await page.clock.pauseAt(new Date(now+1000));
    const resetAt=await page.evaluate(()=>Date.now()/1000+302400);
    await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:24,resetAt}]});
    await update(page,{errorCode:'RATE_LIMITED',retryAfterSeconds:7200});
    await page.evaluate(()=>{requests=[];console.info=(marker,id)=>requests.push({marker,id})});
    assert.equal(await page.locator('#codex-quota-popover').isVisible(),false);
    const entry=page.locator('#codex-quota-trigger .cq-ring-fill'),detail=page.locator('#codex-quota-popover .cq-ring-fill');
    const initial=Number((await entry.getAttribute('stroke-dasharray')).split(' ')[0]);
    await page.clock.fastForward(60000);
    const elapsed=Number((await entry.getAttribute('stroke-dasharray')).split(' ')[0]);
    assert.ok(elapsed>initial,'the closed entry must advance without a quota response');assert.equal(await entry.getAttribute('stroke-dasharray'),await detail.getAttribute('stroke-dasharray'));
    assert.equal(await page.evaluate(()=>requests.length),0);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>__codexQuotaAutoRefreshTimer),null);
    await page.clock.fastForward(3600000);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    const expected=await page.evaluate(resetAt=>(1-(resetAt-Date.now()/1000)/604800)*100,resetAt);
    assert.ok(Math.abs(Number((await entry.getAttribute('stroke-dasharray')).split(' ')[0])-expected)<1e-6);
    assert.equal(await entry.getAttribute('stroke-dasharray'),await detail.getAttribute('stroke-dasharray'));assert.equal(await page.evaluate(()=>requests.length),0);assert.equal(await page.evaluate(()=>__codexQuotaOfficialNeedsData),false);
    await page.evaluate(()=>{__codexQuotaOfficialCooldownUntil=0;document.querySelector('.cq-refresh').click();});await page.clock.fastForward(26000);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.match(await page.locator('.cq-status').innerText(),/超时/);
  }finally{await close(page);}
});

test('session switch clears old values immediately, even while collapsed or settings open',async()=>{
  const page=await pageFor();try{
    await open(page);await page.locator('.cq-settings-button').click();await page.evaluate(()=>__codexQuotaResetSession());
    assert.equal(await page.locator('#codex-quota-popover').isVisible(),false);assert.match(await page.locator('#codex-quota-trigger').innerText(),/暂不可用/);assert.equal(await page.locator('.cq-value').count(),0);
    assert.equal(await page.locator('#codex-quota-trigger .cq-time-ring,.cq-trigger-weekly-bar').count(),0);assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-graphical'),null);
    assert.equal(await page.locator('.cq-trigger-plan').isVisible(),false);assert.equal(await page.locator('.cq-trigger-plan').getAttribute('data-cq-tier'),null);
    assert.equal(await page.locator('.cq-plan').textContent(),'');
    await open(page);assert.match(await page.locator('#codex-quota-popover').innerText(),/暂不可用/);assert.equal(await page.locator('.cq-settings-button').isVisible(),true);
    await page.locator('#collapse').click();await settle(page);await page.evaluate(()=>__codexQuotaSessionScope='new-official-session');await page.evaluate(source);await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:41,resetAt:Date.now()/1000+302400}]});await open(page);
    assert.equal(await page.locator('#codex-official-usage-host').count(),1);assert.equal(await page.locator('.cq-value-digits').innerText(),'41');assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-kind'),'official');
  }finally{await close(page);}
});

test('host replacement, missing anchors and native data preserve a single recoverable entry',async()=>{
  const page=await pageFor();try{
    const handle=await page.locator('#codex-quota-trigger').elementHandle();
    await page.evaluate(()=>{savedRail=document.querySelector('[data-app-navigation-rail]');savedRail.remove()});await settle(page);
    await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:40,resetAt:Date.now()/1000+302400}]});assert.equal(await page.locator('#codex-quota-trigger').isVisible(),false);
    await page.evaluate(()=>document.body.prepend(savedRail));await settle(page);assert.equal(await handle.evaluate(el=>el.isConnected),true);assert.match(await page.locator('#codex-quota-trigger').getAttribute('aria-label'),/40%/);
    await page.evaluate(()=>{const c=document.querySelector('.sidebar-navigation');const copy=c.cloneNode(true);copy.querySelector('#codex-quota-footer')?.remove();c.replaceWith(copy)});await settle(page);assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true);assert.equal(await handle.evaluate(el=>el.isConnected),true);assert.equal(await page.locator('#codex-quota-popover').count(),1);await open(page);assert.equal(await page.locator('.cq-value-digits').innerText(),'40');
    await page.evaluate(()=>{document.getElementById('avatar').outerHTML='<svg id="avatar" width="22" height="22"><circle r="8" cx="11" cy="11"/></svg>'});await settle(page);assert.equal(await page.locator('#codex-quota-trigger').isVisible(),true);
  }finally{await close(page);}
});

test('chat streaming and our own renders settle without observer loops',async()=>{
  const page=await pageFor();try{
    const n=await page.evaluate(()=>layoutScans);
    for(let i=0;i<20;i++)await page.locator('#chat').evaluate(el=>el.append(document.createElement('span')));
    await settle(page);assert.equal(await page.evaluate(()=>layoutScans),n);
    await update(page,officialPayload());await settle(page);const after=await page.evaluate(()=>layoutScans);await settle(page);assert.equal(await page.evaluate(()=>layoutScans),after);
    await page.evaluate(()=>{document.documentElement.className='host-no-op';const style=document.createElement('style');style.id='host-no-op-style';style.textContent=':root{--color-text:#234567}';document.head.append(style);});
    await settle(page);const beforeNoOps=await page.evaluate(()=>layoutScans);
    for(let i=0;i<20;i++)await page.evaluate(()=>{document.documentElement.className=document.documentElement.className;const style=document.getElementById('host-no-op-style');style.textContent=style.textContent;style.firstChild.data=style.firstChild.data;});
    await settle(page);assert.equal(await page.evaluate(()=>layoutScans),beforeNoOps,'same-value host attributes and stylesheet text replacements must not cause layout scans');
    await page.evaluate(()=>{document.documentElement.classList.add('dark');document.getElementById('host-no-op-style').firstChild.data=':root{--color-text:#345678}';});
    await settle(page);assert.ok(await page.evaluate(()=>layoutScans)>beforeNoOps,'real host theme and stylesheet changes remain observable');
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>getComputedStyle(el).color),'rgb(52, 86, 120)');
    assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-dark'),'');
  }finally{await close(page);}
});

test('host surface tokens drive official quota, including dark and forced colors',async()=>{
  const page=await pageFor();try{
    await page.locator('[data-app-navigation-rail]').evaluate(el=>{el.style.setProperty('--radius-2xl','18px');el.style.setProperty('--radius-sm','9px')});
    await settle(page);
    const trigger=await page.locator('#codex-quota-trigger').evaluate(el=>{const s=getComputedStyle(el);return {blur:s.backdropFilter,border:s.borderTopStyle,width:parseFloat(s.borderTopWidth)}});
    assert.equal(trigger.blur,'blur(18px)');assert.equal(trigger.border,'solid');assert.ok(trigger.width>0);
    assert.deepEqual(await page.locator('#codex-quota-trigger,#codex-quota-popover').evaluateAll(els=>els.map(el=>getComputedStyle(el).borderRadius)),['9px','9px']);
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>getComputedStyle(el).backdropFilter),'blur(8px)');
    assert.equal(await page.locator('#codex-quota-popover').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth)),0);
    await open(page);await page.addStyleTag({content:':root{color-scheme:dark;--color-surface-elevated-secondary:#272a23;--color-text:#f1f3e8;--color-text-secondary:#c7cbbb;--color-border:#42473a}'});await settle(page);
    const colors=await page.locator('#codex-quota-popover').evaluate(el=>{const sample=document.createElement('span');sample.style.background='color-mix(in srgb, rgb(39, 42, 35) 90%, transparent)';el.append(sample);const expected=getComputedStyle(sample).backgroundColor;sample.remove();const s=getComputedStyle(el);return {background:s.backgroundColor,expected,color:s.color,blur:s.backdropFilter}});
    assert.equal(colors.background,colors.expected);assert.equal(colors.color,'rgb(241, 243, 232)');assert.equal(colors.blur,'blur(8px)');
    await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:59,resetAt:Date.now()/1000+302400}]});
    await page.emulateMedia({forcedColors:'active'});
    const forced=await page.locator('#codex-quota-popover').evaluate(el=>{const s=getComputedStyle(el);return {shadow:s.boxShadow,blur:s.backdropFilter,border:parseFloat(s.borderTopWidth),background:s.backgroundColor}});
    assert.equal(forced.shadow,'none');assert.equal(forced.blur,'none');assert.ok(forced.border>0);assert.match(forced.background,/^rgb\(/);
    assert.equal(await page.locator('#codex-quota-trigger').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
    assert.deepEqual(await page.locator('.cq-trigger-plan').evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundImage,shadow:s.boxShadow,textShadow:s.textShadow,distinct:s.color!==s.backgroundColor};}),{background:'none',shadow:'none',textShadow:'none',distinct:true});
  }finally{await close(page);}
});

test('late notification permission cannot override a newer toggle or resurrect a disposed settings view',async()=>{
  for(const action of ['turn-off','other-window','reinjection','leave-settings']){
    const {context,pages:[page,other]}=await sharedPages(action==='other-window'?2:1);try{
      await update(page,officialPayload());await open(page);await page.locator('.cq-settings-button').click();
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

test('self-drawn switches survive host reset, keyboard use, rejected notifications and synced preferences',async()=>{
  const {context,pages:[page,other]}=await sharedPages(2);try{
    await page.addStyleTag({content:'input[type=checkbox]{appearance:none;background:transparent;border:0}'});
    await update(page,officialPayload());await open(page);await page.locator('.cq-settings-button').click();
    assert.equal(await page.locator('#cq-settings input[type=checkbox][role=switch]').count(),4);
    for(const track of await page.locator('.cq-switch-track').all()){
      assert.equal(await track.isVisible(),true);const box=await track.boundingBox();assert.equal(box.width,28);assert.equal(box.height,16);
      assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').width),'12px');assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').height),'12px');
    }
    const hour12=page.locator('[name=hour12]'),track=page.locator('[name=hour12] + .cq-switch-track');
    const off=await track.evaluate(el=>getComputedStyle(el).backgroundColor);
    await hour12.focus();await page.keyboard.press('Space');assert.equal(await hour12.isChecked(),true);
    assert.notEqual(await track.evaluate(el=>getComputedStyle(el).backgroundColor),off);
    assert.equal(await track.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el,'::after').transform).m41),12);
    assert.equal(await track.evaluate(el=>getComputedStyle(el).outlineWidth),'2px');
    assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').transitionDuration),'0s');
    await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await track.evaluate(el=>getComputedStyle(el,'::after').transitionDuration),'0.13s');await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=> 'denied'}));
    await page.locator('[name=system]').click();await page.waitForFunction(()=>document.querySelector('[name=system]').checked===false);
    assert.equal(await page.locator('[name=system] + .cq-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor),off);
    await other.evaluate(()=>{const key='codex-usage-card.settings.v2';localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)),hour12:false}));});
    await page.waitForFunction(()=>document.querySelector('[name=hour12]').checked===false);assert.equal(await track.evaluate(el=>getComputedStyle(el).backgroundColor),off);
    assert.equal(await track.evaluate(el=>{const transform=getComputedStyle(el,'::after').transform;return transform==='none'?0:new DOMMatrixReadOnly(transform).m41}),0);
    await hour12.check();
    assert.ok(await page.locator('.cq-tools').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth)>0));assert.equal(await page.locator('.cq-tools').evaluate(el=>getComputedStyle(el).fontSize),'11px');
    await page.emulateMedia({forcedColors:'active'});assert.equal(await track.isVisible(),true);
    assert.notEqual(await track.evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('[name=system] + .cq-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor));
    await page.emulateMedia({forcedColors:'none'});
    await page.locator('.cq-doctor').click();await page.evaluate(()=>__codexQuotaUpdateDiagnosis({CardVisible:false,StageCodes:['CARD_NOT_VISIBLE']}));assert.match(await page.locator('#cq-diagnosis').innerText(),/CARD_NOT_VISIBLE/);
    await page.locator('#cq-settings header button').click();assert.equal(await page.locator('.cq-settings-button').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(source);await page.locator('.cq-settings-button').click();assert.equal(await page.locator('[name=hour12]').isChecked(),true);assert.equal(await page.locator('#codex-quota-popover').count(),1);
  }finally{await context.close();}
});

test('real native text fallback never invents a timestamp or a second window',async()=>{
  const page=await browser.newPage({reducedMotion:'reduce'});try{
    await page.setContent(shell);await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<div id="native" role="status" class="rounded-2xl border bg-token-main-surface-primary"><progress max="100" value="20"></progress><span class="font-medium">80%</span><div class="text-sm text-token-text-secondary">Resets at 20:00</div></div>')});await setup(page,null);await open(page);
    assert.equal(await page.locator('#native').isVisible(),false);assert.match(await page.locator('.cq-value').innerText(),/20%/);assert.equal(await page.locator('.cq-ring-fill').getAttribute('stroke-dasharray'),null);
    assert.equal(await page.locator('#codex-quota-trigger').getAttribute('data-cq-graphical'),null);assert.equal(await page.locator('#codex-quota-trigger .cq-time-ring,.cq-trigger-weekly-bar').count(),0);
    await page.locator('#native progress').evaluate(el=>el.value=42);await settle(page);assert.match(await page.locator('.cq-value').innerText(),/42%/);
  }finally{await page.close();}
});

test('synthetic desktop and narrow captures for visual review',async()=>{
  const dir=join(__dirname,'../.runtime-test/sidebar-v3-verification');mkdirSync(dir,{recursive:true});
  for(const width of [1024,320]){
    const page=await pageFor(officialPayload(),{width,height:720});try{await open(page);await page.screenshot({path:join(dir,`light-${width}.png`)});await page.locator('.cq-settings-button').click();await page.screenshot({path:join(dir,`settings-${width}.png`)});}finally{await close(page);}
  }
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

test('recovery alerts work independently and queued old-session alerts are discarded', async () => {
  const {context, pages: [page]} = await sharedPages();
  try {
    await open(page);
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

test('queued alerts cannot survive a session reset or UI reinjection',async()=>{
  const {context,pages:[page]}=await sharedPages();try{
    for(const interruption of ['reset','reinjection']){
      await page.evaluate(()=>{
        localStorage.removeItem('codex-usage-card.alerts.v2');document.getElementById('cq-notice')?.remove();delete globalThis.releaseQuotaLock;
        void navigator.locks.request('codex-usage-card.alerts',()=>new Promise(resolve=>{globalThis.releaseQuotaLock=resolve;}));
      });
      await page.waitForFunction(()=>typeof releaseQuotaLock==='function');
      await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:95,resetAt:1900000000}]});
      if(interruption==='reset'){
        // Logout can reset the page before the helper supplies a new scope. A fast
        // success must not make a queued result from the previous lifecycle valid.
        await page.evaluate(()=>__codexQuotaResetSession());
        await update(page,{planName:'pro',windows:[{label:'Weekly',usedPercent:42,resetAt:1900000000}]});
      }else await page.evaluate(source);
      await page.evaluate(()=>releaseQuotaLock());await page.waitForTimeout(80);
      assert.equal(await page.locator('#cq-notice').count(),0,`${interruption} must discard the queued low-quota message`);
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('codex-usage-card.alerts.v2')||'{}').records?.Weekly?.sent||[]),[],'discarded results must not mark a threshold as delivered');
    }
  }finally{await context.close();}
});

test('a disposed installation retry cannot resurrect an older UI',async()=>{
  const page=await browser.newPage({reducedMotion:'reduce',locale:'zh-CN'});const errors=[];page.on('pageerror',e=>errors.push(e.message));try{
    await page.setContent(shell);
    const installed=await page.evaluate(source=>{
      globalThis.__codexQuotaMode='account';globalThis.__codexQuotaOfficialLoaded=true;
      const query=document.querySelectorAll;
      document.querySelectorAll=function(selector){if(selector==='nav[data-app-navigation-rail="true"]')throw new Error('synthetic temporary host failure');return query.call(this,selector);};
      const first=eval(source);document.querySelectorAll=query;
      const second=eval(source);return {first,second};
    },source);
    assert.deepEqual(installed,{first:false,second:true});
    await page.waitForTimeout(550);
    assert.equal(await page.locator('#codex-quota-trigger').count(),1,'an obsolete retry must not create a second entry');
    assert.equal(await page.locator('#codex-quota-popover').count(),1);
    assert.equal(await page.locator('[data-cq-ui]').getAttribute('data-cq-ui'),await page.evaluate(()=>String(__codexQuotaUiRevision)),'the latest successful UI must remain installed');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('cold document injection installs once and stays collapsed on reload', async()=>{
  const page=await browser.newPage({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.route('https://quota.test/**',r=>r.fulfill({contentType:'text/html',body:shell}));
    await page.addInitScript({content:"globalThis.__codexQuotaMode='account';globalThis.__codexQuotaOfficialLoaded=true;"+source+';'+source});
    await page.goto('https://quota.test/');await page.locator('#codex-quota-trigger').waitFor();
    assert.equal(await page.locator('#codex-quota-popover').count(),1);assert.equal(await page.locator('#codex-quota-popover').isVisible(),false);
    await page.reload();await page.locator('#codex-quota-trigger').waitFor();assert.equal(await page.locator('#codex-quota-trigger').count(),1);assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
