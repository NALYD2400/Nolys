const nativeViewport = require('./island-viewport.cjs');
/* Vraie interface, pont Tauri simulé : les appels natifs sont observés sans ouvrir d'application. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport });
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
                case 'library_get': return { tracks: [{ id: 'context-track', title: 'Titre de test', artist: 'Nolys', path: 'C:\\Music\\test.wav', duration: 30000 }], playlists: [] };
                case 'launch_shortcut': return true;
                case 'get_audio_sessions': return [{ pid: 17, name: 'Lecteur.exe', volume: 50, muted: false }];
                case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
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
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(shots, name) });
        };

        // Vrais clics droits : le repli global fonctionne aussi depuis les shadow DOM.
        for (const [mode, target] of [
            ['files', '.files-panel .lib-heading'], ['replay', '.replay-panel .lib-heading'],
            ['library', '.lib-heading'], ['music-history', '.lib-heading'],
            ['settings', '.settings-root h1'], ['timer', '.timer-readout'],
            ['control', '.island-control-container'], ['menu', '.island-menu-grid'],
        ]) {
            await page.evaluate(mode => { window.island.isExpanded = true; window.island.setMode(mode); }, mode);
            await settled();
            const surface = page.locator(target).first();
            await surface.click({ button: 'right' });
            await page.waitForSelector('#island-context-menu');
            assert.equal(await page.evaluate(() => window.island.mode), mode);
            assert.equal(await page.getByRole('menuitem', { name: 'Personnaliser ce menu…', exact: true }).count(), 1);
            if (mode === 'settings') await screenshot('menus-clic-droit-page.png');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#island-context-menu').count(), 0);
            assert.equal(await page.evaluate(() => window.island.mode), mode, 'Échap ferme seulement le menu');
        }

        await page.evaluate(async () => {
            await window.island.addMusicHistoryItem({ title: 'Titre de test', artist: 'Nolys', appId: 'Spotify' });
            window.island.setMode('music-history');
        });
        await settled();
        await page.locator('.row[data-key]').click({ button: 'right' });
        assert.equal(await page.locator('.lib-menu:not([hidden])').count(), 1, 'l’historique garde son menu local');
        assert.equal(await page.locator('#island-context-menu').count(), 0);
        await page.keyboard.press('Escape');

        await page.evaluate(() => { window.island.isExpanded = true; window.island.setMode('library'); });
        await settled();
        await page.locator('.row[data-track]').click({ button: 'right' });
        assert.equal(await page.locator('.lib-menu:not([hidden])').count(), 1, 'le morceau garde son menu local');
        assert.equal(await page.locator('#island-context-menu').count(), 0);
        await page.keyboard.press('Escape');
        const search = page.locator('.lib-search input');
        await search.fill('Texte conservé');
        // Observer l'annulation au document, après tous les gestionnaires (y compris le filtre natif).
        await page.evaluate(() => document.addEventListener('contextmenu', event => {
            window.__contextPrevented = event.defaultPrevented;
        }));
        await search.click({ button: 'right' });
        assert.equal(await page.evaluate(() => window.__contextPrevented), false, 'copier/coller préservé dans le shadow DOM');
        assert.equal(await page.locator('#island-context-menu').count(), 0);
        assert.equal(await search.inputValue(), 'Texte conservé');
        await search.fill('');
        const back = page.locator('.lib-header [data-action="back"]');
        await back.focus();
        await back.press('Shift+F10');
        await page.waitForSelector('#island-context-menu');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        assert.equal(await back.evaluate(el => el.getRootNode().activeElement === el), true, 'Échap rend le focus au bouton d’origine');
        await back.press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Personnaliser ce menu…', exact: true }).click();
        await page.waitForSelector('.menu-editor-list');
        assert.equal(await page.evaluate(() => window.island.mode), 'settings');
        await screenshot('menus-clic-droit-personnalisation.png');

        await page.evaluate(() => {
            window.island.musicData = { title: 'Titre de test', artist: 'Nolys', duration: 180000, progress: 30000, isPlaying: false };
            window.island.setMode('music');
        });
        await settled();
        const beforeSeek = calls.filter(call => call.command === 'media_control').length;
        await page.locator('.progress-bar').click({ button: 'right' });
        assert.equal(await page.locator('#island-context-menu').count(), 1);
        assert.equal(await page.evaluate(() => Boolean(window.island.isScrubbing)), false);
        assert.equal(calls.filter(call => call.command === 'media_control').length, beforeSeek, 'le clic droit ne déplace pas la lecture');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.island.setMode('mixer'));
        await settled();
        const beforeVolume = calls.filter(call => call.command === 'set_session_volume').length;
        await page.locator('.mixer-volume-slider').click({ button: 'right' });
        assert.equal(await page.locator('#island-context-menu').count(), 1);
        assert.equal(await page.evaluate(() => Boolean(window.island.isScrubbingMixer)), false);
        assert.equal(calls.filter(call => call.command === 'set_session_volume').length, beforeVolume, 'le clic droit ne modifie pas le volume');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { window.island.musicData = null; });

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
        // Destination en bas de page : la fenêtre transparente est plus grande
        // que la capsule ; seule la zone de page doit servir au placement.
        await page.locator('.select-trigger').scrollIntoViewIfNeeded();
        const pageScroll = await page.locator('.page').evaluate(el => el.scrollTop);
        await page.locator('.select-trigger').click();
        const destinationBounds = async () => page.locator('.select-menu').evaluate(menu => {
            const bounds = menu.closest('.page').getBoundingClientRect();
            const rect = menu.getBoundingClientRect();
            const trigger = menu.parentElement.querySelector('.select-trigger').getBoundingClientRect();
            return {
                inside: rect.top >= bounds.top + 13 && rect.bottom <= bounds.bottom - 29
                    && rect.left >= bounds.left && rect.right <= bounds.right,
                above: rect.bottom < trigger.top,
                scrollable: menu.scrollHeight > menu.clientHeight,
                rect: [rect.left, rect.top, rect.right, rect.bottom],
                page: [bounds.left, bounds.top, bounds.right, bounds.bottom],
            };
        });
        const destination = await destinationBounds();
        assert.ok(destination.inside && destination.above && destination.scrollable, `destination visible au-dessus : ${JSON.stringify(destination)}`);
        assert.equal(await page.locator('.page').evaluate(el => el.scrollTop), pageScroll, 'ouvrir la liste ne déplace pas la page');
        await screenshot('menus-destination.png');
        await page.keyboard.press('End');
        await page.waitForFunction(() => {
            const root = window.island._settingsHost.shadowRoot;
            return root.activeElement === [...root.querySelectorAll('.select-menu [role="option"]')].at(-1);
        });
        assert.equal(await page.locator('.page').evaluate(el => el.scrollTop), pageScroll, 'le clavier fait défiler uniquement les options');
        assert.ok((await destinationBounds()).inside);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('listbox').count(), 0);
        assert.equal(await page.locator('.select-trigger').evaluate(el => el.getRootNode().activeElement === el), true);
        await page.locator('.select-trigger').click();
        await page.getByRole('option', { name: 'Application, dossier ou lien…', exact: true }).click();
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
        await page.getByRole('radio', { name: 'Clic droit', exact: true }).click();
        await page.getByRole('switch', { name: 'Afficher le morceau et les commandes de lecture', exact: true }).click();
        await page.locator('.select-trigger').click();
        await page.getByRole('option', { name: 'Menu des modules', exact: true }).click();
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
        assert.ok(contextBox.x >= 0 && contextBox.y >= 0 && contextBox.x + contextBox.width <= nativeViewport.width && contextBox.y + contextBox.height <= nativeViewport.height);
        assert.ok(await page.locator('.context-menu-entries').evaluate(el => el.scrollHeight > el.clientHeight));
        await page.getByRole('menuitem', { name: 'Réglages', exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole('menuitem', { name: 'Réglages', exact: true }).click();
        await page.waitForFunction(() => window.island.isExpanded && window.island.mode === 'settings');
        assert.deepEqual(errors, []);
        console.log('OK — menus : clic droit dans les vues, menus locaux, saisie, clavier, curseurs, personnalisation, persistance et défilement');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
