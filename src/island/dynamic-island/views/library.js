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

/** Bibliothèque : un mode de l’Island comme les autres. Le son vit dans `localPlayer`. */
export const libraryView = {
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
