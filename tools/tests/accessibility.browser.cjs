// Keyboard and unavailable measurements in the actual UI; all native effects are mocked.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: { width: 800, height: 720 } });
        const calls = [], errors = [];
        let stats = null, volume = 0, wifi = false;
        let mic = { config: { enabled: false, inputId: '', outputId: '', volume: 60, balance: 0, denoise: true,
            gateEnabled: true, gateThreshold: -50, highPass: true, latency: 'normal' }, running: false, inputLevel: 0, outputLevel: 0 };
        await context.exposeBinding('__invoke', async ({}, command, args = {}) => {
            calls.push({ command, args });
            switch (command) {
                case 'get_layout_state': return { layout: { scale: 1 }, editMode: false };
                case 'get_update_status': return { state: 'idle', currentVersion: '2.6.1', canCheck: false };
                case 'get_mic_monitor': return structuredClone(mic);
                case 'set_mic_monitor': mic = { ...mic, config: args.config }; return structuredClone(mic);
                case 'get_system_stats': return stats;
                case 'get_system_volume': return volume;
                case 'set_system_volume': volume = args.volume; return true;
                case 'wifi_control': if (args.action !== 'status') { wifi = args.action === 'on'; return 'ok'; } return wifi ? 'on' : 'off';
                case 'bluetooth_control': case 'dnd_control': return args.action === 'status' ? 'off' : 'ok';
                case 'library_get': return { tracks: [], playlists: [] };
                case 'get_audio_input_devices': return [{ id: 'mic-a', name: 'Micro A' }, { id: 'mic-b', name: 'Micro B' }];
                case 'get_audio_devices': return [{ id: 'out-a', name: 'Casque A' }];
                case 'get_audio_sessions': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            localStorage.setItem('liquid_control_widget_type', 'stats');
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async () => () => {}, startDragging: async () => {} }) },
            };
            Object.defineProperty(navigator, 'getBattery', { value: () => Promise.reject(new Error('Unavailable')) });
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://127.0.0.1:1421'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        const open = async mode => {
            await page.evaluate(mode => window.island.openExpandedMode(mode), mode);
            await page.waitForFunction(() => !window.island._transitionInProgress);
            await page.waitForTimeout(500);
        };
        await open('control');
        assert.equal(await page.locator('#ic-stat-val-cpu').innerText(), '—');
        assert.equal(await page.locator('#ic-stat-val-ram').innerText(), '—');
        await page.locator('#ic-wifi').focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#ic-wifi')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await page.locator('#ic-wifi').getAttribute('aria-pressed'), 'true');
        assert.ok(calls.some(call => call.command === 'wifi_control' && call.args.action === 'on'));
        await page.locator('#ic-volume-slider').focus(); await page.keyboard.press('ArrowUp');
        assert.equal(volume, 5);
        assert.equal(await page.locator('#ic-volume-slider').getAttribute('aria-valuenow'), '5');
        stats = { cpu: 0, ram: 100, diskFree: 0, diskTotal: 100 };
        await page.waitForFunction(() => document.querySelector('#ic-stat-val-cpu')?.innerText === '0%');
        assert.equal(await page.locator('#ic-stat-val-ram').innerText(), '100%');
        stats = null;
        await page.waitForFunction(() => document.querySelector('#ic-stat-val-cpu')?.innerText === '—');
        await page.evaluate(() => { localStorage.setItem('liquid_control_widget_type', 'machine'); window.island.renderControl(); });
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#ic-mach-val-batt').innerText(), '—');
        assert.equal(await page.locator('#ic-mach-val-disk').innerText(), '—');
        await open('mic');
        await page.locator('[data-mic="volume"]').focus(); await page.keyboard.press('End');
        await page.waitForFunction(() => window.island.micConfig.volume === 200);
        assert.equal(await page.locator('[data-mic="volume"]').getAttribute('aria-valuenow'), '200');
        assert.equal(await page.locator('[data-mic="volume"]').evaluate(element => document.activeElement === element), true);
        await page.locator('[data-mic="meter"]').focus(); await page.keyboard.press('ArrowUp');
        await page.waitForFunction(() => window.island.micConfig.gateThreshold === -49);
        assert.equal(await page.locator('[data-mic="meter"]').getAttribute('aria-valuenow'), '-49');
        await page.evaluate(() => window.island.openSettings('mic'));
        await page.getByRole('heading', { name: 'Retour micro', exact: true }).waitFor();
        const trigger = page.getByRole('button', { name: /^Micros :/ });
        await trigger.focus(); await page.keyboard.press('ArrowDown');
        assert.equal(await page.getByRole('option', { name: 'Par défaut de Windows' }).evaluate(element => element.getRootNode().activeElement === element), true);
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.island._settingsHost.shadowRoot.querySelector('[aria-label^="Micros :"]').textContent.includes('Micro A'));
        assert.equal(await trigger.evaluate(element => element.getRootNode().activeElement === element), true);
        await trigger.press('Tab');
        assert.notEqual(await trigger.evaluate(element => element.getRootNode().activeElement === element), true);
        await trigger.focus();
        assert.equal(mic.config.inputId, 'mic-a');
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('listbox').count(), 0);
        assert.equal(await trigger.evaluate(element => element.getRootNode().activeElement === element), true);
        await page.keyboard.press('b'); // no matching option: retain closed state
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await page.waitForFunction(async () => (await window.__invoke('get_mic_monitor')).config.inputId === 'mic-b');
        assert.equal(mic.config.inputId, 'mic-b');
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Charger', exact: true }).isEnabled(), true);
        await page.getByRole('button', { name: 'Charger', exact: true }).click();
        assert.equal(mic.config.enabled, false);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('liquid_mic_device_profiles')).profiles[0].inputId), 'mic-b');
        await page.evaluate(() => { localStorage.removeItem('liquid_mic_device_profiles'); window.dispatchEvent(new Event('nolys-preferences-restored')); });
        await page.waitForFunction(() => [...window.island._settingsHost.shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Charger')?.disabled);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'passed', checks: ['native keyboard tiles', 'zero volume keyboard', 'missing/zero/live/failed stats', 'missing battery/disk', 'microphone slider keys and focus', 'Select option focus/navigation/escape', 'device profile disabled restore'] }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
