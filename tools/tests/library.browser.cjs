/* Parcours navigateur : vraie Island, vraie Bibliothèque et HTMLAudio, pont natif simulé.
 * Lancer `npm run dev:ui`, puis `node tools/tests/library.browser.cjs`. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.NOLYS_UI_URL || 'http://127.0.0.1:1420';
const screenshots = path.join(process.cwd(), 'docs', 'screenshots');

function wavFixture() {
    const samples = 8000 * 30;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    return wav;
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
    try {
        // Même taille CSS que la fenêtre native de l'Island (620 × 600).
        const context = await browser.newContext({ viewport: { width: 620, height: 600 } });
        const library = { tracks: [], playlists: [] };
        let playerActive = false;
        let sequence = 0;
        const errors = [];
        const titles = ['Lumière', 'Été', 'Après la pluie', 'Nocturne', 'Panorama', 'Horizon', 'Résonance', 'Dérive', 'Matin calme', 'Les heures bleues', 'Traversée', 'Dernier regard'];
        const fixture = titles.map((title, index) => ({ id: `t${index}`, title, artist: ['Atlas', 'Nacre', 'Ligne Claire'][index % 3], album: ['Contours', 'Lointain', 'Clair de nuit'][index % 3], path: `/test/${index}.wav`, cover: '', duration: 30000, favorite: false, addedAt: index, missing: false }));
        async function emit(channel, payload) {
            await Promise.all(context.pages().filter(p => !p.isClosed()).map(page => page.evaluate(({ channel, payload }) => window.__dispatch?.(channel, payload), { channel, payload }).catch(() => {})));
        }
        const audioBytes = wavFixture();
        await context.route('**/__audio/**', route => {
            const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
            if (!range) return route.fulfill({ contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' }, body: audioBytes });
            const start = Number(range[1]);
            const end = range[2] ? Math.min(Number(range[2]), audioBytes.length - 1) : audioBytes.length - 1;
            return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${audioBytes.length}` }, body: audioBytes.subarray(start, end + 1) });
        });
        await context.exposeBinding('__invoke', async (_source, command, args = {}) => {
            switch (command) {
                case 'library_get': return structuredClone(library);
                case 'library_relink': {
                    const track = library.tracks.find(t => t.id === args.id);
                    track.path = `/test/relocated-${track.id}.wav`; track.missing = false;
                    await emit('local-library-changed', null);
                    return structuredClone(library);
                }
                case 'library_player_active': playerActive = args.active; return;
                case 'library_check_track': if (!library.tracks.some(t => t.id === args.id && !t.missing)) throw new Error('Fichier introuvable.'); return;
                case 'library_import': {
                    const added = library.tracks.length ? 0 : fixture.length;
                    if (added) library.tracks.push(...structuredClone(fixture));
                    await emit('local-library-changed', null);
                    return { library: structuredClone(library), added, duplicates: added ? 0 : fixture.length, skipped: 0, cancelled: false };
                }
                case 'library_mutate': {
                    const m = args.mutation;
                    if (m.type === 'createPlaylist') library.playlists.push({ id: `p${++sequence}`, name: m.name, trackIds: [] });
                    if (m.type === 'renamePlaylist') library.playlists.find(p => p.id === m.id).name = m.name;
                    if (m.type === 'deletePlaylist') library.playlists.splice(library.playlists.findIndex(p => p.id === m.id), 1);
                    if (m.type === 'setPlaylistTracks') library.playlists.find(p => p.id === m.id).trackIds = [...new Set(m.trackIds)];
                    if (m.type === 'favorite') library.tracks.find(t => t.id === m.id).favorite = m.value;
                    if (m.type === 'removeTracks') { library.tracks = library.tracks.filter(t => !m.ids.includes(t.id)); for (const p of library.playlists) p.trackIds = p.trackIds.filter(id => !m.ids.includes(id)); }
                    await emit('local-library-changed', null);
                    return structuredClone(library);
                }
                case 'get_layout_state': return { scale: 1 };
                case 'get_system_volume': return 50;
                case 'register_shortcuts': case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': return [];
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__listenerCounts = () => Object.fromEntries([...listeners].map(([name, callbacks]) => [name, callbacks.length]));
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => `${location.origin}/__audio/${encodeURIComponent(p)}` },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => {
                    listeners.set(channel, [...(listeners.get(channel) || []), callback]);
                    return () => listeners.set(channel, (listeners.get(channel) || []).filter(fn => fn !== callback));
                }, startDragging: async () => {} }) },
            };
        });

        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/island/index.html`);
        await page.addStyleTag({ content: 'html { background: #14131a !important; }' });
        await page.waitForFunction(() => window.island?.localPlayer?.library);
        const settled = () => page.waitForFunction(() => !window.island._transitionInProgress);
        const inLibrary = fn => page.waitForFunction(fn);
        const rows = () => page.locator('.row');
        const shot = async name => { await settled(); await page.waitForTimeout(1000); await page.screenshot({ path: path.join(screenshots, name), animations: 'disabled' }); };

        await page.evaluate(() => window.island.openExpandedMode('menu'));
        await page.waitForFunction(() => !window.island._transitionInProgress && document.querySelectorAll('.island-menu-item').length === 8);
        await page.locator('.island-menu-item').filter({ hasText: /Bibliothèque/ }).click();
        await page.getByText('Votre musique, ici').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await shot('18-bibliotheque-vide.png');
        const box = await page.evaluate(() => { const r = window.island.el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
        assert.ok(box.left >= 0 && box.right <= box.width && box.bottom <= box.height, `la capsule tient dans la fenêtre : ${JSON.stringify(box)}`);

        await page.getByRole('button', { name: 'Importer un dossier', exact: true }).click();
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelectorAll('.row').length === 12);
        await page.getByRole('status').filter({ hasText: '12 titres ajoutés' }).waitFor();
        await page.locator('#search').fill('ete');
        assert.equal(await rows().count(), 1);
        await page.getByRole('button', { name: 'Effacer la recherche' }).click();
        assert.equal(await rows().count(), 12);

        await page.getByRole('button', { name: 'Choisir', exact: true }).click();
        await page.locator('[data-action="toggle-select"][data-id="t0"]').click();
        await page.locator('[data-action="toggle-select"][data-id="t1"]').click();
        await page.getByRole('button', { name: 'Ajouter à…', exact: true }).click();
        await page.locator('#sheet-form input[name="name"]').fill('Sur la route');
        await page.locator('#sheet-form').getByRole('button', { name: 'Ajouter', exact: true }).click();
        await page.locator('#sheet').waitFor({ state: 'hidden' });
        assert.deepEqual(library.playlists[0].trackIds, ['t0', 't1']);
        assert.equal(await page.locator('#selection').isVisible(), false);

        await page.locator('.chip', { hasText: 'Sur la route' }).click();
        await page.getByRole('button', { name: 'Options pour Été', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Monter', exact: true }).click();
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelector('.row').dataset.track === 't1');
        assert.deepEqual(library.playlists[0].trackIds, ['t1', 't0']);
        await page.getByRole('button', { name: 'Lire', exact: true }).click();
        await page.waitForFunction(() => window.island.localPlayer.active && !window.island.localPlayer.audio.paused && window.island.localPlayer.audio.currentTime > .1);
        assert.equal(await page.evaluate(() => window.island.musicData.source), 'local');
        assert.equal(playerActive, true);
        await shot('20-bibliotheque-playlist.png');

        // Échap replie l'Island ; la musique continue.
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !window.island.isExpanded && !window.island._libraryController);
        await page.waitForFunction(() => window.island.localPlayer.audio.currentTime > .3);
        assert.equal(await page.evaluate(() => window.island.localPlayer.audio.paused), false);
        await settled();
        await page.evaluate(() => window.island.openLibrary());
        await page.locator('.chip.is-active', { hasText: 'Sur la route' }).waitFor();
        await page.locator('.chip[data-view=all]').click();
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelector('#p-title').textContent === 'Été');
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.waitForFunction(() => window.island.localPlayer.audio.paused);
        await page.locator('#volume').evaluate(el => { el.value = '.31'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForFunction(() => Math.abs(window.island.localPlayer.audio.volume - .31) < .001);
        await page.locator('#seek').evaluate(el => { el.value = '10000'; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForFunction(() => Math.abs(window.island.localPlayer.audio.currentTime - 10) < .1);
        await page.getByRole('button', { name: 'Lecture aléatoire', exact: true }).click();
        await page.waitForFunction(() => window.island.localPlayer.shuffle);
        await page.getByRole('button', { name: 'Ajouter Lumière aux favoris', exact: true }).click();
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelector('.chip[data-view=favorites] small').textContent === '1');
        assert.equal(library.tracks[0].favorite, true);
        // L'accent suit celui de l'Island (thème ou pochette), sans copie propre à la vue.
        const accent = await page.evaluate(() => [getComputedStyle(window.island._libraryHost.shadowRoot.querySelector('.lib')).getPropertyValue('--accent-rgb').trim(), getComputedStyle(document.documentElement).getPropertyValue('--neon-primary-rgb').trim()]);
        assert.equal(accent[0], accent[1] || '212, 148, 96');
        await page.getByRole('button', { name: 'Lecture', exact: true }).click();
        await shot('19-bibliotheque.png');

        library.tracks.find(t => t.id === 't1').missing = true;
        await emit('local-library-changed', null);
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelector('.row[data-track="t1"]')?.classList.contains('is-missing'));
        await page.locator('.row[data-track="t1"]').getByRole('button', { name: 'Retrouver', exact: true }).click();
        await inLibrary(() => !window.island._libraryHost.shadowRoot.querySelector('.row[data-track="t1"]')?.classList.contains('is-missing'));
        await page.locator('[data-action="play"][data-id="t1"]').click();
        await page.waitForFunction(() => window.island.localPlayer.currentSource.includes('relocated') && !window.island.localPlayer.audio.paused);
        await page.getByRole('button', { name: 'Arrêter et revenir aux autres lecteurs', exact: true }).click();
        await page.waitForFunction(() => !window.island.localPlayer.active);
        assert.equal(playerActive, false);

        await page.getByRole('button', { name: 'Choisir', exact: true }).click();
        await page.locator('[data-action="toggle-select"][data-id="t0"]').click();
        await page.locator('[data-action="toggle-select"][data-id="t1"]').click();
        await page.locator('#selection').getByRole('button', { name: 'Retirer', exact: true }).click();
        await page.locator('#sheet-form').getByRole('button', { name: 'Retirer', exact: true }).click();
        await inLibrary(() => window.island._libraryHost.shadowRoot.querySelectorAll('.row').length === 10);
        assert.equal(library.playlists[0].trackIds.length, 0);

        // Échap ferme la feuille, pas l'Island.
        for (const label of ['Créer une playlist', 'Renommer la playlist', 'Supprimer la playlist']) {
            if (label !== 'Créer une playlist') await page.locator('.chip', { hasText: 'Sur la route' }).click();
            await page.getByRole('button', { name: label, exact: true }).click();
            await page.locator('#sheet').waitFor({ state: 'visible' });
            await page.keyboard.press('Escape');
            await page.locator('#sheet').waitFor({ state: 'hidden' });
            assert.equal(await page.evaluate(() => window.island.mode), 'library');
            assert.equal(await page.evaluate(() => window.island.isExpanded), true);
        }

        await page.locator('.chip[data-view=all]').click();
        await page.locator('#search').fill('Nocturne');
        await page.getByRole('button', { name: 'Revenir au menu de l’Island', exact: true }).click();
        await page.waitForFunction(() => window.island.mode === 'menu' && !window.island._transitionInProgress && !window.island._libraryController);
        await page.locator('.island-menu-item').filter({ hasText: /Bibliothèque/ }).click();
        await page.getByText('Tous les titres').waitFor();
        assert.equal(await page.locator('#search').inputValue(), 'Nocturne');
        assert.equal(await rows().count(), 1);
        await page.evaluate(() => window.island.showNotification('Test', 'La collection reste ouverte'));
        assert.equal(await page.evaluate(() => window.island.mode), 'library');
        await page.getByRole('status').filter({ hasText: 'La collection reste ouverte' }).waitFor();
        const counts = await page.evaluate(() => window.__listenerCounts());
        assert.equal(counts['local-library-changed'], 1);
        assert.equal(counts['local-library-media'], 1);
        assert.equal(errors.length, 0, JSON.stringify(errors));
        console.log(JSON.stringify({ passed: ['entrée menu', 'taille de la capsule', 'import', 'recherche sans accents', 'sélection', 'playlist', 'ordre', 'audio réel', 'Échap et réouverture', 'pause', 'position', 'volume', 'aléatoire', 'favoris', 'accent du thème', 'fichier déplacé', 'retour aux autres lecteurs', 'retrait groupé', 'feuilles et Échap', 'état conservé', 'notification'] }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
