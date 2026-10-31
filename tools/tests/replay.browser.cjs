// Real application UI with an observed Tauri bridge; native capture has a separate Rust test.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

(async () => {
    const fixture = path.join(process.cwd(), '.impeccable/runtime/replay-player-fixture.mp4');
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    const encoded = spawnSync(process.env.NOLYS_FFMPEG || path.join(process.cwd(), 'src-tauri/resources/replay/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', fixture], { encoding: 'utf8', windowsHide: true });
    assert.equal(encoded.status, 0, encoded.stderr || 'Prepare FFmpeg with npm run prepare:replay first');
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
        const config = { sourceId: '', capture: 'auto', encoder: 'auto', codec: 'h264', preset: 'speed', height: 1080, fps: 60, bitrateMbps: 16, seconds: 60, memoryMb: 256, cursor: true, systemAudio: true, microphone: false, outputDevice: '', inputDevice: '', systemVolume: 100, micVolume: 100, audioKbps: 192, separateAudio: false, destination: 'C:\\Users\\Test\\Videos\\Nolys', enginePath: '' };
        let state = { phase: 'idle', config, bufferedSeconds: 0, bufferBytes: 0, recording: false, recordingSeconds: 0, exporting: false, encoder: '', pipeline: '', width: 0, height: 0, error: null, notice: null, clips: [], engineAvailable: true, enginePath: 'C:\\Nolys\\ffmpeg.exe', recoveryFiles: 0 };
        const calls = [], errors = [];
        const preview = spawnSync(process.env.NOLYS_FFMPEG || path.join(process.cwd(), 'src-tauri/resources/replay/ffmpeg.exe'), ['-v', 'error', '-i', fixture, '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { windowsHide: true });
        assert.equal(preview.status, 0);
        await context.route('**/__replay_thumbnail.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: preview.stdout }));
        let rejectDeletion = false, rejectRename = false;
        let networkSample = { netDown: 2048, netUp: 128 };
        await context.route('**/__replay_fixture.mp4', route => {
            const bytes = fs.readFileSync(fixture);
            const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
            if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: bytes });
            const start = Number(range[1]), end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
            return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
        });
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            calls.push({ command, args });
            if (command === 'replay_snapshot') return structuredClone(state);
            if (command === 'replay_media') return 'http://localhost:1420/__replay_fixture.mp4';
            if (command === 'replay_thumbnail') return 'http://localhost:1420/__replay_thumbnail.jpg';
            if (command === 'replay_cache') return { bytes: 1024, files: 1, limitBytes: 128 * 1024 ** 2 };
            if (command === 'replay_recovery_list') return [];
            if (command === 'replay_reindex' || command === 'replay_relocate') return structuredClone(state);
            if (command === 'replay_rename') {
                if (rejectRename) { rejectRename = false; throw new Error('Un fichier porte déjà ce nom.'); }
                state.clips = state.clips.map(clip => clip.id === args.id ? { ...clip, name: `${args.name}.mp4` } : clip);
                return structuredClone(state);
            }
            if (command === 'replay_delete') {
                if (rejectDeletion) { rejectDeletion = false; throw new Error('Le fichier est utilisé par une autre application.'); }
                state.clips = state.clips.filter(clip => clip.id !== args.id); state.notice = null;
                return structuredClone(state);
            }
            if (command === 'replay_sources') return [{ id: 'monitor:1', kind: 'monitor', label: 'Écran 1 · 1920 × 1080', width: 1920, height: 1080 }, { id: 'window:42:10', kind: 'window', label: 'Jeu de test', width: 2560, height: 1440 }, {id:'window:long',kind:'window',label:'Fenêtre avec un titre très long · '+ 'Texte externe & <test> '.repeat(100),width:1920,height:1080}];
            if (command === 'replay_configure') { state.config = args.config; return structuredClone(state); }
            if (command === 'replay_action') {
                if (args.action === 'start') Object.assign(state, { phase: 'buffering', bufferedSeconds: 30.25, bufferBytes: 19 * 1024 ** 2, encoder: 'h264_amf', pipeline: 'DXGI · GPU direct', width: 1920, height: 1080 });
                if (args.action === 'record') state.recording = true;
                if (args.action === 'record-stop') state.recording = false;
                if (args.action === 'save') { state.notice = 'Clip de test.mp4 enregistré'; state.clips = [{ id: 'fixture-replay', name: 'Clip de test.mp4', path: 'C:\\Videos\\Clip de test.mp4', kind: 'replay', createdAt: 1792411200, seconds: 30.25, bytes: 19 * 1024 ** 2 }]; }
                if (args.action === 'dismiss') { state.error = null; state.notice = null; }
                if (args.action === 'stop') Object.assign(state, { phase: 'idle', recording: false, bufferedSeconds: 0, bufferBytes: 0 });
                return structuredClone(state);
            }
            if (command === 'replay_pick') return 'C:\\Videos\\Mes clips';
            switch (command) {
                case 'get_layout_state': return { layout: { scale: 1 }, editMode: false };
                case 'get_update_status': return { state: 'idle', currentVersion: '2.4.0', canCheck: false };
                case 'get_mic_monitor': return { config: { enabled: false }, level: 0 };
                case 'get_system_volume': return 50;
                case 'get_hardware_telemetry': return networkSample;
                case 'library_get': return { tracks: [], playlists: [] };
                case 'files_snapshot': return { jobs: [], destination: '', inputs: [] };
                case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true'); localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = { core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p }, webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => { const bucket = listeners.get(channel) || []; bucket.push(callback); listeners.set(channel, bucket); return () => { const i = bucket.indexOf(callback); if (i >= 0) bucket.splice(i, 1); }; }, startDragging: async () => {} }) } };
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        const settled = async () => { await page.waitForFunction(() => !window.island._transitionInProgress); await page.waitForTimeout(1000); };
        const shots = path.join(process.cwd(), '.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
        await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
        await page.evaluate(() => window.island.openExpandedMode('menu')); await settled();
        await page.getByRole('button', { name: 'Replay', exact: true }).click(); await settled();
        await page.waitForSelector('#replay-sourceId-trigger');
        // Un titre de fenêtre externe ne peut plus agrandir la liste native au-delà de l’Island.
        await page.locator('#replay-sourceId-trigger').click();
        await page.getByRole('listbox').waitFor();
        const menuFits = await page.evaluate(() => {
            const root=window.island._replayHost.shadowRoot, menu=root.querySelector('.replay-select-menu'), capsule=root.querySelector('.replay-panel');
            const m=menu.getBoundingClientRect(), c=capsule.getBoundingClientRect();
            return {inside:m.left>=c.left&&m.right<=c.right&&m.top>=c.top&&m.bottom<=c.bottom,width:m.width,panel:c.width,overflow:menu.scrollWidth-menu.clientWidth};
        });
        assert.ok(menuFits.inside && menuFits.width<menuFits.panel && menuFits.overflow===0,JSON.stringify(menuFits));
        await page.screenshot({path:path.join(shots,'replay-source-menu.png')});
        await page.keyboard.press('End'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#replay-sourceId').inputValue(),'window:long');
        assert.equal(await page.locator('#replay-sourceId-trigger').getAttribute('aria-expanded'),'false');
        assert.ok(await page.evaluate(()=>window.island._replayHost.shadowRoot.activeElement.id==='replay-sourceId-trigger'));
        await page.locator('#replay-sourceId-trigger').click(); await page.keyboard.press('Escape');
        assert.equal(await page.locator('#replay-sourceId-trigger').getAttribute('aria-expanded'),'false');
        assert.equal(await page.evaluate(()=>window.island.isExpanded),true,'Échap ferme uniquement le menu');
        await page.locator('#replay-sourceId-trigger').click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.replay-preflight').count(), 0);
        assert.equal(calls.some(call => call.command === 'replay_preflight'), false, 'capture must not run preflight checks');
        await page.screenshot({ path: path.join(shots, 'replay-idle-desktop.png') });
        await page.getByRole('tab', { name: 'Clips', exact: true }).click(); await settled();
        assert.equal(await page.getByRole('tab', { name: 'Clips', exact: true }).getAttribute('aria-selected'), 'true');
        assert.match(await page.getByRole('tab', { name: 'Clips', exact: true }).getAttribute('class'), /is-active/);
        assert.equal(await page.getByRole('heading', { name: 'Vos clips apparaîtront ici' }).count(), 1);
        await page.screenshot({ path: path.join(shots, 'replay-clips-empty-desktop.png') });
        await page.getByRole('tab', { name: 'Capture', exact: true }).click(); await page.waitForTimeout(400);
        assert.equal(await page.getByRole('button', { name: 'Activer le replay', exact: true }).isEnabled(), true);
        await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
        await page.getByRole('combobox', { name: /Images par seconde/ }).click();
        await page.getByRole('option', {name:'120 FPS',exact:true}).click();
        assert.equal(await page.locator('#replay-fps').inputValue(),'120','le menu transmet la valeur choisie');
        await page.getByLabel('Enregistrer le microphone', { exact: false }).check();
        await page.getByRole('button', { name: 'Enregistrer les réglages', exact: true }).click();
        await page.getByText('Réglages enregistrés', {exact:true}).waitFor();
        assert.equal(state.config.fps, 120); assert.equal(state.config.microphone, true);
        await page.locator('.replay-body').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(shots, 'replay-settings-desktop.png') });
        await page.getByRole('tab', { name: 'Capture', exact: true }).click();
        await page.getByRole('button', { name: 'Activer le replay', exact: true }).click();
        await page.waitForSelector('#replay-phase');
        assert.equal(await page.locator('#replay-phase').textContent(), 'Replay actif');
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        assert.equal(state.recording, true); await settled();
        await page.screenshot({ path: path.join(shots, 'replay-recording-desktop.png') });
        await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
        assert.equal(await page.getByLabel('Images par seconde', { exact: false }).isDisabled(), true);
        await page.getByRole('tab', { name: 'Capture', exact: true }).click();
        await page.getByRole('button', { name: 'Sauvegarder', exact: true }).click();
        assert.equal(state.notice, 'Clip de test.mp4 enregistré');
        assert.equal(await page.getByRole('button', { name: 'Voir le clip', exact: true }).count(), 0);
        assert.equal(await page.locator('#replay-buffer-progress').count(), 0);
        assert.equal(await page.locator('#replay-content #replay-pipeline').count(), 0, 'technical diagnostics belong in settings');
        assert.equal(await page.locator('#replay-feedback').textContent().then(text => text.includes('Clip de test.mp4')), false);
        await settled();
        assert.equal(await page.locator('.replay-body').evaluate(el => el.scrollHeight > el.clientHeight + 1), false);
        await page.screenshot({ path: path.join(shots, 'replay-clean-saved.png') });
        await page.getByRole('button', { name: 'Fermer Replay', exact: true }).click(); await settled();
        assert.equal(state.recording, true, 'closing the panel must not stop capture');
        await page.evaluate(() => window.__dispatch('replay-status', {}));
        const satellite = page.locator('#island-replay-satellite');
        await page.waitForSelector('#island-replay-satellite.is-visible');
        assert.equal(await satellite.textContent(), '', 'Replay satellite must contain only an icon');
        assert.equal(await satellite.getAttribute('tabindex'), '0');
        assert.match(await satellite.getAttribute('aria-label'), /REC/);
        const assertSatellites = async expectedSide => {
            await page.waitForTimeout(850);
            const boxes = await page.evaluate(() => {
                const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
                return { island: rect(window.island.el), replay: rect(window.island._replaySatellite), others: [...document.querySelectorAll('.island-satellite.is-visible:not(#island-replay-satellite)')].map(rect) };
            });
            assert.ok(Math.abs(boxes.replay.y - boxes.island.y) < 1, 'same row as the Island');
            assert.ok(expectedSide === 'right' ? boxes.replay.x > boxes.island.right : boxes.replay.right < boxes.island.x);
            for (const other of boxes.others) assert.ok(boxes.replay.right <= other.x || boxes.replay.x >= other.right, 'satellites must not overlap');
            return boxes;
        };
        const setActivities = async (microphone, timer, timerValue = 5) => {
            await page.evaluate(({ microphone, timer, timerValue }) => {
                const island = window.island;
                // UI fixtures only: no native microphone or timer is started.
                island.micStatus = { config: { enabled: microphone } };
                island.startMicLoop = () => {};
                island.syncMicActivity();
                island._timers.reset(); island._timers.setMode('countdown');
                island._timers.setDuration(Math.max(300, timerValue));
                if (timer) island._timers.toggle();
                island.syncTimerSatellite();
            }, { microphone, timer, timerValue });
        };
        await assertSatellites('right');
        await setActivities(true, false); await assertSatellites('left');
        await page.screenshot({ path: path.join(shots, 'replay-satellite-microphone.png') });
        await setActivities(false, true); await assertSatellites('right');
        await setActivities(true, true, 3665); await assertSatellites('right');
        await page.screenshot({ path: path.join(shots, 'replay-satellite-all-active.png') });
        const edgeLeft = await page.evaluate(() => innerWidth - window.island.el.getBoundingClientRect().right - 60);
        const edge = await page.addStyleTag({ content: `#dynamic-island-container { left: ${edgeLeft}px; }` });
        await page.evaluate(() => window.island.positionMicSatellite());
        await assertSatellites('left');
        await edge.evaluate(el => el.remove());
        await page.evaluate(() => window.island.positionMicSatellite());
        for (const mode of ['menu', 'control', 'settings', 'files']) {
            await page.evaluate(mode => {
                if (mode === 'settings') window.island.openSettings();
                else if (mode === 'files') window.island.openFiles();
                else window.island.openExpandedMode(mode);
            }, mode); await settled();
            assert.equal(await page.evaluate(() => window.island.isExpanded), true);
            assert.equal(await satellite.getAttribute('aria-hidden'), 'true', `Replay hidden in ${mode}`);
            assert.equal(await satellite.getAttribute('tabindex'), '-1');
            assert.equal(await satellite.evaluate(el => el.classList.contains('is-visible')), false);
        }
        await page.evaluate(() => window.island.returnToMusicIdle()); await settled();
        await page.waitForSelector('#island-replay-satellite.is-visible');
        await setActivities(false, false);
        await satellite.click(); await settled();
        await page.getByRole('button', { name: 'Terminer REC', exact: true }).click();
        await page.getByRole('button', { name: 'Arrêter la capture', exact: true }).click();
        assert.equal(state.phase, 'idle');
        assert.equal(await satellite.evaluate(el => el.classList.contains('is-visible')), false);
        await page.getByRole('tab', { name: 'Clips', exact: true }).click();
        await page.waitForTimeout(400);
        assert.equal(await page.getByRole('tab', { name: 'Clips', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByText('Clip de test.mp4', { exact: true }).count(), 1);
        await settled();
        const clipHeight = await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().height);
        await page.waitForFunction(() => document.querySelector('.replay-panel-host').shadowRoot.querySelector('.replay-thumbnail img')?.naturalWidth === 320);
        assert.equal(await page.locator('.replay-thumbnail img.is-loaded').count(), 1);
        const previewCalls = calls.filter(call => call.command === 'replay_thumbnail').length;
        await page.evaluate(() => window.__dispatch('replay-status', {})); await settled();
        assert.equal(calls.filter(call => call.command === 'replay_thumbnail').length, previewCalls, 'telemetry must reuse thumbnails');
        assert.ok(clipHeight <= 538, `single clip and library controls should fit, got ${clipHeight}`);
        const originalClips = structuredClone(state.clips);
        state.clips = Array.from({ length: 12 }, (_, index) => ({ ...originalClips[0], id: `many-${index}`, name: `Clip ${index}.mp4` }));
        await page.evaluate(() => window.__dispatch('replay-status', {})); await settled();
        const manyHeight = await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().height);
        assert.ok(manyHeight >= clipHeight && manyHeight <= 538, `clip list height must grow within its cap, got ${manyHeight}`);
        assert.equal(await page.locator('.replay-body').evaluate(el => el.scrollHeight > el.clientHeight), true);
        state.clips = originalClips;
        await page.evaluate(() => window.__dispatch('replay-status', {})); await settled();
        assert.ok(await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().height) <= 538);
        await page.getByRole('button', { name: 'Renommer le clip', exact: true }).click();
        const rename = page.getByRole('textbox', { name: 'Nouveau nom du clip', exact: true });
        await rename.fill('Nom annulé'); await rename.press('Escape');
        assert.equal(await page.getByText('Clip de test.mp4', { exact: true }).count(), 1);
        await page.getByRole('button', { name: 'Renommer le clip', exact: true }).click();
        await rename.fill('Victoire été');
        await rename.evaluate(el => { window.__renameInput = el; });
        await page.evaluate(() => window.__dispatch('replay-status', {})); await page.waitForTimeout(300);
        assert.equal(await rename.evaluate(el => el === window.__renameInput && el.value === 'Victoire été' && el.getRootNode().activeElement === el), true);
        await page.screenshot({ path: path.join(shots, 'replay-rename-desktop.png') });
        rejectRename = true; await rename.press('Enter');
        await page.getByRole('alert').waitFor();
        assert.equal(await rename.inputValue(), 'Victoire été'); assert.equal(state.clips[0].name, 'Clip de test.mp4');
        await rename.press('Enter'); await settled();
        assert.equal(await rename.count(), 0); assert.equal(await page.getByText('Victoire été.mp4', { exact: true }).count(), 1);
        assert.ok(calls.some(call => call.command === 'replay_rename' && call.args.id === 'fixture-replay' && call.args.name === 'Victoire été'));
        await page.getByRole('button', { name: 'Lire', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.replay-panel-host').shadowRoot.querySelector('#replay-video')?.readyState >= 2);
        await settled();
        assert.ok(await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().width) > 560);
        await page.locator('#replay-video').evaluate(video => { video.pause(); video.currentTime = 1.2; window.__playingVideo = video; });
        await page.waitForFunction(() => { const video = window.__playingVideo; return !video.seeking && Math.abs(video.currentTime - 1.2) < 0.1; });
        await page.evaluate(() => window.__dispatch('replay-status', {})); await page.waitForTimeout(300);
        assert.equal(await page.locator('#replay-video').evaluate(video => video === window.__playingVideo), true, 'telemetry must not reload video');
        assert.ok(await page.locator('#replay-video').evaluate(video => video.paused && video.currentTime >= 1.1));
        await page.screenshot({ path: path.join(shots, 'replay-player-desktop.png') });
        await page.locator('#replay-video').evaluate(video => video.dispatchEvent(new Event('error')));
        await page.getByRole('button', { name: 'Ouvrir dans un autre lecteur', exact: true }).click();
        assert.ok(calls.some(call => call.command === 'replay_media' && call.args.id === 'fixture-replay'));
        await page.getByRole('button', { name: 'Revenir aux clips', exact: true }).click(); await settled();
        assert.equal(await page.locator('#replay-video').count(), 0);
        await page.getByRole('tab', { name: 'Réglages', exact: true }).click(); await settled();
        await page.getByRole('button', { name: 'Fermer Replay', exact: true }).click(); await settled();
        await page.evaluate(() => window.island.openReplay()); await settled();
        assert.ok(await page.locator('#dynamic-island').evaluate(el => el.clientHeight) >= 536, 'settings must reopen at full height after a compact clip list');
        await page.getByRole('tab', { name: 'Clips', exact: true }).click(); await settled();
        assert.equal(await page.locator('#dynamic-island').evaluate(el => Math.round(el.getBoundingClientRect().width)), 562);
        await page.getByRole('button', { name: 'Afficher', exact: true }).click();
        assert.ok(calls.some(call => call.command === 'replay_play' && call.args.id === 'fixture-replay'));
        assert.ok(calls.some(call => call.command === 'replay_reveal' && call.args.id === 'fixture-replay'));
        await page.screenshot({ path: path.join(shots, 'replay-clips-desktop.png') });
        state.error = 'La source n’est plus disponible. Choisissez un écran ou une fenêtre visible.';
        await page.evaluate(() => window.__dispatch('replay-status', {}));
        await page.getByRole('button', { name: 'Fermer le message', exact: true }).waitFor();
        await page.screenshot({ path: path.join(shots, 'replay-error-desktop.png') });
        await page.getByRole('button', { name: 'Fermer le message', exact: true }).click();
        assert.equal(state.error, null);
        await page.getByRole('tab', { name: 'Capture', exact: true }).click();
        await page.setViewportSize({ width: 640, height: 600 }); await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(shots, 'replay-idle-compact.png') });
        const overflow = await page.locator('.replay-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1);
        assert.equal(overflow, false);
        await page.getByRole('tab', { name: 'Clips', exact: true }).click();
        await page.getByRole('button', { name: 'Renommer le clip', exact: true }).click();
        await page.screenshot({ path: path.join(shots, 'replay-rename-compact.png') });
        assert.equal(await page.locator('.replay-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        await page.getByRole('button', { name: 'Annuler le renommage', exact: true }).click();
        await page.getByRole('button', { name: 'Lire', exact: true }).click(); await settled();
        const playerBox = await page.locator('#dynamic-island').boundingBox();
        assert.ok(playerBox.x >= 0 && playerBox.x + playerBox.width <= 640);
        await page.screenshot({ path: path.join(shots, 'replay-player-compact.png') });
        await page.locator('#replay-video').press('Escape'); await settled();
        rejectDeletion = true;
        await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
        assert.equal(state.clips.length, 1, 'confirmation precedes recycling');
        await page.getByRole('button', { name: 'Confirmer la mise à la corbeille', exact: true }).click();
        assert.equal(state.clips.length, 1);
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
        await page.getByRole('button', { name: 'Confirmer la mise à la corbeille', exact: true }).click();
        assert.equal(state.clips.length, 0);
        assert.equal(await page.getByRole('heading', { name: 'Vos clips apparaîtront ici' }).count(), 1);
        state.clips = Array.from({ length: 65 }, (_, index) => ({ ...originalClips[0], id: `page-${index}`, name: `Partie ${index}.mp4`, createdAt: index, kind: index % 2 ? 'recording' : 'replay' }));
        await page.evaluate(() => window.__dispatch('replay-status', {})); await settled();
        assert.equal(await page.locator('.replay-clips li').count(), 25);
        await page.getByRole('button', { name: 'Page suivante', exact: true }).click();
        assert.equal(await page.locator('.replay-clips li').count(), 25);
        await page.getByRole('searchbox', { name: 'Rechercher un clip', exact: true }).fill('Partie 64');
        assert.equal(await page.locator('.replay-clips li').count(), 1);
        await page.getByRole('button', { name: 'Sélectionner la page', exact: true }).click();
        await page.getByRole('button', { name: 'Corbeille · 1', exact: true }).click();
        await page.getByRole('button', { name: 'Annuler', exact: true }).click();
        assert.equal(state.clips.length, 65);
        await page.getByRole('button', { name: 'Corbeille · 1', exact: true }).click();
        await page.getByRole('button', { name: 'Confirmer la mise à la corbeille', exact: true }).click();
        assert.equal(state.clips.length, 64);
        await page.setViewportSize({ width: 720, height: 600 });
        for (const mode of ['music', 'timer', 'network', 'menu', 'music-search', 'music-history', 'control', 'mixer', 'mic', 'library', 'settings', 'replay', 'files']) {
            await page.evaluate(mode => window.island.setMode(mode), mode); await settled();
            if (mode === 'network') {
                assert.equal(await page.locator('.net-display-dl').textContent(), '16.8Mbps');
                networkSample = null;
                await page.evaluate(() => window.island.refreshNetwork());
                assert.equal(await page.locator('.net-display-dl').textContent(), '—Mbps', 'missing telemetry must not display invented speeds');
            }
            const box = await page.locator('#dynamic-island').boundingBox();
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 721 && box.y + box.height <= 601, `${mode} must fit the native viewport: ${JSON.stringify(box)}`);
            assert.equal(await page.locator('#dynamic-island').evaluate(el => el.scrollWidth <= el.clientWidth + 2), true, `${mode} must not overflow horizontally: ${await page.locator('#dynamic-island').evaluate(el => JSON.stringify({width:el.clientWidth,scroll:el.scrollWidth,children:[...el.querySelectorAll('*')].filter(c=>c.getBoundingClientRect().right>el.getBoundingClientRect().right+2).map(c=>c.className).slice(0,12)}))}`);
        }
        assert.deepEqual(errors, []);
        console.log('Replay browser: settings, capture, REC, satellites, embedded playback and seek, telemetry persistence, player resize/return, deletion failure/success, empty clips and compact layout passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
