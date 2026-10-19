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

/** Verre posé une fois la cascade des lignes jouée : sa première initialisation GPU est lourde. */
export function afterIntro(callback) {
    (window.requestIdleCallback || setTimeout)(callback, { timeout: 700 });
}

/**
 * Grandes vues dont la hauteur suit le contenu (peu de titres : capsule plus basse). Le
 * maximum est la forme de base.css ; le minimum garde la place des menus et des fenêtres
 * internes (nouvelle playlist, confirmation).
 */
const FITTED_PANELS = {
    replay: { min: 360, max: 536 },
    files: { min: 280, max: 496 },
    library: { min: 280, max: 496 },
    'music-history': { min: 260, max: 452 },
    settings: { min: 380, max: 524 },
};

/** Bibliothèque : un mode de l’Island comme les autres. Le son vit dans `localPlayer`. */
export const libraryView = {
    /** Hauteur retenue pour ce mode (dernière demandée par sa vue), ou rien : taille de base.css. */
    fittedPanelHeight(mode) {
        return Object.hasOwn(FITTED_PANELS, mode) ? this._panelHeights?.[mode] ?? null : null;
    },

    /** Hôte neuf : il prend tout de suite la hauteur retenue (pas de second ressort à l'ouverture). */
    applyPanelHeight(host, mode) {
        const height = this.fittedPanelHeight(mode);
        if (height) host.style.setProperty('--panel-height', `${height}px`);
    },

    /**
     * La vue demande la hauteur de son contenu. La vue (contain: strict) prend sa nouvelle
     * taille d'un coup, la capsule la suit avec son ressort habituel, centrée comme à l'ouverture.
     * Hors de la vue courante (préparation au repos), la hauteur est seulement retenue.
     */
    fitPanel(mode, host, wanted) {
        const limits = FITTED_PANELS[mode];
        if (!limits || !Number.isFinite(wanted)) return;
        const height = Math.round(Math.min(limits.max, Math.max(limits.min, wanted)));
        this._panelHeights ??= {};
        const current = this.mode === mode && this.isExpanded && host?.isConnected && (this.content.contains(host) || (mode === 'files' && this.el.contains(host)));
        if (this._panelHeights[mode] === height && (!current || this.el.style.height === `${height}px`)) return;
        this._panelHeights[mode] = height;
        if (!current || this._layoutEditMode) return;
        host.style.setProperty('--panel-height', `${height}px`);
        this.el.style.height = `${height}px`;
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
        this.applyPanelHeight(host, 'library');
        this.content.replaceChildren(host);
        this._libraryHost = host;
        const settled = capsuleSettled(this.el);
        this._libraryController = mountLibrary(host, {
            player: this.localPlayer,
            onFit: height => this.fitPanel('library', host, height),
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
