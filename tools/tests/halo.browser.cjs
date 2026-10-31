// Render every capsule on transparency and inspect the actual pixels at the
// native window boundary. A visible alpha there means the shadow is clipped.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nativeViewport = require('./island-viewport.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport });
        await context.exposeBinding('__invoke', async (_source, command) => {
            if (command === 'get_layout_state') return { layout: { scale: 1 }, editMode: false };
            if (command === 'get_mic_monitor') return { config: { enabled: false }, level: 0 };
            if (command === 'get_system_volume') return 50;
            if (command === 'library_get') return { tracks: [], playlists: [] };
            if (command === 'get_update_status') return { state: 'idle', currentVersion: '2.6.1', canCheck: false };
            if (['get_audio_sessions', 'get_audio_devices', 'get_audio_input_devices', 'register_shortcuts'].includes(command)) return [];
            return null;
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            localStorage.setItem('liquid_island_config', JSON.stringify({ glowEnabled: true, glowDensity: 50, glowColorMode: 'fixed', glowColor: '#D49460' }));
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async () => () => {}, startDragging: async () => {} }) },
            };
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        const layoutSource = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/island/layout.rs'), 'utf8');
        const nativeTop = Number(layoutSource.match(/pub const PILL_TOP_OFFSET: f64 = ([\d.]+)/)[1]);
        assert.equal(await page.locator('#dynamic-island-container').evaluate(el => parseFloat(getComputedStyle(el).top)), nativeTop);
        const shots = path.join(process.cwd(), '.impeccable/review/halo');
        fs.mkdirSync(shots, { recursive: true });
        async function edges(label) {
            const png = await page.screenshot({ omitBackground: true });
            const result = await page.evaluate(async source => {
                const img = new Image(); img.src = source; await img.decode();
                const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
                const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
                let edge = 0, visible = 0;
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const alpha = data[(y * width + x) * 4 + 3];
                    visible = Math.max(visible, alpha);
                    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edge = Math.max(edge, alpha);
                }
                return { edge, visible };
            }, `data:image/png;base64,${png.toString('base64')}`);
            assert.ok(result.visible >= 200, `${label}: the capsule must actually be rendered`);
            if (result.edge > 1) fs.writeFileSync(path.join(shots, `${label}-clipped.png`), png);
            assert.ok(result.edge <= 1, `${label}: visible shadow at window edge (alpha ${result.edge}/255)`);
            console.log(`${label}: boundary alpha ${result.edge}/255`);
        }
        for (const mode of ['music', 'timer', 'network', 'menu', 'music-search', 'music-history', 'control', 'mixer', 'mic', 'library', 'settings', 'replay', 'files']) {
            await page.evaluate(mode => window.island.openExpandedMode(mode), mode);
            await page.waitForFunction(() => !window.island._transitionInProgress);
            await page.waitForTimeout(900);
            await edges(mode);
            // Freeze the breathing halo at its largest blur/opacity.
            await page.evaluate(() => {
                const island = window.island;
                island._stopGlowBreath(); island.syncGlowHalo();
                island.el.classList.add('glow-breathing');
                island._halo.classList.add('is-breathing');
                island._halo.style.setProperty('--glow-breath', '1');
            });
            await edges(`${mode}-peak`);
        }
        // Both image/file and replay players share the widest capsule (680 px).
        for (const mode of ['files', 'replay']) {
            await page.evaluate(mode => {
                const island = window.island;
                island.openExpandedMode(mode);
                island.el.classList.add(mode === 'files' ? 'island-files-preview' : 'island-replay-player');
            }, mode);
            await page.waitForTimeout(950);
            await edges(`${mode}-wide`);
        }
        // The menu's shadow must fit even when opened at any viewport corner.
        for (const [x, y] of [[0, 0], [nativeViewport.width, 0], [0, nativeViewport.height], [nativeViewport.width, nativeViewport.height]]) {
            await page.evaluate(([x, y]) => window.island.showContextMenu(x, y), [x, y]);
            await page.waitForTimeout(300);
            await edges(`context-${x}-${y}`);
        }
        await page.evaluate(() => window.island.closeContextMenu());
        await page.waitForTimeout(250);
        await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
        await page.screenshot({ path: path.join(shots, 'halo-window.png') });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
