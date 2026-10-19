/**
 * Retour micro : état partagé avec le cœur Rust, vumètre en direct et bulle
 * « activité en cours » à côté de la pilule.
 *
 * Le traitement audio est entièrement natif (platform/mic_monitor.rs) ; ici on
 * ne fait qu'afficher les niveaux et envoyer les réglages.
 */
import { ipcRenderer } from '../../../shared/ipc.js';
import { SoundService } from '../../../services/SoundService.js';

/** Échelle du vumètre : -80 dBFS à gauche, 0 dBFS à droite. */
export const METER_FLOOR_DB = -80;

export const toDb = (linear) => (linear > 0.00001 ? 20 * Math.log10(linear) : METER_FLOOR_DB);
export const dbToPct = (db) => Math.max(0, Math.min(100, ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100));
export const pctToDb = (pct) => METER_FLOOR_DB + (pct / 100) * -METER_FLOOR_DB;

export const micMonitorMethods = {
    /** Appelé une fois au démarrage : état initial et synchro avec les Réglages. */
    initMicMonitor() {
        this.micStatus = null;
        this._micSatellite = document.getElementById('island-satellite');
        this._micSatellite?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.disarmMicSatellite();
            this.openExpandedMode('mic');
        });
        // Clic droit : la bulle passe au rouge, un second clic droit dans les 3 s coupe le retour.
        // Un seul clic coupait tout de suite, sans prévenir (facile à faire par erreur).
        this._micSatellite?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._micSatelliteArmed) {
                this.disarmMicSatellite();
                this.setMicMonitor({ enabled: false });
                return;
            }
            this._micSatellite.classList.add('is-confirming');
            this._micSatellite.title = 'Clic droit encore pour couper le retour micro';
            this._micSatelliteArmed = setTimeout(() => this.disarmMicSatellite(), 3000);
        });
        this._micSatellite?.addEventListener('mouseleave', () => this.disarmMicSatellite());

        // La bulle suit le bord droit de la pilule, même pendant ses changements de taille.
        new ResizeObserver(() => this.positionMicSatellite()).observe(this.el);
        window.addEventListener('resize', () => this.positionMicSatellite());

        // Même thème que la pilule : couleurs, halo et pochette floutée suivent ses changements.
        const themeObserver = new MutationObserver(() => this.syncSatelliteTheme());
        themeObserver.observe(this.el, { attributes: true, attributeFilter: ['style', 'class'] });
        const bgLayer = this.el.querySelector('.island-bg-layer');
        if (bgLayer) themeObserver.observe(bgLayer, { attributes: true, attributeFilter: ['style'] });
        this.syncSatelliteTheme();

        // Option « bulle d'activité » : les Réglages vivent dans l'Island (même page, pas
        // d'événement « storage »). La bulle n'existe qu'Island repliée, et chaque repli
        // relit l'option (renderContent → syncMicActivity).

        ipcRenderer.on('mic-monitor-changed', (_event, status) => {
            // Pendant nos propres envois, les états intermédiaires feraient reculer l'interface.
            if (!this._micSending) this.applyMicStatus(status);
        });
        ipcRenderer.invoke('get-mic-monitor').then((status) => this.applyMicStatus(status)).catch(() => {});
    },

    disarmMicSatellite() {
        if (!this._micSatelliteArmed) return;
        clearTimeout(this._micSatelliteArmed);
        this._micSatelliteArmed = null;
        this._micSatellite.classList.remove('is-confirming');
        this._micSatellite.title = 'Retour micro : clic pour régler, deux clics droits pour couper';
    },

    get micConfig() {
        return this.micStatus?.config || {};
    },

    /**
     * Envoie une partie des réglages ; l'interface est mise à jour tout de suite.
     * Un seul envoi à la fois, les suivants regroupés : sinon deux envois rapprochés
     * (glissement du seuil, clics répétés) pouvaient arriver dans le désordre et laisser
     * un ancien réglage actif.
     */
    async setMicMonitor(patch) {
        if (this.micStatus) this.micStatus.config = { ...this.micConfig, ...patch };
        this.refreshMicView();
        this._micPending = { ...this._micPending, ...patch };
        if (this._micSending) return;
        this._micSending = true;
        try {
            while (this._micPending) {
                // État pas encore reçu : on part des réglages enregistrés, pas des valeurs par défaut.
                const base = this.micStatus
                    ? this.micConfig
                    : (await ipcRenderer.invoke('get-mic-monitor').catch(() => null))?.config || {};
                const config = { ...base, ...this._micPending };
                this._micPending = null;
                try {
                    const status = await ipcRenderer.invoke('set-mic-monitor', config);
                    if (!this._micPending) this.applyMicStatus(status);
                } catch (e) {
                    console.warn('[MicMonitor] Échec de l’envoi des réglages.', e);
                }
            }
        } finally {
            this._micSending = false;
        }
    },

    toggleMicMonitor(force) {
        const enabled = typeof force === 'boolean' ? force : !this.micConfig.enabled;
        SoundService.play('click');
        return this.setMicMonitor({ enabled });
    },

    applyMicStatus(status) {
        if (!status || !status.config) return;
        const wasEnabled = Boolean(this.micConfig.enabled);
        this.micStatus = status;
        if (wasEnabled !== Boolean(status.config.enabled)) {
            this.refreshMicView({ full: true });
        } else {
            this.refreshMicView();
        }
        this.syncMicActivity();
    },

    /**
     * Micro à droite de la pilule, minuteur à gauche. La bulle est posée sur le centre de
     * la pilule : à gauche, il faut la décaler de sa propre largeur pour que son bord
     * droit reste à 8 px de la pilule.
     */
    positionMicSatellite() {
        const half = this.el.offsetWidth / 2;
        const place = (satellite, side) => {
            // Largeur d'arrivée, pas la largeur actuelle : pendant l'élargissement du minuteur,
            // offsetWidth vaut encore l'ancienne taille, et la bulle venait se coller à la pilule.
            const width = satellite.classList.contains('is-hours') ? 66 : satellite.classList.contains('is-wide') ? 54 : 35;
            // Le minuteur garde 12 px d'air avec la pilule (le micro 8 px), pour ne pas paraître collé.
            const to = side > 0 ? half + 8 : -(half + 12 + width);
            const from = side > 0 ? half - 36 : -(half - 1);
            satellite.style.setProperty('--satellite-to', `${Math.round(to)}px`);
            satellite.style.setProperty('--satellite-from', `${Math.round(from)}px`);
        };
        if (this._micSatellite) place(this._micSatellite, 1);
        if (this._timerSatellite) place(this._timerSatellite, -1);
        const replay = this._replaySatellite;
        if (replay?.classList.contains('is-visible')) {
            const micVisible = this._micSatellite?.classList.contains('is-visible');
            const timerVisible = this._timerSatellite?.classList.contains('is-visible');
            const timerWidth = this._timerSatellite?.classList.contains('is-hours') ? 66 : this._timerSatellite?.classList.contains('is-wide') ? 54 : 35;
            const rightGap = micVisible ? 8 + 35 + 8 : 8;
            const leftGap = timerVisible ? 12 + timerWidth + 8 : 12;
            const rect = this.el.getBoundingClientRect();
            const leftSpace = rect.left - leftGap;
            const rightSpace = window.innerWidth - rect.right - rightGap;
            const leftFits = leftSpace >= 35;
            const rightFits = rightSpace >= 35;
            // Prendre le côté libre, puis la file la plus courte. Si un seul côté
            // tient dans la fenêtre, il prime sur la préférence de placement.
            let right = rightGap <= leftGap;
            if (micVisible && !timerVisible) right = false;
            if (!micVisible && timerVisible) right = true;
            if (rightFits !== leftFits) right = rightFits;
            if (!rightFits && !leftFits) right = rightSpace >= leftSpace;
            const to = right ? half + rightGap : -(half + leftGap + 35);
            const from = right ? half - 36 : -(half - 1);
            replay.style.setProperty('--satellite-to', `${Math.round(to)}px`);
            replay.style.setProperty('--satellite-from', `${Math.round(from)}px`);
        }
    },

    /** Recopie la matière de la pilule (variables posées par ThemeService, pochette floutée). */
    syncSatelliteTheme() {
        const source = this.el.querySelector('.island-bg-layer');
        for (const satellite of [this._micSatellite, this._timerSatellite, this._replaySatellite]) {
            if (!satellite) continue;
            for (const name of ['--island-bg', '--island-blur', '--island-glow-size', '--island-glow-rgb', '--island-glow-opacity']) {
                const value = this.el.style.getPropertyValue(name);
                if (value) satellite.style.setProperty(name, value);
                else satellite.style.removeProperty(name);
            }
            satellite.classList.toggle('is-glowing', this.el.classList.contains('island-active-music'));

            const target = satellite.querySelector('.satellite-bg');
            if (source && target) {
                target.style.backgroundImage = source.style.backgroundImage || 'none';
                target.style.opacity = source.style.opacity || '0';
                target.style.filter = source.style.filter || '';
            }
        }
    },

    /** Le vumètre tourne tant que la vue micro ou la bulle sont visibles. */
    syncMicActivity() {
        const enabled = Boolean(this.micConfig.enabled);
        const viewOpen = this.isExpanded && this.mode === 'mic';
        const satelliteVisible = enabled && !this.isExpanded && localStorage.getItem('liquid_mic_satellite') !== 'false';

        if (this._micSatellite) {
            this._micSatellite.classList.toggle('is-visible', satelliteVisible);
            this._micSatellite.classList.toggle('has-error', Boolean(this.micStatus?.error));
        }
        this.positionMicSatellite();

        const wantLoop = enabled && (viewOpen || satelliteVisible);
        if (wantLoop && !this._micLoop) this.startMicLoop();
        if (!wantLoop && this._micLoop) this.stopMicLoop();
        if (!enabled) this.paintMicLevels({ inputLevel: 0, outputLevel: 0, gateOpen: false, voice: 0 });
    },

    /**
     * Minuterie plutôt qu'un requestAnimationFrame continu : la bulle reste affichée des
     * heures, inutile de réveiller la page à chaque image de l'écran (jusqu'à 360 i/s).
     */
    startMicLoop() {
        const loop = { timer: null };
        this._micLoop = loop;
        const tick = async () => {
            if (this._micLoop !== loop) return;
            try {
                const status = await ipcRenderer.invoke('get-mic-monitor');
                if (this._micLoop !== loop) return;
                // Envoi en cours : on garde les réglages affichés (ceux du serveur sont en retard).
                if (status && status.config && this._micSending && this.micStatus) status.config = this.micConfig;
                if (status && status.config) {
                    const stateChanged = !this.micStatus
                        || status.running !== this.micStatus.running
                        || status.error !== this.micStatus.error
                        || status.inputName !== this.micStatus.inputName
                        || status.outputName !== this.micStatus.outputName
                        || status.inputFallback !== this.micStatus.inputFallback
                        || status.outputFallback !== this.micStatus.outputFallback;
                    this.micStatus = status;
                    if (stateChanged) this.refreshMicView();
                    this.paintMicLevels(status);
                }
            } catch (e) {
                // Le prochain tour réessaiera.
            }
            if (this._micLoop !== loop) return;
            // ~20 i/s dans la vue, ~8 i/s pour la bulle, moins en mode Éco.
            const viewOpen = this.isExpanded && this.mode === 'mic';
            const eco = localStorage.getItem('liquid_eco_mode') === 'true';
            loop.timer = setTimeout(tick, viewOpen ? (eco ? 100 : 50) : (eco ? 250 : 120));
        };
        tick();
    },

    stopMicLoop() {
        if (this._micLoop) clearTimeout(this._micLoop.timer);
        this._micLoop = null;
    },

    /** Met à jour vumètre et bulle sans reconstruire le HTML. */
    paintMicLevels(status) {
        const inputPct = dbToPct(toDb(status.inputLevel || 0));
        const outputPct = dbToPct(toDb(status.outputLevel || 0));

        if (this._micSatellite) {
            const level = outputPct / 100;
            const speaking = Boolean(status.gateOpen) && outputPct > 35;
            this._micSatellite.style.setProperty('--mic-level', level.toFixed(3));
            this._micSatellite.classList.toggle('is-speaking', speaking);
            // Quatre barres façon visualiseur : même niveau, un peu de variation entre elles.
            const shape = [0.55, 1, 0.8, 0.45];
            const energy = Math.max(0, (level - 0.35) / 0.65);
            shape.forEach((weight, index) => {
                const jitter = 0.75 + Math.random() * 0.5;
                const height = speaking ? Math.min(1, 0.2 + energy * weight * jitter) : 0.2;
                this._micSatellite.style.setProperty(`--b${index + 1}`, height.toFixed(3));
            });
        }

        const view = this.content.querySelector('.mic-view');
        if (!view) return;
        view.style.setProperty('--mic-in', `${inputPct.toFixed(1)}%`);
        view.style.setProperty('--mic-out', `${outputPct.toFixed(1)}%`);
        view.classList.toggle('gate-open', Boolean(status.gateOpen));
        // Silence parfait pendant 2 s alors que le retour tourne : micro coupé sur le casque, le plus souvent.
        const silent = status.running && !(status.inputLevel > 0);
        if (!silent) this._micSilentSince = null;
        else this._micSilentSince ??= performance.now();
        const muted = silent && performance.now() - this._micSilentSince > 2000;
        view.classList.toggle('is-muted', muted);
        const readout = view.querySelector('.mic-meter-readout');
        if (readout) {
            const db = toDb(status.inputLevel || 0);
            readout.textContent = muted ? 'Aucun son : micro coupé ?' : (db <= METER_FLOOR_DB + 0.5 ? '−∞ dB' : `${Math.round(db)} dB`);
        }
        const voice = view.querySelector('.mic-voice-dot');
        if (voice) voice.style.setProperty('--voice', (status.voice || 0).toFixed(2));
    },
};
