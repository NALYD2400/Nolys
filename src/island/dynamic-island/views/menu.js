/** Menu des applications. */
export const menuView = {
    renderMenu() {
        const statsEnabled = localStorage.getItem('liquid_island_stats_enabled') !== 'false';
        const timerEnabled = localStorage.getItem('liquid_island_timer_enabled') !== 'false';
        const networkEnabled = localStorage.getItem('liquid_island_network_enabled') !== 'false';
        const musicEnabled = localStorage.getItem('liquid_music_enabled') !== 'false';
        const controlEnabled = localStorage.getItem('liquid_island_control_enabled') !== 'false';
        const searchEnabled = localStorage.getItem('liquid_search_island_sync') !== 'false';

        let itemsHtml = '';

        if (controlEnabled) {
            itemsHtml += `
            <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('control')">
                <div class="menu-icon"><i class="ph ph-sliders"></i></div>
                <span>Contrôle</span>
            </div>`;
        }

        if (musicEnabled) {
            itemsHtml += `
            <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('music')">
                <div class="menu-icon"><i class="ph ph-music-notes"></i></div>
                <span>Lecteur</span>
            </div>`;

            itemsHtml += `
            <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('music-history')">
                <div class="menu-icon"><i class="ph ph-clock-counter-clockwise"></i></div>
                <span>Historique</span>
            </div>`;
        }

        if (timerEnabled) {
            itemsHtml += `
            <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('timer')">
                <div class="menu-icon"><i class="ph ph-timer"></i></div>
                <span>Chrono</span>
            </div>`;
        }

        // Mixer integration
        itemsHtml += `
        <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('mixer')">
            <div class="menu-icon"><i class="ph ph-sliders-horizontal"></i></div>
            <span>Mélangeur</span>
        </div>`;

        itemsHtml += `
        <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('mic')">
            <div class="menu-icon"><i class="ph ph-microphone"></i></div>
            <span>Micro</span>
        </div>`;

        // Réglages integration
        itemsHtml += `
        <div class="island-menu-item" onclick="event.stopPropagation(); window.island.setMode('settings')">
            <div class="menu-icon"><i class="ph ph-gear"></i></div>
            <span>Réglages</span>
        </div>`;

        if (itemsHtml === '') {
            itemsHtml = '<div style="grid-column: 1/-1; opacity: 0.5; font-size: 13px;">Aucun module actif</div>';
        }

        this.content.innerHTML = `
            <div class="island-menu-grid">
                ${itemsHtml}
            </div>
        `;
    },
};
