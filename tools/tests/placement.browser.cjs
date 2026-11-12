/* Placement réel de l'UI ; le pont reproduit le zoom et l'origine de la fenêtre native. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: require('./island-viewport.cjs') });
        let layout = { x: 420, y: -192, scale: 1, displayId: 'primary' };
        const calls = [];
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            calls.push({ command, args });
            if (command === 'get_layout_state') return { layout, editMode: false };
            if (command === 'get_mic_monitor') return { config: { enabled: false } };
            if (command === 'library_get') return { tracks: [], playlists: [] };
            if (command === 'get_system_volume') return 50;
            if (['register_shortcuts', 'get_audio_sessions', 'get_audio_devices', 'get_audio_input_devices'].includes(command)) return [];
            if (command === 'set_layout_config') {
                const next = args.layout.scale;
                layout = { ...layout, x: layout.x + 1080 * (layout.scale - next) / 2, y: layout.y + 192 * (layout.scale - next), scale: next };
                await page.evaluate(layout => window.__dispatch('layout-config-changed', layout), layout);
                await page.evaluate(() => window.__dispatch('layout-edit-mode-changed', true));
            }
            if (command === 'set_layout_edit_mode') {
                if (!args.enabled) calls.at(-1).pillHeight = await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().height);
                await page.evaluate(value => window.__dispatch('layout-edit-mode-changed', value), args.enabled);
            }
            return null;
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const cb of listeners.get(channel) || []) cb({ payload }); };
            window.__TAURI__ = {
                core: { invoke: (c, a) => window.__invoke(c, a), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, cb) => {
                    listeners.set(channel, [...(listeners.get(channel) || []), cb]); return () => {};
                } }) },
            };
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        await page.evaluate(() => window.__dispatch('layout-edit-mode-changed', true));
        await page.waitForTimeout(650);
        assert.equal(await page.locator('.layout-edit-hint, #layout-drag-surface').count(), 0);
        const screenBox = action => page.locator(`[data-layout="${action}"]`).evaluate(el => {
            const r = el.getBoundingClientRect(), { x, y, scale } = window.island.layoutViewport();
            return { x: x + r.left * scale, y: y + r.top * scale, width: r.width * scale, height: r.height * scale };
        });
        async function fixedClicks(action, count, expected, wheel = false) {
            const origin = await screenBox(action);
            for (let i = 0; i < count; i++) {
                // Même position à l'écran, convertie en coordonnées de la fenêtre après chaque zoom.
                const point = await page.evaluate(({ x, y }) => {
                    const l = window.island.layoutViewport();
                    return { x: (x - l.x) / l.scale, y: (y - l.y) / l.scale };
                }, { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 });
                if (wheel) {
                    await page.mouse.move(point.x, point.y);
                    await page.mouse.wheel(0, action === 'bigger' ? -100 : 100);
                } else await page.mouse.click(point.x, point.y);
                await page.waitForTimeout(45);
                const current = await screenBox(action);
                for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(current[key] - origin[key]) < 1, `${action} ${key} stable à ${layout.scale} : ${JSON.stringify(current)} / ${JSON.stringify(origin)}`);
            }
            await page.waitForFunction(scale => window.island._layoutConfig.scale === scale, expected);
        }
        await fixedClicks('bigger', 10, 1.5);
        await fixedClicks('smaller', 17, .65);
        await fixedClicks('bigger', 7, 1);
        await fixedClicks('bigger', 8, 1.4, true);
        await fixedClicks('smaller', 8, 1, true);
        await page.waitForFunction(() => !window.island._layoutScaleFrame);
        const previewFrames = async () => page.evaluate(async () => {
            const frames = [];
            document.querySelector('[data-layout="preview"]').click();
            for (let i = 0; i < 16; i++) {
                await new Promise(requestAnimationFrame);
                const pill = window.island.el.getBoundingClientRect();
                const bar = document.querySelector('#layout-edit-toolbar').getBoundingClientRect();
                frames.push({ height: pill.height, gap: bar.top - pill.bottom, pinned: Boolean(window.island._toolbarAnchor) });
            }
            return frames;
        });
        const opening = await previewFrames();
        assert.ok(opening.every(f => Math.abs(f.gap - 14) < 1 && !f.pinned), 'la barre suit chaque image de l’ouverture sans attente');
        assert.ok(new Set(opening.map(f => Math.round(f.height))).size > 2, 'ouverture continue');
        assert.equal(await page.evaluate(() => window.island._layoutPreview && window.island.isExpanded), true);
        await page.evaluate(() => { window.__placementContent = window.island.content.firstElementChild; });
        await fixedClicks('bigger', 3, 1.15);
        assert.ok(await page.evaluate(() => window.__placementContent === window.island.content.firstElementChild), 'la taille ne reconstruit pas le contenu');
        assert.equal(await page.evaluate(() => window.island._layoutPreview), true, 'le retour natif de taille ne ferme pas l’aperçu');
        const closing = await previewFrames();
        assert.ok(closing.every(f => Math.abs(f.gap - 14) < 1 && !f.pinned), 'la barre suit chaque image du repli sans attente');
        assert.equal(await page.evaluate(() => window.island.isExpanded), false);
        await page.waitForFunction(() => !window.island._layoutScaleFrame);
        const resizing = await page.evaluate(async () => {
            const widths = [];
            document.querySelector('[data-layout="bigger"]').click();
            for (let i = 0; i < 12; i++) {
                await new Promise(requestAnimationFrame);
                widths.push(window.island.el.getBoundingClientRect().width);
            }
            return widths;
        });
        assert.ok(new Set(resizing.map(w => w.toFixed(2))).size > 2, 'le changement de taille passe par plusieurs images');
        assert.ok(resizing.every((w, i) => !i || w >= resizing[i - 1] - .1), 'pas d’aller-retour pendant le changement de taille : ' + JSON.stringify(resizing));
        await page.mouse.move(10, 10);
        await page.waitForFunction(() => !window.island._toolbarAnchor);
        await page.waitForTimeout(250);
        const hit = calls.filter(call => call.command === 'set_hit_region').at(-1).args.rects;
        const toolbar = await page.locator('#layout-edit-toolbar').boundingBox();
        assert.ok(hit.some(r => Math.abs(r.x - toolbar.x) < 1 && Math.abs(r.y - toolbar.y) < 1), 'la barre reste cliquable côté natif');
        assert.ok(hit.every(r => r.width < 1080 && r.height < 960), 'aucun rectangle transparent de la taille de la fenêtre');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#dynamic-island-container')).pointerEvents), 'none');
        await page.keyboard.press('Shift+ArrowUp');
        assert.deepEqual(calls.filter(call => call.command === 'layout_nudge').at(-1)?.args, { dx: 0, dy: -10 });
        const shots = path.join(process.cwd(), '.impeccable/review/placement-2.6.6');
        fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, 'placement.png') });
        await page.locator('[data-layout="preview"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-layout="done"]').click();
        await page.waitForFunction(() => !window.island._layoutEditMode);
        assert.ok(calls.filter(call => call.command === 'set_layout_edit_mode').at(-1).pillHeight < 80, 'Terminer replie l’aperçu avant de rendre le zoom au cœur natif');
        assert.equal(await page.locator('#layout-edit-toolbar').isVisible(), false);
        // Même ancrage dans une surface plus large que les 1080 px de la capsule.
        await page.setViewportSize({ width: 1920, height: 1080 });
        const anchorChecks = await page.evaluate(() => {
            const island = window.island, samples = [];
            island.setLayoutEditMode(true);
            for (const [offsetX, offsetY] of [[0, 0], [240, 100], [800, 800]]) {
                island.applyWindowViewport({ x: 0, y: 0, width: 1920, height: 1760, scale: 1, offsetX, offsetY });
                const rect = island.el.getBoundingClientRect();
                samples.push({ center: rect.left + rect.width / 2, top: rect.top,
                    expectedCenter: offsetX + 540, expectedTop: offsetY + 192,
                    position: getComputedStyle(document.querySelector('#dynamic-island-container')).position });
            }
            island.setLayoutEditMode(false);
            island._windowViewport = null; delete window.__NOLYS_VIEWPORT__;
            const container = document.querySelector('#dynamic-island-container');
            container.style.removeProperty('--island-viewport-x'); container.style.removeProperty('--island-viewport-y');
            container.style.removeProperty('--island-frame-width');
            return samples;
        });
        assert.ok(anchorChecks.every(s => s.position === 'fixed' && Math.abs(s.center - s.expectedCenter) < 1 && Math.abs(s.top - s.expectedTop) < 1), `ancrage de déplacement : ${JSON.stringify(anchorChecks)}`);
        await page.setViewportSize(require('./island-viewport.cjs'));
        const haloAudit = await page.evaluate(async () => {
            const island = window.island;
            const samples = [];
            const sample = label => {
                const pill = island.el.getBoundingClientRect();
                const halo = island._halo.getBoundingClientRect();
                const error = Math.max(...['left', 'top', 'width', 'height'].map(k => Math.abs(pill[k] - halo[k])));
                samples.push({ label, error });
            };
            for (const scale of [.65, 1, 1.5]) {
                island.applyLayoutConfig({ scale });
                island.setLayoutEditMode(true);
                await new Promise(r => setTimeout(r, 500));
                for (const preview of [false, true]) {
                    island.toggleLayoutPreview(preview);
                    for (let i = 0; i < 18; i++) { await new Promise(requestAnimationFrame); await new Promise(r => setTimeout(r, 0)); sample(`${scale} preview=${preview} frame=${i}`); }
                }
                island.toggleLayoutPreview(false);
                await new Promise(r => setTimeout(r, 300));
                island.setLayoutEditMode(false);
                sample(`${scale} done immediately`);
                for (let i = 0; i < 18; i++) { await new Promise(requestAnimationFrame); await new Promise(r => setTimeout(r, 0)); sample(`${scale} done frame=${i}`); }
                island.setLayoutEditMode(true);
                island.toggleLayoutPreview(true);
                island.setLayoutEditMode(false);
                for (let i = 0; i < 18; i++) { await new Promise(requestAnimationFrame); await new Promise(r => setTimeout(r, 0)); sample(`${scale} quick preview/done frame=${i}`); }
            }
            return samples;
        });
        assert.ok(haloAudit.every(s => s.error < 1), `halo aligné : ${JSON.stringify(haloAudit.filter(s => s.error >= 1).slice(0, 8))}`);
        // Échap au milieu du glisser : aucun mouvement ne doit survivre au mode.
        await page.evaluate(() => window.island.setLayoutEditMode(true));
        await page.waitForTimeout(500);
        const dragBox = await page.locator('#dynamic-island').boundingBox();
        await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(dragBox.x + dragBox.width / 2 + 12, dragBox.y + dragBox.height / 2 + 12);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !window.island._layoutEditMode);
        await page.waitForTimeout(60);
        const dragMoves = calls.filter(call => call.command === 'layout_drag_move').length;
        const dragEnds = calls.filter(call => call.command === 'layout_drag_end').length;
        await page.mouse.move(10, 10);
        await page.mouse.up();
        await page.waitForTimeout(60);
        assert.equal(calls.filter(call => call.command === 'layout_drag_move').length, dragMoves, 'aucun déplacement après Échap');
        assert.equal(calls.filter(call => call.command === 'layout_drag_end').length, dragEnds, 'fin du glisser envoyée une seule fois');
        assert.equal(await page.evaluate(() => window.island._stopLayoutDrag === null && !document.body.classList.contains('layout-edit-dragging')), true);
        assert.deepEqual(errors, []);
        console.log('Placement : clics fixes 65–150 %, molette, aperçu/repli synchronisés, taille continue sans reconstruction, zones visibles, clavier et sortie OK.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
