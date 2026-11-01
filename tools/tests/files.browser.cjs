const nativeViewport = require('./island-viewport.cjs');
// Real UI, simulated native bridge: validates discovery and preserved file actions.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: nativeViewport });
        const input = { id: 'input-1', name: 'Portrait.png', extension: 'png', kind: 'image', size: 30000, directory: false };
        const calls = [], errors = [];
        let snapshot = { sequence: 0, jobs: [], destination: 'C:\\Videos\\Nolys\\Exports', error: null };
        let selected = [], nextPick = [input];
        let failNext = false;
        let failPreview = false, brokenPreview = false, releasePreview = null, delayPreview = false;
        await context.route('**/__files_preview.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#364859"/><circle cx="870" cy="220" r="110" fill="#e6ba7d"/><path d="M0 800V620L320 260 650 650 910 390 1200 700V800Z" fill="#7ea6a0"/></svg>' }));
        await context.route('**/__files_broken.png', route => route.fulfill({ contentType: 'image/png', body: 'invalid image' }));
        const emit = async page => page.evaluate(s => window.__dispatch('files-changed', s), snapshot);
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            calls.push({ command, args });
            if (command === 'files_snapshot') return structuredClone(snapshot);
            if (command === 'files_pick') {
                selected = [...new Map([...selected, ...nextPick].map(input => [input.id, input])).values()];
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, inputs: selected };
                return structuredClone(selected);
            }
            if (command === 'files_remove_inputs') {
                selected = selected.filter(input => !args.ids.includes(input.id));
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, inputs: selected };
                await emit(page); return structuredClone(selected);
            }
            if (command === 'files_preferences') {
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, preferences: args.preferences };
                await emit(page); return structuredClone(snapshot);
            }
            if (command === 'files_repair_history') {
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [], repairable: false, error: null };
                await emit(page); return structuredClone(snapshot);
            }
            if (command === 'files_retry') {
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [...snapshot.jobs, { id: 'retry-job', status: 'queued', completed: 0, total: 1, outputs: [], items: [{ name: 'Failed.png', status: 'queued' }] }] };
                await emit(page); return 'retry-job';
            }
            if (command === 'files_preview') {
                if (delayPreview) await new Promise(resolve => { releasePreview = resolve; });
                if (failPreview) { failPreview = false; throw new Error('Ce fichier a été déplacé ou n’est plus disponible.'); }
                return `http://localhost:1420/${brokenPreview ? '__files_broken.png' : '__files_preview.svg'}`;
            }
            if (command === 'files_start') {
                if (failNext) { failNext = false; throw new Error('Choisissez un fond pour cette image transparente.'); }
                snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [{ id: 'job-1', status: 'done', completed: 1, total: 1, outputs: [{ id: 'output-1', name: 'Portrait.jpg', size: 12000 }], items: [{ name: input.name, status: 'done', outputId: 'output-1', sizeBefore: 30000 }] }] };
                await emit(page); return 'job-1';
            }
            if (command === 'files_forget') { snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [] }; await emit(page); }
            if (command === 'files_drag_out') setTimeout(() => page.evaluate(() => window.__dispatch('files-drag-ended', {})).catch(() => {}), 20);
            switch (command) {
                case 'get_layout_state': return { layout: { scale: 1 }, editMode: false };
                case 'get_update_status': return { state: 'idle', currentVersion: '2.4.0', canCheck: false };
                case 'get_mic_monitor': return { config: { enabled: false }, level: 0 };
                case 'get_system_volume': return 50;
                case 'library_get': return { tracks: [], playlists: [] };
                case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': case 'register_shortcuts': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true'); localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = { core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => p }, webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => { listeners.set(channel, [...(listeners.get(channel) || []), callback]); return () => {}; }, startDragging: async () => {} }) } };
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.NOLYS_UI_URL || 'http://localhost:1420'}/island/index.html`);
        await page.waitForFunction(() => window.island?.localPlayer);
        const settled = async () => { await page.waitForFunction(() => !window.island._transitionInProgress); await page.waitForTimeout(850); };
        const shots = path.join(process.cwd(), '.impeccable/review'); fs.mkdirSync(shots, { recursive: true });
        await page.addStyleTag({ content: 'html { background: #17151b !important; }' });
        const shot = async name => { await settled(); await page.screenshot({ path: path.join(shots, name) }); };
        // Les onglets visibles ne doivent pas disparaître à la fin du ressort de la capsule.
        const tabsOpening = await page.evaluate(async () => {
            const { mountFiles } = await import('/files/controller.js');
            const { initFiles } = await import('/files/store.js');
            await initFiles();
            const host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:0;top:0;width:560px;height:496px';
            document.body.append(host);
            let release;
            const controller = mountFiles(host, { onClose() {}, ready: new Promise(resolve => { release = resolve; }) });
            try {
                const root = host.shadowRoot;
                const tabs = root.querySelector('#files-tabs');
                await new Promise(requestAnimationFrame);
                const beforeReady = Number(getComputedStyle(tabs).opacity);
                release();
                await new Promise(requestAnimationFrame);
                const afterReady = Number(getComputedStyle(tabs).opacity);
                return { beforeReady, afterReady };
            } finally { controller.destroy(); host.remove(); }
        });
        assert.equal(tabsOpening.beforeReady, 1);
        assert.equal(tabsOpening.afterReady, 1, 'les onglets restent visibles quand la capsule finit de s’ouvrir');
        // Suivre l'ouverture complète, y compris le retrait de data-intro à 900 ms.
        for (const motion of ['fluid', 'vivid', 'sober']) {
            const opening = await page.evaluate(async motion => {
                localStorage.setItem('liquid_motion_level', motion);
                window.island.syncMotionPreference();
                const start = performance.now();
                let visible = false, frames = 0;
                const flickers = [];
                window.island.openFiles();
                await new Promise(resolve => {
                    const sample = () => {
                        const host = window.island._filesHost;
                        const tabs = host?.shadowRoot?.querySelector('#files-tabs');
                        let opacity = tabs ? 1 : 0;
                        // Les parents peuvent masquer les onglets sans changer leur propre style.
                        for (let node = tabs; node; node = node.parentElement || node.getRootNode().host) {
                            const style = getComputedStyle(node);
                            opacity *= Number(style.opacity);
                            if (node.hidden || style.display === 'none' || style.visibility === 'hidden') opacity = 0;
                        }
                        if (opacity >= .99) visible = true;
                        if (visible && opacity < .95) flickers.push(Math.round(performance.now() - start));
                        frames++;
                        if (performance.now() - start < 2100) requestAnimationFrame(sample);
                        else resolve();
                    };
                    requestAnimationFrame(sample);
                });
                return { visible, frames, flickers };
            }, motion);
            assert.equal(opening.visible, true, `onglets affichés en mouvement ${motion}`);
            assert.ok(opening.frames > 5, 'plusieurs images de l’ouverture sont observées');
            assert.deepEqual(opening.flickers, [], `aucune disparition après apparition, mouvement ${motion}`);
            await page.getByRole('button', { name: 'Fermer les fichiers', exact: true }).click();
            await settled();
        }
        await page.evaluate(() => { localStorage.setItem('liquid_motion_level', 'system'); window.island.syncMotionPreference(); window.island.openFiles(); }); await settled();
        await page.getByRole('heading', { name: 'Déposez vos fichiers' }).waitFor();
        await shot('files-clean-empty.png');
        await page.getByRole('tab', { name: 'Activité', exact: true }).click();
        await page.getByRole('heading', { name: 'Aucun traitement' }).waitFor();
        await page.getByRole('tab', { name: 'Fichiers', exact: true }).click();
        await page.getByRole('button', { name: 'Choisir des fichiers', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Convertir', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByText('Portrait.png', { exact: true }).count(), 1);
        await page.getByRole('button', { name: 'Aperçu de Portrait.png', exact: true }).click();
        const preview = page.locator('#files-preview-image');
        await page.waitForFunction(() => document.querySelector('.files-panel-host').shadowRoot.querySelector('img')?.naturalWidth === 1200);
        await shot('files-image-preview-desktop.png');
        assert.equal(await page.locator('#dynamic-island').evaluate(el => el.getBoundingClientRect().width > 650), true);
        await preview.evaluate(el => { window.__previewElement = el; });
        await emit(page);
        assert.equal(await preview.evaluate(el => el === window.__previewElement), true, 'activity updates preserve the decoded image');
        await page.setViewportSize({ width: 520, height: 520 }); await shot('files-image-preview-compact.png');
        assert.equal(await preview.evaluate(el => { const image = el.getBoundingClientRect(), panel = el.closest('.lib').getBoundingClientRect(); return image.left >= panel.left && image.right <= panel.right && image.bottom <= panel.bottom; }), true);
        await page.getByRole('button', { name: 'Revenir aux fichiers', exact: true }).click(); await settled();
        assert.equal(await page.getByRole('button', { name: 'Aperçu de Portrait.png', exact: true }).evaluate(el => el.getRootNode().activeElement === el), true);
        await page.setViewportSize(nativeViewport);
        failPreview = true;
        await page.getByRole('button', { name: 'Aperçu de Portrait.png', exact: true }).click();
        await page.getByRole('alert').waitFor(); assert.equal(await preview.count(), 0);
        await page.getByRole('button', { name: 'Fermer le message', exact: true }).click();
        brokenPreview = true;
        await page.getByRole('button', { name: 'Aperçu de Portrait.png', exact: true }).click();
        await page.getByText('Cette image ne peut pas être affichée.', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'Afficher dans le dossier', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_reveal' && c.args.id === 'input-1'));
        await page.keyboard.press('Escape'); await settled(); brokenPreview = false;
        delayPreview = true;
        await page.getByRole('button', { name: 'Aperçu de Portrait.png', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.files-panel-host').shadowRoot.querySelector('[data-action="preview"]').disabled);
        await page.keyboard.press('Escape');
        assert.ok(releasePreview); releasePreview(); delayPreview = false;
        await settled(); assert.equal(await preview.count(), 0, 'late response must not reopen a cancelled preview');
        await page.getByLabel('Format de sortie', { exact: true }).selectOption('jpg');
        await page.getByLabel('Si l’image est transparente', { exact: true }).selectOption('#ffffff');
        await page.getByLabel('Qualité JPG', { exact: true }).fill('75');
        await shot('files-clean-convert.png');
        await page.getByRole('button', { name: 'Convertir en JPG', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Activité', exact: true }).getAttribute('aria-selected'), 'true');
        const request = calls.find(call => call.command === 'files_start');
        assert.equal(request.args.action, 'convert'); assert.equal(request.args.options.quality, 75); assert.equal(request.args.options.background, '#ffffff');
        await page.getByRole('button', { name: 'Aperçu de Portrait.jpg', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.files-panel-host').shadowRoot.querySelector('img')?.naturalWidth === 1200);
        assert.ok(calls.some(c => c.command === 'files_preview' && c.args.id === 'output-1'));
        await page.keyboard.press('Escape'); await settled();
        assert.equal(await page.getByRole('tab', { name: 'Activité', exact: true }).getAttribute('aria-selected'), 'true');
        await page.getByRole('button', { name: 'Afficher', exact: true }).click();
        await page.getByRole('button', { name: 'Copier', exact: true }).click();
        const drag = page.getByRole('button', { name: 'Glisser', exact: true });
        await drag.hover(); await page.mouse.down(); await page.mouse.up();
        assert.ok(calls.some(c => c.command === 'files_drag_out' && c.args.ids[0] === 'output-1'));
        assert.ok(calls.some(c => c.command === 'files_reveal' && c.args.id === 'output-1'));
        assert.ok(calls.some(c => c.command === 'files_copy' && c.args.ids[0] === 'output-1'));
        await shot('files-clean-activity.png');
        await page.getByRole('tab', { name: 'Dimensions', exact: true }).click();
        await page.getByLabel('Grand côté maximal', { exact: true }).selectOption('1280');
        await page.getByRole('button', { name: 'Redimensionner', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_start' && c.args.action === 'resize' && c.args.options.maxEdge === 1280));
        await page.getByRole('tab', { name: 'Dimensions', exact: true }).click();
        await page.getByRole('button', { name: 'Compresser en JPG', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_start' && c.args.action === 'compress'));
        await page.getByRole('tab', { name: 'Convertir', exact: true }).click();
        failNext = true;
        await page.getByRole('button', { name: 'Convertir en JPG', exact: true }).click();
        assert.equal(await page.getByRole('tab', { name: 'Convertir', exact: true }).getAttribute('aria-selected'), 'true');
        await page.getByRole('alert').waitFor(); await shot('files-clean-error.png');
        await page.getByRole('button', { name: 'Fermer le message', exact: true }).click();
        assert.equal(await page.getByRole('alert').count(), 0);
        selected = [input, { ...input, id: 'input-2', name: 'Paysage.png' }]; snapshot = { ...snapshot, inputs: selected };
        await page.evaluate(inputs => window.__dispatch('files-selection', { inputs }), selected); await settled();
        await page.locator('#files-selection-list summary').click();
        await page.getByLabel('Format de sortie', { exact: true }).selectOption('png');
        assert.equal(await page.locator('#files-selection-list').getAttribute('open'), '');
        await page.setViewportSize({ width: 640, height: nativeViewport.height }); await shot('files-clean-compact.png');
        assert.equal(await page.locator('.files-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        selected = [{ ...input, kind: 'pdf', extension: 'pdf', name: 'Document.pdf' }]; snapshot = { ...snapshot, inputs: selected };
        await page.evaluate(inputs => window.__dispatch('files-selection', { inputs }), selected); await settled();
        assert.equal(await page.getByRole('tab', { name: 'Convertir', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Copier', exact: true }).click();
        await page.getByRole('button', { name: 'Exporter une copie', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_start' && c.args.action === 'copy'));
        await page.getByRole('button', { name: 'Dossier des exports', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_reveal' && c.args.id === null));

        // New module actions: complete cumulative selection, individual removal,
        // native preferences, bounded history pages and explicit recovery.
        nextPick = Array.from({ length: 7 }, (_, index) => ({ ...input, id: `added-${index}`, name: `Added ${index}.png` }));
        await page.getByRole('button', { name: 'Ajouter des fichiers', exact: true }).click();
        await page.locator('#files-selection-list summary').click();
        assert.equal(await page.locator('.files-inputs li').count(), 8);
        await page.getByRole('button', { name: 'Retirer Added 6.png de la sélection', exact: true }).click();
        assert.equal(await page.locator('.files-inputs li').count(), 7);
        assert.equal(selected.some(input => input.id === 'added-6'), false);
        await page.getByRole('button', { name: 'Vider la sélection', exact: true }).click();
        await page.getByRole('heading', { name: 'Déposez vos fichiers' }).waitFor();
        await page.getByRole('tab', { name: 'Préférences', exact: true }).click();
        await page.getByLabel('Format', { exact: true }).selectOption('webp');
        await page.getByLabel('Traitements terminés conservés', { exact: true }).selectOption('20');
        await page.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
        assert.equal(snapshot.preferences.format, 'webp'); assert.equal(snapshot.preferences.historyLimit, 20);
        const done = { status: 'done', completed: 1, total: 1, items: [{ name: 'Result.png', status: 'done' }], outputs: [] };
        snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: Array.from({ length: 43 }, (_, index) => ({ ...done, id: `history-${index}` })) };
        await emit(page); await page.getByRole('tab', { name: 'Activité', exact: true }).click();
        assert.equal(await page.locator('.files-job').count(), 20);
        await page.getByRole('button', { name: 'Suivant', exact: true }).click();
        assert.equal(await page.locator('.files-job').first().getAttribute('data-job'), 'history-22');
        snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [{ ...done, id: 'failed-job', status: 'failed', retryable: true, items: [{ name: 'Failed.png', status: 'failed', error: 'Unreadable' }] }] };
        await emit(page); await page.getByRole('button', { name: 'Réessayer les échecs', exact: true }).click();
        assert.ok(calls.some(call => call.command === 'files_retry' && call.args.jobId === 'failed-job'));
        snapshot = { ...snapshot, sequence: snapshot.sequence + 1, jobs: [], repairable: true, error: 'Historique illisible, original conservé.' };
        await emit(page);
        await page.getByRole('button', { name: 'Reconstruire l’historique…', exact: true }).click();
        assert.equal(calls.filter(call => call.command === 'files_repair_history').length, 0);
        await page.getByRole('button', { name: 'Conserver l’original et reconstruire', exact: true }).click();
        await page.getByText('Historique reconstruit.', { exact: false }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.deepEqual(errors, []);
        console.log('Files browser: previews/focus, conversion/file actions, cumulative full selection/removal, preferences, history pages, failed-only retry and explicit recovery passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
