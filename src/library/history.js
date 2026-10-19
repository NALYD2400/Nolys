/**
 * Historique musical : même capsule, mêmes lignes et mêmes menus que la Bibliothèque.
 * Les données (localStorage, lecteurs externes) restent dans features/music-history.js,
 * qui fournit `store`.
 */
import { escapeHtml as e, formatHistoryTime } from '../island/dynamic-island/helpers/format.js';
import { normalize } from './model.js';
import { icon, menuItem } from './view.js';
import { createPanel } from './panel.js';

const FILTERS = [['all', 'Tous', null], ['favorites', 'Favoris', 'star'], ['recent', 'Récents', 'clock-counter-clockwise']];
const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

const shellMarkup = `
<div class="lib" tabindex="-1">
    <header class="lib-header">
        <button type="button" class="round-btn" data-action="back" aria-label="Revenir au lecteur" title="Lecteur">${icon('caret-left', 'ph-bold')}</button>
        <div class="lib-heading"><span>Historique</span><small id="summary"></small></div>
        <label class="lib-search">
            ${icon('magnifying-glass', 'ph-bold')}
            <input id="search" type="text" placeholder="Rechercher" aria-label="Rechercher un titre, un artiste ou une source" autocomplete="off" spellcheck="false">
            <button type="button" data-action="clear-search" aria-label="Effacer la recherche" hidden>${icon('x', 'ph-bold')}</button>
        </label>
        <button type="button" class="round-btn" data-action="clear-history" aria-label="Vider l’historique" title="Vider l’historique (les favoris restent)">${icon('trash', 'ph-bold')}</button>
    </header>
    <nav class="lib-chips" id="chips" aria-label="Filtres"></nav>
    <div class="lib-list" id="list"></div>
    <div class="lib-toast" id="toast" role="status" aria-live="polite" hidden></div>
    <div class="lib-menu" id="menu" role="menu" hidden></div>
</div>`;

function rowMarkup(item, { current, playing, favorite, provider, index }) {
    const sub = [e(item.artist), `${icon(String(provider.icon || 'ph-music-notes').replace(/^ph-/, ''), 'ph-bold')} ${e(provider.label)}`];
    if ((item.playCount || 1) > 1) sub.push(`${item.playCount} écoutes`);
    const art = item.cover ? `<img src="${e(item.cover)}" alt="" loading="lazy" decoding="async">` : icon('music-note', 'ph-fill');
    const hint = item.localTrackId ? 'play' : 'magnifying-glass';
    const state = current ? `<span class="cover-state ${playing ? 'is-playing' : ''}" aria-hidden="true"><i></i><i></i><i></i></span>` : `<span class="cover-play" aria-hidden="true">${icon(hint, hint === 'play' ? 'ph-fill' : 'ph-bold')}</span>`;
    const label = item.localTrackId ? `Lire ${item.title}` : `Rechercher ${item.title}`;
    return `<div class="row ${current ? 'is-current' : ''}" data-key="${e(item.key)}" style="--i:${Math.min(index, 12)}">
        <button type="button" class="row-main" data-action="open" data-key="${e(item.key)}" aria-label="${e(label)}">
            <span class="cover">${art}${state}</span>
            <span class="row-text"><strong>${e(item.title)}</strong><small class="row-sub">${sub.join('<span class="dot" aria-hidden="true"></span>')}</small></span>
        </button>
        <span class="row-ago">${e(formatHistoryTime(item.lastPlayedAt || item.timestamp))}</span>
        <button type="button" class="mini-btn fav star ${favorite ? 'is-on' : ''}" data-action="favorite" data-key="${e(item.key)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Retirer' : 'Ajouter'} ${e(item.title)} ${favorite ? 'des' : 'aux'} favoris">${icon('star', favorite ? 'ph-fill' : 'ph-bold')}</button>
        <button type="button" class="mini-btn" data-action="row-menu" data-key="${e(item.key)}" aria-haspopup="menu" aria-label="Options pour ${e(item.title)}">${icon('dots-three', 'ph-bold')}</button>
    </div>`;
}

export function mountHistory(host, { store, savedState = {}, ready = Promise.resolve(), onBack = () => {}, onClose = () => {} }) {
    const panel = createPanel(host, shellMarkup);
    const { root, $, on, toast, openMenu, closeMenu } = panel;
    const state = { filter: 'all', query: '', ...savedState };
    let armedTimer;

    const find = key => store.items().find(item => item.key === key);

    function render() {
        if (panel.disposed) return;
        const items = store.items();
        const favorites = items.filter(item => store.isFavorite(item));
        const plays = items.reduce((sum, item) => sum + (item.playCount || 1), 0);
        $('#summary').textContent = items.length ? `${plural(items.length, 'titre')} · ${plural(plays, 'écoute')}` : 'Rien d’écouté pour l’instant';
        const counts = { all: items.length, favorites: favorites.length, recent: items.length - favorites.length };
        $('#chips').innerHTML = FILTERS.map(([id, label, glyph]) => `<button type="button" class="chip ${state.filter === id ? 'is-active' : ''}" data-filter="${id}" ${state.filter === id ? 'aria-current="true"' : ''}>${glyph ? icon(glyph, 'ph-bold') : ''}<span>${label}</span><small>${counts[id]}</small></button>`).join('');
        renderList(items);
    }

    let waiting = true;
    function renderList(items = store.items()) {
        // Les lignes attendent que la capsule ait fini de s'agrandir (voir `ready`).
        if (waiting) return;
        const list = $('#list');
        const scroll = list.scrollTop;
        const search = normalize(state.query.trim());
        const matches = item => !search || normalize(`${item.title} ${item.artist} ${store.provider(item).label}`).includes(search);
        const visible = items.filter(matches);
        const favorite = visible.filter(item => store.isFavorite(item));
        const recent = visible.filter(item => !store.isFavorite(item));
        const sections = [
            state.filter !== 'recent' && favorite.length ? ['Favoris', 'star', favorite] : null,
            state.filter !== 'favorites' && recent.length ? ['Récents', 'clock-counter-clockwise', recent] : null,
        ].filter(Boolean);
        if (!sections.length) {
            const [glyph, title, text] = search ? ['magnifying-glass', 'Aucun résultat', 'Essayez un autre titre, artiste ou source.']
                : state.filter === 'favorites' ? ['star', 'Aucun favori', 'Touchez l’étoile d’un titre pour le garder ici.']
                : ['clock-counter-clockwise', 'Historique vide', 'Les titres que vous écoutez apparaîtront ici, quel que soit le lecteur.'];
            list.innerHTML = `<div class="empty"><span class="empty-icon">${icon(glyph, 'ph-fill')}</span><strong>${title}</strong><p>${text}</p></div>`;
            panel.keepFocus();
            return;
        }
        const playing = store.isPlaying();
        let index = 0;
        list.innerHTML = sections.map(([title, glyph, entries]) => `<div class="list-title">${icon(glyph, 'ph-bold')}<span>${title}</span></div>`
            + entries.map(item => rowMarkup(item, { index: index++, current: store.isCurrent(item), playing, favorite: store.isFavorite(item), provider: store.provider(item) })).join('')).join('');
        list.scrollTop = scroll;
        panel.keepFocus();
    }

    function rowMenu(key, anchor, point) {
        const item = find(key);
        if (!item) return;
        const provider = store.provider(item);
        const html = item.localTrackId
            ? menuItem('play', 'Lire', 'play', { id: key }) + menuItem('show-library', 'Voir dans la Bibliothèque', 'vinyl-record', { id: key })
            : (store.isCurrent(item) ? menuItem('replay', 'Reprendre au début', 'arrow-counter-clockwise', { id: key }) : '')
                + menuItem('search', 'Rechercher dans Nolys', 'magnifying-glass', { id: key })
                + menuItem('open-provider', `Ouvrir dans ${provider.label}`, 'arrow-square-out', { id: key });
        openMenu(anchor, html + '<span class="menu-divider" role="separator"></span>' + menuItem('remove', 'Retirer de l’historique', 'x', { id: key, danger: true }), point);
    }

    function syncClearButton() {
        $('[data-action="clear-search"]').hidden = !$('#search').value;
    }

    function disarm() {
        clearTimeout(armedTimer);
        $('[data-action="clear-history"]').classList.remove('is-armed');
    }

    async function act(action, button) {
        const key = button.dataset.key || button.dataset.id;
        const item = key ? find(key) : null;
        switch (action) {
            case 'back': onBack(); break;
            case 'clear-search': $('#search').value = ''; state.query = ''; syncClearButton(); renderList(); $('#search').focus(); break;
            case 'clear-history': {
                // Deux appuis : le premier arme le bouton, le second vide (les favoris restent).
                if (!button.classList.contains('is-armed')) {
                    button.classList.add('is-armed');
                    toast('Touchez encore pour vider l’historique. Les favoris restent.');
                    clearTimeout(armedTimer);
                    armedTimer = setTimeout(disarm, 3000);
                    break;
                }
                disarm();
                store.clear();
                render();
                toast('Historique vidé.');
                break;
            }
            case 'open': if (item) await store.open(item, item.localTrackId ? 'open' : 'search'); break;
            case 'favorite': if (item) { await store.toggleFavorite(item); render(); } break;
            case 'row-menu': rowMenu(key, button); break;
            case 'play': closeMenu(); if (item) await store.open(item, 'open'); break;
            case 'show-library': closeMenu(); if (item) await store.open(item, 'search'); break;
            case 'replay': closeMenu(); if (item) await store.open(item, 'replay'); break;
            case 'search': closeMenu(); if (item) await store.open(item, 'search'); break;
            case 'open-provider': closeMenu(); if (item) await store.open(item, 'open'); break;
            case 'remove': closeMenu(); if (item) { store.remove(item); render(); toast('Titre retiré de l’historique.'); } break;
        }
    }

    on(root, 'click', async event => {
        const target = event.target.closest('[data-action], [data-filter]');
        if (panel.dismissMenuOnClick(event, target)) return;
        if (target?.dataset.action !== 'clear-history') disarm();
        if (!target || target.disabled) return;
        try {
            if (target.dataset.filter) { state.filter = target.dataset.filter; render(); $('#list').scrollTop = 0; }
            else await act(target.dataset.action, target);
        } catch (error) { toast(String(error?.message || error), true); }
    });

    on(root, 'contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        const row = event.target.closest('.row[data-key]');
        if (row) rowMenu(row.dataset.key, row.querySelector('[data-action="row-menu"]'), { x: event.clientX, y: event.clientY });
    });

    on($('#search'), 'input', event => {
        state.query = event.target.value.slice(0, 80);
        syncClearButton();
        renderList();
    });

    on(root, 'keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            $('#search').focus();
            $('#search').select();
            return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (closeMenu({ restoreFocus: true })) return;
        if (root.activeElement === $('#search') && $('#search').value) { act('clear-search', $('#search')); return; }
        onClose();
    });

    $('#search').value = state.query;
    syncClearButton();
    render();
    panel.focus();
    ready.then(() => {
        waiting = false;
        if (!panel.disposed) { renderList(); panel.startIntro(); }
    });

    return {
        get savedState() { return { filter: state.filter, query: state.query }; },
        /** Nouveau titre, favori changé depuis le lecteur, lecture en pause… */
        refresh: render,
        notify: message => toast(message),
        destroy() {
            clearTimeout(armedTimer);
            panel.destroy();
        },
    };
}
