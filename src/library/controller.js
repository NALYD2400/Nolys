import { native } from '../shared/ipc.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { time, tracksFor, moveTrack } from './model.js';
import { shellMarkup, chipsMarkup, sectionMarkup, emptyMarkup, rowMarkup, selectionMarkup, menuItem, cover, VIEW_NAMES } from './view.js';
import { createPanel, setIcon, warmPanel } from './panel.js';

const PAGE = 150;
const SORTS = { title: 'Titre', artist: 'Artiste', album: 'Album', recent: 'Ajout récent' };
const VIEWS = ['all', 'favorites', 'queue'];

/**
 * Import en cours, hors de la vue : refermer puis rouvrir la Bibliothèque retrouve sa
 * progression au lieu de relancer un second import (« Un import est déjà en cours »).
 * phase : pick (sélecteur Windows ouvert), scan, read, save ; vide quand rien ne tourne.
 */
const importJob = { phase: '', done: 0, total: 0, result: null, error: '', listeners: new Set(), listening: null };
const notifyImport = () => importJob.listeners.forEach(listener => listener());

async function startImport(player, kind) {
    if (importJob.phase) return;
    importJob.listening ||= native.listen('local-library-import', progress => {
        if (!importJob.phase) return;
        Object.assign(importJob, progress);
        notifyImport();
    }).catch(() => { importJob.listening = null; });
    Object.assign(importJob, { phase: 'pick', done: 0, total: 0, result: null, error: '' });
    notifyImport();
    try {
        await importJob.listening;
        const result = await native.invoke('library_import', { kind });
        player.library = result.library;
        importJob.result = result;
    } catch (error) {
        importJob.error = String(error?.message || error);
    } finally {
        importJob.phase = '';
        notifyImport();
    }
}

const IMPORT_LABELS = { pick: 'Choisissez votre musique dans la fenêtre Windows…', scan: 'Recherche des fichiers audio…', read: 'Lecture des titres et pochettes', save: 'Enregistrement de la bibliothèque…' };

/** Ouverture fluide dès la première fois (voir warmPanel). */
export function warmLibrary(player) {
    warmPanel(host => mountLibrary(host, { player }));
}

/**
 * Vue Bibliothèque montée dans l’Island (shadow DOM : ses styles ne débordent pas).
 * La collection et la lecture viennent directement du lecteur local de l’Island.
 */
export function mountLibrary(host, { player, savedState = {}, ready = Promise.resolve(), onBack = () => {}, onClose = () => {} }) {
    const panel = createPanel(host, shellMarkup);
    const { root, $, on, toast, openMenu, closeMenu } = panel;

    const state = {
        view: 'all', query: '', sort: 'title', ...savedState,
        limit: PAGE, selecting: false, selection: new Set(), busy: false,
    };
    let library = null;
    let queueKey = '';
    let lastError = '';
    let sheetReturnFocus = null;
    let waiting = true;

    const playback = () => player.snapshot;
    const playlist = () => player.library.playlists.find(p => p.id === state.view);
    const visibleTracks = () => tracksFor(player.library, state.view, playback(), state.query, state.sort);
    const playableIds = tracks => tracks.filter(t => !t.missing).map(t => t.id);
    const errorText = error => String(error?.message || error);

    // ------------------------------------------------------------------ Rendu

    function render() {
        if (panel.disposed) return;
        library = player.library;
        if (!VIEWS.includes(state.view) && !playlist()) state.view = 'all';
        const known = new Set(library.tracks.map(t => t.id));
        for (const id of state.selection) if (!known.has(id)) state.selection.delete(id);

        const tracks = visibleTracks();
        const current = playlist();
        $('#summary').textContent = `${library.tracks.length} titre${library.tracks.length > 1 ? 's' : ''}${library.playlists.length ? ` · ${library.playlists.length} playlist${library.playlists.length > 1 ? 's' : ''}` : ''}`;
        $('#chips').innerHTML = chipsMarkup({ library, view: state.view, queueLength: playback().queue.length });
        $('#section').innerHTML = sectionMarkup({ title: current?.name || VIEW_NAMES[state.view], tracks, playlist: current, view: state.view, selecting: state.selecting, sortLabel: SORTS[state.sort] });
        $('#section').hidden = !tracks.length && !current;
        renderList(tracks);
        renderSelection(tracks);
        renderPlayer();
        $('#chips .chip.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function renderList(tracks = visibleTracks()) {
        const list = $('#list');
        const focusedKey = root.activeElement?.closest?.('[data-track]')?.dataset.track;
        const focusedAction = root.activeElement?.dataset?.action;
        const scroll = list.scrollTop;
        if (!tracks.length) {
            list.innerHTML = emptyMarkup({ query: state.query.trim(), playlist: playlist(), view: state.view });
            panel.keepFocus();
            return;
        }
        const { trackId, isPlaying } = playback();
        // Les lignes attendent que la capsule ait fini de s'agrandir (voir `ready`).
        if (waiting) return;
        const count = state.limit;
        list.innerHTML = tracks.slice(0, count).map((track, index) => rowMarkup(track, {
            index, current: track.id === trackId, playing: isPlaying, selecting: state.selecting, selected: state.selection.has(track.id),
        })).join('') + (tracks.length > count ? `<button type="button" class="pill-btn more" data-action="more">Afficher ${Math.min(PAGE, tracks.length - state.limit)} titres de plus</button>` : '');
        list.scrollTop = scroll;
        if (focusedKey) list.querySelector(`[data-track="${CSS.escape(focusedKey)}"] [data-action="${CSS.escape(focusedAction || 'play')}"]`)?.focus({ preventScroll: true });
        panel.keepFocus();
    }

    function renderSelection(tracks = visibleTracks()) {
        const bar = $('#selection');
        bar.hidden = !state.selecting;
        $('#player').hidden = state.selecting;
        if (!state.selecting) return;
        const ids = tracks.slice(0, state.limit).map(t => t.id);
        bar.innerHTML = selectionMarkup(state.selection.size, ids.length > 0 && ids.every(id => state.selection.has(id)));
    }

    function renderPlayer() {
        const snap = playback();
        const track = player.library.tracks.find(t => t.id === snap.trackId);
        const panel = $('#player');
        panel.classList.toggle('is-idle', !snap.active);
        if (panel.dataset.track !== (track?.id || '')) {
            panel.dataset.track = track?.id || '';
            $('#p-cover').innerHTML = cover(track);
            $('#p-title').textContent = track?.title || 'Aucun morceau';
            $('#p-artist').textContent = track ? track.artist || 'Artiste inconnu' : 'Choisissez un titre pour l’écouter';
        }
        const toggle = panel.querySelector('[data-action="toggle"]');
        setIcon(toggle, snap.isPlaying ? 'pause' : 'play', 'ph-fill');
        toggle.setAttribute('aria-label', snap.isPlaying ? 'Pause' : 'Lecture');
        for (const button of panel.querySelectorAll('[data-action="toggle"], [data-action="prev"], [data-action="next"], [data-action="stop"]')) button.disabled = !snap.active;

        const shuffle = panel.querySelector('[data-action="shuffle"]');
        shuffle.classList.toggle('is-on', snap.shuffle);
        shuffle.setAttribute('aria-pressed', String(snap.shuffle));
        const repeat = panel.querySelector('[data-action="repeat"]');
        const repeatMode = snap.repeat || 'off';
        repeat.classList.toggle('is-on', repeatMode !== 'off');
        repeat.setAttribute('aria-pressed', String(repeatMode !== 'off'));
        repeat.setAttribute('aria-label', `Répétition : ${{ all: 'toute la file', one: 'un seul titre', off: 'désactivée' }[repeatMode]}`);
        setIcon(repeat, repeatMode === 'one' ? 'repeat-once' : 'repeat', 'ph-bold');

        const seek = $('#seek');
        seek.max = String(Math.max(1, Math.round(snap.duration || 0)));
        seek.disabled = !snap.active;
        if (!seek.matches(':active')) seek.value = String(snap.progress || 0);
        paintSlider(seek);
        $('#p-elapsed').textContent = time(Number(seek.value));
        $('#p-duration').textContent = time(snap.duration);
        const volume = $('#volume');
        if (!volume.matches(':active')) volume.value = String(snap.volume ?? 0.8);
        paintSlider(volume);

        for (const row of root.querySelectorAll('.row')) {
            const current = row.dataset.track === snap.trackId;
            if (row.classList.contains('is-current') !== current) { renderList(); break; }
            row.querySelector('.cover-state')?.classList.toggle('is-playing', current && snap.isPlaying);
        }
    }

    function paintSlider(input) {
        const max = Number(input.max) || 1;
        input.style.setProperty('--pct', `${Math.max(0, Math.min(100, (Number(input.value) - Number(input.min || 0)) / (max - Number(input.min || 0)) * 100))}%`);
    }

    // --------------------------------------------------------- Menus et feuilles

    function trackMenu(id, anchor, point) {
        const track = player.library.tracks.find(t => t.id === id);
        if (!track) return;
        const list = playlist();
        const index = list?.trackIds.indexOf(id) ?? -1;
        openMenu(anchor, menuItem('add-to-playlist', 'Ajouter à une playlist', 'playlist', { id })
            + menuItem('enqueue', 'Lire ensuite', 'queue', { id, disabled: track.missing })
            + (list ? menuItem('move-up', 'Monter', 'arrow-up', { id, disabled: index <= 0 }) + menuItem('move-down', 'Descendre', 'arrow-down', { id, disabled: index === list.trackIds.length - 1 }) : '')
            + menuItem('relink', 'Retrouver le fichier', 'folder-open', { id })
            + '<span class="menu-divider" role="separator"></span>'
            + menuItem('remove', list ? 'Retirer de la playlist' : 'Retirer de la bibliothèque', 'minus-circle', { id, danger: true }), point);
    }

    function openSheet({ title, body, confirm = 'Enregistrer', danger = false, submit }) {
        closeMenu();
        const sheet = $('#sheet');
        const form = $('#sheet-form');
        sheetReturnFocus = root.activeElement;
        form.innerHTML = `<h2 id="sheet-title">${e(title)}</h2>${body}<p class="sheet-error" role="alert" hidden></p>
            <div class="sheet-actions"><button type="button" class="pill-btn" data-action="close-sheet">Annuler</button><button type="submit" class="pill-btn ${danger ? 'is-danger-solid' : 'is-accent'}">${e(confirm)}</button></div>`;
        form.onsubmit = async event => {
            event.preventDefault();
            const buttons = [...form.querySelectorAll('button')];
            buttons.forEach(button => { button.disabled = true; });
            try {
                await submit(Object.fromEntries(new FormData(form)));
                closeSheet();
            } catch (error) {
                const message = form.querySelector('.sheet-error');
                message.hidden = false;
                message.textContent = errorText(error);
            } finally { buttons.forEach(button => { button.disabled = false; }); }
        };
        sheet.hidden = false;
        (form.querySelector('input, select') || form.querySelector('[type="submit"]'))?.focus({ preventScroll: true });
    }

    function closeSheet() {
        const sheet = $('#sheet');
        if (sheet.hidden) return false;
        sheet.hidden = true;
        $('#sheet-form').onsubmit = null;
        if (sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
        sheetReturnFocus = null;
        return true;
    }

    // ------------------------------------------------------------------ Actions

    async function mutate(mutation) {
        player.library = await native.invoke('library_mutate', { mutation });
        render();
        return player.library;
    }

    async function createPlaylist(name) {
        const before = new Set(player.library.playlists.map(p => p.id));
        const next = await mutate({ type: 'createPlaylist', name });
        return next.playlists.find(p => !before.has(p.id));
    }

    function askNewPlaylist() {
        openSheet({ title: 'Nouvelle playlist', confirm: 'Créer', body: '<label class="field"><span>Nom</span><input name="name" maxlength="80" placeholder="Sur la route" required autocomplete="off"></label>', submit: async ({ name }) => {
            const created = await createPlaylist(name);
            if (created) setView(created.id);
        } });
    }

    function addToPlaylist(ids) {
        if (!ids.length) return;
        const playlists = player.library.playlists;
        const count = `${ids.length} titre${ids.length > 1 ? 's' : ''}`;
        openSheet({ title: 'Ajouter à une playlist', confirm: 'Ajouter',
            body: playlists.length
                ? `<label class="field"><span>Playlist</span><select name="playlist">${playlists.map(p => `<option value="${e(p.id)}" ${p.id === state.view ? 'selected' : ''}>${e(p.name)}</option>`).join('')}<option value="">Nouvelle playlist…</option></select></label><label class="field" data-new hidden><span>Nom de la nouvelle playlist</span><input name="name" maxlength="80" autocomplete="off"></label><p class="sheet-note">${count} · les doublons sont ignorés.</p>`
                : `<label class="field"><span>Nom de la nouvelle playlist</span><input name="name" maxlength="80" placeholder="Sur la route" required autocomplete="off"></label><p class="sheet-note">${count}</p>`,
            submit: async values => {
                const target = values.playlist ? player.library.playlists.find(p => p.id === values.playlist) : await createPlaylist(values.name || '');
                if (!target) throw new Error('Cette playlist n’existe plus.');
                await mutate({ type: 'setPlaylistTracks', id: target.id, trackIds: [...target.trackIds, ...ids] });
                exitSelection();
                toast(`Ajouté à « ${target.name} ».`);
            } });
        const select = root.querySelector('#sheet-form select');
        select?.addEventListener('change', () => {
            const field = root.querySelector('#sheet-form [data-new]');
            field.hidden = select.value !== '';
            field.querySelector('input').required = select.value === '';
            if (select.value === '') field.querySelector('input').focus();
        });
    }

    function removeTracks(ids) {
        if (!ids.length) return;
        const list = playlist();
        if (list) {
            return mutate({ type: 'setPlaylistTracks', id: list.id, trackIds: list.trackIds.filter(id => !ids.includes(id)) }).then(exitSelection);
        }
        openSheet({ title: 'Retirer de la bibliothèque ?', confirm: 'Retirer', danger: true,
            body: `<p class="sheet-note">${ids.length > 1 ? `${ids.length} titres seront retirés` : '1 titre sera retiré'} de Nolys et de vos playlists. Les fichiers restent sur votre PC.</p>`,
            submit: async () => { await mutate({ type: 'removeTracks', ids }); exitSelection(); } });
    }

    function importMusic(kind) {
        closeMenu();
        return startImport(player, kind);
    }

    /** Barre d'import dans le thème, et bilan quand l'import se termine. */
    let importWasRunning = false;
    function renderImport() {
        const running = Boolean(importJob.phase);
        host.toggleAttribute('data-busy', running);
        setIcon($('[data-action="import"]'), running ? 'circle-notch' : 'plus', 'ph-bold');
        const bar = $('#progress');
        bar.hidden = !running;
        if (running) {
            const counted = importJob.phase === 'read' && importJob.total > 0;
            const pct = importJob.phase === 'save' ? 100 : counted ? Math.round(importJob.done / importJob.total * 100) : 0;
            bar.classList.toggle('is-indeterminate', !counted && importJob.phase !== 'save');
            bar.style.setProperty('--pct', `${pct}%`);
            bar.setAttribute('aria-valuenow', String(pct));
            $('#progress-label').textContent = IMPORT_LABELS[importJob.phase] || 'Import…';
            $('#progress-count').textContent = counted ? `${importJob.done} / ${importJob.total}` : '';
        }
        if (importWasRunning && !running) finishImport();
        importWasRunning = running;
    }

    function finishImport() {
        const { result, error } = importJob;
        if (error) { toast(error, true); return; }
        if (!result || result.cancelled) return;
        if (result.added) { state.view = 'all'; state.query = ''; $('#search').value = ''; syncClearButton(); }
        render();
        const s = count => (count > 1 ? 's' : '');
        // Dossier déplacé puis réimporté : les titres retrouvés gardent playlists et favoris.
        const found = result.relinked ? `${result.relinked} titre${s(result.relinked)} retrouvé${s(result.relinked)} à son nouvel emplacement` : '';
        const details = [result.duplicates && `${result.duplicates} déjà présent${s(result.duplicates)}`, result.skipped && `${result.skipped} illisible${s(result.skipped)}`].filter(Boolean);
        const head = [result.added && `${result.added} titre${s(result.added)} ajouté${s(result.added)}`, found].filter(Boolean).join(' · ');
        toast(head
            ? `${head}${details.length ? ` · ${details.join(' · ')}` : ''}.`
            : `Aucun nouveau titre${details.length ? ` · ${details.join(' · ')}` : ' : aucun fichier audio pris en charge'}.`, !head && !result.duplicates);
    }

    async function relink(id) {
        if (state.busy) return;
        state.busy = true;
        try {
            const missing = () => player.library.tracks.filter(t => t.missing).length;
            const before = missing();
            player.library = await native.invoke('library_relink', { id });
            render();
            // Les autres titres du même dossier déplacé sont retrouvés avec lui.
            const others = before - missing() - 1;
            if (others > 0) toast(`${others} autre${others > 1 ? 's' : ''} titre${others > 1 ? 's' : ''} du même dossier retrouvé${others > 1 ? 's' : ''}.`);
        } finally { state.busy = false; }
    }

    async function play(id) {
        const track = player.library.tracks.find(t => t.id === id);
        if (!track || track.missing) return;
        await player.control({ type: 'play', id, queue: playableIds(visibleTracks()) });
    }

    function setView(view) {
        state.view = view;
        state.limit = PAGE;
        state.query = '';
        $('#search').value = '';
        syncClearButton();
        exitSelection(false);
        render();
        $('#list').scrollTop = 0;
    }

    function exitSelection(redraw = true) {
        state.selecting = false;
        state.selection.clear();
        if (redraw) render();
    }

    function syncClearButton() {
        $('[data-action="clear-search"]').hidden = !$('#search').value;
    }

    async function act(action, button) {
        const id = button.dataset.id;
        switch (action) {
            case 'back': onBack(); break;
            case 'import': openMenu(button, menuItem('import-folder', 'Un dossier', 'folder-open') + menuItem('import-files', 'Des fichiers', 'file-audio')); break;
            case 'import-folder': await importMusic('folder'); break;
            case 'import-files': await importMusic('files'); break;
            case 'clear-search': $('#search').value = ''; state.query = ''; syncClearButton(); render(); $('#search').focus(); break;
            case 'new-playlist': askNewPlaylist(); break;
            case 'rename-playlist': {
                const list = playlist();
                if (list) openSheet({ title: 'Renommer la playlist', body: `<label class="field"><span>Nom</span><input name="name" value="${e(list.name)}" maxlength="80" required autocomplete="off"></label>`, submit: ({ name }) => mutate({ type: 'renamePlaylist', id: list.id, name }) });
                break;
            }
            case 'delete-playlist': {
                const list = playlist();
                if (list) openSheet({ title: 'Supprimer la playlist ?', confirm: 'Supprimer', danger: true, body: `<p class="sheet-note">« ${e(list.name)} » sera supprimée. Les titres restent dans votre bibliothèque.</p>`, submit: async () => { await mutate({ type: 'deletePlaylist', id: list.id }); setView('all'); } });
                break;
            }
            case 'sort': openMenu(button, Object.entries(SORTS).map(([value, label]) => menuItem('set-sort', label, { title: 'text-aa', artist: 'user', album: 'vinyl-record', recent: 'clock' }[value], { value, checked: state.sort === value })).join('')); break;
            case 'set-sort': state.sort = button.dataset.value; state.limit = PAGE; closeMenu(); render(); break;
            case 'play-all': {
                const ids = playableIds(visibleTracks());
                if (ids.length) await player.control({ type: 'play', id: player.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0], queue: ids });
                break;
            }
            case 'select-mode': state.selecting = !state.selecting; state.selection.clear(); render(); break;
            case 'toggle-select': state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id); renderList(); renderSelection(); break;
            case 'select-all': {
                const ids = visibleTracks().slice(0, state.limit).map(t => t.id);
                const all = ids.every(trackId => state.selection.has(trackId));
                ids.forEach(trackId => (all ? state.selection.delete(trackId) : state.selection.add(trackId)));
                renderList(); renderSelection(); break;
            }
            case 'cancel-select': exitSelection(); break;
            case 'add-selected': addToPlaylist([...state.selection]); break;
            case 'remove-selected': await removeTracks([...state.selection]); break;
            case 'more': state.limit += PAGE; renderList(); break;
            case 'play': await play(id); break;
            case 'favorite': {
                const track = player.library.tracks.find(t => t.id === id);
                if (track) await mutate({ type: 'favorite', id, value: !track.favorite });
                break;
            }
            case 'track-menu': trackMenu(id, button); break;
            case 'add-to-playlist': closeMenu(); addToPlaylist([id]); break;
            case 'enqueue': {
                closeMenu();
                const snap = playback();
                if (!snap.active) { await play(id); break; }
                const queue = snap.queue.filter(q => q !== id);
                queue.splice(queue.indexOf(snap.trackId) + 1, 0, id);
                await player.control({ type: 'queue', ids: queue });
                toast('Ce titre sera lu ensuite.');
                break;
            }
            case 'move-up': case 'move-down': {
                closeMenu();
                const list = playlist();
                if (list) await mutate({ type: 'setPlaylistTracks', id: list.id, trackIds: moveTrack(list.trackIds, id, action === 'move-up' ? -1 : 1) });
                break;
            }
            case 'relink': closeMenu(); await relink(id); break;
            case 'remove': closeMenu(); await removeTracks([id]); break;
            case 'close-sheet': closeSheet(); break;
            case 'toggle': case 'prev': case 'next': await player.control({ type: 'media', action: action === 'toggle' ? 'toggle' : action }); break;
            case 'shuffle': case 'repeat': case 'stop': await player.control({ type: action }); break;
        }
    }

    // --------------------------------------------------------------- Événements

    on(root, 'click', async event => {
        const target = event.target.closest('[data-action], [data-view]');
        // Un second clic sur le bouton qui a ouvert le menu le referme simplement.
        if (panel.dismissMenuOnClick(event, target)) return;
        if (event.target === $('#sheet')) { closeSheet(); return; }
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
        try {
            if (target.dataset.view) setView(target.dataset.view);
            else await act(target.dataset.action, target);
        } catch (error) { toast(errorText(error), true); }
    });

    on(root, 'contextmenu', event => {
        event.preventDefault();
        const row = event.target.closest('.row[data-track]');
        if (row && !state.selecting) trackMenu(row.dataset.track, row.querySelector('[data-action="track-menu"]'), { x: event.clientX, y: event.clientY });
    });

    on($('#search'), 'input', event => {
        state.query = event.target.value;
        state.limit = PAGE;
        syncClearButton();
        render();
    });

    on($('#seek'), 'input', event => { paintSlider(event.target); $('#p-elapsed').textContent = time(Number(event.target.value)); });
    on($('#seek'), 'change', event => player.control({ type: 'seek', value: Number(event.target.value) }).catch(error => toast(errorText(error), true)));
    on($('#volume'), 'input', event => { paintSlider(event.target); player.control({ type: 'volume', value: Number(event.target.value) }).catch(() => {}); });

    on(root, 'keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            $('#search').focus();
            $('#search').select();
            return;
        }
        if (event.key === 'Tab' && !$('#sheet').hidden) {
            const focusable = [...$('#sheet-form').querySelectorAll('input:not([hidden]), select, button:not(:disabled)')].filter(el => !el.closest('[hidden]'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && root.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first.focus(); }
            return;
        }
        if (event.key !== 'Escape') return;
        // Échap remonte d’un niveau à la fois ; l’Island ne se replie qu’en dernier.
        event.preventDefault();
        event.stopPropagation();
        if (closeMenu({ restoreFocus: true }) || closeSheet()) return;
        if (state.selecting) { exitSelection(); return; }
        if (root.activeElement === $('#search') && $('#search').value) { act('clear-search', $('#search')); return; }
        onClose();
    });

    const unsubscribe = player.subscribe(snapshot => {
        if (panel.disposed) return;
        const nextQueue = snapshot.queue.join('|');
        const queueChanged = nextQueue !== queueKey;
        queueKey = nextQueue;
        if (player.library !== library || (queueChanged && state.view === 'queue')) render();
        else {
            if (queueChanged) $('#chips').innerHTML = chipsMarkup({ library, view: state.view, queueLength: snapshot.queue.length });
            renderPlayer();
        }
        if (snapshot.error && snapshot.error !== lastError) toast(snapshot.error, true);
        lastError = snapshot.error;
    });

    $('#search').value = state.query;
    syncClearButton();
    queueKey = playback().queue.join('|');
    lastError = playback().error;
    render();
    ready.then(() => {
        waiting = false;
        if (!panel.disposed) { renderList(); panel.startIntro(); }
    });
    importJob.listeners.add(renderImport);
    importWasRunning = Boolean(importJob.phase);
    renderImport();
    panel.focus();
    if (!player.library.tracks.length) player.reload().catch(error => toast(`Impossible d’ouvrir la bibliothèque : ${errorText(error)}`, true));

    return {
        /** Ce qui survit à une fermeture : vue, recherche et tri. */
        get savedState() { return { view: state.view, query: state.query, sort: state.sort }; },
        /** Un sélecteur Windows est ouvert : l’Island ne doit pas se replier. */
        get busy() { return state.busy || importJob.phase === 'pick'; },
        notify: message => toast(message),
        destroy() {
            panel.destroy();
            unsubscribe();
            importJob.listeners.delete(renderImport);
        },
    };
}
