/** Navigation entre les modes et rendu principal. */
import { ipcRenderer } from '../../../shared/ipc.js';

export const navigationMethods = {
    // ... (rest of methods)

    async transitionState(updateFn) {
        // Mode placement : l'Island reste repliée (aucune ouverture ni notification).
        if (this._layoutEditMode) return;
        // Une transition est déjà en cours : celle-ci est rejouée juste après, au lieu d'être perdue
        // (une notification reçue pendant un changement de mode ne s'affichait jamais).
        if (this._transitionInProgress) {
            this._queuedTransition = updateFn;
            return;
        }

        this._transitionInProgress = true;
        const transitionToken = ++this._transitionToken;
        this.el.classList.add('animating');

        try {
            // 1. Wait for the content to fully fade out (opacity 0)
            await new Promise(r => setTimeout(r, 90));

            if (transitionToken !== this._transitionToken) return;

            // 2. Set transition flag to prevent heavy HTML injection during scaling
            this._isTransitioning = true;

            // 3. Perform size change (updates parent size classes, starting the CSS width/height morph)
            updateFn();

            // 4. Wait for the morphing animation to be 70% complete (200ms is the sweet spot!)
            await new Promise(r => setTimeout(r, 200));

            if (transitionToken !== this._transitionToken) return;

            // 5. Clear transition flag and render the complete, heavy HTML content
            this._isTransitioning = false;
            // Cascade d'entrée : seulement pour ce rendu-là, pas pour les mises à jour suivantes.
            this.content.classList.add('di-intro');
            clearTimeout(this._introTimer);
            this._introTimer = setTimeout(() => this.content.classList.remove('di-intro'), 900);
            this.renderContent();

            // 6. Wait a tiny bit for the DOM tree to settle and paint
            await new Promise(r => setTimeout(r, 40));
        } finally {
            if (transitionToken === this._transitionToken) {
                this._isTransitioning = false;
                this._transitionInProgress = false;
                this.el.classList.remove('animating');
                const queued = this._queuedTransition;
                this._queuedTransition = null;
                if (queued) this.transitionState(queued);
            }
        }
    },

    toggleExpand() {
        this.transitionState(() => {
            this.isExpanded = !this.isExpanded;
            this.renderContent();
        });
    },

    /** `force` : fermeture demandée par l'utilisateur (Échap, ✕), même avec un dialogue ouvert. */
    collapseIsland({ force = false } = {}) {
        if (!this.isExpanded) return;
        // Sélecteur de fichiers Windows ouvert : la perte de focus ne doit pas fermer la vue.
        if (this.mode === 'library' && this._libraryController?.busy) return;
        if (this.mode === 'settings' && this._settingsController?.busy && !force) return;
        if (this.mode === 'notification') {
            this.dismissNotification();
            return;
        }

        try { window.speechSynthesis.cancel(); } catch (e) {}

        if (this.mode === 'search') {
            window.dispatchEvent(new CustomEvent('liquid-search-close'));
        }

        this.transitionState(() => {
            this.mode = 'music';
            this.isExpanded = false;
            this.renderContent();
        });
    },

    returnToMusicIdle() {
        this.clearNotification();
        this.mode = 'music';
        this.isExpanded = false;
        this.el.classList.remove(...this.getIslandSizeClasses());
        this.el.classList.remove('animating');
        this.renderContent();
    },

    openExpandedMode(mode) {
        this.transitionState(() => {
            this.mode = mode;
            this.isExpanded = true;
            this.renderContent();
        });
    },

    async launchShortcut(command) {
        if (!command) return;
        try {
            const rawCommand = String(command).trim();
            if (rawCommand.startsWith('liquid:')) {
                this.runInternalShortcut(rawCommand);
                return true;
            }

            // `false` : commande introuvable ou refusée par le cœur natif.
            return Boolean(await ipcRenderer.invoke('launch-shortcut', rawCommand));
        } catch (e) {
            console.error("Failed to launch shortcut:", command, e);
            return false;
        }
    },

    runInternalShortcut(command) {
        const action = String(command || '').replace('liquid:', '').trim();
        this.isExpanded = true;

        if (action === 'music-search') {
            this.openMusicSearchPanel();
            return;
        }
        if (action === 'music-history') {
            this.mode = 'music-history';
            this.renderContent();
            return;
        }
        if (action === 'menu' || action === 'widgets') {
            this.mode = 'menu';
            this.renderContent();
            return;
        }
        if (action === 'mixer') {
            this.mode = 'mixer';
            this.renderContent();
            return;
        }
        if (action === 'mic') {
            this.mode = 'mic';
            this.renderContent();
            return;
        }
        if (action === 'control') {
            this.mode = 'control';
            this.renderContent();
            return;
        }
        if (action === 'settings') {
            this.setMode('settings');
            return;
        }

        this.mode = 'music';
        this.renderContent();
    },

    setMode(mode) {
        if (mode === 'library') {
            this.openLibrary();
            return;
        }
        // Les Réglages s'ouvrent dans l'Island (views/settings.js), plus dans une fenêtre à part.
        if (mode === 'settings') {
            this.openSettings();
            return;
        }
        this.isAudioDeviceDropdownOpen = false;
        this.isMicDeviceDropdownOpen = false;

        if (mode === 'menu') {
            this.transitionState(() => {
                this.mode = mode;
                this.renderContent();
            });
            return;
        }

        // Feature flags check
        if (mode === 'timer' && localStorage.getItem('liquid_island_timer_enabled') === 'false') return;
        if (mode === 'stats' && localStorage.getItem('liquid_island_stats_enabled') === 'false') return;
        if (mode === 'network' && localStorage.getItem('liquid_island_network_enabled') === 'false') return;

        this.transitionState(() => {
            this.mode = mode;
            this.renderContent();
        });
    },

    getIslandSizeClasses() {
        return [
            'island-idle',
            'island-expanded',
            'island-large',
            'island-notifying',
            'island-mode-music',
            'island-mode-notification',
            'island-mode-timer',
            'island-mode-network',
            'island-mode-menu',
            'island-mode-search',
            'island-mode-music-search',
            'island-mode-music-history',
            'island-mode-control',
            'island-mode-mixer',
            'island-mode-mic',
            'island-mode-library',
            'island-mode-settings'
        ];
    },

    getModeSizeClass() {
        const sizeByMode = {
            music: 'island-mode-music',
            notification: 'island-mode-notification',
            timer: 'island-mode-timer',
            network: 'island-mode-network',
            menu: 'island-mode-menu',
            search: 'island-mode-search',
            'music-search': 'island-mode-music-search',
            'music-history': 'island-mode-music-history',
            control: 'island-mode-control',
            mixer: 'island-mode-mixer',
            mic: 'island-mode-mic',
            library: 'island-mode-library',
            settings: 'island-mode-settings'
        };

        return sizeByMode[this.mode] || 'island-mode-music';
    },

    renderContent() {
        if (this.mode !== 'library' || !this.isExpanded) this.leaveLibrary?.();
        if (this.mode !== 'music-history' || !this.isExpanded) this.leaveMusicHistory?.();
        if (this.mode !== 'settings' || !this.isExpanded) this.leaveSettings?.();
        try { window.speechSynthesis.cancel(); } catch (e) {}
        // Une navigation manuelle annule aussi le retour automatique de l'ancienne alerte.
        if (this.mode !== 'notification' && this._notificationReturnState) this.clearNotification();

        // Reset any inline sizing from dynamic modes (e.g. mixer/history autosize)
        try {
            if (this.isExpanded && this.mode === 'mixer') {
                const grouped = this.getGroupedSessions ? this.getGroupedSessions(this.audioSessions || []) : [];
                const count = grouped.length;
                const visible = Math.max(1, Math.min(count || 1, 5));
                const bodyTarget = count === 0 ? 120 : visible * 62;
                let target = 15 + 20 + 26 + 12 + bodyTarget + 6; // padTop + padBottom + headerH + headerMb + bodyTarget + security
                target = Math.max(260, Math.min(520, target));
                this.el.style.height = `${Math.round(target)}px`;
                this.el.style.width = '';
            } else {
                // Bibliothèque, Historique, Réglages : hauteur de leur contenu (views/library.js).
                const fitted = this.isExpanded ? this.fittedPanelHeight?.(this.mode) : null;
                this.el.style.height = fitted ? `${fitted}px` : '';
                this.el.style.width = '';
            }
        } catch (e) {
            console.error('Error estimating dynamic mode height:', e);
            this.el.style.height = '';
            this.el.style.width = '';
        }

        this._micSheet = null;
        this._micDragging = false;

        // Clear any active real-time system stats update interval
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        if (this._controlSliderCleanup) {
            this._controlSliderCleanup();
            this._controlSliderCleanup = null;
        }
        // Le contenu va être remplacé : chaque vue en verre réenregistre ses surfaces après rendu.
        this.releaseGlassControls({ keepScene: this.hasGlassSurfaces() });

        this._lastRenderedTrack = null; // Force updateMusic to re-sync state on next poll

        // Essential: Clear ALL possible size/state classes before applying the new one.
        // Une notification repliée garde sa taille compacte pendant son délai.
        const keepCompactNotification = !this.isExpanded && this.mode === 'notification';
        this.el.classList.remove(...this.getIslandSizeClasses());

        if (this.isExpanded) {
            const modeSizeClass = this.getModeSizeClass();

            // Keep legacy classes for compatibility, then refine the shape per mode.
            if (this.mode === 'control' || this.mode === 'mixer') {
                this.el.classList.add('island-large', modeSizeClass);
            } else {
                this.el.classList.add('island-expanded', modeSizeClass);
            }

            if (this._isTransitioning) {
                this.content.innerHTML = '';
                this._vizCanvas = null;
                this.syncVisualizerActivity();
                return;
            }

            // Render specific module
            if (this.mode === 'music') this.renderMusic();
            else if (this.mode === 'notification') this.renderNotification();
            else if (this.mode === 'timer') this.renderTimer();
            else if (this.mode === 'network') this.renderNetwork();
            else if (this.mode === 'menu') this.renderMenu();
            else if (this.mode === 'search') this.renderSearch();
            else if (this.mode === 'music-search') this.renderMusicSearch();
            else if (this.mode === 'music-history') this.renderMusicHistory();
            else if (this.mode === 'control') this.renderControl();
            else if (this.mode === 'mixer') this.renderMixer();
            else if (this.mode === 'mic') this.renderMicMonitor();
            else if (this.mode === 'library') this.renderLibrary();
            else if (this.mode === 'settings') this.renderSettings();
        } else if (keepCompactNotification) {
            this.el.classList.add('island-notifying');
            if (this._isTransitioning) {
                this.content.innerHTML = '';
            } else {
                this.renderNotification();
            }
        } else {
            // Collapsed state
            this.el.classList.add('island-idle');

            if (this._isTransitioning) {
                this.content.innerHTML = '';
                this._vizCanvas = null;
                this.syncVisualizerActivity();
                return;
            }

            this.renderIdle();
        }

        // Ensure initial audio sessions are loaded when entering mixer or control modes
        if (this.isExpanded && (this.mode === 'mixer' || (this.mode === 'control' && localStorage.getItem('liquid_control_widget_type') === 'mixer'))) {
            this.updateAudioSessions();
        }

        // Bulle du retour micro : visible seulement Island repliée.
        this.syncMicActivity?.();
        this.positionMicSatellite?.();

        // Enforce active album artwork cover & colors across all screens!
        this.syncGlobalCoverAesthetics();

        this.syncVisualizerActivity();

        // Ensure the visualizer responds to state changes
        this.updateMediaState();
    },
};
