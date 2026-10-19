/** Vues système : statistiques, réseau, chrono et minuteur. */
import { SoundService } from '../../../services/SoundService.js';

/** Durées proposées par le minuteur, par défaut (en secondes). */
const DEFAULT_TIMER_PRESETS = [60, 300, 600, 1500];
const TIMER_PRESETS_KEY = 'liquid_timer_presets';
const MAX_TIMER_SECONDS = 99 * 3600;

/** Durées rapides personnalisées (localStorage), avec repli sur les valeurs par défaut. */
function loadTimerPresets() {
    try {
        const saved = JSON.parse(localStorage.getItem(TIMER_PRESETS_KEY) || 'null');
        if (Array.isArray(saved) && saved.length === DEFAULT_TIMER_PRESETS.length
            && saved.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_TIMER_SECONDS)) {
            return saved;
        }
    } catch (e) { /* valeurs par défaut */ }
    return [...DEFAULT_TIMER_PRESETS];
}

/** « 1 h », « 25 min » ou « 1:30 » selon la durée. */
export function formatTimerPreset(seconds) {
    if (seconds % 3600 === 0) return `${seconds / 3600} h`;
    if (seconds % 60 === 0) return `${seconds / 60} min`;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Lit une durée tapée : « 90 » (minutes), « 1h », « 1h30 », « 1h 30 », « 1:30 » (m:ss),
 * « 1:30:00 » (h:mm:ss). Renvoie les secondes, ou null si ce n'est pas une durée valable.
 */
export function parseTimerInput(text) {
    const raw = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    let seconds = null;
    let match;
    if ((match = raw.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/))) {
        seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    } else if ((match = raw.match(/^(\d{1,3}):(\d{1,2})$/))) {
        seconds = Number(match[1]) * 60 + Number(match[2]);
    } else if ((match = raw.match(/^(\d{1,2})h(\d{1,2})?$/))) {
        seconds = Number(match[1]) * 3600 + Number(match[2] || 0) * 60;
    } else if ((match = raw.match(/^(\d{1,4})(min|m)?$/))) {
        seconds = Number(match[1]) * 60;
    }
    if (seconds === null || seconds < 1 || seconds > MAX_TIMER_SECONDS) return null;
    return seconds;
}

export const systemViews = {
    renderStats(stats) {
        const cpu = stats ? stats.cpu : 0;
        const ram = stats ? stats.ram : 0; // Added RAM

        // --- Gauge Configuration ---
        const r = 32;
        const C = 201;

        const cpuOffset = C - (cpu / 100) * C;
        const ramOffset = C - (ram / 100) * C;

        const items = [];

        // 1. CPU Usage (Always show)
        items.push({
            id: 'cpu',
            val: cpu + '%',
            label: 'CPU',
            offset: cpuOffset,
            icon: 'ph-cpu',
            color: 'var(--neon-primary)'
        });

        // 2. RAM Usage (Lightweight alternative to GPU/Temp)
        items.push({
            id: 'ram',
            val: ram + '%',
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
                <button class="island-action-btn menu-btn" onclick="event.stopPropagation(); window.island.setMode('menu')" title="Menu des modules">
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

    renderNetwork() {
        // --- Network Simulation Logic ---
        if (!this.networkState) {
            this.networkState = { dl: 50, ul: 10 };
        }

        // Random drift smoother
        const targetDl = this.networkState.dl + (Math.random() - 0.5) * 30;
        const targetUl = this.networkState.ul + (Math.random() - 0.5) * 5;

        // Clamp
        this.networkState.dl = Math.max(5, Math.min(950, targetDl));
        this.networkState.ul = Math.max(1, Math.min(300, targetUl));

        const dl = this.networkState.dl.toFixed(1);
        const ul = this.networkState.ul.toFixed(1);

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
                    <button class="island-action-btn menu-btn" onclick="event.stopPropagation(); window.island.setMode('menu')" title="Menu des modules">
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

    renderTimer() {
        // Pilule repliée : le chrono n'a rien à afficher dedans, seulement sa bulle.
        if (!this.isExpanded || this.mode !== 'timer') {
            this.syncTimerSatellite();
            return;
        }
        const isCountdown = this.timerMode === 'countdown';
        const mins = Math.floor(this.timerValue / 60).toString().padStart(2, '0');
        const secs = (this.timerValue % 60).toString().padStart(2, '0');
        const status = this.isTimerRunning ? 'En cours' : (this.timerValue > 0 ? 'En pause' : 'Prêt');
        // Minuteur au repos, vide ou sur sa durée : on propose les durées à la place du statut.
        const showPresets = isCountdown && !this.isTimerRunning && (this.timerValue === 0 || this.timerValue === this.timerPreset);
        const presets = loadTimerPresets();
        // Clic : durée. Clic droit : la changer (saisie d'une nouvelle durée).
        const presetsHtml = presets.map((seconds, index) => `
                    <button class="timer-preset ${this.timerPreset === seconds ? 'on' : ''}" data-preset="${index}" onclick="event.stopPropagation(); window.island.setTimerPreset(${seconds})" oncontextmenu="event.preventDefault(); event.stopPropagation(); window.island.editTimerPreset(${index})" title="Minuteur : ${formatTimerPreset(seconds)} (clic droit pour la changer)">${formatTimerPreset(seconds)}</button>`).join('');

        this.content.innerHTML = `
        <div class="island-timer-container">
            <div class="island-timer-header">
                <div class="timer-mode" role="radiogroup" aria-label="Mode">
                    <button class="${isCountdown ? '' : 'on'}" role="radio" aria-checked="${!isCountdown}" onclick="event.stopPropagation(); window.island.setTimerMode('stopwatch')">Chrono</button>
                    <button class="${isCountdown ? 'on' : ''}" role="radio" aria-checked="${isCountdown}" onclick="event.stopPropagation(); window.island.setTimerMode('countdown')">Minuteur</button>
                </div>
                <button class="island-action-btn menu-btn" onclick="event.stopPropagation(); window.island.setMode('menu')" title="Menu des modules">
                    <i class="ph-bold ph-squares-four"></i>
                </button>
            </div>
            <div class="timer-stage">
                ${showPresets
                    ? `<div class="timer-presets">${presetsHtml}
                    </div>`
                    : `<div class="timer-status">${status}</div>`}
                <div class="timer-readout">${mins}:${secs}</div>
                <div class="timer-controls">
                    <button class="timer-control-btn" onclick="event.stopPropagation(); window.island.resetTimer()" title="Réinitialiser">
                        <i class="ph-bold ph-arrow-counter-clockwise"></i>
                    </button>
                    <button class="timer-control-btn primary ${this.isTimerRunning ? 'is-running' : ''}" onclick="event.stopPropagation(); window.island.toggleTimer()" title="${this.isTimerRunning ? 'Pause' : 'Démarrer'}">
                        <i class="ph-fill ${this.isTimerRunning ? 'ph-pause' : 'ph-play'}"></i>
                    </button>
                </div>
            </div>
        </div>
      `;
        this.syncTimerSatellite();
    },

    /** Bascule chrono / minuteur : chaque mode garde sa valeur. */
    setTimerMode(mode) {
        if (this.timerMode === mode) return;
        this.timerStore ??= { stopwatch: 0, countdown: 0 };
        this.timerStore[this.timerMode] = this.timerValue;
        this.timerMode = mode;
        this.timerValue = this.timerStore[mode];
        this.isTimerRunning = false;
        this.renderTimer();
    },

    /**
     * Clic droit sur une durée rapide : un champ s'ouvre à sa place. Entrée valide, Échap
     * ou perte du focus annule. Une durée invalide garde l'ancienne valeur.
     */
    editTimerPreset(index) {
        const button = this.content.querySelector(`.timer-preset[data-preset="${index}"]`);
        if (!button || button.querySelector('input')) return;
        const presets = loadTimerPresets();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'timer-preset-input';
        input.value = formatTimerPreset(presets[index]);
        input.placeholder = '90 · 1h30 · 1:30:00';
        input.setAttribute('aria-label', 'Nouvelle durée');
        button.textContent = '';
        button.appendChild(input);
        input.focus();
        input.select();

        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            const seconds = save ? parseTimerInput(input.value) : null;
            if (seconds !== null) {
                presets[index] = seconds;
                try { localStorage.setItem(TIMER_PRESETS_KEY, JSON.stringify(presets)); } catch (e) { /* stockage plein : valeur gardée pour cette session */ }
                if (this.timerPreset === presets[index]) this.timerPreset = seconds;
            }
            this.renderTimer();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // les touches ne doivent pas déclencher les raccourcis de l'Island
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', (e) => e.stopPropagation());
    },

    /** Choisit une durée du minuteur, prête à démarrer. */
    setTimerPreset(seconds) {
        this.timerMode = 'countdown';
        this.timerPreset = seconds;
        this.timerValue = seconds;
        this.isTimerRunning = false;
        this.renderTimer();
    },

    /** Démarre ou met en pause ; un minuteur terminé repart de sa durée. */
    toggleTimer() {
        if (!this.isTimerRunning && this.timerMode === 'countdown' && this.timerValue === 0) {
            this.timerValue = this.timerPreset;
        }
        this.isTimerRunning = !this.isTimerRunning;
        this.renderTimer();
    },

    /** Réinitialise : le chrono revient à zéro, le minuteur à sa durée choisie. */
    resetTimer() {
        this.isTimerRunning = false;
        this.timerValue = this.timerMode === 'countdown' ? this.timerPreset : 0;
        this.renderTimer();
    },

    /** Bulle du minuteur, à gauche de la pilule : pendant le décompte, pilule libre. */
    initTimerSatellite() {
        this._timerSatellite = document.getElementById('island-timer-satellite');
        this._timerSatellite?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openExpandedMode('timer');
        });
        this.positionMicSatellite();
        this.syncSatelliteTheme();
        this.syncTimerSatellite();
    },

    /**
     * Temps dans la bulle, lisible d'un coup d'œil : les secondes seules sous la minute
     * (« 45 »), puis le nombre de minutes (« 2 min »). L'anneau suit le temps restant d'un minuteur.
     */
    syncTimerSatellite() {
        const bubble = this._timerSatellite;
        if (!bubble) return;
        const total = Math.max(0, Math.floor(this.timerValue));
        // Sous la minute : les secondes seules. Au-delà : m:ss, et la bulle s'élargit pour les deux.
        const wide = total >= 60;
        const hours = total >= 3600;
        const pad = (n) => String(n).padStart(2, '0');
        let label = String(total);
        if (hours) label = `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
        else if (wide) label = `${Math.floor(total / 60)}:${pad(total % 60)}`;
        const value = bubble.querySelector('.satellite-timer-value');
        if (value && value.textContent !== label) value.textContent = label;
        const sizeChanged = bubble.classList.contains('is-wide') !== wide || bubble.classList.contains('is-hours') !== hours;
        if (sizeChanged) {
            bubble.classList.toggle('is-wide', wide);
            bubble.classList.toggle('is-hours', hours);
            this.positionMicSatellite?.(); // la bulle s'élargit vers la gauche : on recale son bord
        }

        const remaining = this.timerMode === 'countdown' && this.timerPreset > 0 ? (this.timerValue / this.timerPreset) * 100 : 100;
        bubble.style.setProperty('--timer-pct', String(Math.round(remaining)));
        bubble.classList.toggle('is-stopwatch', this.timerMode !== 'countdown');
        bubble.classList.toggle('is-visible', this.isTimerRunning && !this.isExpanded);
        this.positionMicSatellite?.();
    },

    /** Appelé à chaque seconde quand le minuteur atteint zéro. */
    onCountdownDone() {
        this.isTimerRunning = false;
        SoundService.play('success');
        this.showIslandFeedback('Minuteur terminé', 'ph-timer');
    },
};
