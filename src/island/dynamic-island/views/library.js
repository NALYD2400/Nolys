import { native } from '../../../shared/ipc.js';
import { themeLook } from '../../../shared/theme-look.js';
import { mountLibrary } from '../../../library/controller.js';

/** Une vue interne : la collection et le lecteur survivent aux changements de mode. */
export const libraryView = {
    async openLibrary() {
        if (this._layoutEditMode || this._libraryOpening || (this.mode === 'library' && this.isExpanded)) return;
        this._libraryOpening = true;
        clearTimeout(this._libraryCloseTimer);
        this._libraryCloseTimer = null;
        try {
            await native.invoke('library_workspace', { expanded: true });
            this._libraryWorkspace = true;
            this.openExpandedMode('library');
        } catch (error) {
            this.showNotification('Bibliothèque', String(error), 'ph-warning-circle');
        } finally {
            this._libraryOpening = false;
        }
    },

    syncLibraryTheme() {
        if (!this._libraryHost) return;
        const cover = localStorage.getItem('liquid_cover_color_sync') !== 'false' ? this._coverColors?.primary : '';
        const look = themeLook(this._islandConfig, cover);
        this._libraryHost.style.setProperty('--library-accent', look.accent);
        this._libraryHost.style.setProperty('--library-accent-rgb', look.accentRgb);
    },

    renderLibrary() {
        clearTimeout(this._libraryCloseTimer);
        this._libraryCloseTimer = null;
        if (this._libraryHost?.isConnected) {
            this.syncLibraryTheme();
            return;
        }
        const host = document.createElement('div');
        host.className = 'island-library-view';
        host.tabIndex = -1;
        this.content.replaceChildren(host);
        this._libraryHost = host;
        this.syncLibraryTheme();
        this._libraryController = mountLibrary(host, {
            savedState: this._libraryState,
            onMenu: () => this.setMode('menu'),
            onCollapse: () => this.collapseIsland(),
        });
        host.focus({ preventScroll: true });
        this._libraryThemeObserver = new MutationObserver(() => this.syncLibraryTheme());
        this._libraryThemeObserver.observe(this.el, { attributes: true, attributeFilter: ['style'] });
    },

    leaveLibrary() {
        if (this._libraryController) {
            this._libraryState = this._libraryController.state;
            this._libraryController.destroy();
            this._libraryController = null;
            this._libraryHost = null;
            this._libraryThemeObserver?.disconnect();
        }
        if (!this._libraryWorkspace || this._libraryCloseTimer) return;
        // Laisser finir le rétrécissement avant de rendre la fenêtre native à sa taille normale.
        this._libraryCloseTimer = setTimeout(() => {
            this._libraryCloseTimer = null;
            if (this.mode === 'library' && this.isExpanded) return;
            native.invoke('library_workspace', { expanded: false }).then(() => {
                if (this.mode !== 'library' && !this._libraryOpening) this._libraryWorkspace = false;
            }).catch(error => console.warn('[Library] Restore workspace:', error));
        }, 650);
    },
};
