const nativeViewport = require('./island-viewport.cjs');
// Real timer UI, isolated browser storage and a mocked native bridge. No hardware changes.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport });
        const errors = [];
        await context.exposeBinding('__invoke', async ({}, command) => {
            switch (command) {
                case 'get_layout_state': return { layout: { scale: 1 }, editMode: false };
                case 'get_mic_monitor': return { config: { enabled: false }, level: 0 };
                case 'get_update_status': return { state: 'idle', currentVersion: '2.6.1', canCheck: false };
                case 'get_system_volume': return 50;
                case 'library_get': return { tracks: [], playlists: [] };
                case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async () => () => {}, startDragging: async () => {} }) },
            };
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const open = async () => {
            await page.waitForFunction(() => window.island?._timers && window.island.localPlayer);
            await page.evaluate(() => window.island.openExpandedMode('timer'));
            await page.waitForFunction(() => !window.island._transitionInProgress);
            await page.waitForTimeout(600);
        };
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://127.0.0.1:1420'}/island/index.html`);
        await open();
        await page.locator('[data-timer-action="toggle"]').click();
        const measured = await page.evaluate(() => {
            const before = window.island.timerValue;
            const start = performance.now();
            while (performance.now() - start < 3200) { /* simulate a blocked renderer */ }
            window.island.onSecondTick();
            return window.island.timerValue - before;
        });
        assert.ok(measured >= 3, `Stopwatch lost blocked UI time: ${measured}`);
        await page.locator('[data-timer-action="toggle"]').click();
        await page.locator('[data-timer-action="countdown"]').click();
        await page.locator('.timer-name-input').fill('Cuisine');
        await page.locator('.timer-name-input').press('Enter');
        await page.locator('[data-timer-action="toggle"]').click();
        await page.locator('[data-timer-action="add"]').click();
        await page.locator('.timer-name-input').fill('Thé');
        await page.locator('.timer-name-input').press('Enter');
        await page.locator('[data-timer-action="toggle"]').click();
        await page.locator('.timer-duration-input').focus();
        await page.evaluate(() => { window.__durationNode = document.querySelector('.timer-duration-input'); });
        await page.waitForTimeout(1250);
        assert.equal(await page.evaluate(() => document.activeElement === window.__durationNode && window.__durationNode.isConnected), true);
        assert.equal(await page.evaluate(() => window.island._timers.satellite.count), 2);

        // Controls created after the release-style policy must still support editing.
        await page.evaluate(() => {
            const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
            meta.content = "script-src 'self' 'wasm-unsafe-eval'"; document.head.appendChild(meta);
            window.island.renderTimer();
        });
        await page.locator('[data-preset="0"]').focus();
        await page.locator('[data-preset="0"]').press('F2');
        await page.locator('.timer-preset-input').fill('2');
        await page.locator('.timer-preset-input').press('Enter');
        assert.equal(await page.locator('[data-preset="0"]').textContent(), '2 min');
        await page.locator('[data-preset="1"]').click({ button: 'right' });
        await page.locator('.timer-preset-input').fill('3');
        await page.locator('.timer-preset-input').press('Enter');
        assert.equal(await page.locator('[data-preset="1"]').textContent(), '3 min');
        assert.equal(await page.locator('.island-timer-container [oncontextmenu]').count(), 0);

        await page.reload(); await open();
        assert.equal(await page.evaluate(() => window.island._timers.state.timers.length), 2);
        assert.equal(await page.evaluate(() => window.island._timers.satellite.count), 2);
        assert.equal(await page.locator('.timer-name-input').inputValue(), 'Thé');
        await page.locator('.timer-duration-input').fill('00:02');
        await page.locator('.timer-duration-input').press('Enter');
        await page.evaluate(() => {
            window.__alarms = 0;
            const original = window.island.onCountdownDone;
            window.island.onCountdownDone = function (timers) { window.__alarms += timers.length; original.call(this, timers); };
        });
        await page.locator('[data-timer-action="toggle"]').click();
        await page.waitForFunction(() => window.island?._timers?.selected.completed);
        await page.evaluate(() => { window.island.tickTimers(); window.island.tickTimers(); window.dispatchEvent(new Event('focus')); });
        assert.equal(await page.evaluate(() => window.__alarms), 1);
        assert.equal(await page.locator('.timer-status').textContent(), 'Terminé');
        assert.equal(await page.evaluate(() => window.island._timers.satellite.name), 'Cuisine');
        const geometry = await page.locator('.island-timer-container').evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
        assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
        await page.evaluate(() => localStorage.setItem('liquid_timer_state', '{broken'));
        await page.reload(); await open();
        assert.equal(await page.evaluate(() => localStorage.getItem('liquid_recovery_liquid_timer_state')), '{broken');
        assert.equal(await page.evaluate(() => window.island._timers.state.timers.length), 1);
        await page.evaluate(() => {
            const state = JSON.parse(localStorage.getItem('liquid_timer_state'));
            state.mode = 'countdown'; state.timers[0].name = 'Restauré'; state.timers[0].presetMs = 15000; state.timers[0].remainingMs = 15000;
            localStorage.setItem('liquid_timer_state', JSON.stringify(state));
            window.dispatchEvent(new Event('nolys-preferences-restored'));
        });
        assert.equal(await page.locator('.timer-name-input').inputValue(), 'Restauré');
        assert.equal(await page.locator('.timer-readout').textContent(), '00:15');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'passed', blockedRendererSeconds: measured, checks: ['independent timers', 'stable input focus', 'keyboard and context editing under CSP', 'restart persistence', 'single completion alarm', 'layout fit', 'corrupt state preserved and recovered'] }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
