const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    const shots = path.join(process.cwd(), '.impeccable/review/adaptive-interface-2026-11-01');
    fs.mkdirSync(shots, { recursive: true });
    try {
        const context = await browser.newContext({ viewport: { width: 900, height: 760 } });
        let media = null;
        await context.exposeBinding('__invoke', async (_, command) => {
            if (command === 'get_media_info') return media;
            if (command === 'get_layout_state') return { layout: { scale: 1 }, editMode: false };
            if (command === 'get_mic_monitor') return { config: { enabled: false }, running: false };
            if (command === 'library_get') return { tracks: [], playlists: [] };
            if (command === 'get_system_volume') return 50;
            if (['get_audio_sessions', 'get_audio_devices', 'get_audio_input_devices', 'register_shortcuts'].includes(command)) return [];
            if (command === 'replay_snapshot') return { phase: 'idle', config: {}, clips: [], engineAvailable: false };
            return null;
        });
        await context.addInitScript(() => {
            for (const [key, value] of Object.entries({ liquid_tray_hint_shown: 'true', liquid_sound_effects_enabled: 'false', liquid_online_covers: 'false', liquid_player_show_visualizer: 'false' })) localStorage.setItem(key, value);
            window.__TAURI__ = { core: { invoke: (c, a) => window.__invoke(c, a), convertFileSrc: p => p }, webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async () => () => {}, startDragging: async () => {} }) } };
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
        await page.evaluate(() => { window.island._islandConfig.playerCoverBg = 100; window.island.openExpandedMode('music'); });
        await page.waitForFunction(() => !window.island._transitionInProgress);
        const shades = {};
        for (const kind of ['bright', 'dark', 'pattern']) {
            const cover = await page.evaluate(kind => {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = kind === 'dark' ? '#080c10' : '#fff'; ctx.fillRect(0, 0, 80, 80);
                if (kind === 'pattern') for (let x = 0; x < 80; x += 16) { ctx.fillStyle = '#a50036'; ctx.fillRect(x, 0, 8, 80); }
                return canvas.toDataURL();
            }, kind);
            media = { title: 'Pochette de test', artist: 'Nolys', cover, appId: 'fixture', trackKey: kind, isPlaying: false, progress: 79000, duration: 182000 };
            await page.evaluate(data => window.island.updateMusic(data), media);
            await page.waitForFunction(cover => window.island._coverReadability?.cover === cover, cover);
            await page.waitForTimeout(700);
            shades[kind] = await page.evaluate(() => Number(window.island.el.style.getPropertyValue('--music-readability-shade')));
            if (kind === 'bright') assert.equal(await page.evaluate(() => {
                const layer = document.querySelector('.island-bg-layer'), style = getComputedStyle(layer);
                return layer.clientWidth > 0 && layer.clientHeight > 0 && style.backgroundImage !== 'none' && Number(style.opacity) > 0;
            }), true, 'the actual cover background is visible');
            await page.screenshot({ path: path.join(shots, `cover-${kind}.png`) });
        }
        assert.ok(shades.bright > .7 && shades.pattern > shades.dark);
        assert.equal(shades.dark, 0);
        await page.evaluate(() => { window.island._islandConfig.playerCoverBg = 0; window.island.renderMusic(); });
        assert.equal(await page.evaluate(() => Number(window.island.el.style.getPropertyValue('--music-readability-shade'))), 0);

        // Le visuel Nolys remplit la pochette locale, sans l'encart noir réservé aux services.
        media = { title: 'Sans pochette', artist: 'Nolys', appId: 'nolys-local', source: 'local', cover: '', isPlaying: false, progress: 0, duration: 30000, trackKey: 'local:art' };
        await page.evaluate(data => window.island.updateMusic(data), media);
        const logo = page.locator('.album-art');
        assert.equal(await logo.getAttribute('src'), '/assets/app-logo.png');
        assert.deepEqual(await logo.evaluate(el => { const s = getComputedStyle(el); return { padding: s.padding, background: s.backgroundColor }; }), { padding: '0px', background: 'rgba(0, 0, 0, 0)' });
        await page.screenshot({ path: path.join(shots, 'local-logo-full.png') });

        // Les compteurs gardent leurs nœuds et le focus ; seule la priorité change la vue.
        await page.evaluate(async () => {
            const { replay } = await import('/replay/store.js');
            window.__replay = replay;
            replay.restore({ phase: 'buffering', recording: true, recordingSeconds: 125, clipsRevision: 1, config: {}, clips: [] });
            const island = window.island;
            island._timers.reset(); island._timers.setMode('countdown'); island._timers.setDuration(300); island._timers.toggle();
            island.isExpanded = false; island.renderContent();
        });
        await page.waitForSelector('.compact-activity.is-recording');
        assert.match(await page.locator('.compact-activity').textContent(), /REC.*02:05/);
        await page.locator('.compact-activity').focus();
        await page.evaluate(() => { window.__compactNode = document.querySelector('.compact-activity'); window.__replay.status({ clipsRevision: 1, recordingSeconds: 126 }); });
        assert.equal(await page.evaluate(() => window.__compactNode === document.activeElement && window.__compactNode.isConnected), true);
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.compact-activity').evaluate(e => e.offsetHeight), 35);
        await page.screenshot({ path: path.join(shots, 'compact-rec.png') });
        await page.evaluate(() => { const island = window.island; island._timers.reset(); island._timers.setDuration(45); island._timers.toggle(); island.tickTimers(); });
        await page.waitForSelector('.compact-activity.is-urgent');
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(shots, 'compact-timer.png') });
        await page.locator('.compact-activity').click();
        await page.waitForFunction(() => window.island.isExpanded && window.island.mode === 'timer');

        // Musique + chrono : la capsule garde le titre et la bulle garde son compteur.
        await page.waitForFunction(() => !window.island._transitionInProgress);
        await page.evaluate(() => {
            const island = window.island;
            window.__replay.restore({ phase: 'idle', recording: false, clipsRevision: 1, config: {}, clips: [] });
            island._timers.reset();
            island._timers.setMode('stopwatch');
            island._timers.reset();
            island._timers.state.stopwatch.elapsedMs = 872000;
            island._timers.toggle();
            island.tickTimers();
        });
        media = { ...media, title: 'Musique avec chrono', isPlaying: true };
        await page.evaluate(data => {
            window.island.updateMusic(data);
            window.island.collapseIsland();
        }, media);
        await page.waitForSelector('.idle-title-text');
        await page.waitForSelector('#island-timer-satellite.is-visible');
        assert.equal(await page.locator('#island-timer-satellite').evaluate(bubble => bubble.classList.contains('is-wide')), true);
        assert.equal(await page.locator('.compact-activity').count(), 0);
        await page.waitForFunction(() => {
            const bubble = document.querySelector('#island-timer-satellite').getBoundingClientRect();
            const island = window.island.el.getBoundingClientRect();
            return bubble.right < island.left;
        });
        const counter = await page.locator('.satellite-timer-value').textContent();
        await page.waitForFunction(value => document.querySelector('.satellite-timer-value').textContent !== value, counter, { timeout: 4000 });
        assert.equal(await page.locator('.idle-title-text').textContent(), 'Musique avec chrono');
        await page.screenshot({ path: path.join(shots, 'music-stopwatch-satellite.png') });
        media = { ...media, isPlaying: false };
        await page.evaluate(data => window.island.updateMusic(data), media);
        await page.waitForSelector('.compact-activity');
        assert.equal(await page.locator('#island-timer-satellite').getAttribute('aria-hidden'), 'true');
        media = { ...media, isPlaying: true };
        await page.evaluate(data => window.island.updateMusic(data), media);
        await page.waitForSelector('#island-timer-satellite.is-visible');
        await page.locator('#island-timer-satellite').click();
        await page.waitForFunction(() => window.island.isExpanded && window.island.mode === 'timer');
        assert.equal(await page.evaluate(() => window.island._timers.state.mode), 'stopwatch');

        // Un minuteur proche de son échéance reste aussi à gauche pendant la lecture.
        await page.waitForFunction(() => !window.island._transitionInProgress);
        await page.evaluate(() => {
            const island = window.island;
            island._timers.reset();
            island._timers.setMode('countdown');
            island._timers.reset();
            island._timers.setDuration(45);
            island._timers.toggle();
            island.tickTimers();
            island.collapseIsland();
        });
        await page.waitForSelector('.idle-title-text');
        await page.waitForSelector('#island-timer-satellite.is-visible');
        assert.equal(await page.locator('.compact-activity').count(), 0);
        await page.locator('#island-timer-satellite').click();
        await page.waitForFunction(() => window.island.isExpanded && window.island.mode === 'timer');

        // Même rendu et remplacement sans ancien délai qui masque le nouveau message.
        await page.evaluate(() => window.island.showIslandFeedback('Ajouté aux favoris', 'ph-star'));
        const toast = page.locator('.island-feedback-toast');
        await toast.waitFor();
        assert.equal(await toast.getAttribute('role'), 'status');
        assert.equal(await toast.locator('i.ph-star').count(), 1);
        const toastStyle = await toast.evaluate(e => { const s = getComputedStyle(e); return { background: s.backgroundColor, padding: s.padding, weight: s.fontWeight }; });
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.island.showIslandFeedback('Fichiers copiés.', 'ph-copy'));
        await page.waitForTimeout(1100);
        await toast.waitFor();
        assert.equal(await toast.textContent(), 'Fichiers copiés.');
        assert.equal(await page.locator('.island-feedback-toast').count(), 1);
        await page.evaluate(() => window.island.openExpandedMode('library'));
        await page.waitForSelector('.lib');
        await page.waitForFunction(() => !window.island._transitionInProgress);
        await page.waitForTimeout(900);
        assert.equal(await toast.isVisible(), false, 'previous-view confirmations disappear during navigation');
        await page.evaluate(() => window.island._libraryController.notify('Replay sauvegardé'));
        const panelToast = page.locator('.lib-toast');
        await panelToast.waitFor();
        assert.deepEqual(await panelToast.evaluate(e => { const s = getComputedStyle(e); return { background: s.backgroundColor, padding: s.padding, weight: s.fontWeight }; }), toastStyle);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(shots, 'shared-feedback.png') });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'passed', shades, checks: ['bright/dark/pattern covers', 'cover background disabled', 'compact priorities and navigation', 'music with stopwatch and countdown satellites', 'pause and resume', 'stable counter focus', 'shared feedback style and message replacement'] }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
