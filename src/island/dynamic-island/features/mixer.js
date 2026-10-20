/** Mixeur audio par application et choix des périphériques. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml } from '../helpers/format.js';
import { getInputDeviceIcon, getMixerIcon, getMuteIcon, getOutputDeviceIcon } from '../helpers/mixer-icons.js';

/** Nom lisible d'une application (« audiodg » = sons de Windows). */
export function sessionName(name = '') {
    const clean = name.replace(/\.exe$/i, '');
    const known = { audiodg: 'Sons système', msedge: 'Microsoft Edge' };
    return known[clean.toLowerCase()] || clean;
}

/** Titre de fenêtre utile sous le nom, ou rien (vide, ou simple répétition du nom). */
export function sessionSubtitle(session) {
    const title = (session.title || '').trim();
    if (!title) return '';
    return title.toLowerCase() === sessionName(session.name).toLowerCase() ? '' : title;
}

export const mixerMethods = {
    updateMixerScrub(e) {
        if (!this.activeMixerSlider || !this.isScrubbingMixer) return;
        
        const rect = this.activeMixerSlider.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const clickPct = Math.max(0, Math.min(100, Math.round((clickX / width) * 100)));
        
        const pid = this.scrubbingPid;
        
        // Update slider visually in real-time
        this.activeMixerSlider.value = clickPct;
        
        // Find row to update percentage badge in real-time
        const row = this.activeMixerSlider.closest('.mixer-session-row, .ic-mixer-row');
        if (row) {
            const badge = row.querySelector('.mixer-app-vol-badge, .ic-mixer-vol');
            if (badge) badge.innerText = `${clickPct}%`;
            
            const muteBtn = row.querySelector('.mixer-mute-btn, .ic-mixer-mute');
            if (muteBtn) {
                if (clickPct === 0) {
                    muteBtn.classList.add('muted');
                    muteBtn.innerHTML = `<i class="ph ${getMuteIcon(true)}"></i>`;
                    row.classList.add('muted');
                } else {
                    muteBtn.classList.remove('muted');
                    muteBtn.innerHTML = `<i class="ph ${getMuteIcon(false, clickPct)}"></i>`;
                    row.classList.remove('muted');
                }
            }
        }
        
        // Update local session state immediately so next tick doesn't snap it back
        const session = this.audioSessions.find(s => s.pid === pid);
        const wasMuted = Boolean(session?.muted);
        if (session) {
            session.volume = clickPct;
            session.muted = (clickPct === 0);
        }

        if (ipcRenderer) {
            if (wasMuted && clickPct > 0) ipcRenderer.invoke('set-session-muted', { pid, muted: false });
            // L'affichage suit chaque mouvement, mais Windows reçoit au plus un volume toutes les
            // 40 ms (le dernier) : sur un écran rapide, des centaines d'appels par seconde saccadaient.
            this._mixerSend = { pid, volume: clickPct, timer: this._mixerSend?.timer };
            this._mixerSend.timer ??= setTimeout(() => {
                const { pid: target, volume } = this._mixerSend;
                this._mixerSend.timer = null;
                ipcRenderer.invoke('set-session-volume', { pid: target, volume });
            }, 40);
        }
    },

    async toggleSessionMute(pid, mustMute) {
        const grouped = this.getGroupedSessions(this.audioSessions || []);
        const group = grouped.find(item => item.pid === pid || (Array.isArray(item.pids) && item.pids.includes(pid)));
        const pids = group && Array.isArray(group.pids) && group.pids.length > 0 ? group.pids : [pid];
        const sessions = this.audioSessions.filter(s => pids.includes(s.pid));
        if (sessions.length === 0) return;
        
        if (!this._previousSessionVolumes) {
            this._previousSessionVolumes = {};
        }
        
        let targetVolume = Math.round(group?.volume || sessions[0]?.volume || 70);
        if (mustMute) {
            for (const session of sessions) {
                this._previousSessionVolumes[session.pid] = session.volume > 0 ? session.volume : targetVolume || 70;
            }
        } else {
            targetVolume = this._previousSessionVolumes[pid] || targetVolume || 70;
        }
        
        for (const session of sessions) {
            session.muted = mustMute;
            if (!mustMute && session.volume <= 0) {
                session.volume = this._previousSessionVolumes[session.pid] || targetVolume;
            }
        }
        
        const row = this.content.querySelector(`[data-pid="${pid}"]`)?.closest('.mixer-session-row, .ic-mixer-row');
        if (row) {
            const slider = row.querySelector('.mixer-volume-slider, .ic-mixer-slider');
            const badge = row.querySelector('.mixer-app-vol-badge, .ic-mixer-vol');
            const muteBtn = row.querySelector('.mixer-mute-btn, .ic-mixer-mute');
            const visibleVolume = mustMute ? 0 : targetVolume;

            if (slider) slider.value = mustMute ? Math.round(sessions[0].volume || targetVolume) : targetVolume;
            if (badge) badge.innerText = mustMute ? 'Muet' : `${visibleVolume}%`;
            if (muteBtn) {
                if (mustMute) {
                    muteBtn.classList.add('muted');
                    muteBtn.innerHTML = `<i class="ph ${getMuteIcon(true)}"></i>`;
                    row.classList.add('muted');
                } else {
                    muteBtn.classList.remove('muted');
                    muteBtn.innerHTML = `<i class="ph ${getMuteIcon(false, visibleVolume)}"></i>`;
                    row.classList.remove('muted');
                }
            }
        }

        
        if (!ipcRenderer) return;

        try {
            await Promise.all(pids.map(targetPid => ipcRenderer.invoke('set-session-muted', { pid: targetPid, muted: mustMute })));
            if (!mustMute && targetVolume > 0) {
                await Promise.all(pids.map(targetPid => ipcRenderer.invoke('set-session-volume', { pid: targetPid, volume: targetVolume })));
            }
        } catch (e) {
            console.error('Error toggling session mute:', e);
            this.updateAudioSessions();
        }
    },

    async toggleAudioDeviceDropdown() {
        this.isAudioDeviceDropdownOpen = !this.isAudioDeviceDropdownOpen;
        const dropdown = this.content.querySelector('#audio-device-dropdown');
        if (this.isAudioDeviceDropdownOpen) {
            this.isMicDeviceDropdownOpen = false;
            const micDropdown = this.content.querySelector('#mic-device-dropdown');
            if (micDropdown) micDropdown.classList.remove('show');
            const micBtn = this.content.querySelector('.mic-select-btn');
            if (micBtn) micBtn.classList.remove('active');

            await this.loadAudioDevices();
            if (dropdown) dropdown.classList.add('show');
            const outBtn = this.content.querySelector('.device-select-btn');
            if (outBtn) outBtn.classList.add('active');
            this.autoSizeMixer();
        } else {
            if (dropdown) dropdown.classList.remove('show');
            const outBtn = this.content.querySelector('.device-select-btn');
            if (outBtn) outBtn.classList.remove('active');
            this.autoSizeMixer();
        }
    },

    async toggleMicDeviceDropdown() {
        this.isMicDeviceDropdownOpen = !this.isMicDeviceDropdownOpen;
        const dropdown = this.content.querySelector('#mic-device-dropdown');
        if (this.isMicDeviceDropdownOpen) {
            this.isAudioDeviceDropdownOpen = false;
            const audioDropdown = this.content.querySelector('#audio-device-dropdown');
            if (audioDropdown) audioDropdown.classList.remove('show');
            const outBtn = this.content.querySelector('.device-select-btn');
            if (outBtn) outBtn.classList.remove('active');

            await this.loadAudioInputDevices();
            if (dropdown) dropdown.classList.add('show');
            const micBtn = this.content.querySelector('.mic-select-btn');
            if (micBtn) micBtn.classList.add('active');
            this.autoSizeMixer();
        } else {
            if (dropdown) dropdown.classList.remove('show');
            const micBtn = this.content.querySelector('.mic-select-btn');
            if (micBtn) micBtn.classList.remove('active');
            this.autoSizeMixer();
        }
    },

    async loadAudioDevices(force = false) {
        if (!ipcRenderer) return;
        try {
            if (!force && this.audioDevices && this.audioDevices.length > 0) {
                this.renderAudioDevicesInDropdown();
                return;
            }
            const devices = await ipcRenderer.invoke('get-audio-devices');
            if (devices) {
                this.audioDevices = devices;
                this.renderAudioDevicesInDropdown();
            }
        } catch (e) {
            console.error('Error loading audio devices:', e);
        }
    },

    async loadAudioInputDevices(force = false) {
        if (!ipcRenderer) return;
        try {
            if (!force && this.audioInputDevices && this.audioInputDevices.length > 0) {
                this.renderMicDevicesInDropdown();
                return;
            }
            const devices = await ipcRenderer.invoke('get-audio-input-devices');
            if (devices) {
                this.audioInputDevices = devices;
                this.renderMicDevicesInDropdown();
            }
        } catch (e) {
            console.error('Error loading audio input devices:', e);
        }
    },

    renderAudioDevicesInDropdown() {
        const devices = this.audioDevices || [];
        const activeDevice = devices.find(d => d.isDefault);
        
        // Update header icon
        const btnIcon = this.content.querySelector('.device-select-btn i');
        if (btnIcon) btnIcon.className = `ph ${getOutputDeviceIcon(activeDevice?.name)}`;
        const btnName = this.content.querySelector('.device-select-btn span');
        if (btnName) btnName.textContent = activeDevice?.name || 'Sortie par défaut';

        // Render items list
        const listContainer = this.content.querySelector('.audio-device-list-container');
        if (listContainer) {
            listContainer.innerHTML = devices.map(d => {
                const icon = getOutputDeviceIcon(d.name);

                const activeClass = d.isDefault ? 'active' : '';
                return `
                    <div class="audio-device-item ${activeClass}" data-island-action="selectAudioDevice" data-arg="${escapeHtml(d.id)}">
                        <span class="audio-device-icon"><i class="ph ${icon}"></i></span>
                        <span class="device-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                        <span class="device-active-dot"></span>
                    </div>
                `;
            }).join('');
        }

        // Ajuste la hauteur quand la liste sortie change
        this.autoSizeMixer();
    },

     async selectAudioDevice(deviceId) {
        if (!ipcRenderer) return;
        try {
            const success = await ipcRenderer.invoke('set-default-audio-device', deviceId);
            if (success) {
                const device = this.audioDevices.find(d => d.id === deviceId);
                const name = device ? device.name : 'Périphérique audio';
                this.showIslandFeedback(`Sortie : ${name}`, 'ph-speaker-high');
                
                await this.loadAudioDevices(true);
                
                setTimeout(() => {
                    if (this.isAudioDeviceDropdownOpen) {
                        this.toggleAudioDeviceDropdown();
                    }
                }, 300);
            } else {
                this.showIslandFeedback('Erreur de changement', 'ph-warning');
            }
        } catch (e) {
            console.error('Error setting audio device:', e);
            this.showIslandFeedback('Erreur', 'ph-warning');
        }
    },

    renderMicDevicesInDropdown() {
        const devices = this.audioInputDevices || [];
        const listContainer = this.content.querySelector('.mic-device-list-container');
        if (listContainer) {
            listContainer.innerHTML = devices.map(d => {
                const icon = getInputDeviceIcon(d.name);

                const activeClass = d.isDefault ? 'active' : '';
                return `
                    <div class="audio-device-item ${activeClass}" data-island-action="selectMicDevice" data-arg="${escapeHtml(d.id)}">
                        <span class="audio-device-icon"><i class="ph ${icon}"></i></span>
                        <span class="device-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                        <span class="device-active-dot"></span>
                    </div>
                `;
            }).join('');
        }

        // Ajuste la hauteur quand la liste micro change
        this.autoSizeMixer();
    },

    autoSizeMixer() {
        if (!this.isExpanded || this.mode !== 'mixer') return;

        const container = this.content?.querySelector?.('.mixer-container');
        if (!container) return;

        const header = container.querySelector('.mixer-header');
        const body = container.querySelector('.mixer-body-wrapper');
        if (!header || !body) return;

        const px = (v) => {
            const n = parseFloat(v || '0');
            return Number.isFinite(n) ? n : 0;
        };

        const padTop = px(getComputedStyle(container).paddingTop);
        const padBottom = px(getComputedStyle(container).paddingBottom);
        const headerMb = px(getComputedStyle(header).marginBottom);
        const headerH = header.getBoundingClientRect().height || 0;

        let bodyTarget = 140; // fallback safe

        // 1) Dropdown devices (sortie / entrée)
        if (this.isAudioDeviceDropdownOpen || this.isMicDeviceDropdownOpen) {
            const dropdown = this.content.querySelector(this.isAudioDeviceDropdownOpen ? '#audio-device-dropdown' : '#mic-device-dropdown');
            if (dropdown) {
                const ddHeader = dropdown.querySelector('.audio-device-dropdown-header');
                const list = dropdown.querySelector('.audio-device-list-container');
                const items = list ? Array.from(list.querySelectorAll('.audio-device-item')) : [];

                const ddHeaderH = ddHeader ? ddHeader.getBoundingClientRect().height : 0;
                const ddHeaderMb = ddHeader ? px(getComputedStyle(ddHeader).marginBottom) : 0;

                const itemH = items[0]?.getBoundingClientRect?.().height || 54;
                const itemMb = items[0] ? px(getComputedStyle(items[0]).marginBottom) : 8;
                const count = items.length;
                const maxVisible = 8; // évite une fenêtre gigantesque si beaucoup de périphériques
                const visible = Math.max(1, Math.min(count || 1, maxVisible));

                const listH = count === 0 ? 110 : (visible * itemH) + ((visible - 1) * itemMb);
                bodyTarget = ddHeaderH + ddHeaderMb + listH;
            }
        } else {
            // 2) Liste des sessions (mélangeur)
            const list = body.querySelector('.mixer-sessions-list');
            const rows = list ? Array.from(list.querySelectorAll('.mixer-session-row')) : [];
            const empty = list ? list.querySelector('.mixer-empty-state') : null;

            if (empty) {
                bodyTarget = empty.getBoundingClientRect().height || 120;
            } else {
                const rowH = rows[0]?.getBoundingClientRect?.().height || 62;
                const count = rows.length;
                const maxVisible = 5; // ton besoin: hauteur = nb de flux, jusqu'à 5
                const visible = Math.max(1, Math.min(count || 1, maxVisible));
                bodyTarget = visible * rowH;
            }
        }

        // 3) Total height = padding + header + body + micro marge de sécurité
        let target = padTop + padBottom + headerH + headerMb + bodyTarget + 6;

        // Gardes-fous (évite un truc trop petit ou trop grand)
        const minH = 260;
        const maxH = 520;
        target = Math.max(minH, Math.min(maxH, target));

        this.el.style.height = `${Math.round(target)}px`;
    },

    async selectMicDevice(deviceId) {
        if (!ipcRenderer) return;
        try {
            const success = await ipcRenderer.invoke('set-default-audio-device', deviceId);
            if (success) {
                const device = this.audioInputDevices.find(d => d.id === deviceId);
                const name = device ? device.name : 'Microphone';
                this.showIslandFeedback(`Micro : ${name}`, 'ph-microphone');
                
                await this.loadAudioInputDevices(true);
                
                setTimeout(() => {
                    if (this.isMicDeviceDropdownOpen) {
                        this.toggleMicDeviceDropdown();
                    }
                }, 300);
            } else {
                this.showIslandFeedback('Erreur de changement', 'ph-warning');
            }
        } catch (e) {
            console.error('Error setting mic device:', e);
            this.showIslandFeedback('Erreur', 'ph-warning');
        }
    },

    renderMixer() {
        const grouped = this.getGroupedSessions(this.audioSessions || []);
        
        let listHtml = '';
        if (grouped.length === 0) {
            listHtml = `
                <div class="mixer-empty-state">
                    <i class="ph ph-speaker-none"></i>
                    <span>Aucun flux audio détecté</span>
                </div>
            `;
        } else {
            listHtml = grouped.map(s => {
                const icon = s.icon || getMixerIcon(s.name, s.title);
                const isMuted = s.volume === 0 || s.muted;
                const activeVol = isMuted ? 0 : Math.round(s.volume);
                const sliderVol = Math.round(s.volume);

                let iconHtml = '';
                if (icon) {
                    iconHtml = `
                        <img src="${escapeHtml(icon)}" class="mixer-app-icon-img" alt="${escapeHtml(s.name)}" data-fallback="next">
                        <i class="ph ph-music-note mixer-app-icon-fallback" style="display: none;"></i>
                    `;
                } else {
                    iconHtml = `<i class="ph ph-music-note mixer-app-icon-fallback"></i>`;
                }
                
                const muteIcon = getMuteIcon(isMuted, activeVol);
                const rowMutedClass = isMuted ? 'muted' : '';
                const btnMutedClass = isMuted ? 'muted' : '';
                
                const cleanName = sessionName(s.name);
                const displayTitle = sessionSubtitle(s);

                return `
                    <div class="mixer-session-row ${rowMutedClass}">
                        <div class="mixer-app-icon-wrapper">
                            ${iconHtml}
                        </div>
                        <div class="mixer-details">
                            <div class="mixer-app-name-row">
                                <span class="mixer-app-name">${escapeHtml(cleanName)}</span>
                                <span class="mixer-app-vol-badge">${isMuted ? 'Muet' : `${activeVol}%`}</span>
                            </div>
                            ${displayTitle ? `<span class="mixer-title-text" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</span>` : ''}
                            <div class="mixer-slider-wrapper">
                                <input type="range" class="mixer-volume-slider" data-pid="${s.pid}" min="0" max="100" value="${sliderVol}" aria-label="Volume de ${escapeHtml(cleanName)}">
                            </div>
                        </div>
                        <button class="mixer-mute-btn ${btnMutedClass}" data-pid="${s.pid}" title="${isMuted ? 'Réactiver le son' : 'Couper le son'}" aria-label="${isMuted ? 'Réactiver le son' : 'Couper le son'}">
                            <i class="ph ${muteIcon}"></i>
                        </button>
                    </div>
                `;
            }).join('');
        }

        // Determine active device icon for header
        const activeDevice = this.audioDevices?.find(d => d.isDefault);
        const headerIcon = getOutputDeviceIcon(activeDevice?.name);

        if (!this.audioDevices || this.audioDevices.length === 0) {
            this.loadAudioDevices(false);
        }
        if (!this.audioInputDevices || this.audioInputDevices.length === 0) {
            this.loadAudioInputDevices(false);
        }

        const activeOutBtnClass = this.isAudioDeviceDropdownOpen ? 'active' : '';
        const activeMicBtnClass = this.isMicDeviceDropdownOpen ? 'active' : '';

        this.content.innerHTML = `
            <div class="mixer-container">
                <div class="mixer-header">
                    <div class="mixer-heading">
                        <span class="mixer-title"><i class="ph ph-sliders"></i> Mélangeur</span>
                        <button type="button" class="mixer-output-btn device-select-btn ${activeOutBtnClass}" data-island-action="toggleAudioDeviceDropdown" title="Changer la sortie audio">
                            <i class="ph ${headerIcon}"></i><span>${escapeHtml(activeDevice?.name || 'Sortie par défaut')}</span><i class="ph-bold ph-caret-down"></i>
                        </button>
                    </div>
                    <div class="music-action-cluster">
                        <button class="island-action-btn mic-select-btn ${activeMicBtnClass}" data-island-action="toggleMicDeviceDropdown" title="Changer de micro">
                            <i class="ph ph-microphone"></i>
                        </button>
                        <button class="island-action-btn menu-btn" data-island-action="setMode" data-arg="menu" title="Menu des modules">
                            <i class="ph-bold ph-squares-four"></i>
                        </button>
                    </div>
                </div>
                <div class="mixer-body-wrapper" style="position: relative; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div class="mixer-sessions-list">
                        ${listHtml}
                    </div>
                    
                    <div class="audio-device-dropdown" id="audio-device-dropdown">
                        <div class="audio-device-dropdown-header">
                            <span class="audio-device-dropdown-title">Sortie audio</span>
                            <button class="audio-device-dropdown-close" title="Fermer" aria-label="Fermer" data-island-action="toggleAudioDeviceDropdown">
                                <i class="ph ph-x"></i>
                            </button>
                        </div>
                        <div class="audio-device-list-container">
                            <!-- Populated dynamically -->
                        </div>
                    </div>

                    <div class="audio-device-dropdown" id="mic-device-dropdown">
                        <div class="audio-device-dropdown-header">
                            <span class="audio-device-dropdown-title">Micro</span>
                            <button class="audio-device-dropdown-close" title="Fermer" aria-label="Fermer" data-island-action="toggleMicDeviceDropdown">
                                <i class="ph ph-x"></i>
                            </button>
                        </div>
                        <div class="audio-device-list-container mic-device-list-container">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (this.isAudioDeviceDropdownOpen) {
            const dropdown = this.content.querySelector('#audio-device-dropdown');
            if (dropdown) dropdown.classList.add('show');
            this.renderAudioDevicesInDropdown();
        }

        if (this.isMicDeviceDropdownOpen) {
            const dropdown = this.content.querySelector('#mic-device-dropdown');
            if (dropdown) dropdown.classList.add('show');
            this.renderMicDevicesInDropdown();
        }

        // Ajuste la hauteur après rendu (mixer / dropdowns)
        setTimeout(() => this.autoSizeMixer(), 0);
    },

    updateMixerUI(sessions) {
        if (this.isScrubbingMixer) return;
        
        const listContainer = this.content.querySelector('.mixer-sessions-list');
        if (!listContainer) return;
        
        const existingRows = listContainer.querySelectorAll('.mixer-session-row');
        if (existingRows.length !== sessions.length) {
            this.renderMixer();
            return;
        }
        
        sessions.forEach((s, idx) => {
            const row = existingRows[idx];
            if (!row) return;
            
            const slider = row.querySelector('.mixer-volume-slider');
            const badge = row.querySelector('.mixer-app-vol-badge');
            const title = row.querySelector('.mixer-title-text');
            const muteBtn = row.querySelector('.mixer-mute-btn');
            
            const isMuted = s.volume === 0 || s.muted;
            const activeVol = isMuted ? 0 : Math.round(s.volume);

            if (slider && parseInt(slider.value) !== Math.round(s.volume)) {
                slider.value = Math.round(s.volume);
            }
            if (badge) {
                badge.innerText = isMuted ? 'Muet' : `${activeVol}%`;
            }
            if (title) {
                const displayTitle = sessionSubtitle(s);
                if (title.innerText !== displayTitle) {
                    title.innerText = displayTitle;
                    title.title = displayTitle;
                    title.hidden = !displayTitle;
                }
            }
            
            if (muteBtn) {
                const muteIcon = getMuteIcon(isMuted, activeVol);
                muteBtn.className = `mixer-mute-btn ${isMuted ? 'muted' : ''}`;
                muteBtn.innerHTML = `<i class="ph ${muteIcon}"></i>`;
            }
            
            row.className = `mixer-session-row ${isMuted ? 'muted' : ''}`;
        });

        // Si le nombre de lignes change (ou au 1er rendu), recalcul de la hauteur
        if (this._lastMixerRowCount !== sessions.length) {
            this._lastMixerRowCount = sessions.length;
            this.autoSizeMixer();
        }
    },

    updateCompactMixerUI(sessions) {
        const card = this.content.querySelector('.ic-mixer-card');
        if (!card) return;
        
        const rows = card.querySelectorAll('.ic-mixer-row');
        sessions.slice(0, 3).forEach((s, idx) => {
            const row = rows[idx];
            if (!row) return;
            
            const slider = row.querySelector('.ic-mixer-slider');
            const volText = row.querySelector('.ic-mixer-vol');
            const muteIcon = row.querySelector('.ic-mixer-mute');
            
            const isMuted = s.volume === 0 || s.muted;
            const activeVol = isMuted ? 0 : Math.round(s.volume);
            
            if (slider && !this.isScrubbingMixer) {
                slider.value = activeVol;
            }
            if (volText) {
                volText.innerText = `${activeVol}%`;
            }
            if (muteIcon) {
                muteIcon.className = `ic-mixer-mute ${isMuted ? 'muted' : ''}`;
                muteIcon.innerHTML = `<i class="ph ${getMuteIcon(isMuted, activeVol)}"></i>`;
            }
        });
    },
};
