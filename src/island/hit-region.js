/**
 * Envoie au cœur natif la zone occupée par la pilule.
 *
 * La fenêtre de l'Island laisse passer les clics ; le cœur Rust réactive la
 * souris dès que le curseur entre dans cette zone (équivalent du
 * `setIgnoreMouseEvents(true, { forward: true })` d'Electron).
 */
import { native } from '../shared/ipc.js';

const TRACKED_SELECTORS = ['#dynamic-island', '#island-context-menu', '.island-satellite.is-visible', '#layout-edit-toolbar'];

let lastPayload = '';
let frameRequested = false;
let lastExtent = '';

export function targetExtent(element, expanded) {
    if (!expanded) return null;
    const rect = element.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(element).zoom) || 1;
    let width = rect.width, height = rect.height;
    for (const animation of element.getAnimations()) {
        const frames = animation.effect?.getKeyframes?.();
        const last = frames?.at(-1);
        if (animation.transitionProperty === 'width') width = (parseFloat(last?.width) * zoom) || width;
        if (animation.transitionProperty === 'height') height = (parseFloat(last?.height) * zoom) || height;
    }
    return { x: Math.round((rect.x + rect.width / 2 - width / 2) * 10) / 10, y: Math.round(rect.y * 10) / 10,
        width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
}

function collectRects() {
    // Le lecteur plein écran quitte la coque : toute sa surface doit recevoir la souris.
    if (document.fullscreenElement) return [{ x: 0, y: 0, width: innerWidth, height: innerHeight }];
    const rects = [];
    for (const selector of TRACKED_SELECTORS) {
        document.querySelectorAll(selector).forEach((element) => {
            const r = element.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
            }
        });
    }
    return rects;
}

function flush() {
    frameRequested = false;
    const island = document.getElementById('dynamic-island');
    const expanded = !document.body.classList.contains('layout-edit-mode')
        && island?.matches('.island-expanded,.island-large,.island-mode-files,.island-notifying');
    const bounds = island ? targetExtent(island, expanded) : null;
    if (bounds && window.__NOLYS_VIEWPORT__) {
        const viewport = window.__NOLYS_VIEWPORT__;
        const zoom = parseFloat(getComputedStyle(island).zoom) || 1;
        bounds.x = 540 + (bounds.x - viewport.offsetX - 540) / zoom;
        bounds.y = 192 + (bounds.y - viewport.offsetY - 192) / zoom;
        bounds.width /= zoom;
        bounds.height /= zoom;
        for (const key of ['x', 'y', 'width', 'height']) bounds[key] = Math.round(bounds[key] * 10) / 10;
    }
    const extent = JSON.stringify(bounds);
    // Le plein écran ne doit ni déplacer la pilule enregistrée, ni recadrer sa fenêtre.
    if (!document.fullscreenElement && extent !== lastExtent) {
        lastExtent = extent;
        native.invoke('set_island_extent', { bounds }).catch(() => { lastExtent = ''; });
    }
    const rects = collectRects();
    const pixelRatio = window.devicePixelRatio || 1;
    const payload = JSON.stringify([rects, pixelRatio]);
    if (payload === lastPayload) return;
    lastPayload = payload;
    native.invoke('set_hit_region', { rects, pixelRatio }).catch(() => {});
}

/** Planifie une mise à jour (au plus une par image). */
function schedule() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(flush);
}

export function trackHitRegion() {
    const island = document.getElementById('dynamic-island');
    if (!island) return;

    // Taille (transitions comprises), classes d'état et éléments ajoutés (menu contextuel).
    new ResizeObserver(schedule).observe(island);
    const toolbar = document.getElementById('layout-edit-toolbar');
    if (toolbar) {
        new ResizeObserver(schedule).observe(toolbar);
        new MutationObserver(schedule).observe(toolbar, { attributes: true, attributeFilter: ['style', 'class'] });
        toolbar.addEventListener('transitionend', schedule);
    }
    document.querySelectorAll('.island-satellite').forEach((satellite) => {
        new MutationObserver(schedule).observe(satellite, { attributes: true, attributeFilter: ['class'] });
        satellite.addEventListener('transitionend', schedule);
    });
    new MutationObserver(schedule).observe(island, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(schedule).observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    island.addEventListener('transitionend', schedule);
    island.addEventListener('animationend', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('fullscreenchange', schedule);
    window.addEventListener('nolys-hit-region-changed', schedule);
    schedule();
}
