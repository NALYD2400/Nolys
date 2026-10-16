/**
 * Socle commun des grandes vues de l'Island en shadow DOM (Bibliothèque, Historique) :
 * mêmes styles, même message flottant, même menu contextuel et même entrée en cascade.
 */
import styles from './styles.css?inline';
import { icon } from './view.js';

// Feuille analysée une seule fois et partagée par chaque ouverture (un <style> par vue
// était réanalysé à chaque fois, au moment où la capsule finit de s'agrandir).
let sharedSheet = null;
const panelSheet = () => {
    if (!sharedSheet) {
        sharedSheet = new CSSStyleSheet();
        sharedSheet.replaceSync(styles);
    }
    return sharedSheet;
};

/**
 * Hauteur naturelle de la vue : tout sauf la liste, plus le contenu réel de la liste. Mesures
 * relatives à la liste elle-même : l'animation d'entrée (translation) ne les fausse pas.
 */
function naturalHeight(root) {
    const lib = root.querySelector('.lib');
    const list = root.querySelector('#list');
    if (!lib || !list) return 0;
    const top = list.getBoundingClientRect().top;
    const empty = list.querySelector(':scope > .empty');
    let content = 0;
    if (empty) {
        // L'état vide s'étire sur toute la liste : on mesure ce qu'il contient.
        const first = empty.firstElementChild?.getBoundingClientRect();
        const last = empty.lastElementChild?.getBoundingClientRect();
        content = first && last ? last.bottom - first.top + 40 : 0;
    } else if (list.lastElementChild) {
        content = list.lastElementChild.getBoundingClientRect().bottom - top + list.scrollTop + parseFloat(getComputedStyle(list).paddingBottom);
    }
    return Math.ceil(lib.clientHeight - list.clientHeight + content);
}

/** `onFit(hauteur)` : la vue demande à l'Island la hauteur de son contenu (voir fitPanel). */
export function createPanel(host, markup, { onFit = null } = {}) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [panelSheet()];
    root.innerHTML = `<link rel="stylesheet" href="/assets/icons/phosphor.css">${markup}`;
    const $ = selector => root.querySelector(selector);
    const abort = new AbortController();
    const on = (target, name, callback, options = {}) => target.addEventListener(name, callback, { ...options, signal: abort.signal });
    let disposed = false;
    let toastTimer;
    let menuAnchor = null;

    function toast(message, error = false) {
        const element = $('#toast');
        if (disposed || !element) return;
        clearTimeout(toastTimer);
        element.textContent = message;
        element.classList.toggle('is-error', error);
        element.hidden = !message;
        if (message) toastTimer = setTimeout(() => { element.hidden = true; }, error ? 7000 : 3200);
    }

    /** Menu ancré sous un bouton, ou au pointeur (clic droit), sans sortir de la capsule. */
    function openMenu(anchor, html, point) {
        const menu = $('#menu');
        menu.innerHTML = html;
        menu.hidden = false;
        menuAnchor = anchor;
        anchor?.setAttribute('aria-expanded', 'true');
        const box = $('.lib').getBoundingClientRect();
        const rect = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const below = rect.bottom - box.top + 6;
        const top = below + height > box.height - 8 ? rect.top - box.top - height - 6 : below;
        const left = (point ? rect.left : rect.right - width) - box.left;
        menu.style.left = `${Math.max(8, Math.min(left, box.width - width - 8))}px`;
        menu.style.top = `${Math.max(8, top)}px`;
        menu.style.transformOrigin = `${point ? 'left' : 'right'} ${top < below ? 'bottom' : 'top'}`;
        menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }

    function closeMenu({ restoreFocus = false } = {}) {
        const menu = $('#menu');
        if (menu.hidden) return false;
        // Masquer l'élément qui a le focus l'enverrait sur <body>, hors de la vue : Échap ne
        // l'atteindrait plus. On le rend au bouton d'origine, ou à la vue.
        const hadFocus = menu.contains(root.activeElement);
        menu.hidden = true;
        menuAnchor?.removeAttribute('aria-expanded');
        if (restoreFocus && menuAnchor?.isConnected) menuAnchor.focus({ preventScroll: true });
        else if (hadFocus) $('.lib').focus({ preventScroll: true });
        menuAnchor = null;
        return true;
    }

    /** Un clic hors du menu le ferme ; renvoie true si ce clic visait son propre bouton. */
    function dismissMenuOnClick(event, target) {
        if ($('#menu').hidden || event.target.closest('#menu')) return false;
        const sameAnchor = Boolean(target) && target === menuAnchor;
        closeMenu();
        return sameAnchor;
    }

    on(root, 'keydown', event => {
        const menu = $('#menu');
        if (menu.hidden || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const items = [...menu.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(root.activeElement);
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
        items[(next + items.length) % items.length]?.focus();
    });

    // Les pastilles défilent aussi à la molette verticale.
    const chips = $('#chips');
    if (chips) on(chips, 'wheel', event => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        chips.scrollLeft += event.deltaY;
    }, { passive: false });

    // Cascade d'entrée des lignes : une seule fois, quand la liste apparaît (startIntro).
    let introTimer;

    return {
        root, $, on, toast, openMenu, closeMenu, dismissMenuOnClick,
        /** Le clavier (Échap, Ctrl+F) agit dès l'ouverture, sans clic préalable. */
        focus: () => { if (!host.inert) $('.lib').focus({ preventScroll: true }); },
        /** Après un nouveau rendu, le bouton qui avait le focus a pu disparaître : Échap doit
         * toujours atteindre la vue, sans voler le focus d'un champ resté en place. */
        keepFocus() {
            if (!root.activeElement && [document.body, host, null].includes(document.activeElement)) $('.lib').focus({ preventScroll: true });
        },
        get disposed() { return disposed; },
        /** Après un rendu de la liste. `frozen` : recherche en cours, la hauteur ne bouge pas
         * (elle sauterait à chaque lettre tapée). */
        fit({ frozen = false } = {}) {
            if (!onFit || disposed || frozen) return;
            const height = naturalHeight(root);
            if (height > 0) onFit(height);
        },
        startIntro() {
            host.setAttribute('data-intro', '');
            clearTimeout(introTimer);
            introTimer = setTimeout(() => host.removeAttribute('data-intro'), 900);
        },
        destroy() {
            disposed = true;
            clearTimeout(toastTimer);
            clearTimeout(introTimer);
            abort.abort();
        },
    };
}

/**
 * Prépare au repos ce que la première ouverture paierait sinon pendant le ressort de la
 * capsule : feuille analysée, code JS optimisé, police d'icônes, première mise en page.
 * `mount(host)` monte une vraie vue dans un hôte invisible et renvoie de quoi la détruire.
 */
export function warmPanel(mount) {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:560px;height:496px;visibility:hidden;pointer-events:none;contain:strict';
    document.body.append(host);
    const view = mount(host);
    // Les lignes sont construites juste après le montage (promesse `ready` déjà tenue) :
    // mise en page, puis tout disparaît dans la même tâche, sans jamais être visible.
    queueMicrotask(() => queueMicrotask(() => {
        void host.shadowRoot?.querySelector('.lib-list')?.offsetHeight;
        view?.destroy();
        host.remove();
    }));
}

/** Change l'icône d'un bouton seulement si elle diffère (pas de clignotement au survol). */
export function setIcon(button, name, weight) {
    const glyph = `${weight} ph-${name}`;
    if (button.dataset.glyph === glyph) return;
    button.dataset.glyph = glyph;
    button.innerHTML = icon(name, weight);
}
