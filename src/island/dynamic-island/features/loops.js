/** Boucles de rafraîchissement (média, progression, horloge). */
import { ipcRenderer } from '../../../shared/ipc.js';
import { formatTime } from '../helpers/format.js';

/** Largeur de la barre de progression du lecteur déplié (styles/music.css). */
const PROGRESS_BAR_WIDTH_PX = 340;

export const loopMethods = {
    startMainLoop() {
        // Use setInterval instead of requestAnimationFrame loop
        // Much more efficient - only runs once per second instead of 60fps
        this._mainInterval = setInterval(() => {
            this.onSecondTick();
        }, 1000);

        // Métadonnées média plus réactives pour réduire la latence ressentie
        // sur la pochette, donc aussi sur la synchro du fond d'écran.
        this._mediaPollingActive = true;
        const pollMedia = async () => {
            if (!this._mediaPollingActive) return;
            await this.updateMediaState();
            if (!this._mediaPollingActive) return;
            this._mediaPollTimer = setTimeout(pollMedia, this.getMediaPollDelay());
        };
        pollMedia();

        // Premier sync immédiat au démarrage, sans attendre la première seconde.
        // For FPS tracking (only when needed for stats display)
        this._fpsInterval = null;
    },

    getMediaPollDelay() {
        if (localStorage.getItem('liquid_eco_mode') === 'true') {
            if (this.isExpanded) return 1200;
            return this.isPlaying ? 2200 : 5000;
        }

        const controlPending = this._mediaControlPendingUntil && this._mediaControlPendingUntil > Date.now();
        if (this.isExpanded || this.isPlaying || controlPending) return 400;
        return 1100;
    },

    startProgressSmoothLoop() {
        this._smoothLoopActive = true;
        const tick = () => {
            if (!this._smoothLoopActive) return;
            if (this.isExpanded && this.mode === 'music' && this.isPlaying && this.musicData) {
                if (this.isScrubbing) {
                    this._smoothTimer = setTimeout(tick, this.getProgressSmoothDelay());
                    return;
                }
                const data = this.musicData;
                const elapsed = Date.now() - (this.lastMediaUpdate || Date.now());
                const currentProgress = Math.min(data.duration, (data.progress || 0) + elapsed);
                
                const pct = data.duration ? (currentProgress / data.duration) * 100 : 0;
                
                const fill = this.el.querySelector('#music-progress-fill');
                const timeEl = this.el.querySelector('#music-current-time');
                
                if (fill) {
                    fill.style.width = `${pct}%`;
                    const bar = fill.closest('.progress-bar');
                    if (bar) bar.style.setProperty('--progress-pct', `${pct}%`);
                }
                if (timeEl) timeEl.innerText = formatTime(currentProgress);
            } else if (!this.isExpanded && this.isPlaying && this.musicData && localStorage.getItem('liquid_idle_compact_mode') === 'progress') {
                const chipTime = this.el.querySelector('.idle-metric-chip span');
                if (chipTime) {
                    const data = this.musicData;
                    const elapsed = Date.now() - (this.lastMediaUpdate || Date.now());
                    const baseProgress = data.progress || 0;
                    const currentProgress = data.duration ? Math.min(data.duration, baseProgress + elapsed) : baseProgress;
                    chipTime.innerText = formatTime(currentProgress);
                }
            }
            if (this._smoothLoopActive) {
                this._smoothTimer = setTimeout(tick, this.getProgressSmoothDelay());
            }
        };
        tick();
    },

    getProgressSmoothDelay() {
        const progressVisible =
            (this.isExpanded && this.mode === 'music' && this.isPlaying && this.musicData) ||
            (!this.isExpanded && this.isPlaying && this.musicData && localStorage.getItem('liquid_idle_compact_mode') === 'progress');
        if (localStorage.getItem('liquid_eco_mode') === 'true') return progressVisible ? 350 : 1200;
        if (!progressVisible) return 500;

        // Lecteur déplié : pas assez court pour que la barre avance d'au plus ~0,5 px à la fois
        // (mouvement continu à l'œil), sans descendre sous 16 ms ni dépasser 100 ms.
        const duration = this.musicData?.duration || 0;
        if (this.isExpanded && duration > 0) {
            const pxPerMs = PROGRESS_BAR_WIDTH_PX / duration;
            return Math.min(100, Math.max(16, Math.round(0.5 / pxPerMs)));
        }
        return 100;
    },

    stopMainLoop() {
        this._mediaPollingActive = false;
        this._smoothLoopActive = false;
        if (this._mainInterval) {
            clearInterval(this._mainInterval);
            this._mainInterval = null;
        }
        if (this._mediaPollTimer) {
            clearTimeout(this._mediaPollTimer);
            this._mediaPollTimer = null;
        }
        if (this._fpsInterval) {
            clearInterval(this._fpsInterval);
            this._fpsInterval = null;
        }
        if (this._smoothTimer) {
            clearTimeout(this._smoothTimer);
            this._smoothTimer = null;
        }
    },

    onSecondTick() {
        if (this.isTimerRunning) {
            if (this.timerMode === 'countdown') {
                this.timerValue = Math.max(0, this.timerValue - 1);
                if (this.timerValue === 0) this.onCountdownDone();
            } else {
                this.timerValue++;
            }
            if (this.isExpanded && this.mode === 'timer') {
                this.renderTimer();
            }
        }
        // La bulle du minuteur suit le décompte, la pilule reste libre (musique ou repos).
        this.syncTimerSatellite();

        if (this.isExpanded) {
            if (this.mode === 'network') {
                this.renderNetwork();
            }
            if (this.mode === 'mixer') {
                this.updateAudioSessions();
            } else if (this.mode === 'music') {
                this.refreshCurrentMediaVolumeSession();
            } else if (this.mode === 'control') {
                const widgetType = localStorage.getItem('liquid_control_widget_type') || 'launchpad';
                if (widgetType === 'mixer') {
                    this.updateAudioSessions();
                }
                
                // Periodically refresh the master volume in real-time if the user is not actively dragging it
                const volSlider = document.getElementById('ic-volume-slider');
                if (volSlider && !volSlider.classList.contains('active') && ipcRenderer) {
                    try {
                        
                        ipcRenderer.invoke('get-system-volume').then(currentVol => {
                            if (currentVol !== undefined && currentVol !== null) {
                                volSlider.style.setProperty('--slider-val-pct', `${Math.round(currentVol)}%`);
                            }
                        }).catch(() => {});
                    } catch(e){}
                }
            }
        }
    },

    async updateMediaState() {
        if (this.localPlayer?.active) {
            const media = this.localPlayer.media;
            if (media) this.updateMusic(media);
            return;
        }
        try {
            if (this._mediaStateRequestInFlight) return;
            if (!ipcRenderer) return;
            this._mediaStateRequestInFlight = true;

            const mediaInfo = await ipcRenderer.invoke('get-media-info');
            if (this.localPlayer?.active) return;
            if (mediaInfo) {
                this.updateMusic({
                    title: mediaInfo.title || "Aucune lecture",
                    artist: mediaInfo.artist || "Système",
                    cover: mediaInfo.cover || "",
                    transientCover: mediaInfo.transientCover || "",
                    appId: mediaInfo.appId || "",
                    isPlaying: mediaInfo.isPlaying || false,
                    progress: mediaInfo.progress || 0,
                    duration: mediaInfo.duration || 0,
                    source: mediaInfo.source || "",
                    trackKey: mediaInfo.trackKey || "",
                    windowTitle: mediaInfo.windowTitle || ""
                });
            }
        } catch (e) { }
        finally {
            this._mediaStateRequestInFlight = false;
        }
    },
};
