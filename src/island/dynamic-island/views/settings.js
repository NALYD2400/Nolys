import { capsuleSettled } from './library.js';

// React et le SDK Liquid Glass ne sont téléchargés qu'à la première ouverture (ou au repos
// après le lancement, voir warmSettingsView) : l'Island seule n'en a pas besoin.
let settingsModule = null;
const loadSettings = () => (settingsModule ??= import('../../../settings/mount.jsx').catch((error) => {
    settingsModule = null;
    throw error;
}));

/** Au repos après le lancement : code des Réglages téléchargé et analysé, feuilles prêtes. */
export function warmSettingsView() {
    loadSettings().then((module) => module.warmSettings()).catch(() => {});
}

/** Réglages : un mode de l'Island comme la Bibliothèque (même taille, même ressort). */
export const settingsView = {
    /** `page` : page à afficher (sinon la dernière consultée). */
    openSettings(page) {
        if (this._layoutEditMode) return;
        if (this.mode === 'settings' && this.isExpanded) {
            if (page) this._settingsController?.showPage(page);
            this._settingsController?.focus();
            return;
        }
        this._settingsPage = page || null;
        this.isAudioDeviceDropdownOpen = false;
        this.isMicDeviceDropdownOpen = false;
        this.openExpandedMode('settings');
    },

    /** Raccourci des Réglages : ouvre, ou referme s'ils sont déjà affichés. */
    toggleSettings() {
        if (this.mode === 'settings' && this.isExpanded) this.collapseIsland();
        else this.openSettings();
    },

    renderSettings() {
        // Nouveau rendu de l'Island (réglage appliqué, thème…) : la vue React reste en place.
        if (this._settingsHost?.isConnected) {
            this._settingsController?.focus();
            return;
        }
        this.leaveSettings();
        const host = document.createElement('div');
        host.className = 'island-library-view island-settings-view';
        this.applyPanelHeight(host, 'settings');
        this.content.replaceChildren(host);
        this._settingsHost = host;
        const page = this._settingsPage;
        this._settingsPage = null;
        // Montée une fois la capsule posée : construire les pages pendant le ressort le ferait accrocher.
        Promise.all([loadSettings(), capsuleSettled(this.el)]).then(([module]) => {
            if (this._settingsHost !== host || !host.isConnected) return;
            this._settingsController = module.mountSettings(host, {
                page,
                onBack: () => this.setMode('menu'),
                onClose: () => this.collapseIsland({ force: true }),
                onFit: (height) => this.fitPanel('settings', host, height),
            });
        }).catch((error) => {
            console.error('[Settings] Chargement impossible :', error);
            if (this._settingsHost === host) host.textContent = 'Réglages indisponibles.';
        });
    },

    leaveSettings() {
        this._settingsController?.destroy();
        this._settingsController = null;
        this._settingsHost = null;
    },
};
