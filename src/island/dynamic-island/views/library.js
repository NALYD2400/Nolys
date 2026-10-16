import { mountLibrary } from '../../../library/controller.js';

/** Bibliothèque : un mode de l’Island comme les autres. Le son vit dans `localPlayer`. */
export const libraryView = {
    openLibrary() {
        if (this._layoutEditMode || (this.mode === 'library' && this.isExpanded)) return;
        this.openExpandedMode('library');
    },

    renderLibrary() {
        if (this._libraryHost?.isConnected) return;
        // Le contenu a été vidé pendant une transition : on repart d’une vue propre.
        this.leaveLibrary();
        const host = document.createElement('div');
        host.className = 'island-library-view';
        this.content.replaceChildren(host);
        this._libraryHost = host;
        this._libraryController = mountLibrary(host, {
            player: this.localPlayer,
            savedState: this._librarySavedState,
            onBack: () => this.setMode('menu'),
            onClose: () => this.collapseIsland(),
        });
    },

    leaveLibrary() {
        if (!this._libraryController) return;
        this._librarySavedState = this._libraryController.savedState;
        this._libraryController.destroy();
        this._libraryController = null;
        this._libraryHost = null;
    },
};
