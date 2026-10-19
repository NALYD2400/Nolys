// Real UI, simulated native bridge: validates discovery and preserved file actions.
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio'] });
    try {
        const context = await browser.newContext({ viewport: { width: 720, height: 600 } });
        const input = { id: 'input-1', name: 'Portrait.png', extension: 'png', kind: 'image', size: 30000, directory: false };
        const calls = [], errors = [];
        let snapshot = { sequence: 0, jobs: [], destination: 'C:\\Videos\\Nolys\\Exports', error: null };
        let failNext = false;
        let failPreview = false, brokenPreview = false, releasePreview = null, delayPreview = false;
        await context.route('**/__files_preview.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#364859"/><circle cx="870" cy="220" r="110" fill="#e6ba7d"/><path d="M0 800V620L320 260 650 650 910 390 1200 700V800Z" fill="#7ea6a0"/></svg>' }));
        await context.route('**/__files_broken.png', route => route.fulfill({ contentType: 'image/png', body: 'invalid image' }));
        const emit = async page => page.evaluate(s => window.__dispatch('files-changed', s), snapshot);
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            calls.push({ command, args });
            if (command === 'files_snapshot') return structuredClone(snapshot);
            if (command === 'files_pick') return [input];
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
        await page.evaluate(() => window.island.openFiles()); await settled();
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
        await page.setViewportSize({ width: 720, height: 600 });
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
        await page.evaluate(inputs => window.__dispatch('files-selection', { inputs }), [input, { ...input, id: 'input-2', name: 'Paysage.png' }]); await settled();
        await page.locator('#files-selection-list summary').click();
        await page.getByLabel('Format de sortie', { exact: true }).selectOption('png');
        assert.equal(await page.locator('#files-selection-list').getAttribute('open'), '');
        await page.setViewportSize({ width: 640, height: 600 }); await shot('files-clean-compact.png');
        assert.equal(await page.locator('.files-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        await page.evaluate(input => window.__dispatch('files-selection', { inputs: [input] }), { ...input, kind: 'pdf', extension: 'pdf', name: 'Document.pdf' }); await settled();
        assert.equal(await page.getByRole('tab', { name: 'Convertir', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Copier', exact: true }).click();
        await page.getByRole('button', { name: 'Exporter une copie', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_start' && c.args.action === 'copy'));
        await page.getByRole('button', { name: 'Dossier des exports', exact: true }).click();
        assert.ok(calls.some(c => c.command === 'files_reveal' && c.args.id === null));
        assert.deepEqual(errors, []);
        console.log('Files browser: input/output image preview, responsive bounds, return/focus, stable image during activity updates, missing/invalid images, cancelled requests, conversion, resize, compression, activity and file actions passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
