import styles from './styles.css?inline';
import { libraryMarkup } from './shell.js';
import { native } from '../shared/ipc.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { tracksFor, moveTrack } from './model.js';
import { icon, renderNavigation, renderCollection, renderPlayback } from './view.js';

export function mountLibrary(host, { onMenu = () => {}, onCollapse = () => {}, savedState } = {}) {
    const document = host.shadowRoot || host.attachShadow({ mode: 'open' });
    document.innerHTML = '<link rel="stylesheet" href="/assets/icons/phosphor.css"><style>' + styles + '</style>' + libraryMarkup;
    const abort = new AbortController();
    const unlisteners = [];
    let disposed = false;
    const on = (target, name, callback) => target.addEventListener(name, callback, { signal: abort.signal });
    const state = {
        library: { tracks: [], playlists: [] }, playback: { queue: [], volume: 0.8, repeat: 'off' },
        view: 'all', query: '', sort: 'title', page: 0, selection: new Set(), importing: false, seeking: false, ...savedState, root: document,
    };
    const dialog = document.querySelector('#dialog');
    const menu = document.querySelector('#track-menu');
    let statusTimer;

    function status(message, error = false, persistent = false) {
        if (disposed) return;
        clearTimeout(statusTimer);
        const element = document.querySelector('#status');
        element.hidden = !message;
        element.classList.toggle('error', error);
        element.textContent = message;
        if (message && !persistent) statusTimer = setTimeout(() => { element.hidden = true; }, error ? 12000 : 5000);
    }

    function render() {
        if (disposed) return;
        if (!['all', 'favorites', 'queue'].includes(state.view) && !state.library.playlists.some(p => p.id === state.view)) state.view = 'all';
        const known = new Set(state.library.tracks.map(track => track.id));
        state.selection = new Set([...state.selection].filter(id => known.has(id)));
        renderNavigation(state);
        renderCollection(state);
        renderPlayback(state);
    }

    async function refresh() {
        state.library = await native.invoke('library_get');
        render();
    }

    async function mutate(mutation) {
        state.library = await native.invoke('library_mutate', { mutation });
        render();
    }

    async function control(action) { await native.invoke('library_control', { action }); }

    function openDialog({ title, body, confirm = 'Enregistrer', destructive = false, submit }) {
        if (dialog.open) dialog.close();
        document.querySelector('#dialog-content').innerHTML = `<h2 id="dialog-title">${e(title)}</h2>${body}<p id="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">Annuler</button><button type="submit" class="button ${destructive ? 'danger' : 'primary'}">${e(confirm)}</button></div>`;
        dialog.setAttribute('aria-labelledby', 'dialog-title');
        document.querySelector('#dialog-form').onsubmit = async event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.target));
            const buttons = [...event.target.querySelectorAll('button')];
            buttons.forEach(button => { button.disabled = true; });
            try { await submit(values); dialog.close(); }
            catch (error) { const message = document.querySelector('#dialog-error'); message.hidden = false; message.textContent = String(error?.message || error); }
            finally { buttons.forEach(button => { button.disabled = false; }); }
        };
        dialog.showModal();
    }

    function createPlaylist() {
        openDialog({ title: 'Nouvelle playlist', body: '<label class="field">Nom de la playlist<input name="name" maxlength="80" placeholder="Par exemple : Sur la route" required autofocus></label>', confirm: 'Créer la playlist', submit: async ({ name }) => {
            const previous = new Set(state.library.playlists.map(p => p.id));
            await mutate({ type: 'createPlaylist', name });
            state.view = state.library.playlists.find(p => !previous.has(p.id))?.id || 'all';
            state.selection.clear(); render();
        } });
    }

    function addToPlaylist(ids) {
        if (!ids.length) return;
        const existing = state.library.playlists.length;
        openDialog({ title: 'Ajouter à une playlist', confirm: 'Ajouter les morceaux',
            body: existing ? `<label class="field">Playlist<select name="playlist">${state.library.playlists.map(p => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label><p>${ids.length} morceau${ids.length > 1 ? 'x' : ''} · les doublons seront ignorés.</p>` : '<p>Créez une première playlist pour ces morceaux.</p><label class="field">Nom de la playlist<input name="name" maxlength="80" required autofocus></label>',
            submit: async values => {
                let playlist = state.library.playlists.find(p => p.id === values.playlist);
                if (!existing) {
                    const before = new Set(state.library.playlists.map(p => p.id));
                    await mutate({ type: 'createPlaylist', name: values.name });
                    playlist = state.library.playlists.find(p => !before.has(p.id));
                }
                if (!playlist) throw new Error('Cette playlist n’existe plus.');
                await mutate({ type: 'setPlaylistTracks', id: playlist.id, trackIds: [...new Set([...playlist.trackIds, ...ids])] });
                state.selection.clear(); render(); status('Morceaux ajoutés à la playlist.');
            },
        });
    }

    function removeTracks(ids) {
        const playlist = state.library.playlists.find(p => p.id === state.view);
        if (playlist) {
            return mutate({ type: 'setPlaylistTracks', id: playlist.id, trackIds: playlist.trackIds.filter(id => !ids.includes(id)) }).then(() => { state.selection.clear(); render(); });
        }
        openDialog({ title: 'Retirer de la bibliothèque ?', confirm: 'Retirer', destructive: true,
            body: `<p>${ids.length} morceau${ids.length > 1 ? 'x seront retirés' : ' sera retiré'} de Nolys et de ses playlists. Les fichiers sur votre PC seront conservés.</p>`,
            submit: async () => { await mutate({ type: 'removeTracks', ids }); state.selection.clear(); render(); },
        });
    }

    async function importMusic(kind) {
        if (state.importing) return;
        document.querySelector('.import-menu').open = false;
        state.importing = true;
        document.querySelectorAll('[data-import]').forEach(button => { button.disabled = true; });
        document.querySelector('.import-menu summary').setAttribute('aria-disabled', 'true');
        status('Choisissez votre musique. L’import des informations peut prendre un moment…', false, true);
        try {
            const result = await native.invoke('library_import', { kind });
            state.library = result.library;
            render();
            status(result.cancelled ? '' : `${result.added} morceau${result.added > 1 ? 'x' : ''} ajouté${result.added > 1 ? 's' : ''}${result.duplicates ? ` · ${result.duplicates} déjà présent${result.duplicates > 1 ? 's' : ''}` : ''}${result.skipped ? ` · ${result.skipped} élément${result.skipped > 1 ? 's' : ''} inaccessible${result.skipped > 1 ? 's' : ''}` : ''}.`);
        } finally {
            state.importing = false;
            document.querySelectorAll('[data-import]').forEach(button => { button.disabled = false; });
            document.querySelector('.import-menu summary').removeAttribute('aria-disabled');
        }
    }

    function trackMenu(id, anchor) {
        const track = state.library.tracks.find(track => track.id === id);
        if (!track) return;
        const playlist = state.library.playlists.find(p => p.id === state.view);
        const position = playlist?.trackIds.indexOf(id) ?? -1;
        const item = (action, label, glyph, disabled = false) => `<button role="menuitem" data-track-action="${action}" data-id="${e(id)}" ${disabled ? 'disabled' : ''}>${icon(glyph)}${label}</button>`;
        menu.innerHTML = item('add', 'Ajouter à une playlist', 'playlist') + item('enqueue', 'Ajouter à la file', 'queue')
            + (playlist ? item('up', 'Monter', 'arrow-up', position <= 0) + item('down', 'Descendre', 'arrow-down', position === playlist.trackIds.length - 1) + item('remove', 'Retirer de la playlist', 'minus-circle') : item('remove', 'Retirer de la bibliothèque', 'minus-circle'))
            + item('relink', 'Retrouver le fichier', 'folder-open');
        menu.hidden = false;
        const bounds = host.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(anchor.right - bounds.left - 228, bounds.width - 236)) + 'px';
        menu.style.top = Math.max(8, Math.min(anchor.bottom - bounds.top + 4, bounds.height - menu.offsetHeight - 8)) + 'px';
        menu.querySelector('button')?.focus();
    }

    async function act(action) {
        const playlist = state.library.playlists.find(p => p.id === state.view);
        switch (action) {
            case 'back-menu': onMenu(); break;
            case 'collapse': onCollapse(); break;
            case 'previous-page': state.page = Math.max(0, state.page - 1); renderCollection(state); break;
            case 'next-page': state.page += 1; renderCollection(state); break;
            case 'create-playlist': createPlaylist(); break;
            case 'close-dialog': dialog.close(); break;
            case 'add-selected': addToPlaylist([...state.selection]); break;
            case 'remove-selected': await removeTracks([...state.selection]); break;
            case 'play-collection': {
                const tracks = tracksFor(state.library, state.view, state.playback, state.query, state.sort).filter(t => !t.missing);
                if (tracks.length) await control({ type: 'play', id: tracks[0].id, queue: tracks.map(t => t.id) });
                break;
            }
            case 'rename-playlist': if (playlist) openDialog({ title: 'Renommer la playlist', body: `<label class="field">Nom<input name="name" value="${e(playlist.name)}" maxlength="80" required autofocus></label>`, submit: values => mutate({ type: 'renamePlaylist', id: playlist.id, name: values.name }) }); break;
            case 'delete-playlist': if (playlist) openDialog({ title: 'Supprimer cette playlist ?', body: `<p>La playlist « ${e(playlist.name)} » sera supprimée. Vos morceaux resteront dans la bibliothèque.</p>`, confirm: 'Supprimer la playlist', destructive: true, submit: () => mutate({ type: 'deletePlaylist', id: playlist.id }) }); break;
        }
    }

    on(document, 'click', async event => {
        const button = event.target.closest('button');
        if (!button) { if (!event.target.closest('#track-menu')) menu.hidden = true; return; }
        try {
        
            if (button.dataset.menu) return trackMenu(button.dataset.menu, button.getBoundingClientRect());
            menu.hidden = true;
            if (button.dataset.view) {
                state.view = button.dataset.view; state.page = 0; state.selection.clear(); state.query = ''; document.querySelector('#search').value = ''; render();
            } else if (button.dataset.import) await importMusic(button.dataset.import);
            else if (button.dataset.action) await act(button.dataset.action);
            else if (button.dataset.play) {
                await control({ type: 'play', id: button.dataset.play, queue: tracksFor(state.library, state.view, state.playback, state.query, state.sort).filter(t => !t.missing).map(t => t.id) });
            } else if (button.dataset.favorite) {
                const track = state.library.tracks.find(t => t.id === button.dataset.favorite);
                if (track) await mutate({ type: 'favorite', id: track.id, value: !track.favorite });
            } else if (button.dataset.media) await control({ type: 'media', action: button.dataset.media });
            else if (button.dataset.control) await control({ type: button.dataset.control });
            else if (button.dataset.trackAction) {
                const id = button.dataset.id;
                const playlist = state.library.playlists.find(p => p.id === state.view);
                switch (button.dataset.trackAction) {
                    case 'add': addToPlaylist([id]); break;
                    case 'enqueue': await control({ type: 'queue', ids: [...state.playback.queue, id] }); status('Morceau ajouté à la file.'); break;
                    case 'remove': await removeTracks([id]); break;
                    case 'relink':
                        state.relinking = true;
                        try { state.library = await native.invoke('library_relink', { id }); render(); }
                        finally { state.relinking = false; }
                        break;
                    case 'up': case 'down': if (playlist) await mutate({ type: 'setPlaylistTracks', id: playlist.id, trackIds: moveTrack(playlist.trackIds, id, button.dataset.trackAction === 'up' ? -1 : 1) }); break;
                }
            }
        } catch (error) { status(String(error?.message || error), true); }
    });

    on(document.querySelector('#search'), 'input', event => { state.query = event.target.value; state.page = 0; renderCollection(state); renderPlayback(state); });
    on(document, 'change', event => {
        const target = event.target;
        if (target.id === 'sort') { state.sort = target.value; state.page = 0; renderCollection(state); }
        if (target.dataset.select) { target.checked ? state.selection.add(target.dataset.select) : state.selection.delete(target.dataset.select); renderCollection(state); }
        if (target.id === 'select-all') {
            for (const track of tracksFor(state.library, state.view, state.playback, state.query, state.sort).slice(state.page * 100, (state.page + 1) * 100)) target.checked ? state.selection.add(track.id) : state.selection.delete(track.id);
            renderCollection(state);
        }
    });
    on(document.querySelector('#seek'), 'input', () => { state.seeking = true; });
    on(document.querySelector('#seek'), 'change', event => { state.seeking = false; control({ type: 'seek', value: Number(event.target.value) }).catch(error => status(String(error), true)); });
    on(document.querySelector('#volume'), 'input', event => control({ type: 'volume', value: Number(event.target.value) }).catch(error => status(String(error), true)));
    on(document, 'keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector('#search').focus(); }
        if (event.key === 'Escape') {
            if (dialog.open) { event.stopPropagation(); return; }
            event.preventDefault(); event.stopPropagation();
            if (!menu.hidden) menu.hidden = true;
            else if (document.querySelector('.import-menu').open) document.querySelector('.import-menu').open = false;
            else onCollapse();
        }
        if (!menu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
            const index = buttons.indexOf(document.activeElement);
            buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
    });
    on(document, 'contextmenu', event => {
        event.preventDefault(); event.stopPropagation();
        const row = event.target.closest('tr[data-track]');
        if (row) { event.preventDefault(); trackMenu(row.dataset.track, { right: event.clientX + 228, bottom: event.clientY }); }
    });
    async function listen(channel, callback) {
        const off = await native.listen(channel, payload => { if (!disposed) callback(payload); });
        if (disposed) off(); else unlisteners.push(off);
    }
    async function init() {
        await listen('local-library-changed', () => refresh().catch(error => status(String(error), true)));
        await listen('local-library-playback', playback => {
            const previous = state.playback;
            state.playback = playback;
            if (state.view === 'queue' && JSON.stringify(previous.queue) !== JSON.stringify(playback.queue)) render();
            else { renderPlayback(state); if (previous.queue?.length !== playback.queue?.length) renderNavigation(state); }
            if (playback.error && playback.error !== previous.error) status(playback.error, true);
        });
        const [library, playback] = await Promise.all([native.invoke('library_get'), native.invoke('library_get_playback')]);
        state.library = library; state.playback = playback; render();
    }
    document.querySelector('#search').value = state.query;
    init().catch(error => { render(); status(`Impossible d’ouvrir la bibliothèque : ${error}`, true, true); });
    return {
        state,
        get importing() { return state.importing || state.relinking; },
        notify: message => status(message),
        destroy() {
            disposed = true; clearTimeout(statusTimer); abort.abort();
            for (const off of unlisteners) off();
            if (dialog.open) dialog.close();
        },
    };
}
