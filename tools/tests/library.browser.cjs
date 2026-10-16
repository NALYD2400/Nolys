/* Parcours navigateur : vrais composants et HTMLAudio, pont natif simulé. */
const { chromium } = require(process.env.NOLYS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
        const context = await browser.newContext({ viewport: { width: 1060, height: 720 } });
        const library = { tracks: [], playlists: [] };
        let playback = { active: false, queue: [], volume: .8, repeat: 'off' };
        let sequence = 0;
        let libraryOpens = 0;
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
        await context.exposeBinding('__invoke', async ({ page }, command, args = {}) => {
            switch (command) {
                case 'library_get': return structuredClone(library);
                case 'library_open': libraryOpens += 1; return;
                case 'library_relink': {
                    const track = library.tracks.find(t => t.id === args.id);
                    track.path = `/test/relocated-${track.id}.wav`; track.missing = false;
                    await emit('local-library-changed', null);
                    return structuredClone(library);
                }
                case 'library_get_playback': return structuredClone(playback);
                case 'library_set_playback': playback = args.playback; await emit('local-library-playback', playback); return;
                case 'library_control': await emit('local-library-control', args.action); return;
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
                    if (m.type === 'removeTrack') { library.tracks.splice(library.tracks.findIndex(t => t.id === m.id), 1); for (const p of library.playlists) p.trackIds = p.trackIds.filter(id => id !== m.id); }
                    if (m.type === 'removeTracks') { library.tracks = library.tracks.filter(t => !m.ids.includes(t.id)); for (const p of library.playlists) p.trackIds = p.trackIds.filter(id => !m.ids.includes(id)); }
                    await emit('local-library-changed', null);
                    return structuredClone(library);
                }
                case 'get_layout_state': return { scale: 1 };
                case 'get_system_volume': return 50;
                case 'register_shortcuts': case 'get_audio_sessions': case 'get_audio_devices': case 'get_audio_input_devices': return [];
                case 'library_window': if (args.action === 'close') setTimeout(() => page.close(), 0); return;
                default: return null;
            }
        });
        await context.addInitScript(() => {
            localStorage.setItem('liquid_tray_hint_shown', 'true');
            localStorage.setItem('liquid_sound_effects_enabled', 'false');
            const listeners = new Map();
            window.__dispatch = (channel, payload) => { for (const callback of listeners.get(channel) || []) callback({ payload }); };
            window.__TAURI__ = {
                core: { invoke: (command, args) => window.__invoke(command, args), convertFileSrc: p => `${location.origin}/__audio/${encodeURIComponent(p)}` },
                webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => {
                    listeners.set(channel, [...(listeners.get(channel) || []), callback]);
                    return () => listeners.set(channel, (listeners.get(channel) || []).filter(fn => fn !== callback));
                }, startDragging: async () => {} }) },
            };
        });
        function pageErrors(page) { page.on('pageerror', error => errors.push(error.message)); }
        const island = await context.newPage(); pageErrors(island);
        await island.goto(`${base}/island/index.html`);
        await island.waitForFunction(() => window.island?.localPlayer?.library);
        await island.evaluate(() => window.island.openExpandedMode('menu'));
        await island.waitForFunction(() => !window.island._transitionInProgress && document.querySelectorAll('.island-menu-item').length === 8);
        await island.locator('.island-menu-item').filter({ hasText: /Bibliothèque/ }).click();
        assert.equal(libraryOpens, 1);
        let page = await context.newPage(); pageErrors(page);
        await page.goto(`${base}/library/index.html`);
        await page.getByRole('heading', { name: 'Faites entrer votre musique' }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(screenshots, '18-bibliotheque-vide.png'), animations: 'disabled' });
        await page.getByRole('button', { name: 'Importer un dossier', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 12);
        await page.locator('#search').fill('ete');
        assert.equal(await page.locator('tbody tr').count(), 1);
        await page.locator('#search').fill('');
        await page.locator('#select-t0').check();
        await page.locator('#select-t1').check();
        await page.getByRole('button', { name: 'Ajouter à une playlist', exact: true }).click();
        await page.locator('dialog input[name="name"]').fill('Sur la route');
        await page.getByRole('button', { name: 'Ajouter les morceaux', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('dialog').open);
        assert.deepEqual(library.playlists[0].trackIds, ['t0', 't1']);
        await page.getByRole('button', { name: /Sur la route/ }).click();
        await page.getByRole('button', { name: 'Options pour Été', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Monter', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('tbody tr').dataset.track === 't1');
        assert.deepEqual(library.playlists[0].trackIds, ['t1', 't0']);
        await page.getByRole('button', { name: 'Écouter', exact: true }).click();
        await island.waitForFunction(() => window.island.localPlayer.active && !window.island.localPlayer.audio.paused && window.island.localPlayer.audio.currentTime > .1);
        assert.equal(await island.evaluate(() => window.island.musicData.source), 'local');
        await page.screenshot({ path: path.join(screenshots, '20-bibliotheque-playlist.png'), animations: 'disabled' });
        await page.getByRole('button', { name: 'Fermer la bibliothèque', exact: true }).click();
        await island.waitForFunction(() => window.island.localPlayer.audio.currentTime > .3);
        assert.equal(await island.evaluate(() => window.island.localPlayer.audio.paused), false);
        page = await context.newPage(); pageErrors(page); await page.goto(`${base}/library/index.html`);
        await page.waitForFunction(() => document.querySelector('#playing-title').textContent === 'Été');
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await island.waitForFunction(() => window.island.localPlayer.audio.paused);
        await page.locator('#volume').evaluate(el => { el.value = '.31'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await island.waitForFunction(() => Math.abs(window.island.localPlayer.audio.volume - .31) < .001);
        await page.locator('#seek').evaluate(el => { el.value = '10000'; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await island.waitForFunction(() => Math.abs(window.island.localPlayer.audio.currentTime - 10) < .1).catch(async error => { console.error(await island.evaluate(() => ({ state: window.island.localPlayer.snapshot, seekable: window.island.localPlayer.audio.seekable.length }))); throw error; });
        await page.getByRole('button', { name: 'Lecture aléatoire', exact: true }).click();
        await island.waitForFunction(() => window.island.localPlayer.shuffle);
        await page.getByRole('button', { name: 'Ajouter Lumière aux favoris', exact: true }).click();
        assert.equal(library.tracks[0].favorite, true);
        await page.screenshot({ path: path.join(screenshots, '19-bibliotheque.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 780, height: 540 });
        const bounds = await page.evaluate(() => ({ horizontalOverflow: document.body.scrollWidth > innerWidth, playerBottom: document.querySelector('#player').getBoundingClientRect().bottom, height: innerHeight }));
        assert.equal(bounds.horizontalOverflow, false); assert.ok(bounds.playerBottom <= bounds.height);
        await page.screenshot({ path: path.join(screenshots, '21-bibliotheque-compacte.png'), animations: 'disabled' });
        library.tracks.find(t => t.id === 't1').missing = true;
        await emit('local-library-changed', null);
        await page.waitForFunction(() => document.querySelector('tr[data-track="t1"]')?.classList.contains('missing'));
        await page.getByRole('button', { name: 'Options pour Été', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Retrouver le fichier', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('tr[data-track="t1"]')?.classList.contains('missing'));
        await page.locator('[data-play="t1"]').click();
        await island.waitForFunction(() => window.island.localPlayer.currentSource.includes('relocated') && !window.island.localPlayer.audio.paused);
        await page.getByRole('button', { name: 'Arrêter la musique locale et revenir aux lecteurs externes', exact: true }).click();
        await island.waitForFunction(() => !window.island.localPlayer.active);
        await page.locator('#select-t0').check();
        await page.locator('#select-t1').check();
        await page.getByRole('button', { name: 'Retirer la sélection', exact: true }).click();
        await page.locator('dialog').getByRole('button', { name: 'Retirer', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 10);
        assert.equal(library.playlists[0].trackIds.length, 0);
        assert.equal(errors.length, 0, JSON.stringify(errors));
        console.log(JSON.stringify({ passed: ['entrée menu', 'import', 'recherche sans accents', 'playlist', 'ordre', 'audio réel', 'fermeture et réouverture', 'pause', 'position', 'volume', 'aléatoire', 'favoris', 'petite fenêtre', 'fichier déplacé', 'retour lecteurs externes', 'retrait groupé'], errors }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
