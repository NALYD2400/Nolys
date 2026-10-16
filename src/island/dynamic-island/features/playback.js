/** État de lecture, progression et synchronisation du lecteur. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { visualizerService } from '../../../services/AudioVisualizerService.js';
import { formatTime } from '../helpers/format.js';
import { APP_LOGO_ART, getDisplayMediaArt } from '../helpers/media-art.js';
import { getMusicHistoryKey } from '../helpers/music-search.js';

export const playbackMethods = {
    getEstimatedMediaProgress() {
        if (!this.musicData) return 0;

        const duration = Number(this.musicData.duration) || 0;
        const baseProgress = Number(this.musicData.progress) || 0;
        if (!this.isPlaying) {
            return duration ? Math.min(duration, Math.max(0, baseProgress)) : Math.max(0, baseProgress);
        }

        const elapsed = Math.max(0, Date.now() - (this.lastMediaUpdate || Date.now()));
        const estimated = baseProgress + elapsed;
        return duration ? Math.min(duration, Math.max(0, estimated)) : Math.max(0, estimated);
    },

    updateProgressVisual(progress, duration = this.musicData?.duration || 0) {
        const safeDuration = Number(duration) || 0;
        const safeProgress = Math.max(0, Number(progress) || 0);
        const pct = safeDuration ? Math.min(100, (safeProgress / safeDuration) * 100) : 0;

        const fill = this.el.querySelector('#music-progress-fill');
        const timeEl = this.el.querySelector('#music-current-time');
        if (fill) {
            fill.style.width = `${pct}%`;
            const bar = fill.closest('.progress-bar');
            if (bar) bar.style.setProperty('--progress-pct', `${pct}%`);
        }
        if (timeEl) {
            timeEl.innerText = formatTime(safeProgress);
        }

        if (!this.isExpanded && localStorage.getItem('liquid_idle_compact_mode') === 'progress') {
            const chipTime = this.el.querySelector('.idle-metric-chip span');
            if (chipTime) chipTime.innerText = formatTime(safeProgress);
        }
    },

    applyOptimisticPlaybackState(nextPlaying, holdMs = 6500) {
        const expected = Boolean(nextPlaying);
        const stableProgress = this.getEstimatedMediaProgress();

        this._mediaControlPendingUntil = Date.now() + holdMs;
        this._mediaControlExpectedIsPlaying = expected;
        this._mediaControlPendingTrackKey = this.musicData ? (this.musicData.trackKey || getMusicHistoryKey(this.musicData)) : "";

        this.isPlaying = expected;
        if (this.musicData) {
            this.musicData.progress = stableProgress;
            this.musicData.isPlaying = expected;
        }
        this.lastMediaUpdate = Date.now();
        this.updateProgressVisual(stableProgress);
        this.updatePlaybackVisualState(expected);
    },

    updatePlaybackVisualState(isPlaying) {
        const active = Boolean(isPlaying);
        if (this.el) {
            this.el.classList.toggle('playing-music-glow', active);
        }
        // Titre trop long : il avance seulement pendant la lecture (figé en pause, à sa position).
        // Ce n'était pas le cas quand la pilule ou le lecteur n'étaient pas redessinés.
        document.querySelectorAll('.is-marquee').forEach((box) => box.classList.toggle('is-paused', !active));
        document.querySelectorAll('.play-btn i, #ic-np-play-btn-val i').forEach((icon) => {
            icon.className = `ph ph-${active ? 'pause' : 'play'}`;
        });
    },

    clearOptimisticPlaybackState() {
        this._mediaControlPendingUntil = 0;
        this._mediaControlExpectedIsPlaying = null;
        this._mediaControlPendingTrackKey = "";
    },

    updateMusic(data) {
        // Enforce temporary progress suppression to make seeking feel instantaneous and prevent snapbacks
        if (this.musicData && this.suppressProgressUpdatesUntil && Date.now() < this.suppressProgressUpdatesUntil) {
            // Keep our current estimated progress and duration, ignore the incoming old progress from the system
            data.progress = this.musicData.progress;
            data.duration = this.musicData.duration;
        }
        if (this._mediaControlExpectedIsPlaying !== null && Date.now() < this._mediaControlPendingUntil) {
            const pendingTrackKey = this._mediaControlPendingTrackKey;
            const incomingTrackKey = data.trackKey || getMusicHistoryKey(data);
            const currentTrackKey = this.musicData ? (this.musicData.trackKey || getMusicHistoryKey(this.musicData)) : "";
            const sameTrack = !pendingTrackKey || !incomingTrackKey || pendingTrackKey === incomingTrackKey || currentTrackKey === incomingTrackKey;

            if (sameTrack) {
                const stableProgress = this.getEstimatedMediaProgress();
                data.isPlaying = this._mediaControlExpectedIsPlaying;
                data.progress = stableProgress;
                if (this.musicData?.duration) {
                    data.duration = this.musicData.duration;
                }
            } else {
                this.clearOptimisticPlaybackState();
            }
        } else if (this._mediaControlExpectedIsPlaying !== null) {
            this.clearOptimisticPlaybackState();
        }

        const previousDisplayArt = this.musicData ? getDisplayMediaArt(this.musicData) : "";
        const currentTrackKey = this.musicData ? (this.musicData.trackKey || getMusicHistoryKey(this.musicData)) : "";
        const incomingTrackKey = data.trackKey || getMusicHistoryKey(data);
        const fallbackSameIdentity = this.musicData &&
            (this.musicData.title || "") === (data.title || "") &&
            (this.musicData.artist || "") === (data.artist || "");
        const sameTrackIdentity = Boolean(currentTrackKey && incomingTrackKey)
            ? currentTrackKey === incomingTrackKey
            : fallbackSameIdentity;
        const realTrackIdentityChanged = Boolean(this.musicData && currentTrackKey && incomingTrackKey && currentTrackKey !== incomingTrackKey);
        const incomingPlaybackChanged = this.musicData && this.musicData.isPlaying !== data.isPlaying;
        const playbackGuardActive = this._mediaControlExpectedIsPlaying !== null && Date.now() < this._mediaControlPendingUntil;
        const shouldFreezeCover = sameTrackIdentity && previousDisplayArt && (incomingPlaybackChanged || playbackGuardActive);
        let effectiveArt = shouldFreezeCover
            ? previousDisplayArt
            : this.getStableDisplayArt(data);

        data.displayCover = effectiveArt;
        const renderIdentityChanged = !this._lastRenderedTrack ||
            this._lastRenderedTrack.title !== data.title ||
            this._lastRenderedTrack.artist !== data.artist;
        const coverChanged = !this._lastRenderedTrack ||
            this._lastRenderedTrack.cover !== effectiveArt;
        const trackChanged = renderIdentityChanged || (!shouldFreezeCover && coverChanged);
        const playbackChanged = !this._lastRenderedTrack ||
            this._lastRenderedTrack.isPlaying !== data.isPlaying;
        const shouldAnimateCover = realTrackIdentityChanged &&
            !playbackGuardActive &&
            previousDisplayArt &&
            effectiveArt &&
            previousDisplayArt !== effectiveArt;

        data.previousDisplayCover = shouldAnimateCover ? previousDisplayArt : "";
        data.animateCover = shouldAnimateCover;
        if (shouldAnimateCover) {
            this._pendingCoverAnimationTrackKey = incomingTrackKey;
        }

        if (trackChanged || playbackChanged) {
            this._lastRenderedTrack = {
                title: data.title,
                artist: data.artist,
                cover: effectiveArt,
                isPlaying: data.isPlaying
            };
        }

        const isNewTrack = realTrackIdentityChanged || !this._lastTrackId;

        if (isNewTrack) {
            this._lastTrackId = {
                title: data.title,
                artist: data.artist
            };
        }
        this._isNewTrackSignal = shouldAnimateCover;

        this.musicData = data;
        this.isPlaying = data.isPlaying;
        this.lastMediaUpdate = Date.now();

        if (trackChanged) {
            this.addMusicHistoryItem(data);
        }

        this.updatePlaybackVisualState(data.isPlaying);

        // Enforce active cover artwork and colors synchronously for instant transition!
        this.syncGlobalCoverAesthetics();

        // Real-time dynamic updates to Control Center Now Playing widget elements if visible
        if (this.isExpanded && this.mode === 'control') {
            const npTitle = document.getElementById('ic-np-title-val');
            const npArtist = document.getElementById('ic-np-artist-val');
            const npCover = document.getElementById('ic-np-cover-img');
            const npPlayBtn = document.getElementById('ic-np-play-btn-val');
            
            if (npTitle) npTitle.innerText = data.title || "Sans titre";
            if (npArtist) npArtist.innerText = data.artist || "Artiste inconnu";
            if (npPlayBtn) {
                npPlayBtn.setAttribute('onclick', `event.stopPropagation(); window.spotifyControl('toggle')`);
                npPlayBtn.innerHTML = `<i class="ph-fill ph-${data.isPlaying ? 'pause' : 'play'}"></i>`;
            }
            if (npCover) {
                const effectiveNpArt = getDisplayMediaArt(data);
                if (effectiveNpArt && effectiveNpArt.length > 0) {
                    if (npCover.tagName === 'IMG') {
                        npCover.src = effectiveNpArt;
                        npCover.className = 'ic-np-cover';
                    } else {
                        const parent = npCover.parentNode;
                        const img = document.createElement('img');
                        img.id = 'ic-np-cover-img';
                        img.className = 'ic-np-cover';
                        img.src = effectiveNpArt;
                        parent.replaceChild(img, npCover);
                    }
                } else {
                    if (npCover.tagName === 'IMG') {
                        npCover.src = APP_LOGO_ART;
                        npCover.className = 'ic-np-cover app-logo-art';
                    } else {
                        const parent = npCover.parentNode;
                        if (!parent) return;
                        const img = document.createElement('img');
                        img.id = 'ic-np-cover-img';
                        img.className = 'ic-np-cover app-logo-art';
                        img.src = APP_LOGO_ART;
                        img.alt = 'Nolys';
                        parent.replaceChild(img, npCover);
                    }
                }
            }
        }

        // Extract colors if cover has changed
        const effectiveCoverArt = getDisplayMediaArt(data);
        if (effectiveCoverArt !== this._lastCoverUrl) {
            this._lastCoverUrl = effectiveCoverArt;
            this._extractColorsFromCover(effectiveCoverArt);
        }

        // Tell visualizer service about playback state
        visualizerService.setPlaybackState(data.isPlaying);
        this.syncVisualizerActivity();

        const musicEnabled = localStorage.getItem('liquid_music_enabled') !== 'false';

        if (!musicEnabled) {
            if (this.mode === 'music') {
                if (trackChanged) {
                    this.renderIdle();
                }
            }
            return;
        }

        if (this.isExpanded && this.mode === 'music') {
            if (this.isScrubbing) return; // Do not re-render DOM while user is actively dragging the scrubber!
            if (trackChanged) {
                this.renderMusic();
            } else if (playbackChanged) {
                this.updatePlaybackVisualState(data.isPlaying);
            }
        } else if (this.isExpanded && this.mode === 'music-history') {
            // Titre en cours et égaliseur de l'Historique.
            if (trackChanged || playbackChanged) this._historyController?.refresh();
        } else if (!this.isExpanded) {
            // La pilule affiche la musique seulement pendant la lecture : elle doit aussi se
            // redessiner quand la lecture démarre ou s'arrête. Sans ça, un morceau annoncé
            // d'abord « en pause » par Windows (YouTube fermé, reprise de Spotify…) laissait
            // la pilule vide alors que la musique jouait.
            // Notification en cours dans la pilule : elle se termine d'elle-même par renderIdle.
            if ((trackChanged || playbackChanged) && this.mode !== 'notification') {
                this.renderIdle();
            }
        }
    },

    async mirrorCurrentMedia() {
        if (!this.musicData) return;
        
        if (!ipcRenderer) return;

        const sources = await ipcRenderer.invoke('get-desktop-sources');

        // Logic de matching intelligente
        const appId = (this.musicData.appId || "").toLowerCase();
        const artist = (this.musicData.artist || "").toLowerCase();
        const title = (this.musicData.title || "").toLowerCase();

        // 1. Essayer de matcher par l'ID de l'application (Spotify.exe -> "Spotify")
        let target = sources.find(s => {
            const sName = s.name.toLowerCase();
            const cleanAppId = appId.split('.')[0].replace('microsoft.', '');
            if (cleanAppId && sName.includes(cleanAppId)) return true;
            return false;
        });

        // 2. Si pas de match, essayer par titre ou artiste (Utile pour YouTube/Chrome)
        if (!target) {
            target = sources.find(s => {
                const sName = s.name.toLowerCase();
                const cleanTitle = title.split(' - ')[0].split(' | ')[0].trim().toLowerCase();
                if (cleanTitle.length > 3 && sName.includes(cleanTitle)) return true;
                if (artist.length > 3 && sName.includes(artist)) return true;
                return false;
            });
        }

        if (target) {
            window.dispatchEvent(new CustomEvent('liquid-open-widget', { detail: 'mirror' }));
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('liquid-mirror-start', { detail: target }));
            }, 500);
            this.showNotification('Miroir', `Projection de ${target.name}`, 'ph-screencast');
        } else {
            console.warn("Mirror target not found for media:", this.musicData);
            this.showNotification('Miroir', 'Fenêtre source introuvable', 'ph-warning-circle');
        }
    },
};
