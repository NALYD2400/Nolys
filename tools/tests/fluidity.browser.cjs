const nativeViewport = require('./island-viewport.cjs');
// Real frontend, simulated Windows: no device, capture or personal-file changes.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport, reducedMotion: 'reduce' });
        const calls = {}, errors = [];
        let volume = null, refuseVolume = false;
        const config = {sourceId:'',capture:'auto',encoder:'auto',codec:'h264',preset:'speed',height:1080,fps:60,bitrateMbps:16,seconds:60,memoryMb:256,cursor:true,systemAudio:true,microphone:false,outputDevice:'',inputDevice:'',systemVolume:100,micVolume:100,audioKbps:192,separateAudio:false,destination:'C:/Fixture',enginePath:''};
        const replay = {phase:'idle',config,bufferedSeconds:0,bufferBytes:0,recording:false,recordingSeconds:0,exporting:false,encoder:'',pipeline:'',width:0,height:0,error:null,notice:null,clips:[],clipsRevision:7,engineAvailable:true,enginePath:'fixture',recoveryFiles:0};
        const library = { tracks: Array.from({length:3000},(_,i)=>({id:`t${i}`,title:`Morceau ${i.toString().padStart(4,'0')}`,artist:'Été',album:'Test',path:`/fixture/${i}.wav`,cover:'',duration:180000,favorite:false,addedAt:i,missing:false})), playlists:[] };
        await context.exposeBinding('__invoke', async (_, command, args = {}) => {
            calls[command] = (calls[command] || 0) + 1;
            switch(command) {
                case 'get_layout_state': return {layout:{scale:1},editMode:false};
                case 'get_update_status': return {state:'idle',currentVersion:'2.6.1',canCheck:false};
                case 'get_mic_monitor': return {config:{enabled:false},running:false,inputLevel:0,outputLevel:0};
                case 'get_system_volume': return volume;
                case 'set_system_volume': if(refuseVolume) throw Error('Sortie audio indisponible'); volume=args.volume; return true;
                case 'get_audio_meter': return {peak:.3,left:.3,right:.3};
                case 'get_media_info': return {title:'Diagnostic',artist:'Fixture',isPlaying:true,progress:1000,duration:180000,cover:'',trackKey:'fixture',appId:'fixture'};
                case 'library_get': return structuredClone(library);
                case 'replay_snapshot': return structuredClone(replay);
                case 'replay_sources': case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown','true'); localStorage.setItem('liquid_sound_effects_enabled','false'); localStorage.setItem('liquid_online_covers','false');
            const listeners = new Map();
            window.__dispatch = (channel,payload) => {for(const cb of listeners.get(channel)||[]) cb({payload});};
            window.__TAURI__={core:{invoke:(c,a)=>window.__invoke(c,a),convertFileSrc:p=>p},webviewWindow:{getCurrentWebviewWindow:()=>({listen:async(c,cb)=>{const list=listeners.get(c)||[];list.push(cb);listeners.set(c,list);return()=>{const i=list.indexOf(cb);if(i>=0)list.splice(i,1);};},startDragging:async()=>{}})}};
        });
        const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
        await page.goto(`${process.env.NOLYS_UI_URL}/island/index.html`);
        await page.waitForFunction(()=>window.island?.localPlayer?.library.tracks.length===3000);
        await page.waitForFunction(()=>document.body.classList.contains('motion-sober'));
        await page.emulateMedia({reducedMotion:'no-preference'});
        await page.waitForFunction(()=>document.body.classList.contains('motion-fluid'));
        await page.evaluate(()=>{localStorage.setItem('liquid_motion_level','vivid');window.island.syncMotionPreference();});
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await page.evaluate(()=>document.body.classList.contains('motion-vivid')),true);
        await page.evaluate(()=>{localStorage.setItem('liquid_motion_level','system');window.island.syncMotionPreference();});
        await page.waitForFunction(()=>document.body.classList.contains('motion-sober'));

        const open = async mode => {await page.evaluate(mode=>window.island.openExpandedMode(mode),mode);await page.waitForFunction(()=>!window.island._transitionInProgress);};
        await page.waitForTimeout(300);
        await page.evaluate(()=>window.island.setWindowHidden(true)); await page.waitForTimeout(120);
        const hiddenCalls=calls.get_audio_meter||0; await page.waitForTimeout(350);
        assert.equal(calls.get_audio_meter||0,hiddenCalls,'no meter polling while hidden');
        await page.evaluate(()=>window.island.setWindowHidden(false)); await page.waitForTimeout(250);
        assert.ok(calls.get_audio_meter>hiddenCalls,'fresh meter polling resumes on show');

        await open('library'); await page.locator('.island-library-view .row').first().waitFor();
        assert.equal(await page.locator('.island-library-view .row').count(),150);
        for(let i=0;i<9;i++) await page.locator('#pagination [data-action="next-page"]').click();
        assert.equal(await page.locator('.island-library-view .row').count(),150,'paging never accumulates rows');
        assert.equal(await page.locator('.island-library-view .row').first().evaluate(el=>getComputedStyle(el).opacity),'1','changing pages must not replay an invisible entry cascade');
        assert.equal(await page.locator('.island-library-view .row').first().getAttribute('data-track'),'t1350');
        assert.match(await page.locator('#pagination').innerText(),/Page 10 \/ 20/);
        const focus=await page.evaluate(()=>window.island._libraryHost.shadowRoot.activeElement?.dataset.action);
        assert.equal(focus,'next-page');
        await page.keyboard.press('Escape'); await page.waitForFunction(()=>!window.island.isExpanded);
        await open('library'); await page.locator('.island-library-view .row').first().waitFor();
        assert.match(await page.locator('#pagination').innerText(),/Page 10 \/ 20/);
        await page.locator('.island-library-view #search').fill('Morceau 2999');
        assert.equal(await page.locator('.island-library-view .row').count(),1);
        assert.equal(await page.locator('.island-library-view .row').first().getAttribute('data-track'),'t2999');
        assert.equal(await page.locator('#pagination').isVisible(),false);

        await open('replay'); await page.locator('#replay-phase').waitFor(); await page.waitForTimeout(100);
        const reads=calls.replay_snapshot;
        await page.evaluate(()=>{window.__mutations=0;window.__replayObserver=new MutationObserver(list=>window.__mutations+=list.filter(e=>e.type==='childList').length);window.__replayObserver.observe(window.island._replayHost.shadowRoot,{subtree:true,childList:true});});
        for(let i=0;i<3;i++) {await page.evaluate(()=>window.__dispatch('replay-status',{clipsRevision:7,phase:'idle',bufferedSeconds:0,bufferBytes:0,recording:false,recordingSeconds:0,exporting:false,error:null,notice:null}));await page.waitForTimeout(40);}
        assert.equal(calls.replay_snapshot,reads,'telemetry does not fetch the catalogue');
        assert.equal(await page.evaluate(()=>window.__mutations),0,'unchanged telemetry preserves DOM nodes');
        replay.clipsRevision=8; replay.clips=[{id:'new',name:'Nouveau.mp4',path:'C:/Fixture/Nouveau.mp4',kind:'replay',createdAt:1792411200,seconds:10,bytes:1024}];
        await page.evaluate(()=>window.__dispatch('replay-status',{clipsRevision:8,phase:'idle'}));
        await page.waitForFunction(()=>document.querySelector('.replay-panel-host')?.shadowRoot?.querySelector('#replay-phase'));
        await page.locator('.replay-panel-host [data-tab="clips"]').click();
        await page.getByText('Nouveau.mp4',{exact:true}).waitFor();
        assert.equal(calls.replay_snapshot,reads+1);

        await open('control'); await page.waitForTimeout(100);
        assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-disabled'),'true');
        assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-valuenow'),null);
        volume=0; await page.evaluate(()=>window.island.onSecondTick());
        await page.waitForFunction(()=>document.querySelector('#ic-volume-slider')?.getAttribute('aria-valuenow')==='0');
        assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-disabled'),'false');
        refuseVolume=true; await page.locator('#ic-volume-slider').focus(); await page.keyboard.press('ArrowUp');
        await page.getByText('Volume indisponible',{exact:true}).waitFor();
        assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-valuenow'),null);
        assert.deepEqual(errors,[]);
        console.log('Fluidity browser: bounded library pages/search/focus/reopen, hidden meter stop/resume, Windows motion with explicit override, incremental Replay with stable DOM, unavailable/refused audio passed.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
