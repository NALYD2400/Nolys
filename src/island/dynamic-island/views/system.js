/** Vues système : statistiques, réseau, chrono et minuteur. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { timerView } from './timer.js';
import { percent, percentLabel } from '../../../shared/system-metrics.js';
export { parseTimerInput, formatTimerPreset } from '../features/timer-state.js';

export const systemViews = {
    renderStats(stats) {
        const cpu = percent(stats?.cpu);
        const ram = percent(stats?.ram);

        // --- Gauge Configuration ---
        const r = 32;
        const C = 201;

        const cpuOffset = C - (cpu / 100) * C;
        const ramOffset = C - (ram / 100) * C;

        const items = [];

        // 1. CPU Usage (Always show)
        items.push({
            id: 'cpu',
            val: percentLabel(cpu),
            label: 'CPU',
            offset: cpuOffset,
            icon: 'ph-cpu',
            color: 'var(--neon-primary)'
        });

        // 2. RAM Usage (Lightweight alternative to GPU/Temp)
        items.push({
            id: 'ram',
            val: percentLabel(ram),
            label: 'RAM',
            offset: ramOffset,
            icon: 'ph-memory',
            color: 'var(--neon-secondary)'
        });

        // If we still have space and detected both GPU stats, maybe show the 4th?
        // Current island logic fits ~3 comfortably.

        // Optimize: Update existing DOM if structure matches (same number of items)
        const existing = this.content.querySelector('.stats-pulse-container');
        const existingItems = existing ? existing.querySelectorAll('.gauge-wrapper') : [];
        if (existing && existingItems.length === items.length) {
            items.forEach((item, index) => {
                const el = existingItems[index];
                const circle = el.querySelector('.gauge-progress');
                const valText = el.querySelector('.gauge-value');
                // const label = el.querySelector('.gauge-label');

                if (circle) circle.style.strokeDashoffset = item.offset;
                if (valText) valText.innerText = item.val;
            });
            return;
        }

        // Generate HTML
        const gaugesHtml = items.map(item => `
            <div class="gauge-wrapper item-${item.id}">
                <svg class="gauge-svg" viewBox="0 0 80 80" style="overflow: visible;">
                    <circle class="gauge-bg" cx="40" cy="40" r="${r}"></circle>
                    <circle class="gauge-progress" cx="40" cy="40" r="${r}" 
                            style="stroke-dasharray: ${C}; stroke-dashoffset: ${item.offset}; stroke: ${item.color}; filter: drop-shadow(0 0 8px ${item.color});"></circle>
                </svg>
                <div class="gauge-content">
                    <i class="ph ${item.icon} gauge-icon" style="color: ${item.color};"></i>
                    <div class="gauge-value">${item.val}</div>
                    <div class="gauge-label">${item.label}</div>
                </div>
            </div>
        `).join('');

        // Initial Layout
        this.content.innerHTML = `
      <div class="stats-pulse-container">
        <div class="stats-pulse-header">
            <div class="stats-pulse-title">
                <i class="ph ph-gauge" style="color: var(--neon-primary);"></i> System Pulse
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="island-action-btn menu-btn" data-island-action="setMode" data-arg="menu" title="Menu des modules">
                    <i class="ph-bold ph-squares-four"></i>
                </button>
            </div>
        </div>
        
        <div class="stats-gauges-row" style="gap: ${items.length > 2 ? '25px' : '40px'};">
            ${gaugesHtml}
        </div>
      </div>
    `;
    },

    async refreshNetwork() {
        if (this._networkPending || !this.isExpanded || this.mode !== 'network') return;
        this._networkPending = true;
        this._networkRequestedAt = Date.now();
        try {
            const sample = await ipcRenderer.invoke('get-hardware-telemetry');
            if (!sample || !Number.isFinite(sample.netDown) || !Number.isFinite(sample.netUp)) throw new Error('Débit indisponible');
            // The native counters report KiB/s; this view uses decimal megabits/s.
            this.networkState = { dl: Math.max(0, sample.netDown) * 1024 * 8 / 1_000_000, ul: Math.max(0, sample.netUp) * 1024 * 8 / 1_000_000 };
            this._networkAvailable = true;
        } catch {
            this._networkAvailable = false;
        } finally {
            this._networkPending = false;
            if (this.isExpanded && this.mode === 'network') this.renderNetwork();
        }
    },

    renderNetwork() {
        this.networkState ??= { dl: 0, ul: 0 };
        if (!this._networkRequestedAt || Date.now() - this._networkRequestedAt > 900) this.refreshNetwork();
        const dl = this._networkAvailable ? this.networkState.dl.toFixed(1) : '—';
        const ul = this._networkAvailable ? this.networkState.ul.toFixed(1) : '—';

        // Determine Speed Class
        let speedClass = 'speed-slow';
        if (this.networkState.dl > 50) speedClass = 'speed-medium';
        if (this.networkState.dl > 150) speedClass = 'speed-fast';
        if (this.networkState.dl > 500) speedClass = 'speed-fiber';

        // Direction based on dominant traffic
        const waveClass = this.networkState.dl > (this.networkState.ul * 2) ? 'download-wave' : 'upload-wave';

        // Check if already rendered to update inplace (Prevents animation reset)
        const container = this.content.querySelector('.network-pulse-container');
        if (container) {
            const waveContainer = container.querySelector('.network-pulse-wave');
            if (waveContainer.className !== `network-pulse-wave ${speedClass}`) {
                waveContainer.className = `network-pulse-wave ${speedClass}`;
            }

            const svg = container.querySelector('.pulse-wave-svg');
            // Only change direction if strictly needed (to keep animation smooth)
            if (!svg.classList.contains(waveClass)) {
                svg.setAttribute('class', `pulse-wave-svg ${waveClass}`);
            }

            // Update Texts
            const dlText = container.querySelector('.net-wave-dl-text');
            if (dlText) dlText.innerHTML = `<i class="ph ph-arrow-down"></i> ${dl} <small>Mbps</small>`;

            const ulText = container.querySelector('.net-wave-ul-text');
            if (ulText) ulText.innerHTML = `<i class="ph ph-arrow-up"></i> ${ul} <small>Mbps</small>`;

            const dlDisp = container.querySelector('.net-display-dl');
            if (dlDisp) dlDisp.innerHTML = `${dl}<span class="speed-unit">Mbps</span>`;

            const ulDisp = container.querySelector('.net-display-ul');
            if (ulDisp) ulDisp.innerHTML = `${ul}<span class="speed-unit">Mbps</span>`;

            return;
        }

        // Initial Render
        this.content.innerHTML = `
            <div class="network-pulse-container">
                <div class="network-pulse-header">
                    <div class="network-pulse-title">
                        <i class="ph ph-globe-stand"></i> Pulse Réseau
                    </div>
                    <button class="island-action-btn menu-btn" data-island-action="setMode" data-arg="menu" title="Menu des modules">
                        <i class="ph-bold ph-squares-four"></i>
                    </button>
                </div>

                <div class="network-pulse-wave ${speedClass}">
                    <svg class="pulse-wave-svg ${waveClass}" viewBox="0 0 1440 320" preserveAspectRatio="none">
                         <path fill="var(--wave-color)" fill-opacity="0.3" d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
                    </svg>
                    <div style="position: absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:30px;">
                        <span class="net-wave-dl-text" style="font-size:12px; font-weight:bold; color: var(--wave-color); text-shadow: 0 1px 2px rgba(0,0,0,0.8);"><i class="ph ph-arrow-down"></i> ${dl} <small>Mbps</small></span>
                        <span class="net-wave-ul-text" style="font-size:12px; font-weight:bold; color: #fff; opacity:0.7; text-shadow: 0 1px 2px rgba(0,0,0,0.8);"><i class="ph ph-arrow-up"></i> ${ul} <small>Mbps</small></span>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-end; padding: 0 5px;">
                     <div class="speed-item">
                        <span class="speed-label"><i class="ph ph-download-simple"></i> Download</span>
                        <div class="speed-value net-display-dl">${dl}<span class="speed-unit">Mbps</span></div>
                     </div>
                     <div style="height: 30px; width: 1px; background: rgba(255,255,255,0.1);"></div>
                     <div class="speed-item">
                        <span class="speed-label"><i class="ph ph-upload-simple"></i> Upload</span>
                        <div class="speed-value net-display-ul" style="color: rgba(255,255,255,0.7);">${ul}<span class="speed-unit">Mbps</span></div>
                     </div>
                </div>
            </div>
        `;
    },

    ...timerView,
};
