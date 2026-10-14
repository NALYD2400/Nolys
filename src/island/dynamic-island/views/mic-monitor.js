/** Vue « Retour micro » : vumètre, seuil de la porte, volume, filtres et périphériques. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml } from '../helpers/format.js';
import { dbToPct, pctToDb } from '../features/mic-monitor.js';

const LATENCIES = [
    { id: 'low', label: 'Faible' },
    { id: 'normal', label: 'Normale' },
    { id: 'safe', label: 'Sûre' },
];

/** « Microphone (2- Logitech PRO X) » → « Logitech PRO X » : le nom utile, sans le type ni le numéro. */
export const cleanDeviceName = (name = '') => {
    const inner = name.match(/^[^()]*\((.+)\)\s*$/);
    return (inner ? inner[1] : name).replace(/^\d+\s*-\s*/, '').trim() || name;
};

const OUTPUT_ICONS = { headset: 'ph-headset', headphones: 'ph-headphones', speakers: 'ph-speaker-hifi', other: 'ph-speaker-high' };

export const micMonitorView = {
    /** Rafraîchit ce qui dépend de l'état : la vue micro, ou la tuile du centre de contrôle. */
    refreshMicView() {
        if (!this.isExpanded || this._isTransitioning) return;
        if (this.mode === 'mic' && !this._micDragging && !this._micSheet) {
            this.renderMicMonitor();
        } else if (this.mode === 'control') {
            this.syncMicTile?.();
        }
    },

    renderMicMonitor() {
        const status = this.micStatus || { config: {} };
        const config = status.config;
        const enabled = Boolean(config.enabled);
        const running = enabled && status.running;
        const error = enabled ? status.error : null;
        const volume = Number.isFinite(config.volume) ? config.volume : 60;
        const threshold = Number.isFinite(config.gateThreshold) ? config.gateThreshold : -50;
        const speakers = running && status.outputKind === 'speakers';

        let state = 'Coupé';
        if (error) state = error;
        else if (running) state = `En direct · ${status.latencyMs || '—'} ms`;
        else if (enabled) state = 'Démarrage…';

        const inputName = cleanDeviceName(status.inputName) || (config.inputId ? 'Micro choisi' : 'Micro par défaut');
        const outputName = cleanDeviceName(status.outputName) || (config.outputId ? 'Sortie choisie' : 'Sortie par défaut');

        this.content.innerHTML = `
            <div class="mic-view di-stagger ${enabled ? 'is-on' : ''} ${running ? 'is-running' : ''} ${error ? 'has-error' : ''} ${config.gateEnabled ? 'gate-enabled' : ''}"
                 style="--gate: ${dbToPct(threshold).toFixed(1)}%">
                <header class="mic-header">
                    <div class="mic-badge"><i class="ph-fill ph-microphone"></i><span class="mic-badge-ring"></span></div>
                    <div class="mic-title">
                        <span class="mic-title-main">Retour micro</span>
                        <span class="mic-title-state"><span class="mic-state-dot"></span>${escapeHtml(state)}</span>
                    </div>
                    <button class="mic-icon-btn" data-mic="back" title="Centre de contrôle"><i class="ph ph-squares-four"></i></button>
                    <button class="mic-switch ${enabled ? 'on' : ''}" data-mic="toggle" role="switch" aria-checked="${enabled}" title="${enabled ? 'Couper le retour' : 'Activer le retour'}">
                        <span class="mic-switch-knob"></span>
                    </button>
                </header>

                <section class="mic-meter-card">
                    <div class="mic-meter-top">
                        <span>Niveau du micro</span>
                        <span class="mic-meter-tools">
                            ${config.denoise ? '<span class="mic-voice-dot" title="Voix détectée"></span>' : ''}
                            <span class="mic-meter-readout">−∞ dB</span>
                        </span>
                    </div>
                    <div class="mic-meter" data-mic="meter" title="${config.gateEnabled ? 'Glisse le repère pour régler le seuil de la porte' : 'Active la porte pour couper les bruits faibles'}">
                        <div class="mic-meter-track">
                            <div class="mic-meter-muted"></div>
                            <div class="mic-meter-fill"></div>
                            <div class="mic-meter-out"></div>
                        </div>
                        <div class="mic-gate-handle"><span>${Math.round(threshold)} dB</span></div>
                    </div>
                    <div class="mic-meter-scale"><span>-80</span><span>-60</span><span>-40</span><span>-20</span><span>0 dB</span></div>
                </section>

                <section class="mic-volume" title="Volume du retour (au-delà de 100 % : amplifié)">
                    <i class="ph ${volume === 0 ? 'ph-speaker-slash' : 'ph-speaker-low'}"></i>
                    <div class="mic-slider" data-mic="volume" style="--val: ${volume / 2}%">
                        <div class="mic-slider-fill"></div>
                        <div class="mic-slider-detent"></div>
                        <div class="mic-slider-knob"></div>
                    </div>
                    <span class="mic-volume-value">${volume} %</span>
                </section>

                <section class="mic-chips">
                    <button class="mic-chip ${config.denoise ? 'on' : ''} ${status.denoiseAvailable === false ? 'is-disabled' : ''}" data-mic="denoise"
                        title="${status.denoiseAvailable === false ? 'Indisponible : le micro doit tourner à 48 kHz' : 'Réduction de bruit par réseau de neurones (RNNoise)'}">
                        <i class="ph ph-sparkle"></i>Anti-bruit IA
                    </button>
                    <button class="mic-chip ${config.gateEnabled ? 'on' : ''}" data-mic="gate" title="Coupe le retour sous le seuil (clavier, ventilateur)">
                        <i class="ph ph-funnel"></i>Porte
                    </button>
                    <button class="mic-chip ${config.highPass ? 'on' : ''}" data-mic="highpass" title="Coupe-bas à 90 Hz (souffle, chocs)">
                        <i class="ph ph-wave-sine"></i>Coupe-bas
                    </button>
                </section>

                <section class="mic-latency">
                    <span title="Faible : le plus réactif. Sûre : si tu entends des craquements."><i class="ph ph-timer"></i>Latence</span>
                    <div class="mic-segment" role="radiogroup" aria-label="Latence">
                        ${LATENCIES.map((l) => `<button class="${(config.latency || 'normal') === l.id ? 'on' : ''}" data-mic-latency="${l.id}" title="Latence ${l.label.toLowerCase()}">${l.label}</button>`).join('')}
                    </div>
                </section>

                <section class="mic-devices">
                    <button class="mic-device" data-mic="input" title="Choisir le micro">
                        <i class="ph ph-microphone"></i><span>${escapeHtml(inputName)}</span><i class="ph ph-caret-up-down"></i>
                    </button>
                    <button class="mic-device ${speakers ? 'warn' : ''}" data-mic="output" title="${speakers ? 'Enceintes : risque de Larsen, préfère un casque' : 'Choisir la sortie'}">
                        <i class="ph ${speakers ? 'ph-warning' : OUTPUT_ICONS[status.outputKind] || 'ph-headphones'}"></i><span>${escapeHtml(outputName)}</span><i class="ph ph-caret-up-down"></i>
                    </button>
                </section>
            </div>
        `;

        const view = this.content.querySelector('.mic-view');
        view.onclick = (e) => e.stopPropagation();
        this.bindMicView(view);
        this.paintMicLevels(status);
        this.syncMicActivity();
    },

    bindMicView(view) {
        const config = () => this.micConfig;
        const act = {
            toggle: () => this.toggleMicMonitor(),
            back: () => this.setMode('control'),
            denoise: () => this.micStatus?.denoiseAvailable !== false && this.setMicMonitor({ denoise: !config().denoise }),
            gate: () => this.setMicMonitor({ gateEnabled: !config().gateEnabled }),
            highpass: () => this.setMicMonitor({ highPass: !config().highPass }),
            input: () => this.openMicDeviceSheet('input'),
            output: () => this.openMicDeviceSheet('output'),
        };
        view.querySelectorAll('[data-mic]').forEach((el) => {
            const action = act[el.dataset.mic];
            if (action) el.addEventListener('click', (e) => { e.stopPropagation(); action(); });
        });
        view.querySelectorAll('[data-mic-latency]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setMicMonitor({ latency: el.dataset.micLatency });
            });
        });

        // Volume : glisser horizontal, 0 à 200 %, aimanté à 100 %.
        const slider = view.querySelector('[data-mic="volume"]');
        this.bindMicDrag(slider, (pct) => {
            let volume = Math.round(pct * 2);
            if (Math.abs(volume - 100) <= 4) volume = 100;
            slider.style.setProperty('--val', `${volume / 2}%`);
            view.querySelector('.mic-volume-value').textContent = `${volume} %`;
            return { volume };
        });

        // Seuil de la porte : on le glisse directement sur le vumètre.
        const meter = view.querySelector('[data-mic="meter"]');
        this.bindMicDrag(meter, (pct) => {
            if (!config().gateEnabled) return null;
            const db = Math.max(-80, Math.min(-10, Math.round(pctToDb(pct))));
            view.style.setProperty('--gate', `${dbToPct(db)}%`);
            view.querySelector('.mic-gate-handle span').textContent = `${db} dB`;
            return { gateThreshold: db };
        });

        // Molette sur le volume : pas de 5 %.
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const volume = Math.max(0, Math.min(200, (config().volume ?? 60) + (e.deltaY < 0 ? 5 : -5)));
            this.setMicMonitor({ volume });
        }, { passive: false });
    },

    /** Glisser à la souris ; `update(pct)` renvoie le correctif à envoyer (ou null). */
    bindMicDrag(element, update) {
        if (!element) return;
        let pending = null;
        let sendTimer = null;
        const flush = () => {
            sendTimer = null;
            if (pending) this.setMicMonitor(pending);
            pending = null;
        };
        const fromEvent = (e) => {
            const rect = element.getBoundingClientRect();
            const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
            const patch = update(pct);
            if (!patch) return;
            pending = { ...pending, ...patch };
            sendTimer ??= setTimeout(flush, 60);
        };
        element.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            element.setPointerCapture(e.pointerId);
            element.classList.add('dragging');
            this._micDragging = true;
            fromEvent(e);
        });
        element.addEventListener('pointermove', (e) => {
            if (element.hasPointerCapture(e.pointerId)) fromEvent(e);
        });
        const end = (e) => {
            if (!element.hasPointerCapture(e.pointerId)) return;
            element.releasePointerCapture(e.pointerId);
            element.classList.remove('dragging');
            this._micDragging = false;
            clearTimeout(sendTimer);
            flush();
        };
        element.addEventListener('pointerup', end);
        element.addEventListener('pointercancel', end);
        element.addEventListener('click', (e) => e.stopPropagation());
    },

    /** Feuille de choix d'un périphérique, glissée par-dessus la vue. */
    async openMicDeviceSheet(kind) {
        const view = this.content.querySelector('.mic-view');
        if (!view || this._micSheet) return;
        this._micSheet = true; // réservé pendant le chargement de la liste
        const channel = kind === 'input' ? 'get-audio-input-devices' : 'get-audio-devices';
        const key = kind === 'input' ? 'inputId' : 'outputId';
        const devices = await ipcRenderer.invoke(channel).catch(() => []);
        if (!view.isConnected) {
            this._micSheet = null;
            return;
        }
        const current = this.micConfig[key] || '';

        const sheet = document.createElement('div');
        sheet.className = 'mic-sheet';
        sheet.innerHTML = `
            <div class="mic-sheet-head">
                <span>${kind === 'input' ? 'Micro' : 'Sortie du retour'}</span>
                <button class="mic-icon-btn" data-close title="Fermer"><i class="ph ph-x"></i></button>
            </div>
            <div class="mic-sheet-list">
                <button class="mic-sheet-item ${current === '' ? 'on' : ''}" data-id="">
                    <i class="ph ph-sparkle"></i><span>Par défaut de Windows</span><i class="ph-bold ph-check"></i>
                </button>
                ${(devices || []).map((d) => `
                    <button class="mic-sheet-item ${current === d.id ? 'on' : ''}" data-id="${escapeHtml(d.id)}">
                        <i class="ph ${kind === 'input' ? 'ph-microphone' : 'ph-headphones'}"></i>
                        <span title="${escapeHtml(d.name)}">${escapeHtml(cleanDeviceName(d.name))}${d.isDefault ? ' <small>défaut</small>' : ''}</span>
                        <i class="ph-bold ph-check"></i>
                    </button>`).join('')}
            </div>
        `;
        const close = () => {
            sheet.classList.add('leaving');
            this._micSheet = null;
            setTimeout(() => sheet.remove(), 220);
        };
        sheet.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('[data-close]')) return close();
            const item = e.target.closest('.mic-sheet-item');
            if (!item) return;
            this._micSheet = null;
            sheet.remove();
            this.setMicMonitor({ [key]: item.dataset.id });
        });
        this._micSheet = sheet;
        view.appendChild(sheet);
    },
};
