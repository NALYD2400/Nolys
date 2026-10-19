/** Menu des modules et des raccourcis personnels. */
import { visibleMenuEntries, moduleMenuSize } from '../../../shared/menu-config.js';
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml } from '../helpers/format.js';

export const menuView = {
    /** Calculé avant le ressort, sans dépendre du contenu de la vue précédente. */
    sizeModuleMenu() {
        const count = visibleMenuEntries('modules').length;
        const top = document.getElementById('dynamic-island-container')?.getBoundingClientRect().top || 50;
        const size = moduleMenuSize(count, Math.min(328, window.innerWidth - 32), Math.min(496, window.innerHeight - top - 24));
        this.el.style.width = `${size.width}px`;
        this.el.style.height = `${size.height}px`;
        this.el.style.setProperty('--menu-columns', size.columns);
        this.el.style.setProperty('--menu-height', `${size.height}px`);
    },

    async activateMenuEntry(entry) {
        if (entry.cmd) {
            const launched = await this.launchShortcut(entry.cmd);
            if (!launched) this.showNotification('Raccourci indisponible', `Impossible d’ouvrir « ${entry.label} ». Vérifie sa destination dans Réglages → Menus.`, 'ph-warning-circle');
            else if (!entry.cmd.startsWith('liquid:')) this.collapseIsland();
        } else if (entry.id === 'layout') {
            ipcRenderer.send('set-layout-edit-mode', true);
        } else if (entry.id === 'exit') {
            ipcRenderer.send('exit-app');
        } else {
            this.isExpanded = true;
            this.setMode(entry.id);
        }
    },

    renderMenu() {
        this.sizeModuleMenu();
        const entries = visibleMenuEntries('modules');
        this.content.innerHTML = `<div class="island-menu-grid" role="group" aria-label="Modules">
            ${entries.map(entry => `<button type="button" class="island-menu-item" data-menu-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.label)}">
                <div class="menu-icon"><i class="ph ${entry.icon}" aria-hidden="true"></i></div>
                <span>${escapeHtml(entry.shortLabel || entry.label)}</span>
            </button>`).join('')}
        </div>`;
        this.content.querySelector('.island-menu-grid').addEventListener('click', event => {
            event.stopPropagation();
            const button = event.target.closest('[data-menu-id]');
            const entry = entries.find(item => item.id === button?.dataset.menuId);
            if (entry) this.activateMenuEntry(entry);
        });
    },
};
