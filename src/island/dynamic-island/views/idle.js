/** Vue compacte (pilule au repos). */
import { ThemeService } from '../../../services/ThemeService.js';
import { escapeHtml, formatTime } from '../helpers/format.js';
import { APP_LOGO_ART, getDisplayMediaArt, getFallbackIcon, getServiceArtStyle, shouldPreferServiceIcon } from '../helpers/media-art.js';

export const idleView = {
    renderIdle() {
        if (this.isExpanded) return;

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
                bgLayer.style.filter = 'blur(16px) saturate(200%)';
            } else {
                const islandConfig = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
                if (islandConfig.bgImage && (!this.musicData || !this.musicData.isPlaying)) {
                    bgLayer.style.backgroundImage = `url('${islandConfig.bgImage.replace(/\\/g, '/')}')`;
                    bgLayer.style.opacity = (islandConfig.imgOpacity || 100) / 100;
                    bgLayer.style.filter = `blur(${islandConfig.blur || 30}px)`;
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

        if (this.isTimerRunning) {
            this.el.classList.add('island-active-music');
            const mins = Math.floor(this.timerValue / 60).toString().padStart(2, '0');
            const secs = (this.timerValue % 60).toString().padStart(2, '0');

            const isMusicPlaying = this.musicData && this.musicData.isPlaying;
            const timerColor = isMusicPlaying ? 'var(--neon-primary)' : '#ffffff';
            const iconGlow = isMusicPlaying ? 'drop-shadow(0 0 4px var(--neon-primary))' : 'none';

            this.content.innerHTML = `
        <div class="island-idle-content" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 100%;">
          <i class="ph ph-timer" style="color: ${timerColor}; font-size: 16px; filter: ${iconGlow};"></i>
          <span style="color: ${timerColor}; font-family: var(--font-mono); font-weight: 700; font-size: 15px; letter-spacing: 0.5px;">
            ${mins}:${secs}
          </span>
        </div>
      `;
            this._vizCanvas = null;
            this.syncVisualizerActivity();
            return;
        }

        // Mini Network Indicator if in network mode but idle? 
        // Or if user prefers network monitoring in idle. 
        // For now, let's keep idle standard unless playing music or explicitly notifying.
        // However, if we want the "Pulse" to be useful for background monitoring, we could add a tiny dot or indicator.
        // Let's stick to music logic for now as per usual OS behavior.

        if (musicEnabled && this.musicData && this.musicData.isPlaying) {
            this.el.classList.add('island-active-music');
            this.el.classList.remove('island-active-network'); // Ensure unique state
            const compactMode = localStorage.getItem('liquid_idle_compact_mode') || 'cover';
            const showIdleVisualizer = localStorage.getItem('liquid_eco_mode') !== 'true' && localStorage.getItem('liquid_player_show_visualizer') !== 'false';

            let coverHtml;
            const appIcon = getFallbackIcon(this.musicData.appId, this.musicData.title, this.musicData.artist, this.musicData.windowTitle);
            const preferServiceIcon = shouldPreferServiceIcon(this.musicData.appId, this.musicData.title, this.musicData.artist);
            const displayArt = getDisplayMediaArt(this.musicData);
            if (preferServiceIcon && appIcon) {
                coverHtml = `<img src="${appIcon}" style="width: 28px; height: 28px; border-radius: 50%; ${getServiceArtStyle('small')} margin-left: 2px;" onerror="this.outerHTML='<div style=\\'width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--neon-primary), var(--neon-secondary)); display: flex; align-items: center; justify-content: center; margin-left: 2px;\\'><i class=\\'ph ph-music-note\\' style=\\'font-size: 14px; color: #fff;\\'></i></div>';">`;
            } else if (displayArt && displayArt.length > 0) {
                coverHtml = `<img src="${displayArt}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-left: 2px;" onerror="this.outerHTML='<div style=\\'width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--neon-primary), var(--neon-secondary)); display: flex; align-items: center; justify-content: center; margin-left: 2px;\\'><i class=\\'ph ph-music-note\\' style=\\'font-size: 14px; color: #fff;\\'></i></div>';">`;
            } else {
                if (appIcon) {
                    coverHtml = `<img src="${appIcon}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: contain; background: #000; padding: 2px; margin-left: 2px;" onerror="this.outerHTML='<div style=\\'width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--neon-primary), var(--neon-secondary)); display: flex; align-items: center; justify-content: center; margin-left: 2px;\\'><i class=\\'ph ph-music-note\\' style=\\'font-size: 14px; color: #fff;\\'></i></div>';">`;
                } else {
                    coverHtml = `<img src="${APP_LOGO_ART}" class="idle-cover-art app-logo-art" alt="Nolys">`;
                }
            }

            let idleInnerHtml = `
          ${coverHtml}
          ${showIdleVisualizer ? '<canvas class="live-viz-canvas" data-bars="5" data-bar-width="3"></canvas>' : ''}
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
};
