/* Parcours navigateur : Réglages ouverts dans la vraie Island, pont natif simulé.
 * Lancer `npm run dev:ui`, puis `node tools/tests/settings.browser.cjs`.
 * NOLYS_SHOTS=dossier : une capture par page des Réglages. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.NOLYS_UI_URL || 'http://localhost:1420';
const screenshots = process.env.NOLYS_SCREENSHOTS_DIR || path.join(process.cwd(), 'docs', 'screenshots');
const pageShots = process.env.NOLYS_SHOTS;

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        // Même taille CSS que la fenêtre native de l'Island (720 × 600).
        const context = await browser.newContext({ viewport: { width: 720, height: 600 } });
        const calls = [];
        const errors = [];
        let layout = { x: 0, y: 0, scale: 1, displayId: 'primary' };
        async function emit(channel, payload) {
            await Promise.all(context.pages().map(page => page.evaluate(({ channel, payload }) => window.__dispatch?.(channel, payload), { channel, payload }).catch(() => {})));
        }
        await context.exposeBinding('__invoke', async (_source, command, args = {}) => {
            calls.push({ command, args });
            switch (command) {
                // Comme le cœur natif : les réglages sont relayés à l'Island (ici, la même page).
                case 'config_changed': setTimeout(() => emit('config-changed', args.config), 5); return null;
                case 'get_layout_state': return { layout, editMode: false };
                case 'get_displays': return [{ id: 'primary', label: 'Écran principal' }, { id: 'second', label: 'Écran 2' }];
                case 'set_layout_config': layout = { ...layout, ...args.layout }; setTimeout(() => emit('layout-config-changed', layout), 5); return null;
                case 'set_layout_edit_mode': setTimeout(() => emit('layout-edit-mode-changed', args.enabled), 5); return null;
                case 'save_settings_file': return true;
                case 'get_update_status': return { state: 'idle', currentVersion: '2.2.3', canCheck: false };
                case 'get_auto_start': return false;
                case 'get_mic_monitor': return { config: { enabled: false }, level: 0 };
                case 'get_system_volume': return 50;
                case 'library_get': return { tracks: [], playlists: [] };
                case 'register_shortcuts': case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            localStorage.removeItem('liquid_settings_page');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => {
                    listeners.set(channel, [...(listeners.get(channel) || []), callback]);
                    return () => listeners.set(channel, (listeners.get(channel) || []).filter(fn => fn !== callback));
                }, startDragging: async () => {} }) },
            };
        });

        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(`${base}/island/index.html`);
        await page.addStyleTag({ content: 'html { background: #14131a !important; }' });
        await page.waitForFunction(() => window.island?.localPlayer);
        const settled = () => page.waitForFunction(() => !window.island._transitionInProgress);
        const mounted = () => page.waitForFunction(() => window.island._settingsController && window.island._settingsHost?.shadowRoot?.querySelector('.nav-item'));
        const isOpen = () => page.evaluate(() => window.island.mode === 'settings' && window.island.isExpanded);
        const heading = () => page.locator('.content-header h1').textContent();
        // Sans « animations: disabled » : figer les animations empêchait le verre du SDK de se dessiner.
        const shot = async file => { await settled(); await page.waitForTimeout(1500); await page.screenshot({ path: file }); };

        // Ouverture depuis le menu de l'Island.
        await page.evaluate(() => window.island.openExpandedMode('menu'));
        await page.waitForFunction(() => !window.island._transitionInProgress && document.querySelectorAll('.island-menu-item').length > 0);
        await page.locator('.island-menu-item').filter({ hasText: /Réglages/ }).click();
        const started = Date.now();
        await mounted();
        const openMs = Date.now() - started;
        assert.equal(await heading(), 'Général');
        assert.ok(await page.evaluate(() => window.island.el.classList.contains('island-mode-settings')));
        const box = await page.evaluate(() => { const r = window.island.el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
        assert.ok(box.left >= 0 && box.right <= 720 && box.bottom <= 600, `la capsule tient dans la fenêtre : ${JSON.stringify(box)}`);
        // Plus grande forme de la capsule (680 × 524, bordure comprise), dans la fenêtre de 720 × 600.
        assert.ok(Math.abs(box.width - 682) <= 2 && Math.abs(box.height - 526) <= 2, `taille de la capsule : ${box.width} × ${box.height}`);
        // Isolation : rien des Réglages ne déborde sur la page de l'Island.
        assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.lg-surface, .lg-menu-positioner').length), 0);
        assert.ok(await page.evaluate(() => getComputedStyle(window.island._settingsHost.shadowRoot.querySelector('.settings-root')).getPropertyValue('--accent').length > 0));
        await page.evaluate(() => document.fonts.ready);
        await shot(path.join(screenshots, '21-reglages-general.png'));

        // Un clic dans les Réglages ne replie pas l'Island ; un réglage relayé ne remonte pas la vue.
        const hostBefore = await page.evaluateHandle(() => window.island._settingsHost);
        const toggle = page.getByRole('switch', { name: 'Notifications dans l’Island' });
        const checked = await toggle.getAttribute('aria-checked');
        await toggle.click();
        await page.waitForTimeout(150);
        assert.ok(calls.some(call => call.command === 'config_changed'), 'réglage envoyé au cœur natif');
        assert.notEqual(await toggle.getAttribute('aria-checked'), checked);
        assert.ok(await isOpen(), 'toujours ouverts après un clic');
        assert.ok(await page.evaluate(host => host === window.island._settingsHost && host.isConnected, hostBefore), 'même vue après config-changed');

        // Chaque page s'affiche sans erreur et tient dans la capsule.
        const labels = await page.locator('.nav-item').allTextContents();
        assert.equal(labels.length, 11);
        assert.ok(labels.some(label => label.trim() === 'Menus'));
        const overflows = [];
        for (const [index, label] of labels.entries()) {
            await page.locator('.nav-item').nth(index).click();
            await page.waitForTimeout(80);
            const overflow = await page.evaluate(() => {
                const root = window.island._settingsHost.shadowRoot;
                const pageEl = root.querySelector('.page');
                const wide = [...pageEl.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > pageEl.getBoundingClientRect().right + 1).slice(0, 3).map(e => `${e.tagName}.${String(e.className).slice(0, 40)}`);
                return { px: pageEl.scrollWidth - pageEl.clientWidth, wide };
            });
            if (overflow.px > 0) overflows.push(`${label} : ${overflow.px} px (${overflow.wide.join(', ')})`);
            if (pageShots) await shot(path.join(pageShots, `reglages-${String(index).padStart(2, '0')}.png`));
        }
        assert.deepEqual(overflows, [], 'pas de défilement horizontal');

        // Hauteur selon la page : courte (Fond d'écran) → capsule plus basse ; longue → maximum.
        await page.locator('.nav-item', { hasText: 'Fond d’écran' }).click();
        await page.waitForFunction(() => window.island.el.style.height && parseFloat(window.island.el.style.height) < 480);
        await page.locator('.nav-item', { hasText: 'Raccourcis' }).click();
        await page.waitForFunction(() => window.island.el.style.height === '524px');

        // Menu déroulant : reste dans la capsule ; Échap ferme le menu, puis les Réglages.
        await page.locator('.nav-item', { hasText: 'Position' }).click();
        await page.locator('.select-trigger').click();
        await page.getByRole('menuitem', { name: 'Écran 2' }).waitFor();
        const menuBox = await page.evaluate(() => { const r = window.island._settingsHost.shadowRoot.querySelector('.select-menu').getBoundingClientRect(); const c = window.island.el.getBoundingClientRect(); return { inside: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom, r: [r.left, r.top, r.right, r.bottom], c: [c.left, c.top, c.right, c.bottom] }; });
        assert.ok(menuBox.inside, `menu dans la capsule : ${JSON.stringify(menuBox)}`);
        if (pageShots) await page.screenshot({ path: path.join(pageShots, 'reglages-menu.png') });
        await page.keyboard.press('Escape');
        await page.getByRole('menuitem', { name: 'Écran 2' }).waitFor({ state: 'detached' });
        assert.ok(await isOpen(), 'Échap a seulement fermé le menu');

        // Taille : boutons − / + par pas de 5 %.
        await page.getByRole('button', { name: 'Plus petite' }).click();
        await page.waitForFunction(() => window.island._settingsHost.shadowRoot.querySelector('.stepper-value')?.textContent === '95 %');
        assert.equal(calls.filter(call => call.command === 'set_layout_config').at(-1).args.layout.scale, 0.95);
        await page.getByRole('button', { name: 'Plus grande' }).click();

        // Export : fenêtre native d'enregistrement, contenu JSON complet.
        await page.locator('.nav-item', { hasText: 'À propos' }).click();
        await page.getByRole('button', { name: 'Exporter', exact: true }).click();
        await page.waitForTimeout(100);
        const exported = calls.find(call => call.command === 'save_settings_file');
        assert.ok(exported && JSON.parse(exported.args.contents).type === 'liquid-dynamic-island-settings');
        assert.match(exported.args.fileName, /^nolys-reglages-\d{4}-\d{2}-\d{2}\.json$/);

        // Sélecteur de fichier ouvert (Importer) : la perte de focus ne replie pas l'Island.
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Importer', exact: true }).click();
        await chooser;
        assert.ok(await page.evaluate(() => window.island._settingsController.busy));
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.waitForTimeout(150);
        assert.ok(await isOpen(), 'pas de repli pendant le sélecteur');
        // Dialogue refermé (le focus revient à l'Island) : le repli au blur redevient possible.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(() => !window.island._settingsController.busy);

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !window.island.isExpanded);
        await settled();
        assert.equal(await page.evaluate(() => window.island._settingsController), null);

        // Raccourci (toggle) puis barre des tâches : ouvre, referme, rouvre.
        await emit('open-settings', true);
        await mounted();
        assert.equal(await heading(), 'À propos', 'dernière page consultée');
        await settled();
        await emit('open-settings', true);
        await page.waitForFunction(() => !window.island.isExpanded);
        await settled();
        await emit('open-settings', false);
        await mounted();
        await settled();
        await emit('open-settings', false);
        await page.waitForTimeout(100);
        assert.ok(await isOpen(), 'la barre des tâches ne referme pas');

        // Placement lancé depuis la page Position : fermeture, puis retour sur Position.
        await page.locator('.nav-item', { hasText: 'Position' }).click();
        await page.getByRole('button', { name: 'Déplacer', exact: true }).click();
        await page.waitForFunction(() => window.island._layoutEditMode && !window.island.isExpanded && !window.island._settingsController);
        await emit('layout-edit-mode-changed', false);
        await mounted();
        assert.equal(await heading(), 'Position');

        // Clic hors de la capsule (zone transparente) : repli.
        await settled();
        await page.mouse.click(10, 590);
        await page.waitForFunction(() => !window.island.isExpanded);
        await settled();

        assert.deepEqual(errors, []);
        console.log(`OK — Réglages dans l'Island (montés ${openMs} ms après le clic)`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
