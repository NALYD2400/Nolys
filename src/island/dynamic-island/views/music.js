/** Lecteur musical déplié. */
import { applyLoopMarquee } from '../helpers/marquee.js';
import { escapeHtml, formatTime } from '../helpers/format.js';
import { APP_LOGO_ART, getDisplayMediaArt, getFallbackIcon, getRawDisplayMediaArt, getServiceArtStyle, shouldPreferServiceIcon } from '../helpers/media-art.js';
import { getMusicHistoryKey } from '../helpers/music-search.js';

export const musicView = {
    renderMusic() {
        const data = this.musicData || {
            title: "Aucune lecture",
            artist: "Lecteur média",
            cover: "",
            isPlaying: false,
            progress: 0,
            duration: 0
        };

        const pct = (data.progress && data.duration) ? (data.progress / data.duration) * 100 : 0;
        const currentTime = formatTime(data.progress || 0);
        const totalTime = formatTime(data.duration || 0);
        const showTimes = localStorage.getItem('liquid_player_show_times') !== 'false';
        const showVisualizer = localStorage.getItem('liquid_eco_mode') !== 'true' && localStorage.getItem('liquid_player_show_visualizer') !== 'false' && data.isPlaying;
        const showActions = localStorage.getItem('liquid_player_show_actions') !== 'false';
        const displayArt = getDisplayMediaArt(data);
        const rawDisplayArt = getRawDisplayMediaArt(data);
        const showMediaDebug = localStorage.getItem('liquid_media_debug') === 'true';
        const debugCoverState = displayArt && rawDisplayArt && displayArt !== rawDisplayArt ? 'preload' : data.cover ? 'real' : data.transientCover ? 'temp' : rawDisplayArt ? 'logo' : 'none';
        const debugTrackKey = data.trackKey || getMusicHistoryKey(data);
        const mediaDebugHtml = showMediaDebug ? `
        <div class="media-debug-row" title="${escapeHtml(debugTrackKey)}">
          <span>SRC ${escapeHtml(data.source || 'n/a')}</span>
          <span>COVER ${escapeHtml(debugCoverState)}</span>
          <span>KEY ${escapeHtml(debugTrackKey.slice(0, 34))}</span>
        </div>` : '';
        const isFavorite = this.isCurrentMusicFavorite();

        const currentRenderTrackKey = data.trackKey || getMusicHistoryKey(data);
        const shouldAnimateCover = Boolean(this._pendingCoverAnimationTrackKey && this._pendingCoverAnimationTrackKey === currentRenderTrackKey);
        const flipClass = shouldAnimateCover ? 'flip-active' : '';
        let coverHtml;
        const appIcon = getFallbackIcon(data.appId, data.title, data.artist, data.windowTitle);
        const preferServiceIcon = shouldPreferServiceIcon(data.appId, data.title, data.artist);
        const isDisplayServiceArt = appIcon && displayArt === appIcon;
        const displayArtStyle = isDisplayServiceArt ? getServiceArtStyle('large') : '';
        const previousDisplayArt = shouldAnimateCover && data.previousDisplayCover && data.previousDisplayCover !== displayArt ? data.previousDisplayCover : '';

        if (displayArt && displayArt.length > 0) {
            const currentImg = `<img src="${escapeHtml(displayArt)}" class="album-art-img album-art-current" style="${displayArtStyle}" alt="Album">`;
            coverHtml = previousDisplayArt
                ? `<div class="album-art album-art-stack ${isDisplayServiceArt ? 'is-service-art' : ''}">
                    <img src="${escapeHtml(previousDisplayArt)}" class="album-art-img album-art-previous" alt="">
                    ${currentImg}
                  </div>`
                : `<img src="${escapeHtml(displayArt)}" class="album-art ${flipClass}" style="${displayArtStyle}" alt="Album">`;
        } else {
            if (appIcon) {
                coverHtml = `<img src="${appIcon}" class="album-art ${flipClass}" style="object-fit: contain; background: #000; padding: 5px;" alt="App Icon">`;
            } else {
                coverHtml = `<img src="${APP_LOGO_ART}" class="album-art app-logo-art ${flipClass}" alt="Nolys">`;
            }
        }

        const menuBtn = `
          <button class="island-action-btn menu-btn" onclick="event.stopPropagation(); window.island.setMode('menu')" title="Menu des modules">
            <i class="ph-bold ph-squares-four"></i>
          </button>`;

        const favoriteBtn = `
          <button class="island-action-btn music-favorite-btn ${isFavorite ? 'is-favorite' : ''}" onclick="event.stopPropagation(); window.island.toggleCurrentMusicFavorite()" title="${isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
            <i class="${isFavorite ? 'ph-fill' : 'ph'} ph-star"></i>
          </button>`;

        const historyBtn = `
          <button class="island-action-btn music-history-btn" onclick="event.stopPropagation(); window.island.setMode('music-history')" title="Historique musique">
            <i class="ph ph-clock-counter-clockwise"></i>
          </button>`;

        this.content.innerHTML = `
      <div class="music-player">
        <div class="music-info">
          ${coverHtml}
          <div class="track-details">
            <div class="track-title"><span class="track-title-text">${escapeHtml(data.title)}</span></div>
            <div class="track-artist">${escapeHtml(data.artist)}</div>
          </div>
          ${showVisualizer ? `<canvas class="music-viz-canvas" data-bars="${this.getVizBarCount()}" data-bar-width="3.5" style="width: ${this.getVizWidth(3.5)}px" aria-hidden="true"></canvas>` : ''}
          ${showActions ? `
            <div class="music-action-cluster">
              ${historyBtn}
              ${favoriteBtn}
              ${menuBtn}
            </div>
          ` : ''}
        </div>
        <div class="music-controls">
          <button class="control-btn-music" title="Précédent" aria-label="Précédent" onclick="event.stopPropagation(); window.spotifyControl('prev')"><i class="ph-fill ph-skip-back"></i></button>
          <button class="control-btn-music play-btn" title="${data.isPlaying ? 'Pause' : 'Lecture'}" aria-label="${data.isPlaying ? 'Pause' : 'Lecture'}" onclick="event.stopPropagation(); window.spotifyControl('toggle')">
            <i class="ph-fill ${data.isPlaying ? 'ph-pause' : 'ph-play'}"></i>
          </button>
          <button class="control-btn-music" title="Suivant" aria-label="Suivant" onclick="event.stopPropagation(); window.spotifyControl('next')"><i class="ph-fill ph-skip-forward"></i></button>
        </div>
        <div class="music-progress-group">
        <div class="progress-bar" style="--progress-pct: ${pct}%">
          <div class="progress-fill" id="music-progress-fill" style="width: ${pct}%"></div>
          <div class="progress-tooltip" id="music-progress-tooltip">${currentTime}</div>
        </div>
        ${showTimes ? `<div class="music-time-row">
            <span id="music-current-time">${currentTime}</span>
            <span>${totalTime}</span>
        </div>` : ''}
        </div>
        ${mediaDebugHtml}
      </div>
    `;

        this.setupTitleMarquee();

        // Wire expanded canvas visualizer
        this._vizCanvas = showVisualizer ? this.content.querySelector('.music-viz-canvas') : null;
        this.syncVisualizerActivity();
        this.refreshCurrentMediaVolumeSession();
        this.syncGlassControls();

        // Update BG
        const bgLayer = this.el.querySelector('.island-bg-layer');
        if (bgLayer) {
            const effectiveBgArt = getDisplayMediaArt(data);
            if (effectiveBgArt && effectiveBgArt.length > 0) {
                bgLayer.style.backgroundImage = `url(${effectiveBgArt.replace(/\\/g, '/')})`;
                bgLayer.style.opacity = String(this.getPlayerCoverOpacity());
                bgLayer.style.filter = 'blur(24px) saturate(180%)';
            } else {
                const islandConfig = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
                if (islandConfig.bgImage) {
                    bgLayer.style.backgroundImage = `url('${islandConfig.bgImage.replace(/\\/g, '/')}')`;
                    bgLayer.style.opacity = (islandConfig.imgOpacity || 100) / 100;
                    bgLayer.style.filter = `blur(${islandConfig.blur || 30}px)`;
                } else {
                    bgLayer.style.backgroundImage = 'none';
                }
            }
        }

        if (shouldAnimateCover && this._pendingCoverAnimationTrackKey === currentRenderTrackKey) {
            this._pendingCoverAnimationTrackKey = "";
        }
        if (this.musicData) {
            this.musicData.animateCover = false;
            this.musicData.previousDisplayCover = "";
        }
        this._isNewTrackSignal = false;
    },

    /**
     * Titre trop long : il défile en boucle vers la gauche (helpers/marquee.js) au lieu
     * d'être coupé par des points de suspension.
     */
    setupTitleMarquee() {
        const title = this.content.querySelector('.track-title');
        const text = title && title.querySelector('.track-title-text');
        if (!text) return;
        // Coupé par « … » (CSS) : défilement désactivé, ou mouvements sobres.
        if (this._islandConfig?.titleScroll === false || document.body.classList.contains('motion-sober')) return;
        requestAnimationFrame(() => applyLoopMarquee(title, text));
    },
};
