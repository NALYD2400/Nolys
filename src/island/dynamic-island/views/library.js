import { mountLibrary } from '../../../library/controller.js';

/**
 * Fin du ressort de la capsule. La taille est animée en mise en page : construire la liste
 * pendant ce temps faisait accrocher la fin de l'ouverture.
 */
export function capsuleSettled(el) {
    if (!el.classList.contains('animating')) return Promise.resolve();
    return new Promise(resolve => {
        const done = () => { el.removeEventListener('transitionend', onEnd); clearTimeout(timer); resolve(); };
        const onEnd = event => { if (event.target === el && (event.propertyName === 'width' || event.propertyName === 'height')) done(); };
        el.addEventListener('transitionend', onEnd);
        const timer = setTimeout(done, 750);
    });
}

/**
 * Dernière hauteur mesurée pour un mode, gardée d'une session à l'autre : sans elle, la
 * première ouverture après le lancement partait de la hauteur par défaut puis se rétrécissait
 * jusqu'à la bonne taille (les suivantes, déjà mesurées, s'ouvraient directement).
 */
const fitKey = (mode) => `liquid_fit_height_${mode}`;
function readStoredFit(mode) {
    try {
        const value = Number(localStorage.getItem(fitKey(mode)));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}
function writeStoredFit(mode, height) {
    try {
        localStorage.setItem(fitKey(mode), String(height));
    } catch {
        // Stockage indisponible : la hauteur reste mesurée à chaque ouverture, comme avant.
    }
}

/** Verre posé une fois la cascade des lignes jouée : sa première initialisation GPU est lourde. */
export function afterIntro(callback) {
    (window.requestIdleCallback || setTimeout)(callback, { timeout: 700 });
}

/** Bibliothèque : un mode de l’Island comme les autres. Le son vit dans `localPlayer`. */
export const libraryView = {
    /**
     * Exceptions à la taille fixe des modules : clip en lecture, aperçu d'une image, liste des
     * clips. La capsule épouse le contenu, au plus `max`. Mesuré après le rendu de la vue, et
     * retenu pour que renderContent le réapplique. La vue reste calée en haut : l'en-tête ne
     * bouge pas pendant que le bas de la capsule suit.
     */
    /** Hauteur à donner à la capsule pour ce mode : mesure en cours, ou la dernière connue (ouverture). */
    fittedHeight(mode) {
        if (this._mediaFit?.mode === mode) return this._mediaFit.height;
        return this._fitCache?.[mode] ?? readStoredFit(mode);
    },

    /** Hôte neuf : il prend tout de suite la hauteur retenue (l'en-tête ne bouge pas à la mesure). */
    applyFittedHeight(host, mode) {
        const height = this.fittedHeight(mode);
        if (!height) return;
        host.classList.add('is-top-anchored');
        host.style.setProperty('--panel-height', `${height}px`);
    },

    fitToContent(host, mode, expanded, max) {
        this._mediaFit = null;
        this._fitCache ??= {};
        // Une mesure encore en attente ne doit pas écraser une demande plus récente.
        const token = this._fitToken = (this._fitToken || 0) + 1;
        if (!expanded) {
            this._fitCache[mode] = null;
            host.style.removeProperty('--panel-height');
            if (this.mode === mode) this.el.style.height = '';
            return;
        }
        requestAnimationFrame(() => {
            const lib = host.shadowRoot?.querySelector('.lib');
            const list = host.shadowRoot?.querySelector('#list');
            if (token !== this._fitToken || !lib || !list?.lastElementChild || !host.isConnected || this.mode !== mode) return;
            // scrollHeight vaut au moins la hauteur visible : on mesure le contenu lui-même.
            const content = list.lastElementChild.getBoundingClientRect().bottom - list.getBoundingClientRect().top
                + list.scrollTop + parseFloat(getComputedStyle(list).paddingBottom);
            const height = Math.min(max, Math.ceil(lib.clientHeight - list.clientHeight + content));
            this._mediaFit = { mode, height };
            // Retenue : la prochaine ouverture part directement de cette hauteur, sans se rétrécir ensuite.
            this._fitCache[mode] = height;
            writeStoredFit(mode, height);
            host.classList.add('is-top-anchored');
            host.style.setProperty('--panel-height', `${height}px`);
            this.el.style.height = `${height}px`;
        });
    },


    openLibrary() {
        if (this._layoutEditMode || (this.mode === 'library' && this.isExpanded)) return;
        this.openExpandedMode('library');
    },

    renderLibrary() {
        if (this._libraryHost?.isConnected) {
            // renderContent vient de retirer le verre : on le repose sur les mêmes boutons.
            this.syncGlassControls();
            return;
        }
        // Le contenu a été vidé pendant une transition : on repart d’une vue propre.
        this.leaveLibrary();
        const host = document.createElement('div');
        host.className = 'island-library-view';
        this.content.replaceChildren(host);
        this._libraryHost = host;
        const settled = capsuleSettled(this.el);
        this._libraryController = mountLibrary(host, {
            player: this.localPlayer,
            savedState: this._librarySavedState,
            ready: settled,
            onBack: () => this.setMode('menu'),
            onClose: () => this.collapseIsland(),
        });
        settled.then(() => afterIntro(() => { if (this._libraryHost === host) this.syncGlassControls(); }));
    },

    leaveLibrary() {
        if (!this._libraryController) return;
        this._librarySavedState = this._libraryController.savedState;
        this._libraryController.destroy();
        this._libraryController = null;
        this._libraryHost = null;
    },
};
