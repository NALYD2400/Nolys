/** Historique et favoris musicaux. */
import { SoundService } from '../../../services/SoundService.js';
import { native } from '../../../shared/ipc.js';
import { mountHistory } from '../../../library/history.js';
import { afterIntro, capsuleSettled } from '../views/library.js';
import { getEffectiveMediaArt } from '../helpers/media-art.js';
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
            localTrackId: data.localTrackId || '',
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
            this._historyController?.refresh();
            return;
        }

        const existing = this.musicHistory.filter(track => track.key !== key);
        this.musicHistory = [item, ...existing].slice(0, 20);
        this.saveMusicHistory();
        this._historyController?.refresh();
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
        if (item.localTrackId) {
            if (mode === 'search') this.setMode('library');
            else this.localPlayer?.control({ type: 'play', id: item.localTrackId }).catch(error => this.showNotification('Bibliothèque', String(error?.message || error), 'ph-warning-circle'));
            return;
        }
        const query = this.getHistoryQuery(item);
        const provider = this.getProviderFromHistoryItem(item);

        if (mode === 'replay' && this.isCurrentHistoryItem(item)) {
            SoundService.play('success');
            window.spotifyControl('seek 0');
            window.spotifyControl('play');
            this.returnToMusicIdle();
            this.showIslandFeedback('Reprise au début', 'ph-repeat');
            return;
        }

        if (mode === 'search') {
            this.openMusicSearchPanel(query, provider);
            return;
        }

        this.openMusicSearch(query, provider);
    },

    /** Favori d'un titre local = favori de la Bibliothèque ; sinon, favori propre à l'historique. */
    isHistoryFavorite(item) {
        const track = item.localTrackId && this.localPlayer?.library.tracks.find(t => t.id === item.localTrackId);
        return track ? track.favorite === true : item.favorite === true;
    },

    async toggleHistoryFavorite(item) {
        const track = item.localTrackId && this.localPlayer?.library.tracks.find(t => t.id === item.localTrackId);
        if (track) {
            await native.invoke('library_mutate', { mutation: { type: 'favorite', id: track.id, value: !track.favorite } });
            await this.localPlayer.reload();
        } else {
            this.musicHistory = this.loadMusicHistory();
            const stored = this.musicHistory.find(entry => entry.key === item.key);
            if (!stored) return;
            stored.favorite = !stored.favorite;
            this.saveMusicHistory();
        }
        SoundService.play(this.isHistoryFavorite(item) ? 'success' : 'close');
    },

    removeHistoryItem(key) {
        this.musicHistory = this.loadMusicHistory().filter(item => item.key !== key);
        this.saveMusicHistory();
        SoundService.play('close');
    },

    /** Vide l'historique en gardant les favoris. */
    clearMusicHistory() {
        this.musicHistory = this.loadMusicHistory().filter(item => this.isHistoryFavorite(item));
        this.saveMusicHistory();
        SoundService.play('close');
    },

    isCurrentMusicFavorite() {
        const data = this.musicData || {};
        if (data.localTrackId) return this.localPlayer?.current?.favorite === true;
        if (!isHistoryTrack(data)) return false;

        const key = getMusicHistoryKey(data);
        return this.loadMusicHistory().some(item => item.key === key && item.favorite === true);
    },

    async toggleCurrentMusicFavorite() {
        const data = this.musicData || {};
        if (data.localTrackId && this.localPlayer) {
            try {
                await native.invoke('library_mutate', { mutation: { type: 'favorite', id: data.localTrackId, value: !this.isCurrentMusicFavorite() } });
                await this.localPlayer.reload();
                if (this.isExpanded && this.mode === 'music') this.renderMusic();
            } catch (error) { this.showNotification('Bibliothèque', String(error?.message || error), 'ph-warning-circle'); }
            return;
        }
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
        this.showIslandFeedback(item.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'ph-star');

        if (this.isExpanded && this.mode === 'music') this.renderMusic();
        this._historyController?.refresh();
    },

    /** Ce que la vue Historique lit et modifie (src/library/history.js). */
    historyStore() {
        return {
            items: () => (this.musicHistory = this.loadMusicHistory()),
            isFavorite: item => this.isHistoryFavorite(item),
            toggleFavorite: item => this.toggleHistoryFavorite(item),
            remove: item => this.removeHistoryItem(item.key),
            clear: () => this.clearMusicHistory(),
            isCurrent: item => this.isCurrentHistoryItem(item),
            isPlaying: () => Boolean(this.musicData?.isPlaying ?? this.isPlaying),
            provider: item => this.getProviderFromHistoryItem(item),
            open: (item, mode) => this.openHistoryTrack(item, mode),
        };
    },

    renderMusicHistory() {
        this._vizCanvas = null;
        if (this._historyHost?.isConnected) {
            this._historyController.refresh();
            this.syncGlassControls();
            return;
        }
        // Le contenu a été vidé pendant une transition : on repart d'une vue propre.
        this.leaveMusicHistory();
        const host = document.createElement('div');
        host.className = 'island-library-view';
        this.content.replaceChildren(host);
        this._historyHost = host;
        const settled = capsuleSettled(this.el);
        this._historyController = mountHistory(host, {
            store: this.historyStore(),
            ready: settled,
            savedState: this._historySavedState || { filter: localStorage.getItem('liquid_music_history_filter') || 'all' },
            onBack: () => this.setMode('music'),
            onClose: () => this.collapseIsland(),
        });
        settled.then(() => afterIntro(() => { if (this._historyHost === host) this.syncGlassControls(); }));
    },

    leaveMusicHistory() {
        if (!this._historyController) return;
        this._historySavedState = this._historyController.savedState;
        try { localStorage.setItem('liquid_music_history_filter', this._historySavedState.filter); } catch { /* stockage plein : filtre non retenu */ }
        this._historyController.destroy();
        this._historyController = null;
        this._historyHost = null;
    },
};
