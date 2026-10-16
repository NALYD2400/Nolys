/**
 * Réglages montés dans l'Island (mode `settings`), chargés à la demande par
 * island/dynamic-island/views/settings.js.
 *
 * Tout vit dans un shadow DOM : les styles des Réglages et du SDK Liquid Glass ne touchent
 * pas l'Island, et ceux de l'Island ne touchent pas les Réglages. Les menus du SDK sont
 * portés dans la racine de leur scène, donc restent eux aussi dans le shadow DOM.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import sdkStyles from '@glass-sdk/liquid-glass/styles.css?inline';
import settingsStyles from './styles.css?inline';
import App from './App.jsx';
import { isBusy, onBusyChange } from './state/busy.js';

// Feuilles analysées une seule fois, partagées par chaque ouverture.
let sheets = null;
function settingsSheets() {
    if (!sheets) {
        sheets = [sdkStyles, settingsStyles].map((css) => {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
            return sheet;
        });
    }
    return sheets;
}

/** Préparation au repos (après le lancement) : feuilles analysées avant la première ouverture. */
export function warmSettings() {
    settingsSheets();
}

/**
 * @param host élément vide, à sa taille finale, dans `.island-content`
 * @param options.page page à ouvrir (sinon la dernière consultée)
 * @param options.onBack retour au menu de l'Island
 * @param options.onClose repli de l'Island
 * @param options.onFit hauteur demandée à l'Island pour la page affichée
 */
export function mountSettings(host, { page, onBack = () => {}, onClose = () => {}, onFit = null } = {}) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = settingsSheets();
    // Police d'icônes : ses classes doivent exister dans le shadow DOM (la police, elle, est
    // déjà chargée par la page de l'Island).
    const icons = document.createElement('link');
    icons.rel = 'stylesheet';
    icons.href = '/assets/icons/phosphor.css';
    const container = document.createElement('div');
    container.className = 'settings-root';
    container.tabIndex = -1;
    root.replaceChildren(icons, container);

    const abort = new AbortController();
    // Échap ferme les Réglages, sauf s'il sert déjà à fermer un menu ouvert (le SDK l'écoute
    // sur le document, après nous) ; l'enregistrement d'un raccourci l'intercepte avant nous.
    root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (root.querySelector('.lg-menu-positioner, [data-open][role="menu"]')) return;
        event.preventDefault();
        onClose();
    }, { signal: abort.signal });
    const offBusy = onBusyChange((busy) => host.toggleAttribute('data-busy', busy));

    const reactRoot = createRoot(container);
    let request = null;
    const render = () => reactRoot.render(
        <App host={host} initialPage={page} pageRequest={request} onBack={onBack} onClose={onClose} onFit={onFit} />,
    );
    // Rendu synchrone : la vue est complète dès l'image suivante (pas de cadre vide).
    flushSync(render);
    container.focus({ preventScroll: true });

    return {
        /** Dialogue Windows ouvert depuis les Réglages : l'Island ne doit pas se replier. */
        get busy() {
            return isBusy();
        },
        showPage(next) {
            request = { page: next };
            render();
        },
        focus() {
            if (!root.activeElement) container.focus({ preventScroll: true });
        },
        destroy() {
            abort.abort();
            offBusy();
            reactRoot.unmount();
        },
    };
}
