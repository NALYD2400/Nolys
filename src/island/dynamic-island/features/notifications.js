/** Alertes temporaires, lecture du détail et retour au panneau précédent. */
import { SoundService } from '../../../services/SoundService.js';

function notificationsAllowed(island) {
    return !island._layoutEditMode
        && localStorage.getItem('liquid_notifications_enabled') !== 'false'
        && localStorage.getItem('liquid_focus_mode') !== 'true';
}

export const notificationMethods = {
    clearNotification() {
        clearTimeout(this.notifTimeout);
        this.notifTimeout = null;
        this._notificationRequest = null;
        this._notificationDismissRequest = null;
        this._notificationReturnState = null;
        this.notificationData = null;
    },

    showNotification(title, message, icon = 'ph-bell') {
        if (!notificationsAllowed(this)) return;
        // Une alerte ne remplace pas le formulaire ou la collection en cours d’utilisation.
        if (this.mode === 'library' && this._libraryController) {
            this._libraryController.notify(`${title} — ${message}`);
            return;
        }

        const request = {};
        this._notificationRequest = request;
        clearTimeout(this.notifTimeout);
        this.notifTimeout = null;

        this.transitionState(() => {
            // Seule la dernière alerte reçue pendant une animation doit apparaître.
            if (this._notificationRequest !== request) return;
            if (!notificationsAllowed(this)) {
                if (this._notificationReturnState) {
                    this.mode = this._notificationReturnState.mode;
                    this.isExpanded = this._notificationReturnState.isExpanded;
                }
                this.clearNotification();
                this.renderContent();
                return;
            }
            if (this.mode !== 'notification') {
                this._notificationReturnState = { mode: this.mode, isExpanded: this.isExpanded };
                this.isExpanded = false;
            }
            this.notificationData = { title: title || 'Notification', message: message || '', icon };
            this.mode = 'notification';
            this.el.classList.remove('island-active-music');
            this.renderContent();
            // Un échec audio ne doit pas interrompre l'affichage de l'alerte.
            try { SoundService.play('notification'); } catch (error) { console.warn('Notification sound unavailable:', error); }
        });
    },

    startNotificationTimeout() {
        if (this.mode !== 'notification' || this.isExpanded || this._isTransitioning || this.notifTimeout) return;
        const request = this._notificationRequest;
        if (!request) return;
        // Le délai commence une fois le contenu visible, après le changement de taille.
        this.notifTimeout = setTimeout(() => {
            this.notifTimeout = null;
            if (this._notificationRequest === request && !this.isExpanded) this.dismissNotification();
        }, 4000);
    },

    expandNotification() {
        const request = this._notificationRequest;
        this._notificationDismissRequest = null;
        clearTimeout(this.notifTimeout);
        this.notifTimeout = null;
        this.transitionState(() => {
            if (this.mode !== 'notification' || this._notificationRequest !== request) return;
            clearTimeout(this.notifTimeout);
            this.notifTimeout = null;
            this.isExpanded = true;
            this.renderContent();
        });
    },

    dismissNotification() {
        const request = this._notificationRequest;
        const dismissal = {};
        this._notificationDismissRequest = dismissal;
        clearTimeout(this.notifTimeout);
        this.notifTimeout = null;
        this.transitionState(() => {
            if (this.mode !== 'notification' || this._notificationRequest !== request || this._notificationDismissRequest !== dismissal) return;
            const previous = this._notificationReturnState || { mode: 'music', isExpanded: false };
            this.mode = previous.mode;
            this.isExpanded = previous.isExpanded;
            this.clearNotification();
            this.renderContent();
        });
    },
};
