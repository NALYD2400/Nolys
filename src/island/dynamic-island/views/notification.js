/** Notification temporaire. */
import { escapeHtml } from '../helpers/format.js';

export const notificationView = {
    renderNotification() {
        const { title, message, icon } = this.notificationData || { title: 'Notification', message: '...', icon: 'ph-bell' };
        const safeTitle = escapeHtml(title);
        const safeMessage = escapeHtml(message);
        const safeIcon = String(icon || 'ph-bell').replace(/[^a-z0-9-\s]/gi, '').trim() || 'ph-bell';

        // Vérifie si l'île est en mode d'expansion complète ou notification compacte
        const isExpanded = this.isExpanded;

        this.content.innerHTML = `
      <div class="island-notification ${isExpanded ? 'expanded' : 'compact'}" role="${isExpanded ? 'status' : 'button'}" ${isExpanded ? '' : 'tabindex="0" aria-label="Lire la notification"'} aria-live="polite" aria-atomic="true">
        <div class="notif-icon-wrapper">
          <i class="ph ${safeIcon} notif-icon"></i>
        </div>
        <div class="notif-content">
          <div class="notif-title" title="${safeTitle}">${safeTitle}</div>
          <div class="${isExpanded ? 'notif-message' : 'notif-preview'}">${safeMessage}</div>
        </div>
        ${isExpanded ? '<button type="button" class="notif-dismiss" aria-label="Fermer la notification" data-island-action="dismissNotification"><i class="ph ph-x" aria-hidden="true"></i></button>' : ''}
      </div>
    `;
        this.startNotificationTimeout();
    },
};
