const nativeViewport = require('./island-viewport.cjs');
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
        // Même taille CSS que la fenêtre native de l'Island (voir island-viewport.cjs).
        const context = await browser.newContext({ viewport: nativeViewport });
        const calls = [];
        const errors = [];
        let layout = { x: 0, y: 0, scale: 1, displayId: 'primary' };
        let nativePreferences = {version:1, layout:structuredClone(layout), microphone:{enabled:false,volume:60}, replay:{destination:'C:\\Videos'}, files:{destination:'C:\\Exports'}};
        let denyNative = false, denySettings = false;
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
                case 'preferences_bundle': return structuredClone(nativePreferences);
                case 'preferences_restore': if (denyNative) throw Error('Dossier natif inaccessible'); nativePreferences=structuredClone(args.bundle); return null;
                case 'ui_settings_write': if (denySettings) throw Error('Disque plein'); return null;
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
            window.__NOLYS_UI_SETTINGS__={initialized:false,values:{}};
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
        assert.ok(box.left >= 0 && box.right <= nativeViewport.width && box.bottom <= nativeViewport.height, `la capsule tient dans la fenêtre : ${JSON.stringify(box)}`);
        // Plus grande forme de la capsule (680 × 524, bordure comprise), dans la fenêtre native.
        assert.ok(Math.abs(box.width - 682) <= 2 && Math.abs(box.height - 526) <= 2, `taille de la capsule : ${box.width} × ${box.height}`);
        // Isolation : rien des Réglages ne déborde sur la page de l'Island.
        assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.lg-surface, .lg-menu-positioner').length), 0);
        assert.ok(await page.evaluate(() => getComputedStyle(window.island._settingsHost.shadowRoot.querySelector('.settings-root')).getPropertyValue('--accent').length > 0));
        await page.evaluate(() => document.fonts.ready);
        await shot(path.join(screenshots, '21-reglages-general.png'));

        // Les actions du guide mènent à une vraie section et transfèrent le focus
        // après disparition du bouton, sans modifier les menus personnalisés.
        for (const [button, destination] of [['Position', 'Position'], ['Menus', 'Menus'], ['Raccourcis', 'Raccourcis']]) {
            if (await heading() !== 'Général') await page.getByRole('button', { name: 'Général', exact: true }).click();
            const guide = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Bien démarrer', exact: true }) });
            await guide.getByRole('button', { name: button, exact: true }).click();
            await page.waitForFunction(title => {
                const root = window.island._settingsHost.shadowRoot;
                return root.activeElement === root.querySelector('h1') && root.activeElement.textContent === title;
            }, destination);
        }
        await page.getByRole('button', { name: 'Général', exact: true }).click();

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
        const checkedSelects = [];
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
            // Tous les sélecteurs partagés, y compris les listes longues du
            // Centre de contrôle et les périphériques du retour micro.
            await page.locator('.page').evaluate(async el => {
                await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
            });
            const triggers = page.locator('.select-trigger');
            for (let selectIndex = 0; selectIndex < await triggers.count(); selectIndex++) {
                const trigger = triggers.nth(selectIndex);
                await trigger.scrollIntoViewIfNeeded();
                const scroll = await page.locator('.page').evaluate(el => el.scrollTop);
                await trigger.click();
                await page.getByRole('listbox').waitFor();
                const check = async () => page.getByRole('listbox').evaluate(menu => {
                    const rect = menu.getBoundingClientRect();
                    const bounds = menu.closest('.page').getBoundingClientRect();
                    const active = menu.getRootNode().activeElement?.getBoundingClientRect();
                    return {
                        inside: rect.top >= bounds.top + 13 && rect.bottom <= bounds.bottom - 29
                            && rect.left >= bounds.left && rect.right <= bounds.right,
                        focusedVisible: active && active.top >= rect.top && active.bottom <= rect.bottom,
                        rect: [rect.left, rect.top, rect.right, rect.bottom],
                        page: [bounds.left, bounds.top, bounds.right, bounds.bottom],
                    };
                });
                for (const key of ['End', 'Home']) {
                    await page.keyboard.press(key);
                    await page.waitForTimeout(40);
                    const bounds = await check();
                    assert.ok(bounds.inside && bounds.focusedVisible, `${label.trim()} / sélecteur ${selectIndex + 1} / ${key} : ${JSON.stringify(bounds)}`);
                    assert.equal(await page.locator('.page').evaluate(el => el.scrollTop), scroll, 'la navigation reste dans la liste');
                }
                checkedSelects.push(`${label.trim()} ${selectIndex + 1}`);
                await page.keyboard.press('Escape');
                assert.equal(await page.getByRole('listbox').count(), 0);
                assert.ok(await isOpen(), 'fermer une liste laisse les Réglages ouverts');
            }
        }
        assert.deepEqual(overflows, [], 'pas de défilement horizontal');
        assert.ok(checkedSelects.length >= 8, `sélecteurs vérifiés : ${checkedSelects.join(', ')}`);
        console.log(`OK — placement et clavier des ${checkedSelects.length} sélecteurs : ${checkedSelects.join(', ')}`);

        // Taille fixe : une page courte (Fond d'écran) ou longue garde la même capsule.
        const settingsHeight = () => page.evaluate(() => window.island.el.getBoundingClientRect().height);
        await page.locator('.nav-item', { hasText: 'Fond d’écran' }).click();
        await page.waitForTimeout(700);
        assert.ok(Math.abs(await settingsHeight() - 526) <= 2, 'page courte : capsule inchangée');
        await page.locator('.nav-item', { hasText: 'Raccourcis' }).click();
        await page.waitForTimeout(700);
        assert.ok(Math.abs(await settingsHeight() - 526) <= 2, 'page longue : capsule inchangée');

        // Menu déroulant : reste dans la capsule ; Échap ferme le menu, puis les Réglages.
        await page.locator('.nav-item', { hasText: 'Position' }).click();
        await page.locator('.select-trigger').click();
        await page.getByRole('option', { name: 'Écran 2' }).waitFor();
        const menuBox = await page.evaluate(() => { const r = window.island._settingsHost.shadowRoot.querySelector('.select-menu').getBoundingClientRect(); const c = window.island.el.getBoundingClientRect(); return { inside: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom, r: [r.left, r.top, r.right, r.bottom], c: [c.left, c.top, c.right, c.bottom] }; });
        assert.ok(menuBox.inside, `menu dans la capsule : ${JSON.stringify(menuBox)}`);
        if (pageShots) await page.screenshot({ path: path.join(pageShots, 'reglages-menu.png') });
        await page.keyboard.press('Escape');
        await page.getByRole('option', { name: 'Écran 2' }).waitFor({ state: 'detached' });
        await settled();
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
        const backup = JSON.parse(exported.args.contents);
        assert.equal(backup.version,2); assert.ok(backup.uiValues && backup.nativePreferences);
        const before = await page.evaluate(()=>localStorage.getItem('liquid_motion_level'));
        const previousNative=structuredClone(nativePreferences);
        const upload = payload => page.locator('input[type="file"]').setInputFiles({name:'nolys-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
        // Validation avant mutation, puis retour arrière indépendant de chaque stockage.
        const restores=calls.filter(call=>call.command==='preferences_restore').length;
        await upload({...backup,settings:{shortcuts:[null]}});
        await page.getByText('Les raccourcis de la sauvegarde sont invalides.',{exact:true}).waitFor();
        assert.equal(calls.filter(call=>call.command==='preferences_restore').length,restores);
        denyNative=true;
        await upload({...backup,settings:{...backup.settings,motion:'sober'}});
        await page.getByText('Dossier natif inaccessible',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>localStorage.getItem('liquid_motion_level')),before);
        denyNative=false; denySettings=true;
        await upload({...backup,settings:{...backup.settings,motion:'sober'}});
        await page.waitForFunction(()=>window.island._settingsHost.shadowRoot.textContent.includes('Récupération incomplète'));
        assert.equal(await page.evaluate(()=>localStorage.getItem('liquid_motion_level')),before);
        assert.deepEqual(nativePreferences,previousNative,'le retour arrière natif est tenté malgré la panne disque');
        denySettings=false;
        await page.getByRole('button',{name:'Réessayer',exact:true}).click();
        await page.waitForFunction(()=>!window.island._settingsHost.shadowRoot.querySelector('.hotkey-error[role="alert"]'));
        await upload({...backup,settings:{...backup.settings,motion:'sober'}});
        await page.waitForFunction(()=>localStorage.getItem('liquid_motion_level')==='sober');
        await page.locator('.row').filter({hasText:'Annuler le dernier import'}).getByRole('button',{name:'Restaurer',exact:true}).click();
        await page.waitForFunction(expected=>(localStorage.getItem('liquid_motion_level') ?? 'system')===(expected ?? 'system'),before);
        assert.deepEqual(nativePreferences,previousNative);

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
    } catch (error) {
        const page = browser.contexts()[0]?.pages()[0];
        if (page) {
            await page.screenshot({ path: path.join(process.cwd(), '.impeccable/review/settings-failure.png') });
            console.error(await page.evaluate(() => ({ mode: window.island?.mode, expanded: window.island?.isExpanded, text: window.island?._settingsHost?.shadowRoot?.textContent?.slice(-900) })));
        }
        throw error;
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
