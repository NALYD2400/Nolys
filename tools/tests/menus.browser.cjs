/* Vraie interface, pont Tauri simulé : les appels natifs sont observés sans ouvrir d'application. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: { width: 720, height: 600 } });
        const calls = [];
        const errors = [];
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            calls.push({ command, args });
            switch (command) {
                case 'config_changed': setTimeout(() => page.evaluate(config => window.__dispatch('config-changed', config), args.config).catch(() => {}), 0); return;
                case 'get_layout_state': return { layout: { scale: 1 }, editMode: false };
                case 'get_update_status': return { state: 'idle', currentVersion: '2.4.0', canCheck: false };
                case 'get_mic_monitor': return { config: { enabled: false }, level: 0 };
                case 'get_system_volume': return 50;
                case 'library_get': return { tracks: [], playlists: [] };
                case 'launch_shortcut': return true;
                case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => {
                    listeners.set(channel, [...(listeners.get(channel) || []), callback]);
                    return () => {};
                }, startDragging: async () => {} }) },
            };
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        const settled = async () => {
            await page.waitForFunction(() => !window.island._transitionInProgress);
            await page.waitForTimeout(800);
        };
        const openMenu = async () => { await page.evaluate(() => window.island.openExpandedMode('menu')); await settled(); };
        const openSettings = async () => {
            await page.evaluate(() => window.island.openSettings('menus'));
            await page.waitForFunction(() => window.island._settingsHost?.shadowRoot?.querySelector('.menu-editor-list'));
            await settled();
        };
        const shots = path.join(process.cwd(), '.impeccable', 'review');
        fs.mkdirSync(shots, { recursive: true });
        const screenshot = async name => {
            await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
            await page.screenshot({ path: path.join(shots, name) });
        };

        await openMenu();
        assert.equal(await page.locator('.island-menu-item').count(), 10);
        const height9 = await page.locator('#dynamic-island').evaluate(el => el.offsetHeight);
        const clipped = await page.locator('.island-menu-grid').evaluate(grid => {
            const bounds = grid.getBoundingClientRect();
            return [...grid.children].some(child => child.getBoundingClientRect().bottom > bounds.bottom || child.getBoundingClientRect().top < bounds.top);
        });
        assert.equal(clipped, false, 'les neuf boutons sont entièrement visibles');
        await screenshot('menus-modules.png');

        await openSettings();
        await page.getByRole('switch', { name: 'Afficher Fichiers', exact: true }).click();
        await page.getByRole('button', { name: 'Descendre Centre de contrôle', exact: true }).click();
        await page.waitForTimeout(100);
        await page.locator('.select-trigger').click();
        await page.getByRole('menuitem', { name: 'Application, dossier ou lien…', exact: true }).click();
        await page.getByLabel('Nom du bouton', { exact: true }).fill('Mon dossier');
        await page.getByLabel('Application, dossier ou lien', { exact: true }).fill('C:\\Documents');
        await page.getByRole('button', { name: 'Dossier', exact: true }).click();
        await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
        await page.waitForTimeout(100);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('liquid_menus')));
        assert.equal(saved.modules[0].enabled, false);
        assert.ok(saved.modules.findIndex(item => item.id === 'music') < saved.modules.findIndex(item => item.id === 'control'));
        assert.equal(saved.modules.at(-1).name, 'Mon dossier');

        await openMenu();
        assert.equal(await page.locator('.island-menu-item').count(), 10);
        assert.equal(await page.locator('[data-menu-id="files"]').count(), 0);
        await page.getByRole('button', { name: 'Mon dossier', exact: true }).click();
        await page.waitForFunction(() => !window.island.isExpanded);
        assert.ok(calls.some(call => call.command === 'launch_shortcut' && call.args.command === 'C:\\Documents'));

        await openSettings();
        await page.getByRole('button', { name: 'Modifier Mon dossier', exact: true }).click();
        await page.getByLabel('Nom du bouton', { exact: true }).fill('Mes documents');
        await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
        await page.getByRole('tab', { name: 'Clic droit', exact: true }).click();
        await page.getByRole('switch', { name: 'Afficher le morceau et les commandes de lecture', exact: true }).click();
        await page.locator('.select-trigger').click();
        await page.getByRole('menuitem', { name: 'Menu des modules', exact: true }).click();
        await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
        await page.waitForTimeout(100);
        await screenshot('menus-reglages.png');
        await page.evaluate(() => { window.island.returnToMusicIdle(); window.island.showContextMenu(710, 590); });
        await page.getByRole('menuitem', { name: 'Bibliothèque', exact: true }).click();
        await page.waitForFunction(() => window.island.mode === 'library' && window.island.isExpanded);
        await settled();
        assert.ok(await page.locator('.island-library-view').count());

        await page.reload();
        await page.waitForFunction(() => window.island?.localPlayer);
        await openMenu();
        assert.equal(await page.getByRole('button', { name: 'Mes documents', exact: true }).count(), 1);
        const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('liquid_menus')));
        assert.equal(persisted.showMedia, false);
        assert.ok(persisted.context.some(entry => entry.id === 'menu'));

        // Une seule rangée se replie ; une longue liste défile dans les limites de la fenêtre.
        await page.evaluate(async () => {
            const { sanitizeMenus } = await import('/shared/menu-config.js');
            const menus = sanitizeMenus({ modules: [{ id: 'settings' }] });
            localStorage.setItem('liquid_menus', JSON.stringify(menus));
            window.island.renderContent();
        });
        await settled();
        assert.ok(await page.locator('#dynamic-island').evaluate(el => el.offsetHeight) < height9);
        await page.evaluate(async () => {
            const { sanitizeMenus } = await import('/shared/menu-config.js');
            const items = Array.from({ length: 38 }, (_, i) => ({ id: `custom-${i}`, name: `Dossier ${i}`, cmd: 'C:\\Documents' }));
            localStorage.setItem('liquid_menus', JSON.stringify(sanitizeMenus({ modules: items, context: items })));
            window.island.renderContent();
        });
        await settled();
        assert.ok(await page.locator('.island-menu-grid').evaluate(el => el.scrollHeight > el.clientHeight));
        await page.locator('[data-menu-id="settings"]').scrollIntoViewIfNeeded();
        await page.locator('[data-menu-id="settings"]').click();
        await page.waitForFunction(() => window.island.mode === 'settings');
        await page.evaluate(() => { window.island.returnToMusicIdle(); window.island.showContextMenu(710, 590); });
        await page.waitForTimeout(300);
        const contextBox = await page.locator('#island-context-menu').boundingBox();
        assert.ok(contextBox.x >= 0 && contextBox.y >= 0 && contextBox.x + contextBox.width <= 720 && contextBox.y + contextBox.height <= 600);
        assert.ok(await page.locator('.context-menu-entries').evaluate(el => el.scrollHeight > el.clientHeight));
        await page.getByRole('menuitem', { name: 'Réglages', exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole('menuitem', { name: 'Réglages', exact: true }).click();
        await page.waitForFunction(() => window.island.isExpanded && window.island.mode === 'settings');
        assert.deepEqual(errors, []);
        console.log('OK — menus : édition, ordre, visibilité, raccourci natif, bibliothèque, persistance, taille et défilement');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
