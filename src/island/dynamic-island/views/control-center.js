import { readJSON, isRecord } from '../../../shared/safe-storage.js';
import { sanitizeShortcuts } from '../../../settings/state/validation.js';
/** Centre de contrôle (tuiles, curseurs, widgets). */
import { ipcRenderer } from '../../../shared/ipc.js';
import { SoundService } from '../../../services/SoundService.js';
import { escapeHtml } from '../helpers/format.js';
import { APP_LOGO_ART, getDisplayMediaArt } from '../helpers/media-art.js';
import { getMusicHistoryKey } from '../helpers/music-search.js';
import { systemMetrics, percentLabel } from '../../../shared/system-metrics.js';
import { bindSystemTile } from '../helpers/system-tile.js';
import { DEFAULT_SHORTCUTS } from '../../../settings/state/presets.js';
import { renderModuleArtwork } from '../../../shared/module-art.js';

export const controlCenterView = {
    renderControl() {
        this._controlCleanup?.();
        this._controlSliderCleanup?.();
        this._controlSliderCleanup = null;
        clearInterval(this.statsInterval);
        const isEcoMode = localStorage.getItem('liquid_eco_mode') === 'true';
        const isFocusMode = localStorage.getItem('liquid_focus_mode') === 'true';

        // 1. Synchronously render UI with cached/default states immediately
        let sysVol = null;
        
        // CPU / RAM / disque réels lus par le cœur natif (dernières valeurs connues en attendant).
        const getSystemStats = async () => {
            try {
                const live = await ipcRenderer.invoke('get-system-stats');
                this._systemStats = systemMetrics(live);
            } catch { this._systemStats = systemMetrics(null); }
            return this._systemStats;
        };
        const applySystemStats = (currentStats) => {
            if (!container.isConnected) return;
            const cpuVal = container.querySelector('#ic-stat-val-cpu');
            const cpuFill = container.querySelector('#ic-stat-fill-cpu');
            const ramVal = container.querySelector('#ic-stat-val-ram');
            const ramFill = container.querySelector('#ic-stat-fill-ram');

            if (cpuVal) cpuVal.innerText = percentLabel(currentStats.cpu);
            if (cpuFill) cpuFill.style.width = `${currentStats.cpu ?? 0}%`;
            if (ramVal) ramVal.innerText = percentLabel(currentStats.ram);
            if (ramFill) ramFill.style.width = `${currentStats.ram ?? 0}%`;
            const diskVal = container.querySelector('#ic-mach-val-disk');
            const diskFill = container.querySelector('#ic-mach-fill-disk');
            if (diskVal) diskVal.textContent = currentStats.diskTotal ? `${Math.round(currentStats.diskFree / 1024 ** 3)} Go libres` : '—';
            if (diskFill) diskFill.style.width = `${currentStats.diskTotal ? (1 - currentStats.diskFree / currentStats.diskTotal) * 100 : 0}%`;
        };

        const stats = systemMetrics(null);
        getSystemStats().then(applySystemStats);

        // Default battery status
        let batteryLevel = null;
        let batteryCharging = null;
        const clearBattery = () => {
            if (!container.isConnected) return;
            const label = container.querySelector('#ic-mach-val-batt');
            const fill = container.querySelector('#ic-mach-fill-batt');
            if (label) label.textContent = '—';
            if (fill) fill.style.width = '0%';
        };
        
        // Default disk space status (C: drive)
        let diskFreeGb = null;
        let diskPercent = 0;

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
            const shortcuts = sanitizeShortcuts(readJSON('liquid_control_shortcuts', DEFAULT_SHORTCUTS, value => Array.isArray(value) && value.every(isRecord)));
            
            thirdCardHtml = `
                <div class="ic-launchpad-card">
                    ${shortcuts.map((s, idx) => `
                        <button type="button" class="ic-launchpad-btn" id="ic-lp-btn-${idx}" title="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}">
                            ${renderModuleArtwork(null, s.cmd) || `<i class="${escapeHtml(s.icon)}" aria-hidden="true"></i>`}<span>${escapeHtml(({explorer:'Fichiers',settings:'Windows',taskmgr:'Tâches',calc:'Calcul'})[s.preset] || s.name)}</span>
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
                            <span id="ic-stat-val-cpu" class="ic-stats-val">${percentLabel(stats.cpu)}</span>
                        </div>
                        <div class="ic-stats-bar">
                            <div id="ic-stat-fill-cpu" class="ic-stats-fill" style="width: ${stats.cpu ?? 0}%; background: var(--neon-primary);"></div>
                        </div>
                    </div>
                    <div class="ic-stats-half" style="border-left: 1px solid rgba(255,255,255,0.06); padding-left: 12px;">
                        <div class="ic-stats-info">
                            <span class="ic-stats-label"><i class="ph ph-database"></i> RAM</span>
                            <span id="ic-stat-val-ram" class="ic-stats-val">${percentLabel(stats.ram)}</span>
                        </div>
                        <div class="ic-stats-bar">
                            <div id="ic-stat-fill-ram" class="ic-stats-fill" style="width: ${stats.ram ?? 0}%; background: var(--neon-secondary);"></div>
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
                            <span id="ic-mach-val-batt" class="ic-machine-val">${percentLabel(batteryLevel)}</span>
                        </div>
                        <div class="ic-machine-bar">
                            <div id="ic-mach-fill-batt" class="ic-machine-fill" style="width: ${batteryLevel ?? 0}%; background: #34c759;"></div>
                        </div>
                    </div>
                    <div class="ic-machine-half" style="border-left: 1px solid rgba(255,255,255,0.06); padding-left: 12px;">
                        <div class="ic-machine-info">
                            <span class="ic-machine-label"><i class="ph ph-hard-drive"></i> Disque C:</span>
                            <span class="ic-machine-val" id="ic-mach-val-disk">—</span>
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
                        <span class="ic-title">Centre de contrôle</span>
                        <span class="ic-time"><i class="ph ph-clock"></i>${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div class="ic-header-actions">
                        <button type="button" class="ic-action-btn" data-island-action="openSettings" data-arg="control" title="Configurer le centre de contrôle" aria-label="Configurer le centre de contrôle"><i class="ph ph-gear" aria-hidden="true"></i></button>
                        <button type="button" class="ic-action-btn power" id="ic-shutdown" title="Quitter Nolys" aria-label="Quitter Nolys"><i class="ph ph-power" aria-hidden="true"></i></button>
                        <button type="button" class="ic-close" data-island-action="setMode" data-arg="menu" title="Menu des modules" aria-label="Menu des modules"><i class="ph ph-squares-four" aria-hidden="true"></i></button>
                    </div>
                </div>
                
                <div class="ic-main-layout">
                    <!-- Left Column: Frosted Toggles + Now Playing + customizable third widget -->
                    <div class="ic-control-stack">
                        <div class="ic-toggles-grid">
                            <button type="button" class="ic-tile" id="ic-wifi" aria-pressed="mixed" aria-busy="true" disabled title="Activer ou désactiver la radio Wi-Fi de Windows">
                                <i class="ph ph-wifi-high"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Wi-Fi</span>
                                    <span class="ic-tile-status">Vérification…</span>
                                </div>
                            </button>
                            <button type="button" class="ic-tile" id="ic-bluetooth" aria-pressed="mixed" aria-busy="true" disabled title="Activer ou désactiver le Bluetooth de Windows">
                                <i class="ph ph-bluetooth"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Bluetooth</span>
                                    <span class="ic-tile-status">Vérification…</span>
                                </div>
                            </button>
                            <button type="button" class="ic-tile" id="ic-dnd" aria-pressed="mixed" aria-busy="true" disabled title="Couper ou autoriser les alertes Windows. Ce réglage est distinct du mode Ne pas déranger de Windows.">
                                <i class="ph ph-moon"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Alertes PC</span>
                                    <span class="ic-tile-status">Vérification…</span>
                                </div>
                            </button>
                            <button type="button" class="ic-tile ${isFocusMode ? 'active' : ''}" id="ic-focus" aria-pressed="${isFocusMode}" title="Focus : plus de notifications dans l’Island, pilule estompée au repos">
                                <i class="ph ph-target"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Focus Nolys</span>
                                    <span class="ic-tile-status">${isFocusMode ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </button>
                            <button type="button" class="ic-tile ${isEcoMode ? 'active' : ''}" id="ic-eco" aria-pressed="${isEcoMode}" title="Économie Nolys : réduit les effets et arrête le visualiseur. Les autres applications restent inchangées.">
                                <i class="ph ph-leaf"></i>
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Économie</span>
                                    <span class="ic-tile-status">${isEcoMode ? 'Activé' : 'Désactivé'}</span>
                                </div>
                            </button>
                            <div class="ic-tile ${this.micConfig.enabled ? 'active' : ''}" id="ic-mic" role="group" aria-label="Retour micro" title="Écouter ta voix dans le casque. Ce bouton ne coupe pas ton microphone dans les autres applications.">
                                <button type="button" class="ic-mic-toggle" aria-label="Retour micro" aria-pressed="${Boolean(this.micConfig.enabled)}" style="display:flex;align-items:center;gap:inherit;flex:1;padding:0;border:0;background:transparent;color:inherit;text-align:left">
                                ${renderModuleArtwork('mic')}
                                <div class="ic-tile-text">
                                    <span class="ic-tile-label">Retour micro</span>
                                    <span class="ic-tile-status">${this.micConfig.enabled ? 'Activé' : 'Désactivé'}</span>
                                </div>
                                </button><button type="button" class="ic-tile-more" title="Régler le retour micro" aria-label="Régler le retour micro" style="padding:0;border:0;background:transparent;color:inherit"><i class="ph-bold ph-caret-right"></i></button>
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
                        <section class="ic-widget" aria-label="${({launchpad:'Raccourcis',stats:'Performance',machine:'Batterie et disque',weather:'Météo',mixer:'Mélangeur'})[widgetType] || 'Widget'}">
                            <div class="ic-widget-header">
                                <span class="ic-widget-title">${({launchpad:'Raccourcis',stats:'Performance',machine:'Batterie et disque',weather:'Météo',mixer:'Mélangeur'})[widgetType] || 'Widget'}</span>
                                <div class="ic-widget-actions">
                                    ${widgetType === 'mixer' ? '<button type="button" class="ic-mixer-open" data-island-action="setMode" data-arg="mixer"><span>Tous les flux</span><i class="ph ph-arrow-up-right" aria-hidden="true"></i></button>' : ''}
                                    ${widgetType === 'weather' ? '<button type="button" class="ic-weather-retry" aria-label="Réessayer la météo" title="Réessayer la météo"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i></button>' : ''}
                                    <button type="button" class="ic-widget-config" data-island-action="openSettings" data-arg="control" aria-label="${widgetType === 'weather' ? (localStorage.getItem('liquid_weather_city')?.trim() ? 'Modifier la ville' : 'Choisir une ville') : 'Configurer le widget'}" title="${widgetType === 'weather' ? 'Ville et widget météo' : 'Configurer le widget'}"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i></button>
                                </div>
                            </div>
                            ${thirdCardHtml}
                        </section>
                    </div>
                    
                    <!-- Right Column: Stretched Volume Vertical Slider -->
                    <div class="ic-sliders-layout" style="width: 60px;">
                        <div class="ic-vertical-slider" id="ic-volume-slider" role="slider" tabindex="0" aria-disabled="true" aria-label="Volume système" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuetext="Indisponible" style="--slider-val-pct: 0%" title="Volume Système">
                            <div class="ic-slider-fill"></div>
                            <div class="ic-slider-icon"><i class="ph ph-speaker-high"></i></div>
                            <span class="ic-volume-value" aria-hidden="true">—</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Delegated header/media/mixer actions must reach the content listeners.
        const container = this.content.querySelector('.island-control-container');
        const header = container.querySelector('.island-control-header');
        const stack = container.querySelector('.ic-control-stack');
        // Mesurer les blocs à leur hauteur naturelle, indépendamment du volume étiré.
        // Les dimensions de mise en page excluent le zoom et les animations d'entrée.
        const fitControl = () => {
            if (!container.isConnected || !this.isExpanded || this.mode !== 'control') return;
            const style = getComputedStyle(container);
            const height = Math.ceil(header.offsetHeight + stack.offsetHeight
                + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.rowGap));
            const value = `${height}px`;
            if (this.el.style.getPropertyValue('--control-height') !== value) this.el.style.setProperty('--control-height', value);
        };
        const controlResize = new ResizeObserver(fitControl);
        controlResize.observe(header);
        controlResize.observe(stack);
        fitControl();

        // Bind Launchpad buttons click handlers
        if (widgetType === 'launchpad') {
            const shortcuts = sanitizeShortcuts(readJSON('liquid_control_shortcuts', DEFAULT_SHORTCUTS, value => Array.isArray(value) && value.every(isRecord)));
            
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
                            this.showIslandFeedback(`Impossible d’ouvrir ${s.name}`, 'ph-warning');
                        } else {
                            btn.classList.remove('is-error'); btn.title = s.name;
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
                if (sliderEl.getAttribute('aria-disabled') === 'true') return;
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
        const writeVolume = async value => {
            try {
                if (await ipcRenderer.invoke('set-system-volume',value) === false) throw new Error('Volume refusé');
            } catch {
                this.updateSystemVolumeSlider(volSlider,null);
                if (container.isConnected) this.showIslandFeedback('Volume indisponible','ph-warning');
            }
        };
        let volumeTimer, pendingVolume;
        this._controlSliderCleanup = bindVerticalSlider(volSlider, (val) => {
            sysVol = val;
            this._systemVolumeWriteVersion=(this._systemVolumeWriteVersion||0)+1;
            this.updateSystemVolumeSlider(volSlider,val);
            pendingVolume=val;
            volumeTimer ??= setTimeout(()=>{volumeTimer=null;const value=pendingVolume;pendingVolume=undefined;writeVolume(value);},40);
        });
        const stopSlider = this._controlSliderCleanup;
        this._controlSliderCleanup = () => {stopSlider();clearTimeout(volumeTimer);if(pendingVolume!==undefined) writeVolume(pendingVolume);};
        volSlider?.addEventListener('keydown', event => {
            if (volSlider.getAttribute('aria-disabled') === 'true') return;
            if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            sysVol = volSlider.hasAttribute('aria-valuenow') ? Number(volSlider.getAttribute('aria-valuenow')) : null;
            if (sysVol === null && !['Home', 'End'].includes(event.key)) return;
            const direction = ['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key) ? 1 : -1;
            sysVol = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.max(0, Math.min(100, sysVol + direction * (event.key.startsWith('Page') ? 10 : 5)));
            this._systemVolumeWriteVersion=(this._systemVolumeWriteVersion||0)+1;
            this.updateSystemVolumeSlider(volSlider,sysVol);
            writeVolume(sysVol);
        });

        // Bind Quick Tiles Toggle Handlers
        const setTileState = (el, key, enabled, message) => {
            localStorage.setItem(key, enabled);
            el.classList.toggle('active', enabled);
            el.setAttribute('aria-pressed', String(enabled));
            el.classList.toggle('has-error', Boolean(message));
            const statusText = el.querySelector('.ic-tile-status');
            if (statusText) statusText.innerText = message || (enabled ? 'Activé' : 'Désactivé');
            // La tuile allumée passe en verre teinté.
            this.syncGlassControls();
        };

        const systemTiles = [
            ['#ic-wifi', 'liquid_wifi_enabled', 'wifi-control'],
            ['#ic-bluetooth', 'liquid_bluetooth_enabled', 'bluetooth-control'],
            ['#ic-dnd', 'liquid_dnd_enabled', 'dnd-control', {on: 'Coupées', off: 'Autorisées'}],
        ].map(([selector, key, channel, labels]) => bindSystemTile({
            element: container.querySelector(selector), key, channel, labels,
            invoke: (channel, action) => ipcRenderer.invoke(channel, action),
            onError: message => { if (container.isConnected) this.showIslandFeedback(message, 'ph-warning'); },
        }));
        const refreshSystemTiles = () => systemTiles.forEach(tile => tile.refresh());
        this._controlCleanup = () => {
            controlResize.disconnect();
            systemTiles.forEach(tile => tile.dispose());
        };
        refreshSystemTiles();

        const tiles = [
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
                    el.setAttribute('aria-busy', 'true');
                    const result = await tile.onToggle(newVal);
                    el.classList.remove('is-busy');
                    el.removeAttribute('aria-busy');
                    if (result === false) setTileState(el, tile.key, currentVal, 'Échec');
                };
            }
        });

        // Setup stats real-time update interval (2s)
        let nextWeatherRefresh = Date.now()+15*60*1000;
        this.statsInterval = setInterval(async () => {
            if (!container.isConnected || this._windowHidden) return;
            refreshSystemTiles();
            const clock = container.querySelector('.ic-time');
            if (clock) clock.innerHTML = `<i class="ph ph-clock" aria-hidden="true"></i>${new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}`;
            const currentWidget = localStorage.getItem('liquid_control_widget_type') || 'launchpad';
            if(currentWidget==='weather' && Date.now()>=nextWeatherRefresh) {nextWeatherRefresh=Date.now()+15*60*1000;this.fillWeatherCard();}
            
            if (currentWidget === 'stats') {
                applySystemStats(await getSystemStats());
            } else if (currentWidget === 'machine') {
                applySystemStats(await getSystemStats());
                if (navigator.getBattery) {
                    try {
                        const batt = await navigator.getBattery();
                        if (!Number.isFinite(batt.level) || batt.level < 0 || batt.level > 1) throw new Error('Batterie indisponible');
                        const bLevel = Math.round(batt.level * 100);
                        const bCharging = batt.charging;
                        
                        const battVal = container.querySelector('#ic-mach-val-batt');
                        const battFill = container.querySelector('#ic-mach-fill-batt');
                        const battLabel = container.querySelector('#ic-mach-lbl-batt');
                        
                        if (battVal) battVal.innerText = `${bLevel}%`;
                        if (battFill) battFill.style.width = `${bLevel}%`;
                        if (battLabel) {
                            const bIcon = bCharging ? 'ph-battery-charging' : 'ph-battery-high';
                            const bText = bCharging ? 'Secteur' : 'Batterie';
                            battLabel.innerHTML = `<i class="ph ${bIcon}" style="${bCharging ? 'color: #34c759;' : ''}"></i> ${bText}`;
                        }
                    } catch { clearBattery(); }
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
                    <div class="ic-confirm-box" role="dialog" aria-modal="true" aria-labelledby="ic-confirm-title" aria-describedby="ic-confirm-desc">
                        <i class="ph ph-power ic-confirm-icon"></i>
                        <span class="ic-confirm-title" id="ic-confirm-title">Quitter Nolys ?</span>
                        <span class="ic-confirm-desc" id="ic-confirm-desc">Confirme la fermeture de l’application.</span>
                        <div class="ic-confirm-buttons">
                            <button class="ic-confirm-btn cancel" id="confirm-cancel">Annuler</button>
                            <button class="ic-confirm-btn confirm" id="confirm-ok">Quitter</button>
                        </div>
                    </div>
                `;

                container.appendChild(overlay);
                const cancel = overlay.querySelector('#confirm-cancel');
                const confirm = overlay.querySelector('#confirm-ok');
                const background = [...container.children].filter(child => child !== overlay);
                background.forEach(child => { child.inert = true; });
                const close = () => {
                    background.forEach(child => { child.inert = false; });
                    overlay.remove(); shutdownBtn.focus({preventScroll:true});
                };
                overlay.addEventListener('keydown', event => {
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
                    else if (event.key === 'Tab') {
                        event.preventDefault(); event.stopPropagation();
                        (document.activeElement === cancel ? confirm : cancel).focus();
                    }
                });
                cancel.focus({preventScroll:true});

                // Bind Cancel button
                overlay.querySelector('#confirm-cancel').onclick = (e) => {
                    e.stopPropagation();
                    close();
                };

                // Bind Confirm button
                overlay.querySelector('#confirm-ok').onclick = (e) => {
                    e.stopPropagation();
                    background.forEach(child => { child.inert = false; });
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
            const readVersion=this._systemVolumeWriteVersion||0;
            try {
                const fetchedVol = await ipcRenderer.invoke('get-system-volume');
                if (readVersion===(this._systemVolumeWriteVersion||0)) this.updateSystemVolumeSlider(volSlider, fetchedVol);
                if (readVersion===(this._systemVolumeWriteVersion||0) && Number.isFinite(fetchedVol) && fetchedVol >= 0 && fetchedVol <= 100) {
                    sysVol = fetchedVol;
                    if (volSlider) {
                        volSlider.style.setProperty('--slider-val-pct', `${Math.round(sysVol)}%`);
                        volSlider.setAttribute('aria-valuenow', sysVol); volSlider.setAttribute('aria-valuetext', `${Math.round(sysVol)} %`);
                    }
                }
            } catch (e) { if(readVersion===(this._systemVolumeWriteVersion||0)) this.updateSystemVolumeSlider(volSlider, null); }

            // Battery Status
            if (widgetType === 'machine' && navigator.getBattery) {
                try {
                    const batt = await navigator.getBattery();
                    if (!Number.isFinite(batt.level) || batt.level < 0 || batt.level > 1) throw new Error('Batterie indisponible');
                    batteryLevel = Math.round(batt.level * 100);
                    batteryCharging = batt.charging;
                    
                    const battVal = container.querySelector('#ic-mach-val-batt');
                    const battFill = container.querySelector('#ic-mach-fill-batt');
                    const battLabel = container.querySelector('#ic-mach-lbl-batt');
                    
                    if (battVal) battVal.innerText = `${batteryLevel}%`;
                    if (battFill) battFill.style.width = `${batteryLevel}%`;
                    if (battLabel) {
                        const battIcon = batteryCharging ? 'ph-battery-charging' : 'ph-battery-high';
                        const battLabelText = batteryCharging ? 'Secteur' : 'Batterie';
                        battLabel.innerHTML = `<i class="ph ${battIcon}" style="${batteryCharging ? 'color: #34c759;' : ''}"></i> ${battLabelText}`;
                    }
                } catch { clearBattery(); }
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
                        
                        const diskVal = container.querySelector('#ic-mach-val-disk');
                        const diskFill = container.querySelector('#ic-mach-fill-disk');
                        
                        if (diskVal) diskVal.innerText = `${diskFreeGb} Go libres`;
                        if (diskFill) diskFill.style.width = `${diskPercent}%`;
                    }
                } catch(e){}
            }

            if (widgetType === 'mixer') await this.updateAudioSessions();
        };

        // Fire async updates immediately without blocking the synchronous render thread!
        updateAsyncSystemData();
        container.querySelector('.ic-weather-retry')?.addEventListener('click', () => this.fillWeatherCard());
        if (widgetType === 'weather') this.fillWeatherCard();
        this.syncMicTile();
        this.syncGlassControls();
    },

    /** Tuile du retour micro à jour sans redessiner tout le centre de contrôle. */
    syncMicTile() {
        const tile = this.content.querySelector('#ic-mic');
        if (!tile) return;
        const enabled = Boolean(this.micConfig.enabled);
        const error = this.micStatus?.error;
        const busy = Boolean(this._micSending);
        const toggle = tile.querySelector('.ic-mic-toggle');
        toggle.disabled = busy;
        toggle.setAttribute('aria-busy', String(busy));
        toggle.setAttribute('aria-pressed', String(enabled));
        tile.classList.toggle('active', enabled);
        tile.classList.toggle('has-error', Boolean(error));
        const status = tile.querySelector('.ic-tile-status');
        if (status) status.textContent = busy ? 'Application…' : error ? 'Erreur' : (enabled ? 'Activé' : 'Désactivé');
        this.syncGlassControls();
    },

    /** Météo réelle (Open-Meteo, via le cœur natif) dans le widget du bas. */
    async fillWeatherCard() {
        const city = (localStorage.getItem('liquid_weather_city') || '').trim();
        if (!city) return;
        const card = this.content.querySelector('#ic-weather-card');
        if(!card || card.getAttribute('aria-busy')==='true') return;
        card.setAttribute('aria-busy','true');
        const retry=this.content.querySelector('.ic-weather-retry');
        if(retry) retry.disabled=true;
        const weather = await ipcRenderer.invoke('get-weather', city).catch(() => null);
        card.setAttribute('aria-busy','false'); if(retry) retry.disabled=false;
        if (!card.isConnected || (localStorage.getItem('liquid_weather_city')||'').trim()!==city) return;
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
