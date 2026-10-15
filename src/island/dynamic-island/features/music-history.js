/** Historique et favoris musicaux. */
import { SoundService } from '../../../services/SoundService.js';
import { escapeHtml, formatHistoryTime } from '../helpers/format.js';
import { APP_LOGO_ART, getEffectiveMediaArt } from '../helpers/media-art.js';
import { getCurrentTrackSearchQuery, getMusicHistoryKey, getMusicSearchProvider, isHistoryTrack } from '../helpers/music-search.js';

export const musicHistoryMethods = {
    loadMusicHistory() {
        try {
            const parsed = JSON.parse(localStorage.getItem('liquid_music_history') || '[]');
            if (Array.isArray(parsed)) {
                // Self-correcting migration: clear massive legacy base64 covers (>5KB) to instantly restore performance!
                let changed = false;
                const migrated = parsed.map(item => {
                    if (item.cover && item.cover.startsWith('data:') && item.cover.length > 5000) {
                        item.cover = ''; // Clear massive base64 cover; will use dynamic fallback
                        changed = true;
                    }
                    return item;
                });
                if (changed) {
                    localStorage.setItem('liquid_music_history', JSON.stringify(migrated));
                }
                return migrated.slice(0, 20);
            }
            return [];
        } catch (e) {
            return [];
        }
    },

    saveMusicHistory() {
        localStorage.setItem('liquid_music_history', JSON.stringify(this.musicHistory.slice(0, 20)));
    },

    compressHistoryCover(coverUrl) {
        return new Promise((resolve) => {
            if (!coverUrl || !coverUrl.startsWith('data:')) {
                resolve(coverUrl);
                return;
            }

            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 48;
                    canvas.height = 48;
                    // Canvas CPU : échantillonnage identique d'une machine à l'autre (et à l'ancienne version).
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 48, 48);
                    const compressed = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(compressed);
                } catch (e) {
                    resolve(coverUrl); // fallback to original on error
                }
            };
            img.onerror = () => {
                resolve(coverUrl);
            };
            img.src = coverUrl;
        });
    },

    async addMusicHistoryItem(data) {
        if (!isHistoryTrack(data)) return;

        const effectiveArt = getEffectiveMediaArt(data);
        const compressedArt = await this.compressHistoryCover(effectiveArt || data.cover || '');
        const provider = getMusicSearchProvider(data);
        const key = getMusicHistoryKey(data);
        const previous = this.musicHistory.find(track => track.key === key);
        const isAlreadyTop = this.musicHistory[0] && this.musicHistory[0].key === key;
        const item = {
            key,
            title: data.title || 'Sans titre',
            artist: data.artist || 'Artiste inconnu',
            cover: compressedArt,
            appId: data.appId || '',
            providerKey: provider.key,
            providerLabel: provider.label,
            providerIcon: provider.icon,
            timestamp: Date.now(),
            lastPlayedAt: Date.now(),
            firstPlayedAt: previous ? (previous.firstPlayedAt || previous.timestamp || Date.now()) : Date.now(),
            playCount: isAlreadyTop ? (previous ? (previous.playCount || 1) : 1) : (previous ? (previous.playCount || 1) + 1 : 1),
            duration: data.duration || 0,
            favorite: previous ? previous.favorite === true : false
        };

        if (isAlreadyTop) {
            this.musicHistory[0] = {
                ...this.musicHistory[0],
                ...item,
                timestamp: this.musicHistory[0].timestamp || item.timestamp
            };
            this.saveMusicHistory();
            return;
        }

        const existing = this.musicHistory.filter(track => track.key !== key);
        this.musicHistory = [item, ...existing].slice(0, 20);
        this.saveMusicHistory();
    },

    getProviderFromHistoryItem(item = {}) {
        if (item.providerKey) {
            return {
                key: item.providerKey,
                label: item.providerLabel || 'Web musique',
                icon: item.providerIcon || 'ph-magnifying-glass'
            };
        }

        return getMusicSearchProvider(item);
    },

    getHistoryQuery(item = {}) {
        return getCurrentTrackSearchQuery(item) || `${item.artist || ''} ${item.title || ''}`.trim();
    },

    isCurrentHistoryItem(item = {}) {
        if (!this.musicData) return false;
        const itemTitle = (item.title || '').trim().toLowerCase();
        const itemArtist = (item.artist || '').trim().toLowerCase();
        const currentTitle = (this.musicData.title || '').trim().toLowerCase();
        const currentArtist = (this.musicData.artist || '').trim().toLowerCase();

        return itemTitle && itemArtist && itemTitle === currentTitle && itemArtist === currentArtist;
    },

    openHistoryTrack(item, mode = 'search') {
        const query = this.getHistoryQuery(item);
        const provider = this.getProviderFromHistoryItem(item);

        if (mode === 'replay' && this.isCurrentHistoryItem(item)) {
            SoundService.play('success');
            window.spotifyControl('seek 0');
            window.spotifyControl('play');
            this.returnToMusicIdle();
            this.showIslandFeedback('Relance depuis le debut', 'ph-repeat');
            return;
        }

        if (mode === 'search') {
            this.openMusicSearchPanel(query, provider);
            return;
        }

        this.openMusicSearch(query, provider);
    },

    clearMusicHistory() {
        this.musicHistory = this.loadMusicHistory().filter(item => item.favorite);
        this.saveMusicHistory();
        SoundService.play('close');
        this.renderMusicHistory();
    },

    toggleMusicFavorite(index) {
        this.musicHistory = this.loadMusicHistory();
        const item = this.musicHistory[index];
        if (!item) return;
        item.favorite = !item.favorite;
        this.saveMusicHistory();
        SoundService.play(item.favorite ? 'success' : 'close');
        this.renderMusicHistory();
    },

    isCurrentMusicFavorite() {
        const data = this.musicData || {};
        if (!isHistoryTrack(data)) return false;

        const key = getMusicHistoryKey(data);
        return this.loadMusicHistory().some(item => item.key === key && item.favorite === true);
    },

    async toggleCurrentMusicFavorite() {
        const data = this.musicData || {};
        if (!isHistoryTrack(data)) {
            this.showIslandFeedback('Aucun morceau à ajouter aux favoris', 'ph-star');
            return;
        }

        const key = getMusicHistoryKey(data);
        this.musicHistory = this.loadMusicHistory();

        if (!this.musicHistory.some(item => item.key === key)) {
            await this.addMusicHistoryItem(data);
            this.musicHistory = this.loadMusicHistory();
        }

        const item = this.musicHistory.find(track => track.key === key);
        if (!item) return;

        item.favorite = !item.favorite;
        this.saveMusicHistory();
        SoundService.play(item.favorite ? 'success' : 'close');
        this.showIslandFeedback(item.favorite ? 'Ajoute aux favoris' : 'Retire des favoris', 'ph-star');

        if (this.isExpanded && this.mode === 'music') {
            this.renderMusic();
        } else if (this.isExpanded && this.mode === 'music-history') {
            this.renderMusicHistory();
        }
    },

    deleteMusicHistoryItem(index) {
        this.musicHistory = this.loadMusicHistory();
        const item = this.musicHistory[index];
        if (!item) return;

        this.musicHistory.splice(index, 1);
        this.saveMusicHistory();
        SoundService.play('close');
        this.showIslandFeedback('Morceau retire', 'ph-trash');
        this.renderMusicHistory();
    },

    setMusicHistorySearch(value) {
        this.musicHistoryQuery = String(value || '').slice(0, 80);
        this.renderMusicHistory();
        requestAnimationFrame(() => {
            const input = this.content.querySelector('#music-history-search-input');
            if (!input) return;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
    },

    getMusicHistoryFilter() {
        const filter = localStorage.getItem('liquid_music_history_filter') || 'all';
        return ['all', 'favorites', 'recent'].includes(filter) ? filter : 'all';
    },

    setMusicHistoryFilter(filter) {
        const nextFilter = ['all', 'favorites', 'recent'].includes(filter) ? filter : 'all';
        localStorage.setItem('liquid_music_history_filter', nextFilter);
        SoundService.play('close');
        this.renderMusicHistory();
    },

    autoSizeMusicHistory() {
        if (!this.isExpanded || this.mode !== 'music-history') return;

        const panel = this.content?.querySelector?.('.music-history-panel');
        const list = this.content?.querySelector?.('.music-history-list');
        const header = this.content?.querySelector?.('.music-history-header');
        const searchFilterRow = this.content?.querySelector?.('.music-history-search-filter-row');
        if (!panel || !list || !header || !searchFilterRow) return;

        const rows = Array.from(list.querySelectorAll('.music-history-row'));
        const empty = list.querySelector('.music-history-empty');
        const titles = Array.from(list.querySelectorAll('.music-history-section-title'));
        const px = (v) => {
            const n = parseFloat(v || '0');
            return Number.isFinite(n) ? n : 0;
        };

        const panelStyle = getComputedStyle(panel);
        const panelPadTop = px(panelStyle.paddingTop);
        const panelPadBottom = px(panelStyle.paddingBottom);
        const panelGap = px(panelStyle.gap);

        const headerH = header.getBoundingClientRect().height || 0;
        const searchFilterRowH = searchFilterRow.getBoundingClientRect().height || 0;

        let listTarget = 120;
        if (empty) {
            listTarget = Math.min(140, empty.getBoundingClientRect().height || 120);
        } else if (rows.length > 0) {
            const fullScrollHeight = list.scrollHeight || 0;
            const rowH = rows[0].getBoundingClientRect().height || 64;
            const titleH = titles[0]?.getBoundingClientRect?.().height || 18;
            const maxVisibleRows = 5;
            const visibleRows = Math.min(rows.length, maxVisibleRows);
            const maxVisibleTitles = Math.min(titles.length, 2);
            const estimatedMax = (visibleRows * rowH) + (maxVisibleTitles * titleH) + 24;
            listTarget = Math.min(fullScrollHeight, estimatedMax);
        }

        let target = panelPadTop + panelPadBottom + headerH + searchFilterRowH + (panelGap * 2) + listTarget;
        target = Math.max(180, Math.min(520, target));
        this.el.style.height = `${Math.round(target)}px`;
    },

    renderMusicHistory() {
        this.musicHistory = this.loadMusicHistory();
        const query = (this.musicHistoryQuery || '').trim().toLowerCase();
        const historyFilter = this.getMusicHistoryFilter();
        const matchesQuery = (item) => {
            if (!query) return true;
            return `${item.title || ''} ${item.artist || ''} ${item.providerLabel || ''} ${item.appId || ''}`.toLowerCase().includes(query);
        };

        const allFavoriteCount = this.musicHistory.filter(item => item.favorite).length;
        const allRecentCount = this.musicHistory.length - allFavoriteCount;
        const favorites = this.musicHistory
            .map((item, index) => ({ item, index }))
            .filter(entry => historyFilter !== 'recent' && entry.item.favorite && matchesQuery(entry.item));
        const recent = this.musicHistory
            .map((item, index) => ({ item, index }))
            .filter(entry => historyFilter !== 'favorites' && !entry.item.favorite && matchesQuery(entry.item));

        const renderRows = (entries) => entries.map(({ item, index }) => {
            const provider = this.getProviderFromHistoryItem(item);
            const isCurrent = this.isCurrentHistoryItem(item);
            const cover = item.cover
                ? `<img src="${escapeHtml(item.cover)}" class="music-history-cover" alt="">`
                : `<img src="${APP_LOGO_ART}" class="music-history-cover music-history-cover-fallback app-logo-art" alt="Nolys">`;

            return `
            <div class="music-history-row ${item.favorite ? 'is-favorite' : ''}" data-index="${index}">
                ${cover}
                <div class="music-history-meta">
                    <div class="music-history-title">${escapeHtml(item.title)}</div>
                    <div class="music-history-sub">
                        <span>${escapeHtml(item.artist)}</span>
                        <span class="music-history-dot"></span>
                        <span><i class="ph ${escapeHtml(provider.icon)}"></i> ${escapeHtml(provider.label)}</span>
                        ${(item.playCount || 1) > 1 ? `<span class="music-history-dot"></span><span>${item.playCount} ecoutes</span>` : ''}
                        <span class="music-history-dot"></span>
                        <span>${escapeHtml(formatHistoryTime(item.timestamp))}</span>
                    </div>
                </div>
                <div class="music-history-actions">
                    <button class="music-history-action ${item.favorite ? 'is-favorite' : ''}" data-action="favorite" title="${item.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}"><i class="${item.favorite ? 'ph-fill' : 'ph'} ph-star"></i></button>
                    <button class="music-history-action" data-action="search" title="Rechercher"><i class="ph ph-magnifying-glass"></i></button>
                    <button class="music-history-action ${isCurrent ? '' : 'is-disabled'}" data-action="replay" title="${isCurrent ? 'Rejouer depuis le debut' : 'Rejouer marche seulement pour le morceau en cours'}" ${isCurrent ? '' : 'disabled'}><i class="ph ph-repeat"></i></button>
                    <button class="music-history-action" data-action="open" title="Ouvrir"><i class="ph ph-arrow-square-out"></i></button>
                    <button class="music-history-action danger" data-action="delete" title="Supprimer"><i class="ph ph-x"></i></button>
                </div>
            </div>`;
        }).join('');

        const favoriteRows = renderRows(favorites);
        const recentRows = renderRows(recent);
        const totalCount = this.musicHistory.length;
        const favoriteCount = allFavoriteCount;
        const totalPlays = this.musicHistory.reduce((sum, item) => sum + (item.playCount || 1), 0);
        const topTrack = this.musicHistory
            .slice()
            .sort((a, b) => (b.playCount || 1) - (a.playCount || 1))[0];
        const topText = topTrack && (topTrack.playCount || 1) > 1
            ? `Top: ${escapeHtml(topTrack.title)} (${topTrack.playCount}x)`
            : `${totalPlays} lecture${totalPlays > 1 ? 's' : ''}`;
        const emptyText = query
            ? 'Aucun morceau trouvé.'
            : historyFilter === 'favorites'
                ? 'Aucun favori pour le moment.'
                : historyFilter === 'recent'
                    ? 'Aucun morceau récent pour le moment.'
            : 'Les prochains morceaux écoutés apparaîtront ici.';
        const historyFilterOptions = [
            { key: 'all', label: 'Tous', count: totalCount },
            { key: 'favorites', label: 'Favoris', count: allFavoriteCount },
            { key: 'recent', label: 'Récents', count: allRecentCount }
        ];

        this.content.innerHTML = `
      <div class="music-history-panel">
        <div class="music-history-header">
          <button class="island-action-btn music-history-back" id="music-history-back" title="Retour lecteur">
            <i class="ph ph-arrow-left"></i>
          </button>
          <div class="music-history-heading">
            <span>Historique</span>
          </div>
          <button class="island-action-btn music-history-clear" id="music-history-clear" title="Vider l’historique">
            <i class="ph ph-trash"></i>
          </button>
        </div>

        <div class="music-history-search-filter-row">
          <div class="music-history-search">
            <i class="ph ph-magnifying-glass"></i>
            <input id="music-history-search-input" type="text" value="${escapeHtml(this.musicHistoryQuery || '')}" placeholder="Rechercher…">
            ${(this.musicHistoryQuery || '').trim() ? '<button id="music-history-search-clear" title="Effacer"><i class="ph ph-x"></i></button>' : ''}
          </div>

          <div class="music-history-filter">
            ${historyFilterOptions.map(option => `
              <button class="${historyFilter === option.key ? 'is-active' : ''}" data-filter="${option.key}">
                <span>${option.label}</span>
                <small>${option.count}</small>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="music-history-list">
          ${favoriteRows ? `
            <div class="music-history-section-title"><i class="ph ph-star"></i> Favoris</div>
            ${favoriteRows}
          ` : ''}
          ${recentRows ? `
            <div class="music-history-section-title"><i class="ph ph-clock-counter-clockwise"></i> Récents</div>
            ${recentRows}
          ` : ''}
          ${favoriteRows || recentRows ? '' : `
            <div class="music-history-empty">
              <i class="ph ph-clock-counter-clockwise"></i>
              <span>${emptyText}</span>
            </div>
          `}
        </div>
      </div>
    `;

        this._vizCanvas = null;

        const backBtn = this.content.querySelector('#music-history-back');
        const clearBtn = this.content.querySelector('#music-history-clear');
        const searchInput = this.content.querySelector('#music-history-search-input');
        const searchClear = this.content.querySelector('#music-history-search-clear');
        const filterBtns = this.content.querySelectorAll('.music-history-filter button');
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setMode('music');
        });
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Deux clics : le premier arme le bouton (rouge), le second vide l'historique.
            if (!clearBtn.classList.contains('is-armed')) {
                clearBtn.classList.add('is-armed');
                clearBtn.title = 'Cliquer encore pour vider (les favoris sont gardés)';
                clearTimeout(this._historyClearTimer);
                this._historyClearTimer = setTimeout(() => {
                    clearBtn.classList.remove('is-armed');
                    clearBtn.title = 'Vider l’historique';
                }, 3000);
                return;
            }
            clearTimeout(this._historyClearTimer);
            this.clearMusicHistory();
        });
        searchInput.addEventListener('click', (e) => e.stopPropagation());
        searchInput.addEventListener('input', (e) => {
            e.stopPropagation();
            this.setMusicHistorySearch(e.target.value);
        });
        if (searchClear) {
            searchClear.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setMusicHistorySearch('');
            });
        }
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setMusicHistoryFilter(btn.dataset.filter);
            });
        });

        this.content.querySelectorAll('.music-history-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('.music-history-row');
                const index = Number(row && row.dataset.index);
                const item = this.musicHistory[index];
                if (!item) return;
                if (btn.dataset.action === 'favorite') {
                    this.toggleMusicFavorite(index);
                    return;
                }
                if (btn.dataset.action === 'delete') {
                    this.deleteMusicHistoryItem(index);
                    return;
                }
                this.openHistoryTrack(item, btn.dataset.action);
            });
        });

        setTimeout(() => this.autoSizeMusicHistory(), 0);
    },
};
