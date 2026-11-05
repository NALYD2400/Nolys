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
                layout = { ...layout, x: Math.round(layout.x + 1080 * (layout.scale - next) / 2), y: Math.round(layout.y + 192 * (layout.scale - next)), scale: next };
                await page.evaluate(layout => window.__dispatch('layout-config-changed', layout), layout);
                await page.evaluate(() => window.__dispatch('layout-edit-mode-changed', true));
            }
            if (command === 'set_layout_edit_mode') await page.evaluate(value => window.__dispatch('layout-edit-mode-changed', value), args.enabled);
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
            const r = el.getBoundingClientRect(), { x = 0, y = 0, scale = 1 } = window.island._layoutConfig;
            return { x: x + r.left * scale, y: y + r.top * scale, width: r.width * scale, height: r.height * scale };
        });
        async function fixedClicks(action, count, expected) {
            const origin = await screenBox(action);
            for (let i = 0; i < count; i++) {
                // Même position à l'écran, convertie en coordonnées de la fenêtre après chaque zoom.
                const point = await page.evaluate(({ x, y }) => {
                    const l = window.island._layoutConfig;
                    return { x: (x - l.x) / l.scale, y: (y - l.y) / l.scale };
                }, { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 });
                await page.mouse.click(point.x, point.y);
                await page.waitForTimeout(45);
                const current = await screenBox(action);
                for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(current[key] - origin[key]) < 1, `${action} ${key} stable à ${layout.scale} : ${JSON.stringify(current)} / ${JSON.stringify(origin)}`);
            }
            await page.waitForFunction(scale => window.island._layoutConfig.scale === scale, expected);
        }
        await fixedClicks('bigger', 10, 1.5);
        await fixedClicks('smaller', 17, .65);
        await fixedClicks('bigger', 7, 1);
        const preview = await screenBox('preview');
        await page.locator('[data-layout="preview"]').click();
        assert.equal(await page.evaluate(() => window.island._layoutPreview && window.island.isExpanded), true);
        assert.ok(Math.abs((await screenBox('preview')).y - preview.y) < 1, 'aperçu : bouton immobile');
        await fixedClicks('bigger', 3, 1.15);
        assert.equal(await page.evaluate(() => window.island._layoutPreview), true, 'le retour natif de taille ne ferme pas l’aperçu');
        await page.locator('[data-layout="preview"]').click();
        assert.equal(await page.evaluate(() => window.island.isExpanded), false);
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
        await page.locator('[data-layout="done"]').click();
        await page.waitForFunction(() => !window.island._layoutEditMode);
        assert.equal(await page.locator('#layout-edit-toolbar').isVisible(), false);
        assert.deepEqual(errors, []);
        console.log('Placement : clics fixes 65–150 %, aperçu, zones visibles, clavier et sortie OK.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
