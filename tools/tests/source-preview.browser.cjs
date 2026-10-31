// Still-image source preview with the real UI and a controlled native bridge.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nativeViewport = require('./island-viewport.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport });
        const page = await context.newPage();
        const frames = await page.evaluate(() => ['#76512d', '#284e75'].map(color => {
            const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 480, 270);
            ctx.fillStyle = '#e7c8a4'; ctx.fillRect(25, 25, 120, 70);
            return canvas.toDataURL('image/jpeg');
        }));
        const config = { sourceId: '', capture: 'auto', encoder: 'auto', codec: 'h264', preset: 'speed', height: 1080, fps: 60, bitrateMbps: 16, seconds: 60, memoryMb: 256, cursor: true, systemAudio: true, microphone: false, outputDevice: '', inputDevice: '', systemVolume: 100, micVolume: 100, audioKbps: 192, separateAudio: false, destination: 'C:\\Videos', enginePath: '' };
        const state = { phase: 'idle', config, bufferedSeconds: 0, bufferBytes: 0, recording: false, recordingSeconds: 0, exporting: false, clips: [], clipsRevision: 1, engineAvailable: true };
        const calls = [], errors = [];
        let hold = false, release = null, fail = false, inFlight = 0, peakFlight = 0;
        await context.exposeBinding('__invoke', async (_source, command, args = {}) => {
            calls.push({ command, args });
            if (command === 'replay_snapshot') return structuredClone(state);
            if (command === 'replay_sources') return [{ id: 'monitor:1', kind: 'monitor', label: 'Écran 1', width: 1920, height: 1080 }, { id: 'window:42:10', kind: 'window', label: 'Jeu de test', width: 1920, height: 1080 }];
            if (command === 'replay_preflight') {
                assert.equal(args.kind, 'preview');
                ++inFlight; peakFlight = Math.max(peakFlight, inFlight);
                try {
                    if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
                    if (fail) { fail = false; throw Error('Source indisponible'); }
                    return frames[args.config.sourceId.startsWith('window:') ? 1 : 0];
                } finally { --inFlight; }
            }
            if (command === 'get_layout_state') return { layout: { scale: 1 }, editMode: false };
            if (command === 'get_mic_monitor') return { config: { enabled: false }, level: 0 };
            if (command === 'get_system_volume') return 50;
            if (command === 'library_get') return { tracks: [], playlists: [] };
            if (['get_audio_sessions', 'get_audio_devices', 'get_audio_input_devices', 'register_shortcuts'].includes(command)) return [];
            return null;
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true'); localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const cb of listeners.get(channel) || []) cb({ payload }); };
            window.__TAURI__ = { core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p }, webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, cb) => { const list = listeners.get(channel) || []; list.push(cb); listeners.set(channel, list); return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }; }, startDragging: async () => {} }) } };
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
        await page.waitForFunction(() => window.island?.localPlayer);
        await page.evaluate(() => window.island.openReplay());
        const previewCalls = () => calls.filter(call => call.command === 'replay_preflight');
        async function expectFrame(frame) {
            await page.waitForFunction(frame => {
                const image = window.island._replayHost?.shadowRoot?.querySelector('#replay-source-image');
                return image && !image.hidden && image.naturalWidth === 480 && image.getAttribute('src') === frame;
            }, frame);
        }
        async function choose(label) {
            await page.locator('#replay-sourceId-trigger').click();
            await page.getByRole('option', { name: label, exact: true }).click();
        }
        await expectFrame(frames[0]);
        await page.waitForTimeout(1000);
        const first = previewCalls().length;
        for (let i = 0; i < 3; i++) await page.evaluate(() => window.__dispatch('replay-status', { clipsRevision: 1, phase: 'idle', bufferedSeconds: 0 }));
        await page.waitForTimeout(500);
        assert.equal(previewCalls().length, first, 'telemetry and elapsed time never poll the source');
        const shots = path.join(process.cwd(), '.impeccable/review/source-preview'); fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, 'source-preview-desktop.png') });

        hold = true;
        await choose('Écran 1');
        await page.waitForFunction(() => window.island._replayHost.shadowRoot.querySelector('#replay-source-image').hidden);
        await choose('Fenêtre / jeu · Jeu de test');
        await page.waitForTimeout(100);
        assert.equal(previewCalls().length, first + 1, 'the second selection waits for the in-flight native request');
        release();
        await expectFrame(frames[1]);
        assert.equal(previewCalls().at(-1).args.config.sourceId, 'window:42:10');
        assert.equal(peakFlight, 1);

        fail = true;
        await page.getByRole('button', { name: 'Actualiser les sources et la miniature', exact: true }).click();
        await page.getByText('Aperçu indisponible · cliquez sur Actualiser', { exact: true }).waitFor();
        assert.equal(await page.locator('#replay-sourceId').inputValue(), 'window:42:10');
        assert.equal(await page.getByRole('button', { name: 'Activer le replay', exact: true }).isEnabled(), true, 'a missing preview does not prevent capture');
        assert.equal(await page.getByRole('alert').count(), 0, 'preview errors stay local');
        await page.getByRole('button', { name: 'Actualiser les sources et la miniature', exact: true }).click();
        await expectFrame(frames[1]);

        hold = true;
        await page.getByRole('button', { name: 'Actualiser les sources et la miniature', exact: true }).click();
        await page.waitForTimeout(100);
        const beforeClose = previewCalls().length;
        await page.getByRole('button', { name: 'Fermer Replay', exact: true }).click();
        await page.waitForTimeout(700);
        await page.evaluate(() => window.island.openReplay());
        await page.waitForTimeout(700);
        assert.equal(previewCalls().length, beforeClose, 'reopening cannot overlap a previous panel request');
        release();
        await expectFrame(frames[1]);
        await page.waitForTimeout(100);
        assert.equal(peakFlight, 1);

        await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
        const inSettings = previewCalls().length;
        await page.waitForTimeout(200);
        assert.equal(previewCalls().length, inSettings);
        await page.getByRole('tab', { name: 'Capture', exact: true }).click();
        await expectFrame(frames[1]);
        await page.waitForTimeout(200);
        await page.evaluate(() => window.__dispatch('replay-status', { clipsRevision: 1, phase: 'buffering', bufferedSeconds: 3 }));
        await page.getByText('Replay actif', { exact: true }).waitFor();
        assert.equal(await page.getByText('Image fixe', { exact: true }).count(), 0);
        const activeCalls = previewCalls().length;
        await page.waitForTimeout(400);
        assert.equal(previewCalls().length, activeCalls, 'active capture uses the existing still image');
        assert.equal(await page.getByRole('button', { name: 'Actualiser les sources et la miniature', exact: true }).isDisabled(), true);
        await page.setViewportSize({ width: 640, height: nativeViewport.height });
        await page.waitForTimeout(1000);
        const fit = await page.locator('.replay-body').evaluate(el => ({ scroll: el.scrollHeight, height: el.clientHeight }));
        assert.ok(fit.scroll <= fit.height + 1, `still image and actions fit without a scrollbar: ${JSON.stringify(fit)}`);
        const actions = await page.locator('.replay-actions').boundingBox(), shell = await page.locator('#dynamic-island').boundingBox();
        assert.ok(actions.y + actions.height <= shell.y + shell.height - 8);
        const frame = await page.locator('.replay-source-preview-frame').boundingBox();
        assert.ok(frame.width >= 500, 'the preview fills the panel width');
        for (const selector of ['.replay-session', '.replay-timing', '.replay-actions']) {
            const box = await page.locator(selector).boundingBox();
            assert.ok(box.x >= frame.x && box.y >= frame.y && box.x + box.width <= frame.x + frame.width && box.y + box.height <= frame.y + frame.height, `${selector} overlays the source image`);
        }
        const timer = await page.locator('.replay-timing').boundingBox();
        assert.ok(Math.abs(timer.x + timer.width / 2 - (frame.x + frame.width / 2)) <= 1);
        assert.ok(Math.abs(timer.y + timer.height / 2 - (frame.y + frame.height / 2)) <= 1, 'timer is in the center of the image');
        assert.ok(Math.abs(shell.y + shell.height - frame.y - frame.height - (frame.x - shell.x)) <= 2, 'bottom and side margins match');
        await page.screenshot({ path: path.join(shots, 'source-preview-compact.png') });
        await page.evaluate(() => window.__dispatch('replay-status', { clipsRevision: 1, phase: 'error', error: 'La source n’est plus disponible. Actualisez les sources.' }));
        await page.getByRole('alert').waitFor();
        await page.waitForTimeout(800);
        const withError = await page.locator('.replay-body').evaluate(el => ({ scroll: el.scrollHeight, height: el.clientHeight }));
        assert.ok(withError.scroll <= withError.height + 1, `source controls also fit with an error: ${JSON.stringify(withError)}`);
        assert.equal(calls.some(call => call.command === 'replay_action' || call.command === 'replay_configure'), false, 'preview never starts capture or changes saved settings');
        assert.deepEqual(errors, []);
        console.log('Source preview: one-shot refresh, stale response rejection, serialized reopen, local error/retry, no audio/capture action, retained still during capture, normal/compact layout passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
