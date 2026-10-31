// Real Nolys UI; all Windows effects are simulated. Main actions and async edge regressions.
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.NOLYS_UI_URL || 'http://127.0.0.1:1420';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
const report={production:true,native:'simulated only',results:[],errors:[]};
const calls=[];let fail={},delay={},radios={wifi_control:'off',bluetooth_control:'off',dnd_control:'off'},applyRadio=true,volume=50;
let mic={config:{enabled:false,volume:60,balance:0},running:false,inputLevel:0,outputLevel:0};
let sessions=[{pid:42,name:'msedge.exe',title:'Synthetic browser',volume:60,muted:false}];
let stats={cpu:25,ram:60,diskFree:100*1024**3,diskTotal:500*1024**3};
const context=await browser.newContext({viewport:{width:720,height:600}});
await context.exposeBinding('__invoke',async(_,command,args={})=>{
 calls.push({command,args,time:Date.now()});const status=radios[command],snapshot=status&&args.action==='status'?status:command==='get_system_stats'?structuredClone(stats):null;
 const ms=typeof delay[command]==='function'?delay[command](args):delay[command];if(ms)await new Promise(r=>setTimeout(r,ms));
 if(fail[command]==='reject')throw Error('Synthetic failure');if(Object.hasOwn(fail,command))return fail[command];
 if(status){if(args.action==='status')return snapshot;if(applyRadio)radios[command]=args.action;return 'ok'}
 switch(command){
 case 'get_layout_state':return {layout:{scale:1},editMode:false};case 'get_displays':return [{id:'primary',label:'Écran principal'}];
 case 'get_update_status':return {state:'idle',currentVersion:'2.6.1',canCheck:false};
 case 'get_mic_monitor':return structuredClone(mic);case 'set_mic_monitor':mic={...mic,config:args.config};return structuredClone(mic);
 case 'get_system_volume':return volume;case 'set_system_volume':volume=args.volume;return true;
 case 'get_system_stats':return snapshot;case 'get_audio_sessions':return structuredClone(sessions);
 case 'set_session_volume':sessions.forEach(s=>{if(s.pid===args.payload.pid){s.volume=args.payload.volume;s.muted=args.payload.volume===0}});return true;
 case 'set_session_muted':sessions.forEach(s=>{if(s.pid===args.payload.pid)s.muted=args.payload.muted});return true;
 case 'get_weather':return {city:args.city,temperature:18,min:12,max:22,code:0,isDay:true};
 case 'library_get':return {tracks:[],playlists:[]};case 'get_audio_devices':case 'get_audio_input_devices':case 'register_shortcuts':return [];
 case 'launch_shortcut':return true;case 'config_changed':setTimeout(()=>page.evaluate(c=>window.__dispatch('config-changed',c),args.config).catch(()=>{}),5);return null;
 default:return null;
 }
});
await context.addInitScript(()=>{
 localStorage.setItem('liquid_tray_hint_shown','true');localStorage.setItem('liquid_sound_effects_enabled','false');localStorage.setItem('liquid_online_covers','false');
 const listeners=new Map();window.__dispatch=(c,p)=>{for(const cb of listeners.get(c)||[])cb({payload:p})};
 window.__TAURI__={core:{invoke:(c,a)=>window.__invoke(c,a),convertFileSrc:p=>p},webviewWindow:{getCurrentWebviewWindow:()=>({listen:async(c,cb)=>{listeners.set(c,[...(listeners.get(c)||[]),cb]);return()=>listeners.set(c,(listeners.get(c)||[]).filter(x=>x!==cb))},startDragging:async()=>{}})}};
 Object.defineProperty(navigator,'getBattery',{value:()=>Promise.reject(Error('Unavailable'))});
});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
async function test(name,fn){try{const detail=await fn();report.results.push({name,pass:true,detail});console.log('PASS',name,JSON.stringify(detail))}catch(e){report.results.push({name,pass:false,error:e.stack});console.log('FAIL',name,e.message)}}
const settled=()=>page.waitForFunction(()=>!window.island._transitionInProgress);
async function open(widget='launchpad'){await page.evaluate(widget=>{localStorage.setItem('liquid_control_widget_type',widget);window.island.openExpandedMode('menu')},widget);await settled();await page.evaluate(()=>window.island.openExpandedMode('control'));await settled();await page.locator('#ic-wifi').waitFor();await page.waitForTimeout(80)}
const count=(command,action)=>calls.filter(c=>c.command===command&&(action===undefined||c.args.action===action)).length;
async function fittedControlGeometry() {
 await page.waitForFunction(()=>{
  const el=window.island.el,widget=el.querySelector('.ic-widget');
  if(!widget)return false;
  const bottom=el.getBoundingClientRect().bottom-widget.getBoundingClientRect().bottom;
  const padding=parseFloat(getComputedStyle(el.querySelector('.island-control-container')).paddingBottom);
  const resizing=el.getAnimations().some(a=>a.playState==='running'&&['height','width'].includes(a.transitionProperty));
  return !resizing&&Math.abs(bottom-padding-parseFloat(getComputedStyle(el).borderBottomWidth))<1;
 });
 return page.evaluate(()=>{
  const el=window.island.el,rect=s=>el.querySelector(s).getBoundingClientRect();
  const toggles=rect('.ic-toggles-grid'),music=rect('.ic-now-playing-card'),widget=rect('.ic-widget'),volume=rect('#ic-volume-slider');
  return {height:el.getBoundingClientRect().height,gaps:[music.top-toggles.bottom,widget.top-music.bottom],bottomAlignment:volume.bottom-widget.bottom};
 });
}
try{
 await page.goto(`${base}/island/index.html`);await page.waitForFunction(()=>window.island?.localPlayer);await open();
 if(!process.argv.includes('--edges')){
 await test('eco pointer and keyboard toggles keep control open and outside click still closes',async()=>{
  try{
   for(const [enabled,key] of [[true,null],[false,'Space'],[true,'Enter'],[false,null]]){
    const button=page.locator('#ic-eco');await button.focus();
    if(key)await page.keyboard.press(key);else await button.click();
    await settled();
    assert.equal(await page.evaluate(()=>window.island.isExpanded),true,'eco toggle must keep the capsule open');
    assert.equal(await page.evaluate(()=>window.island.mode),'control');
    assert.equal(await page.locator('#ic-eco').getAttribute('aria-pressed'),String(enabled));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('eco-mode')),enabled);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'ic-eco','eco toggle retains keyboard focus');
   }
   await page.mouse.click(2,2);await settled();
   assert.equal(await page.evaluate(()=>window.island.isExpanded),false,'real outside click still closes');
  }finally{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('liquid-eco-mode-changed',{detail:false})));}
 });await open();
 await test('settings button opens control section',async()=>{await page.getByRole('button',{name:'Configurer le centre de contrôle',exact:true}).click();await page.getByRole('heading',{name:'Centre de contrôle',exact:true}).waitFor();return page.evaluate(()=>window.island.mode)});await open();
 await test('menu button navigates',async()=>{await page.getByRole('button',{name:'Menu des modules',exact:true}).click();await settled();assert.equal(await page.evaluate(()=>window.island.mode),'menu')});await open();
 await test('external media dispatch',async()=>{const mark=calls.length;for(const action of ['prev','toggle','next'])await page.locator(`[data-arg="${action}"]`).click();await page.waitForTimeout(70);const sent=calls.slice(mark).filter(c=>c.command==='media_control').map(c=>c.args.action);assert.equal(sent.length,3);assert.equal(sent[0],'prev');assert.equal(sent[2],'next');return sent});
 await test('local media dispatch',async()=>{await page.evaluate(()=>{window.island.localPlayer.active=true;window.__localCalls=[];window.island.localPlayer.control=async a=>window.__localCalls.push(a)});for(const action of ['prev','toggle','next'])await page.locator(`[data-arg="${action}"]`).click();const sent=await page.evaluate(()=>window.__localCalls);assert.equal(sent.length,3);await page.evaluate(()=>window.island.localPlayer.active=false);return sent});
 await test('radio confirmed pending and rapid clicks',async()=>{delay.wifi_control=a=>a.action==='status'?0:220;const before=count('wifi_control','on');await page.locator('#ic-wifi').evaluate(e=>{e.click();e.click();e.click()});assert.equal(await page.locator('#ic-wifi').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#ic-wifi').isDisabled(),true);await page.waitForFunction(()=>document.querySelector('#ic-wifi').getAttribute('aria-pressed')==='true');assert.equal(count('wifi_control','on')-before,1);delete delay.wifi_control});
 await test('radio accepted but unapplied rejected',async()=>{applyRadio=false;await page.locator('#ic-wifi').click();await page.waitForFunction(()=>document.querySelector('#ic-wifi').textContent.includes('Non appliqué'));assert.equal(await page.locator('#ic-wifi').getAttribute('aria-pressed'),'true');applyRadio=true});
 await test('radio refresh stale response discarded',async()=>{radios.wifi_control='off';await open();let entered=false;delay.wifi_control=a=>{if(a.action==='status'){entered=true;return 800}return 0};const until=Date.now()+2600;while(!entered&&Date.now()<until)await page.waitForTimeout(25);assert.ok(entered);await page.locator('#ic-wifi').click();await page.waitForTimeout(1700);assert.equal(await page.locator('#ic-wifi').getAttribute('aria-pressed'),'true');assert.equal(radios.wifi_control,'on');delete delay.wifi_control});
 await test('radio unavailable is disabled and recovers',async()=>{fail.bluetooth_control='not_found';await open();assert.equal(await page.locator('#ic-bluetooth').isDisabled(),true);delete fail.bluetooth_control;await page.waitForFunction(()=>!document.querySelector('#ic-bluetooth').disabled);return page.locator('#ic-bluetooth').innerText()});
 await test('notification label matches global alerts',async()=>{assert.match(await page.locator('#ic-dnd').innerText(),/Alertes PC/);await page.locator('#ic-dnd').click();await page.waitForFunction(()=>document.querySelector('#ic-dnd').textContent.includes('Coupées'))});
 await test('quit semantics focus trap Escape cancellation',async()=>{await page.locator('#ic-shutdown').click();assert.equal(await page.getByRole('dialog',{name:'Quitter Nolys ?'}).getAttribute('aria-modal'),'true');assert.equal(await page.evaluate(()=>document.activeElement.id),'confirm-cancel');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'confirm-ok');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'confirm-cancel');await page.keyboard.press('Escape');assert.equal(await page.locator('[role=dialog]').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'ic-shutdown')});
 await test('quit confirms fake exit once',async()=>{const n=count('exit_app');await page.locator('#ic-shutdown').click();await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.waitForTimeout(60);assert.equal(count('exit_app')-n,1)});await open();
 await test('mic rejection rolls back and releases disabled',async()=>{fail.set_mic_monitor='reject';await page.locator('.ic-mic-toggle').click();await page.waitForTimeout(160);assert.equal(await page.locator('.ic-mic-toggle').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('.ic-mic-toggle').isDisabled(),false);assert.equal(mic.config.enabled,false);delete fail.set_mic_monitor});
 await open('mixer');
 await test('mixer keyboard sends and labelled mute button works',async()=>{const slider=page.getByRole('slider',{name:'Volume de Microsoft Edge'});await slider.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(70);assert.equal(sessions[0].volume,61);const button=page.getByRole('button',{name:'Couper le son de Microsoft Edge'});await button.focus();await page.keyboard.press('Space');await page.waitForTimeout(80);assert.equal(sessions[0].muted,true);return sessions[0]});
 await test('mixer dynamic sessions and all-flows navigation',async()=>{sessions=[{pid:99,name:'test.exe',volume:30,muted:false},{pid:100,name:'audiodg.exe',volume:70,muted:false}];await page.evaluate(()=>window.island.updateAudioSessions());await page.getByRole('slider',{name:'Volume de test'}).waitFor();assert.equal(await page.locator('.ic-mixer-row').count(),2);await page.getByRole('button',{name:'Tous les flux (2)'}).click();await settled();assert.equal(await page.evaluate(()=>window.island.mode),'mixer')});
 await test('mixer empty state',async()=>{sessions=[];await open('mixer');await page.getByText('Aucun flux audio détecté',{exact:true}).waitFor()});
 await test('mixer unavailable and retry recovery',async()=>{fail.get_audio_sessions='reject';await open('mixer');await page.getByText('Audio indisponible',{exact:true}).waitFor();await page.getByRole('button',{name:'Réessayer',exact:true}).focus();delete fail.get_audio_sessions;sessions=[{pid:42,name:'msedge.exe',volume:60,muted:false}];await page.keyboard.press('Enter');await page.getByRole('slider',{name:'Volume de Microsoft Edge'}).waitFor()});
 await page.screenshot({path:'.impeccable/runtime/control-confirm-b-20261031.png'});
 // Delayed old request across a new machine render: old disk read must not paint the new card.
 await test('cross-view delayed machine stats does not overwrite new card',async()=>{let seen=0;stats={cpu:1,ram:1,diskFree:10*1024**3,diskTotal:100*1024**3};delay.get_system_stats=()=>++seen<=2?1300:0;await open('machine');await open('launchpad');stats={cpu:2,ram:2,diskFree:80*1024**3,diskTotal:100*1024**3};await open('machine');await page.waitForTimeout(1100);assert.match(await page.locator('#ic-mach-val-disk').innerText(),/80 Go/);delete delay.get_system_stats});
 await test('control height follows zero one three then one live audio sessions',async()=>{
  const sizes=[];
  for(const n of [0,1,3,1]){
   sessions=Array.from({length:n},(_,i)=>({pid:200+i,name:`app${i}.exe`,volume:60,muted:false}));
   if(!sizes.length)await open('mixer');else await page.evaluate(()=>window.island.updateAudioSessions());
   const geometry=await fittedControlGeometry();
   geometry.gaps.forEach(gap=>assert.ok(Math.abs(gap-10)<1,JSON.stringify(geometry)));
   assert.ok(Math.abs(geometry.bottomAlignment)<1,JSON.stringify(geometry));sizes.push(geometry.height);
   if(n===1&&sizes.length===2)await page.screenshot({path:'.impeccable/runtime/control-spacing-one-session.png'});
   if(n===3)await page.screenshot({path:'.impeccable/runtime/control-spacing-three-sessions.png'});
  }
  assert.ok(sizes[2]>sizes[1]+40,JSON.stringify(sizes));assert.ok(Math.abs(sizes[3]-sizes[1])<1,JSON.stringify(sizes));return sizes;
 });
 await test('five control widgets keep regular spacing and fitted volume',async()=>{
  const geometries={};
  for(const widget of ['launchpad','stats','machine','weather','mixer']){
   await open(widget);const geometry=await fittedControlGeometry();
   geometry.gaps.forEach(gap=>assert.ok(Math.abs(gap-10)<1,`${widget}: ${JSON.stringify(geometry)}`));
   assert.ok(Math.abs(geometry.bottomAlignment)<1,`${widget}: ${JSON.stringify(geometry)}`);geometries[widget]=geometry;
  }
  return geometries;
 });
 }
 if(process.argv.includes('--edges')){
 await test('mixer unavailable retry keyboard recovery',async()=>{fail.get_audio_sessions='reject';await open('mixer');await page.getByText('Audio indisponible',{exact:true}).waitFor();const retry=page.getByRole('button',{name:'Réessayer',exact:true});await retry.focus();delete fail.get_audio_sessions;await page.keyboard.press('Enter');await page.getByRole('slider',{name:'Volume de Microsoft Edge'}).waitFor()});
 // Isoler la réponse déjà en vol : une nouvelle lecture après l'écriture peut légitimement échouer.
 await test('late failed volume read preserves newer successful write',async()=>{await open();await page.evaluate(()=>clearInterval(window.island._mainInterval));fail.get_system_volume='reject';delay.get_system_volume=500;await page.evaluate(()=>window.island.onSecondTick());await page.locator('#ic-volume-slider').focus();await page.keyboard.press('ArrowUp');await page.waitForTimeout(650);assert.equal(volume,55);assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-valuenow'),'55');assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-disabled'),'false');delete fail.get_system_volume;delete delay.get_system_volume});
 }
}finally{report.passed=report.results.filter(r=>r.pass).length;report.failed=report.results.filter(r=>!r.pass).length;await mkdir('.impeccable/runtime',{recursive:true});await writeFile(`.impeccable/runtime/control-center-browser-results${process.argv.includes('--edges')?'-edges':''}${process.argv.includes('--final')?'-final':''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors}));await browser.close();if(report.failed || report.errors.length)process.exitCode=1}
