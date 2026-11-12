/** Vue compacte (pilule au repos). */
import { ThemeService } from '../../../services/ThemeService.js';
import { escapeHtml, formatTime } from '../helpers/format.js';
import { applyLoopMarquee } from '../helpers/marquee.js';
import { APP_LOGO_ART, coverBlurPx, getDisplayMediaArt, getFallbackIcon, getServiceArtStyle, shouldPreferServiceIcon } from '../helpers/media-art.js';
import { compactActivity } from '../helpers/compact-activity.js';
import { replay } from '../../../replay/store.js';
import { offlineArt } from '../../../shared/privacy.js';
import { readRecord } from '../../../shared/safe-storage.js';
import { renderModuleArtwork } from '../../../shared/module-art.js';

export const idleView = {
    renderIdle() {
        if (this.isExpanded) return;
        const activity = this.getCompactActivity();
        this._compactActivityKind = activity?.kind || null;
        this.syncTimerSatellite?.();
        this.syncReplaySatellite?.();
        this.syncCoverReadability();
        // Largeur adaptée au titre : recalculée plus bas pour la musique, sinon taille du CSS.
        this.el.style.width = '';

        // Apply a gorgeous blurred cover art background to the small pill if playing music!
        const bgLayer = this.el.querySelector('.island-bg-layer');
        const musicEnabled = localStorage.getItem('liquid_music_enabled') !== 'false';
        const idleCoverBgEnabled = localStorage.getItem('liquid_island_idle_cover_bg') !== 'false';
        const effectiveIdleArt = getDisplayMediaArt(this.musicData);
        const showMusicCoverBg = musicEnabled && idleCoverBgEnabled && this.musicData && this.musicData.isPlaying && effectiveIdleArt && effectiveIdleArt.length > 0;

        if (bgLayer) {
            if (showMusicCoverBg && localStorage.getItem('liquid_cover_color_sync') !== 'false') {
                const cleanCover = effectiveIdleArt.replace(/\\/g, '/');
                bgLayer.style.backgroundImage = `url("${cleanCover}")`;
                bgLayer.style.opacity = '0.55'; // Vibrant visibility for tiny capsule
                bgLayer.style.filter = `blur(${coverBlurPx(0.55)}px) saturate(200%)`;
            } else {
                const islandConfig = readRecord('liquid_island_config');
                const background = offlineArt(islandConfig.bgImage);
                if (background && !this.musicData?.isPlaying) {
                    bgLayer.style.backgroundImage = `url(${JSON.stringify(background.replace(/\\/g, '/'))})`;
                    bgLayer.style.opacity = (islandConfig.imgOpacity ?? 100) / 100;
                    bgLayer.style.filter = `blur(${islandConfig.blur ?? 30}px)`;
                } else {
                    bgLayer.style.backgroundImage = 'none';
                    bgLayer.style.opacity = '0';
                }
            }
        }

        if (this.mode === 'ai-thinking') {
            this.el.classList.add('island-active-music');
            this.content.innerHTML = `
                <div class="island-idle-content" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 100%; padding: 0 16px; color: var(--neon-primary); font-weight: 600; font-size: 13px;">
                    <i class="ph ph-robot" style="font-size: 16px; animation: pulseGlow 1.5s infinite;"></i>
                    <span style="font-family: inherit; font-size: 12px; letter-spacing: 0.5px;">Liquid AI réfléchit...</span>
                </div>
            `;
            this._vizCanvas = null;
            this.syncVisualizerActivity();
            return;
        }

        if (this.mode === 'ai-action') {
            this.el.classList.add('island-active-music');
            const label = this.aiActionLabel || 'Action';
            this.content.innerHTML = `
                <div class="island-idle-content" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 100%; padding: 0 16px; color: var(--neon-secondary); font-weight: 600; font-size: 13px;">
                    <i class="ph ph-sparkle" style="font-size: 16px; animation: pulseGlow 1.5s infinite;"></i>
                    <span style="font-family: inherit; font-size: 12px; letter-spacing: 0.5px;">Exécute : ${label}...</span>
                </div>
            `;
            this._vizCanvas = null;
            this.syncVisualizerActivity();
            return;
        }

        if (activity) {
            this.el.classList.toggle('island-active-music', Boolean(musicEnabled && this.musicData?.isPlaying));
            this.el.classList.remove('island-active-network');
            if (!this.el.classList.contains('island-game-compact')) this.el.style.width = '200px';
            this.content.innerHTML = `<div class="island-idle-content">
                <button type="button" class="compact-activity ${activity.urgent ? 'is-urgent' : ''} ${activity.kind === 'recording' ? 'is-recording' : ''}"
                    data-island-action="openCompactActivity">
                    ${renderModuleArtwork(activity.mode)}
                    <span class="compact-activity-label"></span><strong class="compact-activity-value"></strong>
                </button></div>`;
            this.updateCompactActivity(activity);
            this._vizCanvas = null;
            this.syncVisualizerActivity();
            this.positionMicSatellite?.();
            return;
        }

        if (musicEnabled && this.musicData && this.musicData.isPlaying) {
            this.el.classList.add('island-active-music');
            this.el.classList.remove('island-active-network'); // Ensure unique state
            const compactMode = localStorage.getItem('liquid_idle_compact_mode') || 'cover';
            const pillConfig = this._islandConfig || {};
            const showIdleVisualizer = localStorage.getItem('liquid_eco_mode') !== 'true' && pillConfig.vizInPill !== false;
            const coverRadius = { round: '50%', rounded: '9px', square: '5px' }[pillConfig.pillCoverShape] || '50%';
            // Mouvements sobres : pas de défilement, le titre est coupé par « … ».
            const titleNoScroll = pillConfig.titleScroll === false || document.body.classList.contains('motion-sober');
            const vizBars = this.getVizBarCount();
            const vizWidth = this.getVizWidth(3);

            let coverHtml;
            const appIcon = getFallbackIcon(this.musicData.appId, this.musicData.title, this.musicData.artist, this.musicData.windowTitle);
            const preferServiceIcon = shouldPreferServiceIcon(this.musicData.appId, this.musicData.title, this.musicData.artist);
            const displayArt = getDisplayMediaArt(this.musicData);
            if (preferServiceIcon && appIcon) {
                coverHtml = `<img src="${escapeHtml(appIcon)}" style="width: 28px; height: 28px; border-radius: ${coverRadius}; ${getServiceArtStyle('small')} margin-left: 2px;" data-fallback="note">`;
            } else if (displayArt && displayArt.length > 0) {
                coverHtml = `<img src="${escapeHtml(displayArt)}" style="width: 28px; height: 28px; border-radius: ${coverRadius}; object-fit: cover; margin-left: 2px;" data-fallback="note">`;
            } else {
                if (appIcon && appIcon !== APP_LOGO_ART) {
                    coverHtml = `<img src="${escapeHtml(appIcon)}" style="width: 28px; height: 28px; border-radius: ${coverRadius}; object-fit: contain; background: #000; padding: 2px; margin-left: 2px;" data-fallback="note">`;
                } else {
                    coverHtml = `<img src="${APP_LOGO_ART}" class="idle-cover-art app-logo-art" style="border-radius: ${coverRadius};" alt="Nolys">`;
                }
            }

            // Pochette, titre du morceau (qui défile s'il est trop long), puis l'onde.
            let idleInnerHtml = `
          ${coverHtml}
          ${pillConfig.pillShowTitle !== false ? `<div class="idle-title ${titleNoScroll ? 'no-scroll' : ''}"><span class="idle-title-text">${escapeHtml(this.musicData.title || 'Lecture')}</span></div>` : ''}
          ${showIdleVisualizer ? `<canvas class="live-viz-canvas" data-bars="${vizBars}" data-bar-width="3" style="width: ${vizWidth}px"></canvas>` : ''}
            `;

            if (compactMode === 'title') {
                idleInnerHtml = `
          ${coverHtml}
          <div class="idle-track-chip">
            <span>${escapeHtml(this.musicData.title || 'Lecture')}</span>
            <small>${escapeHtml(this.musicData.artist || '')}</small>
          </div>
                `;
            } else if (compactMode === 'volume') {
                const group = this.currentMediaVolumeGroup;
                const activeVol = group ? (group.muted || group.volume === 0 ? 0 : Math.round(group.volume || 0)) : null;
                const icon = activeVol === 0 ? 'ph-speaker-slash' : (activeVol !== null && activeVol < 50 ? 'ph-speaker-low' : 'ph-speaker-high');
                idleInnerHtml = `
          <div class="idle-metric-chip">
            <i class="ph ${icon}"></i>
            <span>${activeVol === null ? '--' : `${activeVol}%`}</span>
          </div>
                `;
                if (!group && (!this._idleVolumeRefreshAt || Date.now() - this._idleVolumeRefreshAt > 2000)) {
                    this._idleVolumeRefreshAt = Date.now();
                    this.refreshCurrentMediaVolumeSession().then(() => {
                        if (!this.isExpanded && localStorage.getItem('liquid_idle_compact_mode') === 'volume') this.renderIdle();
                    });
                }
            } else if (compactMode === 'progress') {
                idleInnerHtml = `
          <div class="idle-metric-chip">
            <i class="ph ph-waveform"></i>
            <span>${formatTime(this.musicData.progress || 0)}</span>
          </div>
                `;
            }

            this.content.innerHTML = `
        <div class="island-idle-content" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 100%; box-sizing: border-box; padding: 0 ${compactMode === 'cover' && showIdleVisualizer ? 8 : 18}px 0 1px;">
          ${idleInnerHtml}
        </div>
            `;
            // Wire canvas to visualizer
            this._vizCanvas = this.content.querySelector('.live-viz-canvas');
            this.syncVisualizerActivity();
            if (compactMode === 'cover') this.fitIdleToTitle();
        } else {
            this.el.classList.remove('island-active-music');
            this.el.classList.remove('island-active-network');
            this.el.style.animation = 'none'; // Ensure no rouge animation
            this.el.style.boxShadow = ''; // Reset to CSS default
            this.content.innerHTML = '';
            this._vizCanvas = null;
            this.syncVisualizerActivity();
            // Restore default settings glow
            ThemeService.applyIslandSettings();
        }
    },

    getCompactActivity() {
        if (this._layoutEditMode || ['ai-thinking', 'ai-action', 'notification'].includes(this.mode)) return null;
        return compactActivity(this._timers?.satellite, replay.state.snapshot,
            this.musicData?.isPlaying && localStorage.getItem('liquid_music_enabled') !== 'false');
    },

    updateCompactActivity(activity) {
        const button = this.content.querySelector('.compact-activity');
        if (!button) return;
        for (const [selector, text] of [['.compact-activity-label', activity.label], ['.compact-activity-value', activity.value]]) {
            const node = button.querySelector(selector);
            if (node.textContent !== text) node.textContent = text;
        }
        button.classList.toggle('is-urgent', activity.urgent);
        const label = `${activity.label} : ${activity.value}. Ouvrir ${activity.mode === 'timer' ? 'les horloges' : 'Replay et enregistrement'}.`;
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    },

    syncCompactActivity() {
        if (this.isExpanded || this._isTransitioning || this._layoutEditMode || this._fileReceiving
            || ['ai-thinking', 'ai-action', 'notification'].includes(this.mode)) return;
        const activity = this.getCompactActivity();
        if ((activity?.kind || null) !== (this._compactActivityKind || null)) this.renderIdle();
        else if (activity) this.updateCompactActivity(activity);
    },

    openCompactActivity() {
        const activity = this.getCompactActivity();
        if (!activity) return;
        if (activity.kind === 'timer') {
            const timer = this._timers.satellite;
            if (timer?.id) this._timers.select(timer.id);
            else this._timers.setMode('stopwatch');
            this.persistTimers();
        }
        this.openExpandedMode(activity.mode);
    },

    /**
     * La pilule prend la largeur de son contenu (120 px au minimum, jusqu'au maximum choisi, 240 par
     * défaut) : pas de grand vide au milieu, et le ressort anime le changement à chaque
     * morceau. Au-delà, le titre défile (ou est coupé si le défilement est désactivé).
     */
    fitIdleToTitle() {
        if (this.el.classList.contains('island-game-compact')) return;
        const title = this.content.querySelector('.idle-title');
        const text = title && title.querySelector('.idle-title-text');
        if (!text) {
            // Sans titre : pilule compacte, juste la pochette et le visualiseur.
            this.el.style.width = '130px';
            return;
        }
        // Minimum bas : un titre court (« VMA ») ne doit pas laisser une pilule trop large.
        const MIN = 120;
        const MAX = Math.max(180, Math.min(340, Number(this._islandConfig?.pillMaxWidth) || 240));
        const others = this.el.offsetWidth - title.clientWidth; // pochette, onde, marges
        const wanted = Math.ceil(Math.max(text.scrollWidth, text.getBoundingClientRect().width) + others);
        // Paliers de 16 px, et un titre à peine plus court garde la largeur actuelle :
        // la pilule ne bat plus à chaque morceau pour quelques pixels.
        let width = Math.max(MIN, Math.min(MAX, Math.ceil(wanted / 16) * 16));
        const previous = this._idlePillWidth;
        if (previous && previous <= MAX && width < previous && previous - width < 48) width = previous;
        this._idlePillWidth = width;
        this.el.style.width = `${width}px`;

        if (!title.classList.contains('no-scroll')) applyLoopMarquee(title, text, wanted - MAX);

        // Police pas encore chargée au tout premier rendu : la largeur mesurée est fausse,
        // on refait la pilule une fois le texte dans sa vraie police.
        if (document.fonts && document.fonts.status !== 'loaded' && !this._idleFontsWait) {
            this._idleFontsWait = document.fonts.ready.then(() => {
                this._idleFontsWait = null;
                if (!this.isExpanded && title.isConnected) this.renderIdle();
            });
        }
    },
};
