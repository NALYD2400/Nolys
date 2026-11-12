/**
 * Vue « Retour micro » : l'essentiel sous la main (marche, vumètre et seuil de la porte, volume,
 * filtres, périphériques). Balance et latence vivent dans Réglages → Retour micro.
 */
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml } from '../helpers/format.js';
import { dbToPct, pctToDb } from '../features/mic-monitor.js';
import { renderModuleArtwork } from '../../../shared/module-art.js';

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
        const previous = this.content.querySelector('.mic-view');
        const focusedControl = previous?.contains(document.activeElement) ? document.activeElement.dataset.mic : null;
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
        // Choix débranché : le retour passe par le périphérique de Windows en attendant.
        const inputFallback = running && status.inputFallback;
        const outputFallback = running && status.outputFallback;
        const fallbackNote = ' (choix débranché : celui de Windows en attendant)';

        this.content.innerHTML = `
            <div class="mic-view di-stagger ${enabled ? 'is-on' : ''} ${running ? 'is-running' : ''} ${error ? 'has-error' : ''} ${config.gateEnabled ? 'gate-enabled' : ''}"
                 style="--gate: ${dbToPct(threshold).toFixed(1)}%">
                <header class="mic-header">
                    <div class="mic-badge" aria-hidden="true">${renderModuleArtwork('mic')}<span class="mic-badge-ring"></span></div>
                    <div class="mic-title">
                        <span class="mic-title-main">Retour micro</span>
                        <span class="mic-title-state"><span class="mic-state-dot"></span>${escapeHtml(state)}</span>
                    </div>
                    <button class="mic-icon-btn" data-mic="settings" title="Plus de réglages (balance, latence, seuil)"><i class="ph ph-sliders-horizontal"></i></button>
                    <button class="mic-icon-btn" data-mic="back" title="Centre de contrôle"><i class="ph ph-squares-four"></i></button>
                    <button class="mic-switch ${enabled ? 'on' : ''}" data-mic="toggle" role="switch" aria-checked="${enabled}" aria-label="Retour micro" title="${enabled ? 'Couper le retour' : 'Activer le retour'}">
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
                    <div class="mic-meter" data-mic="meter" role="slider" tabindex="${config.gateEnabled ? '0' : '-1'}" aria-label="Seuil de la porte de bruit" aria-valuemin="-80" aria-valuemax="-10" aria-valuenow="${threshold}" aria-valuetext="${threshold} dB" aria-disabled="${!config.gateEnabled}" title="${config.gateEnabled ? 'Glisse le repère pour régler le seuil de la porte' : 'Active la porte pour couper les bruits faibles'}">
                        <div class="mic-meter-track">
                            <div class="mic-meter-muted"></div>
                            <div class="mic-meter-fill"></div>
                            <div class="mic-meter-out"></div>
                        </div>
                        <div class="mic-gate-handle"><span>${Math.round(threshold)} dB</span></div>
                    </div>
                </section>

                <section class="mic-volume" title="Volume du retour (au-delà de 100 % : amplifié)">
                    <i class="ph-bold ${volume === 0 ? 'ph-speaker-slash' : 'ph-speaker-low'}"></i>
                    <div class="mic-slider" data-mic="volume" role="slider" tabindex="0" aria-label="Volume du retour micro" aria-valuemin="0" aria-valuemax="200" aria-valuenow="${volume}" aria-valuetext="${volume} %" style="--val: ${volume / 2}%">
                        <div class="mic-slider-fill"></div>
                        <div class="mic-slider-detent"></div>
                        <div class="mic-slider-knob"></div>
                    </div>
                    <span class="mic-volume-value">${volume} %</span>
                </section>

                <section class="mic-chips">
                    <button class="mic-chip ${config.denoise ? 'on' : ''} ${status.denoiseAvailable === false ? 'is-disabled' : ''}" data-mic="denoise" aria-pressed="${Boolean(config.denoise)}" ${status.denoiseAvailable === false ? 'disabled' : ''}
                        title="${status.denoiseAvailable === false ? 'Indisponible : le micro doit tourner à 48 kHz' : 'Réduction de bruit par réseau de neurones (RNNoise)'}">
                        <i class="ph-bold ph-sparkle"></i>Anti-bruit IA
                    </button>
                    <button class="mic-chip ${config.gateEnabled ? 'on' : ''}" data-mic="gate" aria-pressed="${Boolean(config.gateEnabled)}" title="Porte : coupe le retour sous le seuil (clavier, ventilateur)">
                        <i class="ph-bold ph-waveform-slash"></i>Porte
                    </button>
                    <button class="mic-chip ${config.highPass ? 'on' : ''}" data-mic="highpass" aria-pressed="${Boolean(config.highPass)}" title="Coupe-bas à 90 Hz (souffle, chocs)">
                        <i class="ph-bold ph-wave-sine"></i>Coupe-bas
                    </button>
                </section>

                <section class="mic-devices">
                    <button class="mic-device ${inputFallback ? 'warn' : ''}" data-mic="input" title="${inputFallback ? `Micro${fallbackNote}` : 'Choisir le micro'}">
                        <i class="ph-bold ${inputFallback ? 'ph-plugs' : 'ph-microphone'}"></i><span>${escapeHtml(inputName)}</span><i class="ph-bold ph-caret-up-down"></i>
                    </button>
                    <button class="mic-device ${speakers || outputFallback ? 'warn' : ''}" data-mic="output" title="${speakers ? 'Enceintes : risque de Larsen, préfère un casque' : outputFallback ? `Sortie${fallbackNote}` : 'Choisir la sortie'}">
                        <i class="ph-bold ${speakers ? 'ph-warning' : outputFallback ? 'ph-plugs' : OUTPUT_ICONS[status.outputKind] || 'ph-headphones'}"></i><span>${escapeHtml(outputName)}</span><i class="ph-bold ph-caret-up-down"></i>
                    </button>
                </section>
            </div>
        `;

        const view = this.content.querySelector('.mic-view');
        view.onclick = (e) => e.stopPropagation();
        this.bindMicView(view);
        this.paintMicLevels(status);
        this.syncMicActivity();
        if (focusedControl) view.querySelector(`[data-mic="${focusedControl}"]`)?.focus();
    },

    bindMicView(view) {
        const config = () => this.micConfig;
        const act = {
            toggle: () => this.toggleMicMonitor(),
            back: () => this.setMode('control'),
            settings: () => this.openSettings('mic'),
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

        // Volume : glisser horizontal, 0 à 200 %, aimanté à 100 %.
        const slider = view.querySelector('[data-mic="volume"]');
        this.bindMicDrag(slider, (pct) => {
            let volume = Math.round(pct * 2);
            if (Math.abs(volume - 100) <= 4) volume = 100;
            slider.style.setProperty('--val', `${volume / 2}%`);
            slider.setAttribute('aria-valuenow', volume);
            slider.setAttribute('aria-valuetext', `${volume} %`);
            view.querySelector('.mic-volume-value').textContent = `${volume} %`;
            return { volume };
        });

        // Seuil de la porte : on le glisse directement sur le vumètre.
        const meter = view.querySelector('[data-mic="meter"]');
        this.bindMicDrag(meter, (pct) => {
            if (!config().gateEnabled) return null;
            const db = Math.max(-80, Math.min(-10, Math.round(pctToDb(pct))));
            view.style.setProperty('--gate', `${dbToPct(db)}%`);
            meter.setAttribute('aria-valuenow', db);
            meter.setAttribute('aria-valuetext', `${db} dB`);
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
        const bindKeys = (element, field, min, max, step, fallback) => {
            element.addEventListener('keydown', event => {
                if (element.getAttribute('aria-disabled') === 'true') return;
                const key = event.key;
                if (!['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(key)) return;
                event.preventDefault(); event.stopPropagation();
                const current = config()[field] ?? fallback;
                const delta = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(key) ? 1 : -1;
                const next = key === 'Home' ? min : key === 'End' ? max : Math.max(min, Math.min(max, current + delta * step * (key.startsWith('Page') ? 10 : 1)));
                this.setMicMonitor({ [field]: next });
            });
        };
        bindKeys(slider, 'volume', 0, 200, 5, 60);
        bindKeys(meter, 'gateThreshold', -80, -10, 1, -50);
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
                ${current && !(devices || []).some((d) => d.id === current) ? `
                    <button class="mic-sheet-item on" data-id="${escapeHtml(current)}" title="Le retour y reviendra dès qu'il sera rebranché">
                        <i class="ph ph-plugs"></i><span>Choix précédent <small>débranché</small></span><i class="ph-bold ph-check"></i>
                    </button>` : ''}
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
            sheet.inert = true;
            this._micSheet = null;
            setTimeout(() => sheet.remove(), 220);
            view.querySelector(`[data-mic="${kind}"]`)?.focus();
        };
        sheet.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target.closest('[data-close]')) return close();
            const item = e.target.closest('.mic-sheet-item');
            if (!item) return;
            this._micSheet = null;
            sheet.remove();
            this.setMicMonitor({ [key]: item.dataset.id });
            this.content.querySelector(`[data-mic="${kind}"]`)?.focus();
        });
        this._micSheet = sheet;
        view.appendChild(sheet);
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', kind === 'input' ? 'Choisir le micro' : 'Choisir la sortie du retour');
        sheet.querySelector('.mic-sheet-item.on, .mic-sheet-item')?.focus();
        sheet.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const items = [...sheet.querySelectorAll('button')];
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...sheet.querySelectorAll('button')];
                const index = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus();
            }
        });
    },
};
