/** Volume système et volume de l’application en cours de lecture. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml } from '../helpers/format.js';
import { getMusicSearchProvider, isHistoryTrack } from '../helpers/music-search.js';

export const volumeMethods = {
    async adjustVolume(delta) {
        if (ipcRenderer) {
            try {
                let current = await ipcRenderer.invoke('get-system-volume') || 50;
                let next = Math.min(100, Math.max(0, current + delta));
                await ipcRenderer.invoke('set-system-volume', next);
                this.showVolumeIndicator(next);
            } catch (e) { }
        }
    },

    showVolumeIndicator(vol) {
        if (this._volTimeout) clearTimeout(this._volTimeout);

        const existing = this.el.querySelector('.volume-indicator-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'volume-indicator-toast';
        const icon = vol === 0 ? 'ph-speaker-slash' : (vol < 50 ? 'ph-speaker-low' : 'ph-speaker-high');
        toast.innerHTML = `<i class="ph ${icon}"></i> <span>${vol}%</span>`;

        this.el.appendChild(toast);

        this._volTimeout = setTimeout(() => {
            toast.style.transition = 'opacity 0.3s, transform 0.3s';
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -50%) scale(0.9)';
            setTimeout(() => toast.remove(), 300);
            this._volTimeout = null;
        }, 1200);
    },

    showIslandFeedback(message, icon = 'ph-check') {
        if (this._feedbackTimeout) clearTimeout(this._feedbackTimeout);

        const existing = this.el.querySelector('.island-feedback-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'island-feedback-toast';
        toast.innerHTML = `<i class="ph ${icon}"></i><span>${escapeHtml(message)}</span>`;
        this.el.appendChild(toast);

        this._feedbackTimeout = setTimeout(() => {
            toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -50%) scale(0.94)';
            setTimeout(() => toast.remove(), 260);
            this._feedbackTimeout = null;
        }, 1100);
    },

    getGroupedSessions(sessions) {
        const groups = {};
        for (const s of sessions) {
            let cleanName = s.name.replace('.exe', '');
            if (cleanName.toLowerCase() === 'audiodg') cleanName = 'Sons système';
            if (cleanName.toLowerCase() === 'msedge') cleanName = 'Microsoft Edge';
            
            const key = cleanName.toLowerCase();
            if (!groups[key]) {
                groups[key] = {
                    pid: s.pid,
                    name: s.name,
                    cleanName: cleanName,
                    pids: [s.pid],
                    volume: s.volume,
                    muted: s.muted,
                    title: s.title,
                    icon: s.icon || ''
                };
            } else {
                groups[key].pids.push(s.pid);
                groups[key].volume = Math.max(groups[key].volume, s.volume);
                groups[key].muted = groups[key].muted && s.muted;
                if (s.title && s.title.trim().length > 0 && (!groups[key].title || groups[key].title.trim().length === 0)) {
                    groups[key].title = s.title;
                }
                if (s.icon && !groups[key].icon) {
                    groups[key].icon = s.icon;
                }
            }
        }
        return Object.values(groups);
    },

    normalizeAudioMatchText(value) {
        return String(value || '')
            .toLowerCase()
            .replace('.exe', '')
            .replace('microsoft.', '')
            .replace(/[^a-z0-9]+/g, '');
    },

    isBrowserAudioToken(token) {
        const normalized = this.normalizeAudioMatchText(token);
        return ['chrome', 'googlechrome', 'msedge', 'microsoftedge', 'edge', 'firefox', 'brave', 'opera', 'operagx', 'arc'].some(browser => normalized.includes(browser));
    },

    isWebMediaServiceToken(token) {
        const normalized = this.normalizeAudioMatchText(token);
        return [
            'youtube',
            'youtubemusic',
            'netflix',
            'spotify',
            'deezer',
            'soundcloud',
            'disney',
            'disneyplus',
            'crunchyroll',
            'primevideo',
            'amazonprime',
            'amazonmusic',
            'tidal'
        ].some(service => normalized.includes(service));
    },

    getCurrentMediaSessionGroup(grouped = this.getGroupedSessions(this.audioSessions || [])) {
        const data = this.musicData || {};
        const appToken = this.normalizeAudioMatchText(data.appId);
        const titleText = String(data.title || '').trim().toLowerCase();
        const artistText = String(data.artist || '').trim().toLowerCase();
        const titleToken = this.normalizeAudioMatchText(data.title);
        const artistToken = this.normalizeAudioMatchText(data.artist);
        const provider = getMusicSearchProvider(data);
        const providerToken = this.normalizeAudioMatchText(provider.label);
        const shouldFallbackToBrowser = this.isBrowserAudioToken(appToken) || this.isWebMediaServiceToken(appToken) || this.isWebMediaServiceToken(providerToken);

        if (!appToken && !titleText && !artistText) return null;

        let best = null;
        let bestScore = 0;

        for (const group of grouped) {
            const groupName = this.normalizeAudioMatchText(group.name || group.cleanName);
            const groupTitle = String(group.title || '').trim().toLowerCase();
            const groupTitleToken = this.normalizeAudioMatchText(group.title);
            const isSystem = groupName.includes('audiodg') || groupName.includes('systemsounds');
            if (isSystem) continue;

            let score = 0;

            if (appToken) {
                if (groupName === appToken || groupName.includes(appToken) || appToken.includes(groupName)) score += 90;
                if (appToken.includes('msedge') && groupName.includes('microsoftedge')) score += 90;
                if (appToken.includes('chrome') && groupName.includes('chrome')) score += 90;
                if (appToken.includes('firefox') && groupName.includes('firefox')) score += 90;
                if (appToken.includes('spotify') && groupName.includes('spotify')) score += 90;
            }

            if (shouldFallbackToBrowser && this.isBrowserAudioToken(groupName)) {
                score += this.isBrowserAudioToken(appToken) ? 90 : 65;
                if (groupTitleToken.includes('youtube') || groupTitleToken.includes('netflix') || groupTitleToken.includes('spotify')) score += 15;
            }

            if (providerToken && providerToken !== 'webmusique') {
                if (groupName.includes(providerToken) || groupTitle.includes(provider.label.toLowerCase()) || groupTitleToken.includes(providerToken)) score += 35;
            }

            if (titleText.length > 3 && groupTitle.includes(titleText.slice(0, 24))) score += 25;
            if (artistText.length > 3 && groupTitle.includes(artistText.slice(0, 24))) score += 15;
            if (titleToken.length > 3 && groupTitleToken.includes(titleToken.slice(0, 24))) score += 25;
            if (artistToken.length > 3 && groupTitleToken.includes(artistToken.slice(0, 24))) score += 15;

            if (score > bestScore) {
                bestScore = score;
                best = group;
            }
        }

        if (!best && grouped.length === 1 && isHistoryTrack(data)) {
            const onlyGroup = grouped[0];
            const onlyName = this.normalizeAudioMatchText(onlyGroup.name || onlyGroup.cleanName);
            if (!onlyName.includes('audiodg') && !onlyName.includes('systemsounds')) {
                best = onlyGroup;
            }
        }

        return bestScore >= 20 || best ? best : null;
    },

    bindCurrentMediaVolumeControls() {
        const card = this.content.querySelector('#current-app-volume-card');
        const slider = this.content.querySelector('#current-app-volume-slider');
        if (!card || !slider) return;

        const stop = (e) => e.stopPropagation();
        card.addEventListener('mousedown', stop);
        card.addEventListener('click', stop);
        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            const volume = Math.max(0, Math.min(100, Number(e.target.value)));
            this.setCurrentMediaVolume(volume);
        });
    },

    updateCurrentMediaVolumeUI(grouped = this.getGroupedSessions(this.audioSessions || [])) {
        const card = this.content.querySelector('#current-app-volume-card');
        const slider = this.content.querySelector('#current-app-volume-slider');
        const valueEl = this.content.querySelector('#current-app-volume-value');
        const nameEl = this.content.querySelector('#current-app-volume-name');
        const iconEl = this.content.querySelector('#current-app-volume-icon');
        if (!card || !slider || !valueEl || !nameEl || !iconEl) return;

        const group = this.getCurrentMediaSessionGroup(grouped);
        this.currentMediaVolumeGroup = group;

        if (!group) {
            card.classList.add('is-disabled');
            card.classList.remove('is-loading');
            slider.disabled = true;
            slider.value = 0;
            slider.style.setProperty('--volume-pct', '0%');
            valueEl.innerText = '--';
            nameEl.innerText = 'App introuvable';
            iconEl.className = 'ph ph-speaker-none';
            return;
        }

        const isMuted = group.volume === 0 || group.muted;
        const activeVol = isMuted ? 0 : Math.round(group.volume);
        const cleanName = group.cleanName || String(group.name || '').replace('.exe', '') || 'App';
        const icon = activeVol === 0 ? 'ph-speaker-slash' : (activeVol < 50 ? 'ph-speaker-low' : 'ph-speaker-high');

        card.classList.remove('is-disabled', 'is-loading');
        slider.disabled = false;
        slider.value = activeVol;
        slider.style.setProperty('--volume-pct', `${activeVol}%`);
        valueEl.innerText = `${activeVol}%`;
        nameEl.innerText = cleanName;
        iconEl.className = `ph ${icon}`;
    },

    async setCurrentMediaVolume(volume) {
        const group = this.currentMediaVolumeGroup || this.getCurrentMediaSessionGroup();
        if (!group) return;

        const targetVolume = Math.max(0, Math.min(100, Math.round(volume)));
        const pids = Array.isArray(group.pids) && group.pids.length > 0 ? group.pids : [group.pid];

        group.volume = targetVolume;
        group.muted = targetVolume === 0;
        for (const session of this.audioSessions) {
            if (pids.includes(session.pid)) {
                session.volume = targetVolume;
                session.muted = targetVolume === 0;
            }
        }

        this.updateCurrentMediaVolumeUI(this.getGroupedSessions(this.audioSessions || []));

        
        if (!ipcRenderer) return;

        for (const pid of pids) {
            ipcRenderer.invoke('set-session-volume', { pid, volume: targetVolume }).catch(() => {});
        }
    },

    async updateAudioSessions() {
        try {
            
            if (!ipcRenderer) return;

            const sessions = await ipcRenderer.invoke('get-audio-sessions');
            if (sessions) {
                this.audioSessions = sessions;
                const grouped = this.getGroupedSessions(sessions);
                
                if (this.isExpanded && this.mode === 'mixer') {
                    this.updateMixerUI(grouped);
                } else if (this.isExpanded && this.mode === 'music') {
                    this.currentMediaVolumeGroup = this.getCurrentMediaSessionGroup(grouped);
                } else if (this.isExpanded && this.mode === 'control') {
                    const widgetType = localStorage.getItem('liquid_control_widget_type') || 'launchpad';
                    if (widgetType === 'mixer') {
                        this.updateCompactMixerUI(grouped);
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching sessions:', e);
        }
    },

    async refreshCurrentMediaVolumeSession() {
        
        if (!ipcRenderer) return null;

        try {
            const sessions = await ipcRenderer.invoke('get-audio-sessions');
            this.audioSessions = Array.isArray(sessions) ? sessions : [];
            const grouped = this.getGroupedSessions(this.audioSessions);
            this.currentMediaVolumeGroup = this.getCurrentMediaSessionGroup(grouped);
            return this.currentMediaVolumeGroup;
        } catch (e) {
            return null;
        }
    },

    async adjustCurrentMediaVolume(delta) {
        if (this.localPlayer?.active) {
            const volume = Math.max(0, Math.min(1, this.localPlayer.audio.volume + delta / 100));
            await this.localPlayer.control({ type: 'volume', value: volume });
            this.showAppVolumeIndicator('Bibliothèque Nolys', Math.round(volume * 100));
            return;
        }
        let group = this.getCurrentMediaSessionGroup();
        if (!group) {
            group = await this.refreshCurrentMediaVolumeSession();
        }

        if (!group) {
            this.showIslandFeedback('Volume app introuvable', 'ph-speaker-none');
            return;
        }

        this.currentMediaVolumeGroup = group;
        const currentVolume = group.muted || group.volume === 0 ? 0 : Math.round(group.volume || 0);
        const nextVolume = Math.max(0, Math.min(100, currentVolume + delta));
        await this.setCurrentMediaVolume(nextVolume);
        this.showAppVolumeIndicator(group.cleanName || String(group.name || 'App').replace('.exe', ''), nextVolume);
    },

    showAppVolumeIndicator(appName, volume) {
        if (this._appVolTimeout) clearTimeout(this._appVolTimeout);

        const existing = this.el.querySelector('.app-volume-toast');
        if (existing) existing.remove();

        const icon = volume === 0 ? 'ph-speaker-slash' : (volume < 50 ? 'ph-speaker-low' : 'ph-speaker-high');
        const toast = document.createElement('div');
        toast.className = 'app-volume-toast';
        toast.innerHTML = `
            <i class="ph ${icon}"></i>
            <span>${escapeHtml(appName)}</span>
            <strong>${Math.round(volume)}%</strong>
        `;

        this.el.appendChild(toast);

        this._appVolTimeout = setTimeout(() => {
            toast.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -50%) scale(0.95)';
            setTimeout(() => toast.remove(), 240);
            this._appVolTimeout = null;
        }, 850);
    },
};
