import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { time, tracksFor } from './model.js';
import { native } from '../shared/ipc.js';

export const icon = name => `<i class="${name.endsWith('-fill') ? 'ph-fill' : 'ph'} ph-${name.replace(/-fill$/, '')}" aria-hidden="true"></i>`;
export const cover = track => track?.cover ? `<img src="${e(native.fileSrc(track.cover))}" alt="" loading="lazy">` : icon('vinyl-record');

export function renderNavigation(state) {
    const document = state.root || globalThis.document;
    const { library, view } = state;
    const items = [['all', 'stack', 'Tous les titres', library.tracks.length], ['favorites', 'heart', 'Favoris', library.tracks.filter(t => t.favorite).length], ['queue', 'queue', 'File de lecture', state.playback.queue?.length || 0]];
    document.querySelector('#navigation').innerHTML = items.map(([id, glyph, label, count]) => `<button data-view="${id}" class="nav-item ${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span><small>${count}</small></button>`).join('');
    document.querySelector('#playlists').innerHTML = library.playlists.length
        ? library.playlists.map(playlist => `<button data-view="${e(playlist.id)}" class="nav-item ${view === playlist.id ? 'active' : ''}" ${view === playlist.id ? 'aria-current="page"' : ''}>${icon('playlist')}<span>${e(playlist.name)}</span><small>${playlist.trackIds.length}</small></button>`).join('')
        : '<p class="playlist-hint">Une ambiance, un trajet, une envie.<br>Créez votre première playlist.</p>';
}

export function renderCollection(state) {
    const document = state.root || globalThis.document;
    const { library, view, playback, selection } = state;
    const playlist = library.playlists.find(playlist => playlist.id === view);
    const tracks = tracksFor(library, view, playback, state.query, state.sort);
    const pageCount = Math.max(1, Math.ceil(tracks.length / 100));
    state.page = Math.min(state.page, pageCount - 1);
    const visible = tracks.slice(state.page * 100, (state.page + 1) * 100);
    const title = playlist?.name || { all: 'Votre bibliothèque', favorites: 'Vos favoris', queue: 'File de lecture' }[view] || 'Votre bibliothèque';
    const subtitle = `${tracks.length} morceau${tracks.length > 1 ? 'x' : ''}${tracks.length ? ` · ${Math.round(tracks.reduce((sum, t) => sum + t.duration, 0) / 60000)} min` : ''}`;
    const unavailable = library.tracks.filter(track => track.missing).length;
    const playlistActions = playlist ? `<button class="icon-button" data-action="rename-playlist" aria-label="Renommer la playlist">${icon('pencil-simple')}</button><button class="icon-button" data-action="delete-playlist" aria-label="Supprimer la playlist">${icon('trash')}</button>` : '';
    let content;
    if (!tracks.length) {
        const empty = state.query ? ['magnifying-glass', 'Aucun morceau trouvé', 'Essayez un autre titre, artiste ou album.']
            : playlist ? ['playlist', 'Cette playlist attend ses morceaux', 'Sélectionnez des titres dans votre bibliothèque pour les ajouter ici.']
            : view === 'favorites' ? ['heart', 'Gardez vos coups de cœur', 'Un clic sur le cœur d’un morceau suffit pour le retrouver ici.']
            : view === 'queue' ? ['queue', 'Rien dans la file pour le moment', 'Lancez un morceau ou une playlist pour commencer.']
            : ['vinyl-record', 'Faites entrer votre musique', 'Importez vos fichiers ou un dossier entier. Vos morceaux restent à leur emplacement d’origine.'];
        content = `<div class="empty-state"><div class="empty-art">${icon(empty[0])}</div><h2>${empty[1]}</h2><p>${empty[2]}</p>${view === 'all' && !state.query ? '<div class="empty-actions"><button class="button primary" data-import="folder">' + icon('folder-open') + 'Importer un dossier</button><button class="button" data-import="files">Choisir des fichiers</button></div><small>MP3 · FLAC · WAV · M4A · AAC · OGG · OPUS</small>' : playlist ? '<button class="button" data-view="all">Choisir des morceaux</button>' : ''}</div>`;
    } else {
        content = `<div class="track-list"><table><thead><tr><th class="selection-col"><input id="select-all" type="checkbox" aria-label="Sélectionner les morceaux affichés" ${visible.every(t => selection.has(t.id)) ? 'checked' : ''}></th><th>Titre</th><th class="artist-col">Artiste</th><th class="album-col">Album</th><th class="time-col">${icon('clock')}</th><th class="heart-col"><span class="sr-only">Favori</span></th><th class="menu-col"><span class="sr-only">Options</span></th></tr></thead><tbody>${visible.map(track => `<tr data-track="${e(track.id)}" class="${playback.trackId === track.id ? 'current' : ''} ${track.missing ? 'missing' : ''}">
            <td><input id="select-${e(track.id)}" data-select="${e(track.id)}" type="checkbox" aria-label="Sélectionner ${e(track.title)}" ${selection.has(track.id) ? 'checked' : ''}></td>
            <td><button class="track-play" data-play="${e(track.id)}" ${track.missing ? 'disabled' : ''} title="${e(track.path)}"><span class="cover">${cover(track)}<span class="cover-play">${icon('play-fill')}</span></span><span class="track-name"><strong>${e(track.title)}</strong>${track.missing ? '<small>Fichier introuvable</small>' : ''}</span></button></td>
            <td class="artist-col"><span title="${e(track.artist)}">${e(track.artist)}</span></td><td class="album-col"><span title="${e(track.album)}">${e(track.album || '—')}</span></td><td class="time-col">${track.duration ? time(track.duration) : '—'}</td>
            <td><button class="icon-button heart ${track.favorite ? 'active' : ''}" data-favorite="${e(track.id)}" aria-label="${track.favorite ? 'Retirer' : 'Ajouter'} ${e(track.title)} ${track.favorite ? 'des' : 'aux'} favoris" aria-pressed="${track.favorite}"><i class="${track.favorite ? 'ph-fill' : 'ph'} ph-heart" aria-hidden="true"></i></button></td>
            <td><button class="icon-button" data-menu="${e(track.id)}" aria-label="Options pour ${e(track.title)}">${icon('dots-three')}</button></td></tr>`).join('')}</tbody></table></div>`;
    }
    const focused = document.activeElement?.id;
    document.querySelector('#collection').innerHTML = `<header class="collection-heading"><div><h1>${e(title)}</h1><p>${subtitle}${unavailable && view === 'all' ? ` · ${unavailable} fichier${unavailable > 1 ? 's' : ''} à retrouver` : ''}</p></div><div class="heading-actions">${playlistActions}</div></header>
        <div class="collection-toolbar"><button class="button play-collection" data-action="play-collection" ${!tracks.some(t => !t.missing) ? 'disabled' : ''}>${icon('play-fill')}Écouter</button>${selection.size ? `<span class="selection-count">${selection.size} sélectionné${selection.size > 1 ? 's' : ''}</span><button class="button subtle" data-action="add-selected">Ajouter à une playlist</button><button class="icon-button" data-action="remove-selected" aria-label="Retirer la sélection">${icon('minus-circle')}</button>` : '<span class="toolbar-spacer"></span>'}
        ${!playlist && view !== 'queue' ? '<label class="sort-label">Trier par <select id="sort" aria-label="Trier les morceaux"><option value="title">Titre</option><option value="artist">Artiste</option><option value="album">Album</option><option value="recent">Ajout récent</option></select></label>' : ''}</div>${content}`;
    if (pageCount > 1) document.querySelector('#collection').insertAdjacentHTML('beforeend', `<div class="pagination"><span>${state.page * 100 + 1}–${Math.min((state.page + 1) * 100, tracks.length)} sur ${tracks.length}</span><button class="icon-button" data-action="previous-page" aria-label="Page précédente" ${state.page === 0 ? 'disabled' : ''}>${icon('caret-left')}</button><button class="icon-button" data-action="next-page" aria-label="Page suivante" ${state.page === pageCount - 1 ? 'disabled' : ''}>${icon('caret-right')}</button></div>`);
    const sort = document.querySelector('#sort');
    if (sort) sort.value = state.sort;
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}

export function renderPlayback(state) {
    const document = state.root || globalThis.document;
    const playback = state.playback;
    const track = state.library.tracks.find(track => track.id === playback.trackId);
    const player = document.querySelector('#player');
    if (player.dataset.track !== (track?.id || '')) {
        player.dataset.track = track?.id || '';
        document.querySelector('#playing-cover').innerHTML = cover(track);
        document.querySelector('#playing-title').textContent = track?.title || 'Choisissez un morceau';
        document.querySelector('#playing-artist').textContent = track?.artist || 'La lecture continue dans l’Island.';
    }
    const toggle = document.querySelector('.play-toggle');
    toggle.disabled = !playback.active;
    toggle.setAttribute('aria-label', playback.isPlaying ? 'Pause' : 'Lecture');
    toggle.innerHTML = `<i class="ph-fill ph-${playback.isPlaying ? 'pause' : 'play'}"></i>`;
    document.querySelector('#elapsed').textContent = time(playback.progress);
    document.querySelector('#duration').textContent = time(playback.duration);
    const seek = document.querySelector('#seek');
    seek.max = Math.max(1, playback.duration || 1);
    seek.disabled = !playback.active;
    if (!state.seeking) seek.value = playback.progress || 0;
    if (document.activeElement?.id !== 'volume') document.querySelector('#volume').value = playback.volume ?? 0.8;
    for (const mode of ['shuffle', 'repeat']) {
        const button = document.querySelector(`[data-control="${mode}"]`);
        const active = mode === 'shuffle' ? playback.shuffle : playback.repeat && playback.repeat !== 'off';
        button.classList.toggle('active', Boolean(active));
        button.setAttribute('aria-pressed', String(Boolean(active)));
        if (mode === 'repeat') { button.setAttribute('aria-label', `Répétition : ${{ all: 'toute la file', one: 'un morceau', off: 'désactivée' }[playback.repeat || 'off']}`); button.innerHTML = icon(playback.repeat === 'one' ? 'repeat-once' : 'repeat'); }
    }
    document.querySelectorAll('tr[data-track]').forEach(row => row.classList.toggle('current', row.dataset.track === playback.trackId));
}
