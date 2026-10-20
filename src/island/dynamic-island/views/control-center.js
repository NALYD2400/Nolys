/** Centre de contrôle (tuiles, curseurs, widgets). */
import { ipcRenderer } from '../../../shared/ipc.js';
import { SoundService } from '../../../services/SoundService.js';
import { escapeHtml } from '../helpers/format.js';
import { APP_LOGO_ART, getDisplayMediaArt } from '../helpers/media-art.js';
import { getMixerIcon, getMuteIcon } from '../helpers/mixer-icons.js';
import { getMusicHistoryKey } from '../helpers/music-search.js';

export const controlCenterView = {
    renderControl() {
        let wifiEnabled = localStorage.getItem('liquid_wifi_enabled') !== 'false';
        let btEnabled = localStorage.getItem('liquid_bluetooth_enabled') !== 'false';
        let dndEnabled = localStorage.getItem('liquid_dnd_enabled') === 'true';
        const isEcoMode = localStorage.getItem('liquid_eco_mode') === 'true';
        const isFocusMode = localStorage.getItem('liquid_focus_mode') === 'true';

        // 1. Synchronously render UI with cached/default states immediately
        let sysVol = 70; // Will be updated asynchronously
        
        // CPU / RAM / disque réels lus par le cœur natif (dernières valeurs connues en attendant).
        const getSystemStats = async () => {
            try {
                const live = await ipcRenderer.invoke('get-system-stats');
                if (live) this._systemStats = live;
            } catch(e){}
            return this._systemStats || { cpu: 12, ram: 45 };
        };
        const applySystemStats = (currentStats) => {
            const cpuVal = document.getElementById('ic-stat-val-cpu');
            const cpuFill = document.getElementById('ic-stat-fill-cpu');
            const ramVal = document.getElementById('ic-stat-val-ram');
            const ramFill = document.getElementById('ic-stat-fill-ram');

            if (cpuVal) cpuVal.innerText = `${currentStats.cpu}%`;
            if (cpuFill) cpuFill.style.width = `${currentStats.cpu}%`;
            if (ramVal) ramVal.innerText = `${currentStats.ram}%`;
            if (ramFill) ramFill.style.width = `${currentStats.ram}%`;
        };

        const stats = this._systemStats || { cpu: 12, ram: 45 };
        getSystemStats().then(applySystemStats);

        // Default battery status
        let batteryLevel = 100;
        let batteryCharging = true;
        
        // Default disk space status (C: drive)
        let diskFreeGb = 150;
        let diskPercent = 70;

        // Music info fallback
        const musicData = this.musicData || { title: "Aucune lecture", artist: "Système", cover: "", isPlaying: false };
        const effectiveNpArt = getDisplayMediaArt(musicData);
        const hasCover = effectiveNpArt && effectiveNpArt.length > 0;
        const controlTrackKey = musicData.trackKey || getMusicHistoryKey(musicData);
        const flipClass = this._pendingCoverAnimationTrackKey && this._pendingCoverAnimationTrackKey === controlTrackKey ? 'flip-active' : '';
        const npCoverHtml = hasCover
            ? `<img id="ic-np-cover-img" src="${escapeHtml(effectiveNpArt)}" class="ic-np-cover ${flipClass}">`
            : `<img id="ic-np-cover-img" src="${APP_LOGO_ART}" class="ic-np-cover app-logo-art ${flipClass}" alt="Nolys">`;

        // Render customizable third card based on user preference
        const widgetType = localStorage.getItem('liquid_control_widget_type') || 'launchpad';
        let thirdCardHtml = '';
        
        if (widgetType === 'launchpad') {
            const defaultShortcuts = [
                { name: "Explorer", preset: "explorer", icon: "ph ph-folder", cmd: "explorer.exe" },
                { name: "Settings", preset: "settings", icon: "ph ph-gear", cmd: "ms-settings:" },
                { name: "TaskMgr", preset: "taskmgr", icon: "ph ph-cpu", cmd: "taskmgr.exe" },
                { name: "Calc", preset: "calc", icon: "ph ph-calculator", cmd: "calc.exe" }
            ];
            const shortcuts = JSON.parse(localStorage.getItem('liquid_control_shortcuts') || JSON.stringify(defaultShortcuts));
            
            thirdCardHtml = `
                <div class="ic-launchpad-card">
                    ${shortcuts.map((s, idx) => `
                        <button class="ic-launchpad-btn" id="ic-lp-btn-${idx}" title="${escapeHtml(s.name)}">
                            <i class="${escapeHtml(s.icon)}"></i>
                        </button>
                    `).join('')}
                </div>
            `;
        } else if (widgetType === 'stats') {
            thirdCardHtml = `
                <div class="ic-stats-card">
                    <div class="ic-stats-half">
                        <div class="ic-stats-info">
                            <span class="ic-stats-label"><i class="ph ph-cpu"></i> CPU</span>
                            <span id="ic-stat-val-cpu" class="ic-stats-val">${stats.cpu}%</span>
                        </div>
                        <div class="ic-stats-bar">
                            <div id="ic-stat-fill-cpu" class="ic-stats-fill" style="width: ${stats.cpu}%; background: var(--neon-primary);"></div>
                        </div>
                    </div>
                    <div class="ic-stats-half" style="border-left: 1px solid rgba(255,255,255,0.06); padding-left: 12px;">
                        <div class="ic-stats-info">
                            <span class="ic-stats-label"><i class="ph ph-database"></i> RAM</span>
                            <span id="ic-stat-val-ram" class="ic-stats-val">${stats.ram}%</span>
                        </div>
                        <div class="ic-stats-bar">
                            <div id="ic-stat-fill-ram" class="ic-stats-fill" style="width: ${stats.ram}%; background: var(--neon-secondary);"></div>
                        </div>
                    </div>
                </div>
            `;
        } else if (widgetType === 'weather') {
            // Rempli juste après le rendu par fillWeatherCard (météo réelle, ville des réglages).
            const city = (localStorage.getItem('liquid_weather_city') || '').trim();
            thirdCardHtml = `
                <div class="ic-weather-card" id="ic-weather-card">
                    <div class="ic-weather-info">
                        <span class="ic-weather-label"><i class="ph ph-cloud-sun"></i> <span id="ic-weather-city">${city ? escapeHtml(city) : 'Météo'}</span></span>
                        <span class="ic-weather-val" id="ic-weather-temp">${city ? '…' : '—'}</span>
                    </div>
                    <div class="ic-weather-condition">
                        <span class="ic-weather-desc" id="ic-weather-desc">${city ? 'Chargement…' : 'Aucune ville choisie'}</span>
                        <span class="ic-weather-hl" id="ic-weather-hl">${city ? '' : 'Réglages → Centre de contrôle'}</span>
                    </div>
                    <div class="ic-weather-icon-wrapper">
                        <i class="ph ph-cloud-sun ic-weather-icon" id="ic-weather-icon"></i>
                    </div>
                </div>
            `;
        } else if (widgetType === 'mixer') {
            thirdCardHtml = `
                <div class="ic-mixer-card" id="ic-cc-mixer-card">
                    <div style="grid-column: 1/-1; opacity: 0.5; font-size: 11px; text-align: center; padding: 15px 0;">
                        Chargement des flux audio...
                    </div>
                </div>
            `;
        } else {
            // Machine widget default
            const battIcon = batteryCharging ? 'ph-battery-charging' : 'ph-battery-high';
            const battLabelText = batteryCharging ? 'Secteur' : 'Batterie';
            
            thirdCardHtml = `
                <div class="ic-machine-card">
                    <div class="ic-machine-half">
                        <div class="ic-machine-info">
                            <span class="ic-machine-label" id="ic-mach-lbl-batt"><i class="ph ${battIcon}" style="${batteryCharging ? 'color: #34c759;' : ''}"></i> ${battLabelText}</span>
                            <span id="ic-mach-val-batt" class="ic-machine-val">${batteryLevel}%</span>
                        </div>
                        <div class="ic-machine-bar">
                            <div id="ic-mach-fill-batt" class="ic-machine-fill" style="width: ${batteryLevel}%; background: #34c759;"></div>
                        </div>
                    </div>
                    <div class="ic-machine-half" style="border-left: 1px solid rgba(255,255,255,0.06); padding-left: 12px;">
                        <div class="ic-machine-info">
                            <span class="ic-machine-label"><i class="ph ph-hard-drive"></i> Disque C:</span>
                            <span class="ic-machine-val" id="ic-mach-val-disk">${diskFreeGb} Go libres</span>
                        </div>
                        <div class="ic-machine-bar">
                            <div class="ic-machine-fill" id="ic-mach-fill-disk" style="width: ${diskPercent}%; background: var(--neon-primary);"></div>
                        </div>
                    </div>
                </div>
            `;
        }

        this.content.innerHTML = `
            <div class="island-control-container">
                <div class="island-control-header">
                    <div class="ic-header-copy">
                        <span class="ic-title">Centre de Contrôle</span>
                        <span class="ic-time"><i class="ph ph-clock"></i>${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div class="ic-header-actions">
                        <button class="ic-action-btn" data-island-action="setMode" data-arg="settings" title="Réglages"><i class="ph ph-gear"></i></button>
                        <button class="ic-action-btn power" id="ic-shutdown" title="Éteindre"><i class="ph ph-power"></i></button>
                        <button class="ic-close" data-island-action="setMode" data-arg="menu" title="Menu des modules"><i class="ph-bold ph-squares-four"></i></button>
                    </div>
                </div>
                
                <div class="ic-main-layout">
                    <!-- Left Column: Frosted Toggles + Now Playing + customizable third widget -->
                    <div class="ic-control-stack">
                        <div class="ic-toggles-grid">
                            <div class="ic-tile ${wifiEnabled ? 'active' : ''}" id="ic-wifi">
                                <i class="ph ph-wifi-high"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Wi-Fi</span>
                                    <span class="ic-tile-status">${wifiEnabled ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </div>
                            <div class="ic-tile ${btEnabled ? 'active' : ''}" id="ic-bluetooth">
                                <i class="ph ph-bluetooth"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Bluetooth</span>
                                    <span class="ic-tile-status">${btEnabled ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </div>
                            <div class="ic-tile ${dndEnabled ? 'active' : ''}" id="ic-dnd" title="Ne pas déranger : coupe les notifications de Windows">
                                <i class="ph ph-moon"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">DND</span>
                                    <span class="ic-tile-status">${dndEnabled ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </div>
                            <div class="ic-tile ${isFocusMode ? 'active' : ''}" id="ic-focus" title="Focus : plus de notifications dans l’Island, pilule estompée au repos">
                                <i class="ph ph-target"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Focus</span>
                                    <span class="ic-tile-status">${isFocusMode ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </div>
                            <div class="ic-tile ${isEcoMode ? 'active' : ''}" id="ic-eco">
                                <i class="ph ph-leaf"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Éco</span>
                                    <span class="ic-tile-status">${isEcoMode ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </div>
                            <div class="ic-tile ${this.micConfig.enabled ? 'active' : ''}" id="ic-mic" title="Retour micro : t’entendre dans le casque">
                                <i class="ph ph-microphone"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Micro</span>
                                    <span class="ic-tile-status">${this.micConfig.enabled ? 'Activé' : 'Coupé'}</span>
                                </div>
                                <span class="ic-tile-more" title="Régler le retour micro"><i class="ph-bold ph-caret-right"></i></span>
                            </div>
                        </div>

                        <!-- Real-time Now Playing Widget -->
                        <div class="ic-now-playing-card">
                            ${npCoverHtml}
                            <div class="ic-np-details">
                                <span class="ic-np-title" id="ic-np-title-val">${escapeHtml(musicData.title)}</span>
                                <span class="ic-np-artist" id="ic-np-artist-val">${escapeHtml(musicData.artist)}</span>
                            </div>
                            <div class="ic-np-controls">
                                <button class="ic-np-btn" title="Précédent" aria-label="Précédent" data-island-action="media" data-arg="prev"><i class="ph-fill ph-skip-back"></i></button>
                                <button class="ic-np-btn play" id="ic-np-play-btn-val" title="${musicData.isPlaying ? 'Pause' : 'Lecture'}" aria-label="${musicData.isPlaying ? 'Pause' : 'Lecture'}" data-island-action="media" data-arg="toggle"><i class="ph-fill ph-${musicData.isPlaying ? 'pause' : 'play'}"></i></button>
                                <button class="ic-np-btn" title="Suivant" aria-label="Suivant" data-island-action="media" data-arg="next"><i class="ph-fill ph-skip-forward"></i></button>
                            </div>
                        </div>

                        <!-- Dynamically loaded widget -->
                        ${thirdCardHtml}
                    </div>
                    
                    <!-- Right Column: Stretched Volume Vertical Slider -->
                    <div class="ic-sliders-layout" style="width: 60px;">
                        <div class="ic-vertical-slider" id="ic-volume-slider" style="--slider-val-pct: ${Math.round(sysVol)}%" title="Volume Système">
                            <div class="ic-slider-fill"></div>
                            <div class="ic-slider-icon"><i class="ph ph-speaker-high"></i></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Bind Container Stop Propagation
        const container = this.content.querySelector('.island-control-container');
        container.onclick = (e) => e.stopPropagation();

        // Bind Launchpad buttons click handlers
        if (widgetType === 'launchpad') {
            const defaultShortcuts = [
                { name: "Explorer", preset: "explorer", icon: "ph ph-folder", cmd: "explorer.exe" },
                { name: "Settings", preset: "settings", icon: "ph ph-gear", cmd: "ms-settings:" },
                { name: "TaskMgr", preset: "taskmgr", icon: "ph ph-cpu", cmd: "taskmgr.exe" },
                { name: "Calc", preset: "calc", icon: "ph ph-calculator", cmd: "calc.exe" }
            ];
            const shortcuts = JSON.parse(localStorage.getItem('liquid_control_shortcuts') || JSON.stringify(defaultShortcuts));
            
            shortcuts.forEach((s, idx) => {
                const btn = container.querySelector(`#ic-lp-btn-${idx}`);
                if (btn) {
                    btn.onclick = async (e) => {
                        e.stopPropagation();
                        SoundService.play('click');
                        const launched = await this.launchShortcut(s.cmd);
                        if (launched === false) {
                            // Raccourci introuvable ou refusé : petit tremblement au lieu d'un échec silencieux.
                            btn.classList.remove('is-error');
                            void btn.offsetWidth;
                            btn.classList.add('is-error');
                            btn.title = `${s.name} : impossible de l’ouvrir`;
                        }
                    };
                }
            });
        }

        // Helper to bind vertical sliders dragging with mouse support
        const bindVerticalSlider = (sliderEl, onChange) => {
            if (!sliderEl) return () => {};

            let isDragging = false;

            const updateFromEvent = (e) => {
                const rect = sliderEl.getBoundingClientRect();
                const pct = Math.max(0, Math.min(100, Math.round(((rect.bottom - e.clientY) / rect.height) * 100)));
                sliderEl.style.setProperty('--slider-val-pct', `${pct}%`);
                onChange(pct);
            };

            const onMouseDown = (e) => {
                e.stopPropagation();
                e.preventDefault();
                isDragging = true;
                sliderEl.classList.add('active');
                updateFromEvent(e);
            };

            const onMouseMove = (e) => {
                if (isDragging) {
                    e.stopPropagation();
                    e.preventDefault();
                    updateFromEvent(e);
                }
            };

            const onMouseUp = (e) => {
                if (isDragging) {
                    e.stopPropagation();
                    e.preventDefault();
                    isDragging = false;
                    sliderEl.classList.remove('active');
                }
            };

            sliderEl.addEventListener('mousedown', onMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            return () => {
                isDragging = false;
                sliderEl.classList.remove('active');
                sliderEl.removeEventListener('mousedown', onMouseDown);
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
        };

        // Bind Volume Vertical Slider
        const volSlider = container.querySelector('#ic-volume-slider');
        this._controlSliderCleanup = bindVerticalSlider(volSlider, (val) => {
            if (ipcRenderer) {
                ipcRenderer.invoke('set-system-volume', val);
            }
        });

        // Bind Quick Tiles Toggle Handlers
        const TOGGLE_ERRORS = { denied: 'Accès refusé', not_found: 'Introuvable', failed: 'Échec', unknown: 'Échec', error: 'Échec' };
        const setTileState = (el, key, enabled, message) => {
            localStorage.setItem(key, enabled);
            el.classList.toggle('active', enabled);
            el.classList.toggle('has-error', Boolean(message));
            const statusText = el.querySelector('.ic-tile-status');
            if (statusText) statusText.innerText = message || (enabled ? 'Activé' : 'Désactivé');
            // La tuile allumée passe en verre teinté.
            this.syncGlassControls();
        };

        // État réel de Windows (le Wi-Fi a pu être coupé ailleurs) : on corrige les tuiles.
        [['#ic-wifi', 'liquid_wifi_enabled', 'wifi-control'], ['#ic-bluetooth', 'liquid_bluetooth_enabled', 'bluetooth-control'], ['#ic-dnd', 'liquid_dnd_enabled', 'dnd-control']]
            .forEach(async ([selector, key, channel]) => {
                const status = await ipcRenderer.invoke(channel, 'status').catch(() => 'unknown');
                const el = container.querySelector(selector);
                if (!el || !el.isConnected || el.classList.contains('is-busy')) return;
                if (status === 'on' || status === 'off') {
                    const enabled = status === 'on';
                    if (el.classList.contains('active') !== enabled) setTileState(el, key, enabled);
                } else if (status === 'not_found') {
                    el.classList.add('is-unavailable');
                    const statusText = el.querySelector('.ic-tile-status');
                    if (statusText) statusText.innerText = 'Indisponible';
                }
            });

        const tiles = [
            { 
                id: '#ic-wifi', 
                key: 'liquid_wifi_enabled', 
                isDefaultTrue: true, 
                onToggle: async (state) => {
                    return ipcRenderer.invoke('wifi-control', state ? 'on' : 'off').catch(() => 'error');
                } 
            },
            { 
                id: '#ic-bluetooth', 
                key: 'liquid_bluetooth_enabled', 
                isDefaultTrue: true, 
                onToggle: async (state) => {
                    return ipcRenderer.invoke('bluetooth-control', state ? 'on' : 'off').catch(() => 'error');
                } 
            },
            { 
                id: '#ic-dnd', 
                key: 'liquid_dnd_enabled', 
                isDefaultTrue: false, 
                onToggle: async (state) => {
                    return ipcRenderer.invoke('dnd-control', state ? 'on' : 'off').catch(() => 'error');
                } 
            },
            { 
                id: '#ic-focus', 
                key: 'liquid_focus_mode', 
                isDefaultTrue: false, 
                onToggle: (state) => {
                    document.body.classList.toggle('focus-mode-active', state);
                }
            },
            { 
                id: '#ic-eco', 
                key: 'liquid_eco_mode', 
                isDefaultTrue: false, 
                onToggle: (state) => {
                    window.dispatchEvent(new CustomEvent('liquid-eco-mode-changed', { detail: state }));
                }
            }
        ];

        tiles.forEach(tile => {
            const el = container.querySelector(tile.id);
            if (el) {
                el.onclick = async () => {
                    if (el.classList.contains('is-busy')) return;
                    const currentVal = tile.isDefaultTrue 
                        ? localStorage.getItem(tile.key) !== 'false' 
                        : localStorage.getItem(tile.key) === 'true';
                    const newVal = !currentVal;
                    setTileState(el, tile.key, newVal);

                    // Le cœur natif répond « ok » ou la raison de l'échec : on revient
                    // en arrière au lieu d'afficher un état faux.
                    el.classList.add('is-busy');
                    const result = await tile.onToggle(newVal);
                    el.classList.remove('is-busy');
                    if (typeof result === 'string' && result !== 'ok') {
                        setTileState(el, tile.key, currentVal, TOGGLE_ERRORS[result] || 'Échec');
                    }
                };
            }
        });

        // Setup stats real-time update interval (2s)
        this.statsInterval = setInterval(async () => {
            const currentWidget = localStorage.getItem('liquid_control_widget_type') || 'launchpad';
            
            if (currentWidget === 'stats') {
                applySystemStats(await getSystemStats());
            } else if (currentWidget === 'machine') {
                if (navigator.getBattery) {
                    try {
                        const batt = await navigator.getBattery();
                        const bLevel = Math.round(batt.level * 100);
                        const bCharging = batt.charging;
                        
                        const battVal = document.getElementById('ic-mach-val-batt');
                        const battFill = document.getElementById('ic-mach-fill-batt');
                        const battLabel = document.getElementById('ic-mach-lbl-batt');
                        
                        if (battVal) battVal.innerText = `${bLevel}%`;
                        if (battFill) battFill.style.width = `${bLevel}%`;
                        if (battLabel) {
                            const bIcon = bCharging ? 'ph-battery-charging' : 'ph-battery-high';
                            const bText = bCharging ? 'Secteur' : 'Batterie';
                            battLabel.innerHTML = `<i class="ph ${bIcon}" style="${bCharging ? 'color: #34c759;' : ''}"></i> ${bText}`;
                        }
                    } catch(e){}
                }
            }
        }, 2000);

        // Retour micro : la tuile l'allume ou le coupe, la flèche ouvre ses réglages.
        const micTile = container.querySelector('#ic-mic');
        if (micTile) {
            micTile.onclick = (e) => {
                if (e.target.closest('.ic-tile-more')) {
                    this.setMode('mic');
                    return;
                }
                this.toggleMicMonitor();
            };
        }

        // Shutdown Event Trigger
        const shutdownBtn = container.querySelector('#ic-shutdown');
        if (shutdownBtn) {
            shutdownBtn.onclick = () => {
                const existing = container.querySelector('.ic-confirm-overlay');
                if (existing) existing.remove();

                const overlay = document.createElement('div');
                overlay.className = 'ic-confirm-overlay';
                overlay.innerHTML = `
                    <div class="ic-confirm-box">
                        <i class="ph ph-power ic-confirm-icon"></i>
                        <span class="ic-confirm-title">Quitter l'Island ?</span>
                        <span class="ic-confirm-desc">Voulez-vous fermer l'application Nolys ?</span>
                        <div class="ic-confirm-buttons">
                            <button class="ic-confirm-btn cancel" id="confirm-cancel">Annuler</button>
                            <button class="ic-confirm-btn confirm" id="confirm-ok">Quitter</button>
                        </div>
                    </div>
                `;

                container.appendChild(overlay);

                // Bind Cancel button
                overlay.querySelector('#confirm-cancel').onclick = (e) => {
                    e.stopPropagation();
                    overlay.remove();
                };

                // Bind Confirm button
                overlay.querySelector('#confirm-ok').onclick = (e) => {
                    e.stopPropagation();
                    this.mode = 'music';
                    this.isExpanded = false;
                    this.renderContent();

                    if (ipcRenderer) {
                        ipcRenderer.send('exit-app'); // Clean shutdown via exit-app
                    }
                };
                
                // Stop click propagation on overlay to avoid closing the island
                overlay.onclick = (e) => e.stopPropagation();
            };
        }

        // 3. ASYNCHRONOUS UPDATE OF DYNAMIC SYSTEM VALUES
        const updateAsyncSystemData = async () => {
            if (!ipcRenderer) return;
            

            // System Volume
            try {
                const fetchedVol = await ipcRenderer.invoke('get-system-volume');
                if (fetchedVol !== undefined && fetchedVol !== null) {
                    sysVol = fetchedVol;
                    if (volSlider) {
                        volSlider.style.setProperty('--slider-val-pct', `${Math.round(sysVol)}%`);
                    }
                }
            } catch (e) { }

            // Wi-Fi Status
            try {
                const realWifi = await ipcRenderer.invoke('wifi-control', 'status');
                if (realWifi === 'on' || realWifi === 'off') {
                    const active = realWifi === 'on';
                    localStorage.setItem('liquid_wifi_enabled', active);
                    const tileEl = container.querySelector('#ic-wifi');
                    if (tileEl) {
                        tileEl.classList.toggle('active', active);
                        const statusText = tileEl.querySelector('.ic-tile-status');
                        if (statusText) statusText.innerText = active ? 'Activé' : 'Désactivé';
                    }
                }
            } catch (e) { }

            // Bluetooth Status
            try {
                const realBt = await ipcRenderer.invoke('bluetooth-control', 'status');
                if (realBt === 'on' || realBt === 'off') {
                    const active = realBt === 'on';
                    localStorage.setItem('liquid_bluetooth_enabled', active);
                    const tileEl = container.querySelector('#ic-bluetooth');
                    if (tileEl) {
                        tileEl.classList.toggle('active', active);
                        const statusText = tileEl.querySelector('.ic-tile-status');
                        if (statusText) statusText.innerText = active ? 'Activé' : 'Désactivé';
                    }
                }
            } catch (e) { }

            // DND Status
            try {
                const realDnd = await ipcRenderer.invoke('dnd-control', 'status');
                if (realDnd === 'on' || realDnd === 'off') {
                    const active = realDnd === 'on';
                    localStorage.setItem('liquid_dnd_enabled', active);
                    const tileEl = container.querySelector('#ic-dnd');
                    if (tileEl) {
                        tileEl.classList.toggle('active', active);
                        const statusText = tileEl.querySelector('.ic-tile-status');
                        if (statusText) statusText.innerText = active ? 'Activé' : 'Désactivé';
                    }
                }
            } catch (e) { }

            // Battery Status
            if (widgetType === 'machine' && navigator.getBattery) {
                try {
                    const batt = await navigator.getBattery();
                    batteryLevel = Math.round(batt.level * 100);
                    batteryCharging = batt.charging;
                    
                    const battVal = document.getElementById('ic-mach-val-batt');
                    const battFill = document.getElementById('ic-mach-fill-batt');
                    const battLabel = document.getElementById('ic-mach-lbl-batt');
                    
                    if (battVal) battVal.innerText = `${batteryLevel}%`;
                    if (battFill) battFill.style.width = `${batteryLevel}%`;
                    if (battLabel) {
                        const battIcon = batteryCharging ? 'ph-battery-charging' : 'ph-battery-high';
                        const battLabelText = batteryCharging ? 'Secteur' : 'Batterie';
                        battLabel.innerHTML = `<i class="ph ${battIcon}" style="${batteryCharging ? 'color: #34c759;' : ''}"></i> ${battLabelText}`;
                    }
                } catch(e){}
            }

            // Disk Space Status (cœur natif)
            if (widgetType === 'machine') {
                try {
                    const live = await getSystemStats();
                    const diskData = live && live.diskTotal ? { FreeSpace: live.diskFree, Size: live.diskTotal } : null;

                    if (diskData) {
                        const freeBytes = diskData.FreeSpace;
                        const totalBytes = diskData.Size;
                        diskFreeGb = Math.round(freeBytes / (1024 * 1024 * 1024));
                        diskPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
                        
                        const diskVal = document.getElementById('ic-mach-val-disk');
                        const diskFill = document.getElementById('ic-mach-fill-disk');
                        
                        if (diskVal) diskVal.innerText = `${diskFreeGb} Go libres`;
                        if (diskFill) diskFill.style.width = `${diskPercent}%`;
                    }
                } catch(e){}
            }

            // Grouped Audio sessions for Mixer Widget
            if (widgetType === 'mixer') {
                try {
                    const mixerCard = document.getElementById('ic-cc-mixer-card');
                    if (mixerCard) {
                        const sessions = await ipcRenderer.invoke('get-audio-sessions');
                        if (sessions) {
                            this.audioSessions = sessions;
                            const grouped = this.getGroupedSessions(sessions);
                            let mixerRowsHtml = '';
                            
                            if (grouped.length === 0) {
                                mixerRowsHtml = `
                                    <div style="grid-column: 1/-1; opacity: 0.5; font-size: 11px; text-align: center; padding: 15px 0;">
                                        Aucun flux audio détecté
                                    </div>
                                `;
                            } else {
                                mixerRowsHtml = grouped.slice(0, 3).map(s => {
                                    const icon = s.icon || getMixerIcon(s.name, s.title);
                                    const isMuted = s.volume === 0 || s.muted;
                                    const activeVol = isMuted ? 0 : Math.round(s.volume);
                                    
                                    let iconHtml = '';
                                    if (icon) {
                                        iconHtml = `
                                            <img src="${escapeHtml(icon)}" style="width: 14px; height: 14px; object-fit: contain;" data-fallback="next">
                                            <i class="ph ph-music-note" style="display: none; font-size: 12px;"></i>
                                        `;
                                    } else {
                                        iconHtml = `<i class="ph ph-music-note"></i>`;
                                    }
                                    
                                    const muteIcon = getMuteIcon(isMuted, activeVol);
                                    
                                    let cleanName = s.name.replace('.exe', '');
                                    if (cleanName.toLowerCase() === 'audiodg') cleanName = 'System Sounds';
                                    
                                    return `
                                        <div class="ic-mixer-row">
                                            <div class="ic-mixer-app-icon" title="${escapeHtml(cleanName)}">
                                                ${iconHtml}
                                            </div>
                                            <div class="ic-mixer-slider-wrapper">
                                                <input type="range" class="ic-mixer-slider" data-pid="${s.pid}" min="0" max="100" value="${activeVol}">
                                            </div>
                                            <span class="ic-mixer-vol">${activeVol}%</span>
                                            <div class="ic-mixer-mute ${isMuted ? 'muted' : ''}" data-pid="${s.pid}">
                                                <i class="ph ${muteIcon}"></i>
                                            </div>
                                        </div>
                                    `;
                                }).join('');
                            }
                            mixerCard.innerHTML = mixerRowsHtml;
                        }
                    }
                } catch(e){}
            }
        };

        // Fire async updates immediately without blocking the synchronous render thread!
        updateAsyncSystemData();
        if (widgetType === 'weather') this.fillWeatherCard();
        this.syncGlassControls();
    },

    /** Tuile du retour micro à jour sans redessiner tout le centre de contrôle. */
    syncMicTile() {
        const tile = this.content.querySelector('#ic-mic');
        if (!tile) return;
        const enabled = Boolean(this.micConfig.enabled);
        const error = enabled && this.micStatus?.error;
        if (tile.classList.contains('active') === enabled && tile.classList.contains('has-error') === Boolean(error)) return;
        tile.classList.toggle('active', enabled);
        tile.classList.toggle('has-error', Boolean(error));
        const status = tile.querySelector('.ic-tile-status');
        if (status) status.textContent = error ? 'Erreur' : (enabled ? 'Activé' : 'Coupé');
        this.syncGlassControls();
    },

    /** Météo réelle (Open-Meteo, via le cœur natif) dans le widget du bas. */
    async fillWeatherCard() {
        const city = (localStorage.getItem('liquid_weather_city') || '').trim();
        if (!city) return;
        const weather = await ipcRenderer.invoke('get-weather', city).catch(() => null);
        const card = document.getElementById('ic-weather-card');
        if (!card || !card.isConnected) return;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        if (!weather) {
            set('ic-weather-temp', '—');
            set('ic-weather-desc', 'Météo indisponible');
            set('ic-weather-hl', 'Ville introuvable ou pas de connexion');
            return;
        }
        const { label, icon, color } = describeWeather(weather.code, weather.isDay);
        set('ic-weather-city', weather.city);
        set('ic-weather-temp', `${Math.round(weather.temperature)}°`);
        set('ic-weather-desc', label);
        set('ic-weather-hl', `Min. ${Math.round(weather.min)}° / Max. ${Math.round(weather.max)}°`);
        const iconEl = document.getElementById('ic-weather-icon');
        if (iconEl) {
            iconEl.className = `ph ${icon} ic-weather-icon`;
            iconEl.style.color = color;
            iconEl.style.filter = `drop-shadow(0 0 8px ${color}4d)`;
        }
    },
};

/** Codes météo WMO (Open-Meteo) → texte, icône Phosphor et couleur. */
function describeWeather(code, isDay) {
    if (code === 0) return isDay ? { label: 'Ensoleillé', icon: 'ph-sun', color: '#ff9f0a' } : { label: 'Nuit claire', icon: 'ph-moon-stars', color: '#64d2ff' };
    if (code <= 2) return isDay ? { label: 'Partiellement nuageux', icon: 'ph-cloud-sun', color: '#ffd60a' } : { label: 'Partiellement nuageux', icon: 'ph-cloud-moon', color: '#5e5ce6' };
    if (code === 3) return { label: 'Couvert', icon: 'ph-cloud', color: '#aeaeb2' };
    if (code <= 48) return { label: 'Brouillard', icon: 'ph-cloud-fog', color: '#aeaeb2' };
    if (code <= 57) return { label: 'Bruine', icon: 'ph-cloud-rain', color: '#64d2ff' };
    if (code <= 67) return { label: 'Pluie', icon: 'ph-cloud-rain', color: '#0a84ff' };
    if (code <= 77) return { label: 'Neige', icon: 'ph-cloud-snow', color: '#e5e5ea' };
    if (code <= 82) return { label: 'Averses', icon: 'ph-cloud-rain', color: '#0a84ff' };
    if (code <= 86) return { label: 'Averses de neige', icon: 'ph-cloud-snow', color: '#e5e5ea' };
    return { label: 'Orage', icon: 'ph-cloud-lightning', color: '#ffd60a' };
}
