/** Gabarits de la Bibliothèque : mêmes briques que les autres vues de l’Island. */
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { native } from '../shared/ipc.js';
import { time } from './model.js';

export const icon = (name, weight = 'ph') => `<i class="${weight} ph-${name}" aria-hidden="true"></i>`;
const plural = (count, word, suffix = 's') => `${count} ${word}${count > 1 ? suffix : ''}`;

export const cover = track => track?.cover
    ? `<img src="${e(native.fileSrc(track.cover))}" alt="" loading="lazy" decoding="async">`
    : icon('music-note', 'ph-fill');

export const shellMarkup = `
<div class="lib" tabindex="-1">
    <header class="lib-header">
        <button type="button" class="round-btn" data-action="back" aria-label="Revenir au menu de l’Island" title="Menu">${icon('caret-left', 'ph-bold')}</button>
        <div class="lib-heading"><span>Bibliothèque</span><small id="summary"></small></div>
        <label class="lib-search">
            ${icon('magnifying-glass', 'ph-bold')}
            <input id="search" type="text" placeholder="Rechercher" aria-label="Rechercher un titre, un artiste ou un album" autocomplete="off" spellcheck="false">
            <button type="button" data-action="clear-search" aria-label="Effacer la recherche" hidden>${icon('x', 'ph-bold')}</button>
        </label>
        <button type="button" class="round-btn is-accent" data-action="import" aria-label="Importer de la musique" aria-haspopup="menu" title="Importer">${icon('plus', 'ph-bold')}</button>
    </header>
    <nav class="lib-chips" id="chips" aria-label="Collections"></nav>
    <div class="lib-section" id="section"></div>
    <div class="lib-list" id="list"></div>
    <footer class="lib-player" id="player" aria-label="Lecture">
        <div class="player-track">
            <span class="cover" id="p-cover">${icon('music-note', 'ph-fill')}</span>
            <span class="row-text"><strong id="p-title">Aucun morceau</strong><small id="p-artist">Choisissez un titre pour l’écouter</small></span>
        </div>
        <div class="player-controls">
            <button type="button" class="mini-btn" data-action="shuffle" aria-label="Lecture aléatoire" aria-pressed="false">${icon('shuffle', 'ph-bold')}</button>
            <button type="button" class="ctl-btn" data-action="prev" aria-label="Morceau précédent">${icon('skip-back', 'ph-fill')}</button>
            <button type="button" class="ctl-btn is-play" data-action="toggle" aria-label="Lecture">${icon('play', 'ph-fill')}</button>
            <button type="button" class="ctl-btn" data-action="next" aria-label="Morceau suivant">${icon('skip-forward', 'ph-fill')}</button>
            <button type="button" class="mini-btn" data-action="repeat" aria-label="Répétition désactivée" aria-pressed="false">${icon('repeat', 'ph-bold')}</button>
        </div>
        <div class="player-extra">
            <label class="volume" title="Volume">${icon('speaker-high', 'ph-fill')}<input id="volume" class="slider" type="range" min="0" max="1" step="0.01" aria-label="Volume"></label>
            <button type="button" class="mini-btn" data-action="stop" aria-label="Arrêter et revenir aux autres lecteurs" title="Revenir aux autres lecteurs">${icon('eject', 'ph-bold')}</button>
        </div>
        <div class="player-progress">
            <span id="p-elapsed">0:00</span>
            <input id="seek" class="slider" type="range" min="0" max="1" step="250" value="0" aria-label="Position de lecture">
            <span id="p-duration">0:00</span>
        </div>
    </footer>
    <footer class="lib-selection" id="selection" aria-label="Sélection" hidden></footer>
    <div class="lib-toast" id="toast" role="status" aria-live="polite" hidden></div>
    <div class="lib-menu" id="menu" role="menu" hidden></div>
    <div class="lib-sheet" id="sheet" hidden><form class="lib-sheet-card" id="sheet-form" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></form></div>
</div>`;

export const VIEW_NAMES = { all: 'Tous les titres', favorites: 'Favoris', queue: 'File d’attente' };

export function chipsMarkup({ library, view, queueLength }) {
    const chip = (id, label, count, glyph) => `<button type="button" class="chip ${view === id ? 'is-active' : ''}" data-view="${e(id)}" ${view === id ? 'aria-current="true"' : ''}>${glyph ? icon(glyph, 'ph-bold') : ''}<span>${e(label)}</span><small>${count}</small></button>`;
    return chip('all', 'Tous', library.tracks.length)
        + chip('favorites', 'Favoris', library.tracks.filter(t => t.favorite).length, 'heart')
        + chip('queue', 'File', queueLength, 'queue')
        + (library.playlists.length ? '<span class="chip-divider" aria-hidden="true"></span>' : '')
        + library.playlists.map(p => chip(p.id, p.name, p.trackIds.length, 'playlist')).join('')
        + `<button type="button" class="chip is-ghost" data-action="new-playlist" aria-label="Créer une playlist" title="Nouvelle playlist">${icon('plus', 'ph-bold')}<span>Playlist</span></button>`;
}

export function sectionMarkup({ title, tracks, playlist, view, selecting, sortLabel }) {
    const minutes = Math.round(tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60000);
    const playable = tracks.some(t => !t.missing);
    const sortable = !playlist && view !== 'queue';
    return `<div class="section-title"><span>${e(title)}</span><small>${plural(tracks.length, 'titre')}${minutes ? ` · ${minutes} min` : ''}</small></div>
        <div class="section-actions">
            ${playlist ? `<button type="button" class="mini-btn" data-action="rename-playlist" aria-label="Renommer la playlist" title="Renommer">${icon('pencil-simple', 'ph-bold')}</button><button type="button" class="mini-btn is-danger" data-action="delete-playlist" aria-label="Supprimer la playlist" title="Supprimer">${icon('trash', 'ph-bold')}</button>` : ''}
            ${sortable ? `<button type="button" class="pill-btn" data-action="sort" aria-haspopup="menu" aria-label="Trier par ${e(sortLabel)}">${icon('sort-ascending', 'ph-bold')}<span>${e(sortLabel)}</span></button>` : ''}
            ${tracks.length ? `<button type="button" class="pill-btn ${selecting ? 'is-on' : ''}" data-action="select-mode" aria-pressed="${selecting}">${icon('check-circle', 'ph-bold')}<span>Choisir</span></button>` : ''}
            <button type="button" class="pill-btn is-accent" data-action="play-all" ${playable ? '' : 'disabled'}>${icon('play', 'ph-fill')}<span>Lire</span></button>
        </div>`;
}

export function emptyMarkup({ query, playlist, view }) {
    const [glyph, title, text] = query ? ['magnifying-glass', 'Aucun résultat', 'Essayez un autre titre, artiste ou album.']
        : playlist ? ['playlist', 'Playlist vide', 'Ajoutez des titres depuis « Tous » avec le menu ⋯ ou « Choisir ».']
        : view === 'favorites' ? ['heart', 'Aucun favori', 'Touchez le cœur d’un titre pour le retrouver ici.']
        : view === 'queue' ? ['queue', 'File vide', 'Lancez un titre ou une playlist pour remplir la file.']
        : ['vinyl-record', 'Votre musique, ici', 'Importez des fichiers ou un dossier. Rien n’est copié : vos morceaux restent à leur place.'];
    const actions = view === 'all' && !query
        ? `<div class="empty-actions"><button type="button" class="pill-btn is-accent" data-action="import-folder">${icon('folder-open', 'ph-bold')}<span>Importer un dossier</span></button><button type="button" class="pill-btn" data-action="import-files">${icon('file-audio', 'ph-bold')}<span>Choisir des fichiers</span></button></div><small class="empty-formats">MP3 · FLAC · WAV · M4A · AAC · OGG · OPUS</small>`
        : playlist ? `<div class="empty-actions"><button type="button" class="pill-btn" data-view="all">${icon('list', 'ph-bold')}<span>Voir tous les titres</span></button></div>` : '';
    return `<div class="empty"><span class="empty-icon">${icon(glyph, 'ph-fill')}</span><strong>${title}</strong><p>${text}</p>${actions}</div>`;
}

export function rowMarkup(track, { current, playing, selecting, selected, index }) {
    const sub = [track.artist, track.album].filter(Boolean).map(e).join(' · ');
    const state = current ? `<span class="cover-state ${playing ? 'is-playing' : ''}" aria-hidden="true"><i></i><i></i><i></i></span>` : `<span class="cover-play" aria-hidden="true">${icon('play', 'ph-fill')}</span>`;
    const main = selecting
        ? `<button type="button" class="row-main" data-action="toggle-select" data-id="${e(track.id)}" aria-pressed="${selected}"><span class="check" aria-hidden="true">${icon('check', 'ph-bold')}</span>`
        : `<button type="button" class="row-main" data-action="play" data-id="${e(track.id)}" ${track.missing ? 'aria-disabled="true"' : ''} title="${e(track.path)}">`;
    return `<div class="row ${current ? 'is-current' : ''} ${track.missing ? 'is-missing' : ''} ${selected ? 'is-selected' : ''}" data-track="${e(track.id)}" style="--i:${Math.min(index, 12)}">
        ${main}<span class="cover">${cover(track)}${selecting ? '' : state}</span>
        <span class="row-text"><strong>${e(track.title)}</strong><small>${track.missing ? '<em>Fichier introuvable</em>' : sub || 'Artiste inconnu'}</small></span></button>
        ${track.missing && !selecting ? `<button type="button" class="pill-btn is-small" data-action="relink" data-id="${e(track.id)}">Retrouver</button>` : `<span class="row-time">${track.duration ? time(track.duration) : '—'}</span>`}
        <button type="button" class="mini-btn fav ${track.favorite ? 'is-on' : ''}" data-action="favorite" data-id="${e(track.id)}" aria-pressed="${track.favorite}" aria-label="${track.favorite ? 'Retirer' : 'Ajouter'} ${e(track.title)} ${track.favorite ? 'des' : 'aux'} favoris">${icon('heart', track.favorite ? 'ph-fill' : 'ph-bold')}</button>
        <button type="button" class="mini-btn" data-action="track-menu" data-id="${e(track.id)}" aria-haspopup="menu" aria-label="Options pour ${e(track.title)}">${icon('dots-three', 'ph-bold')}</button>
    </div>`;
}

export function selectionMarkup(count, allSelected) {
    return `<button type="button" class="mini-btn" data-action="cancel-select" aria-label="Terminer la sélection">${icon('x', 'ph-bold')}</button>
        <span class="selection-count">${count ? plural(count, 'titre') + ` choisi${count > 1 ? 's' : ''}` : 'Touchez des titres'}</span>
        <button type="button" class="pill-btn" data-action="select-all">${icon(allSelected ? 'minus-square' : 'check-square', 'ph-bold')}<span>${allSelected ? 'Aucun' : 'Tout'}</span></button>
        <button type="button" class="pill-btn" data-action="add-selected" ${count ? '' : 'disabled'}>${icon('playlist', 'ph-bold')}<span>Ajouter à…</span></button>
        <button type="button" class="pill-btn is-danger" data-action="remove-selected" ${count ? '' : 'disabled'}>${icon('minus-circle', 'ph-bold')}<span>Retirer</span></button>`;
}

export const menuItem = (action, label, glyph, { id = '', value = '', disabled = false, danger = false, checked = null } = {}) =>
    `<button type="button" role="${checked !== null ? 'menuitemradio' : 'menuitem'}" class="${danger ? 'is-danger' : ''}" data-action="${action}" ${id ? `data-id="${e(id)}"` : ''} ${value ? `data-value="${e(value)}"` : ''} ${checked !== null ? `aria-checked="${checked}"` : ''} ${disabled ? 'disabled' : ''}>${icon(glyph, 'ph-bold')}<span>${e(label)}</span>${checked === true ? icon('check', 'ph-bold') : ''}</button>`;
