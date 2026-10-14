/** Écouteurs d’événements, menu contextuel et barre de progression. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { escapeHtml, formatTime } from '../helpers/format.js';
import { getDisplayMediaArt } from '../helpers/media-art.js';
import { isHistoryTrack } from '../helpers/music-search.js';
import { themeLook } from '../../../shared/theme-look.js';

export const eventMethods = {
    initEvents() {
        // Right-click context menu listener
        this.el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Allow mouse capture
            if (ipcRenderer) {
                ipcRenderer.send('set-ignore-mouse', false);
            }
            
            this.showContextMenu(e.clientX, e.clientY);
        });

        this.el.addEventListener('click', (e) => {
            if (this._layoutEditMode) return;
            if (this.isExpanded && (this.mode === 'search' || this.mode === 'music-search' || this.mode === 'music-history' || this.mode === 'control' || this.mode === 'mixer' || this.mode === 'mic')) return; // Don't toggle expansion on interactive screens

            if (this.mode === 'ai-thinking' || this.mode === 'ai-action') {
                window.dispatchEvent(new CustomEvent('liquid-open-widget', { detail: 'ai' }));
                return;
            }

            if (this.mode === 'notification') {
                this.mode = this.previousMode || 'music';
            }
            this.toggleExpand();
        });

        const dragPointerTarget = this.dragSurface || this.el;
        dragPointerTarget.addEventListener('mousedown', (e) => {
            if (!this._layoutEditMode || e.button !== 0) return;
            document.body.classList.add('layout-edit-dragging');
        });

        document.addEventListener('mouseup', () => {
            document.body.classList.remove('layout-edit-dragging');
        });

        window.addEventListener('blur', () => {
            document.body.classList.remove('layout-edit-dragging');
        });

        window.addEventListener('liquid-eco-mode-changed', (e) => {
            localStorage.setItem('liquid_eco_mode', !!e.detail);
            this.syncEcoMode();
            this.renderContent();
        });

        // Permanent delegated mousedown listener for progress bar scrubbing (persists across re-renders)
        this.content.addEventListener('mousedown', (e) => {
            const progBar = e.target.closest('.progress-bar');
            if (progBar) {
                e.stopPropagation();
                e.preventDefault(); // Prevent text selection during drag
                
                this.isScrubbing = true;
                this.scrubbingBar = progBar;
                progBar.classList.add('active');
                
                // Instant visual seek feedback on mouse down
                this.updateScrubPosition(e);
            }
        });

        // Permanent delegated mousedown listener for session volume scrubbing in the mixer mode
        this.content.addEventListener('mousedown', (e) => {
            const slider = e.target.closest('.mixer-volume-slider, .ic-mixer-slider');
            if (slider) {
                e.stopPropagation();
                e.preventDefault();

                const pid = parseInt(slider.getAttribute('data-pid'));
                this.isScrubbingMixer = true;
                this.scrubbingPid = pid;
                this.activeMixerSlider = slider;
                
                // Track volume change
                this.updateMixerScrub(e);
            }
        });

        // Global mousemove listener for dragging progress bar or mixer volume
        document.addEventListener('mousemove', (e) => {
            if (this.isScrubbing && this.scrubbingBar) {
                e.stopPropagation();
                e.preventDefault();
                this.updateScrubPosition(e);
            } else if (this.isScrubbingMixer && this.activeMixerSlider) {
                e.stopPropagation();
                e.preventDefault();
                this.updateMixerScrub(e);
            }
        });

        // Global mouseup listener to commit progress bar seek or mixer volume drag
        document.addEventListener('mouseup', (e) => {
            if (this.isScrubbing && this.scrubbingBar) {
                e.stopPropagation();
                e.preventDefault();
                
                this.isScrubbing = false;
                this.scrubbingBar.classList.remove('active');
                
                const data = this.musicData;
                if (data && data.duration) {
                    const pct = parseFloat(this.scrubbingBar.style.getPropertyValue('--progress-pct')) / 100;
                    const targetMs = Math.round(pct * data.duration);
                    
                    console.log('[Scrubber Drag] Seek completed! pct:', pct, 'targetMs:', targetMs);
                    
                    // Force local progress updates to persist seek position immediately
                    this.musicData.progress = targetMs;
                    this.lastMediaUpdate = Date.now();
                    
                    // Suppress incoming system state updates for 1500ms to allow player core buffer sync
                    this.suppressProgressUpdatesUntil = Date.now() + 1500;
                    
                    // Execute seek via C# core bridge
                    window.spotifyControl('seek ' + targetMs);
                }
                this.scrubbingBar = null;
            } else if (this.isScrubbingMixer) {
                e.stopPropagation();
                e.preventDefault();
                
                this.isScrubbingMixer = false;
                this.scrubbingPid = null;
                this.activeMixerSlider = null;
            }
        });

        // Prevent click events on specific child elements from bubbling and collapsing the island
        this.content.addEventListener('click', (e) => {
            if (e.target.closest('.progress-bar, .music-search-panel, .music-history-panel, .mixer-volume-slider, .ic-mixer-slider, .mixer-mute-btn, .ic-mixer-mute')) {
                e.stopPropagation();
                e.preventDefault();
            }

            // Click listener for session mute toggles
            const muteBtn = e.target.closest('.mixer-mute-btn, .ic-mixer-mute');
            if (muteBtn) {
                const pid = parseInt(muteBtn.getAttribute('data-pid'));
                const isMuted = muteBtn.classList.contains('muted');
                this.toggleSessionMute(pid, !isMuted);
            }
        });

        // Permanent delegated mousemove listener for progress bar hover (elastic remaining time tooltip)
        this.content.addEventListener('mousemove', (e) => {
            const progBar = e.target.closest('.progress-bar');
            if (progBar && this.musicData && this.musicData.duration) {
                const rect = progBar.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const pct = Math.max(0, Math.min(100, (clickX / width) * 100));
                
                progBar.style.setProperty('--tooltip-pct', `${pct}%`);
                
                const tooltip = progBar.querySelector('#music-progress-tooltip');
                if (tooltip) {
                    const targetMs = Math.round((pct / 100) * this.musicData.duration);
                    tooltip.innerText = formatTime(targetMs);
                }
            }
        });

        // Close on click outside (Desktop)
        document.addEventListener('click', (e) => {
            if (this.isContextMenuOpen) {
                const menu = document.getElementById('island-context-menu');
                if (!menu || !menu.contains(e.target)) {
                    this.closeContextMenu();
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
            }
            if (this.isExpanded && !this.el.contains(e.target)) {
                this.collapseIsland();
            }
        });

        // Close when the window loses focus (clicking on taskbar, desktop, or other apps)
        window.addEventListener('blur', () => {
            this.closeContextMenu();
            this.collapseIsland();
        });

        window.addEventListener('liquid-ai-status', (e) => {
            if (e.detail === 'search') {
                this.setMode('search');
                // Force expand for search
                if (!this.isExpanded) {
                    this.isExpanded = true;
                    this.el.classList.remove('island-idle');
                    this.el.classList.add('island-expanded');
                }
                this.renderContent();
                // Focus search input after expansion animation
                setTimeout(() => {
                    const input = this.el.querySelector('#island-search-input');
                    if (input) input.focus();
                }, 400);
            } else if (e.detail === 'idle' && this.mode === 'search') {
                this.setMode('music');
                if (this.isExpanded) this.toggleExpand();
            }
        });

        window.addEventListener('liquid-search-hide', () => {
            if (this.mode === 'search') {
                this.setMode('music');
                if (this.isExpanded) this.toggleExpand();
            }
        });

        // Listen for keyboard specifically for search when expanded
        window.addEventListener('keydown', (e) => {
            if (this.mode !== 'search' || !this.isExpanded) return;

            if (e.key === 'Escape') {
                window.dispatchEvent(new CustomEvent('liquid-search-close'));
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('liquid-search-navigate', { detail: 1 }));
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('liquid-search-navigate', { detail: -1 }));
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('liquid-search-execute'));
            }
        });

        window.addEventListener('liquid-window-opened', () => {
            if (this.isExpanded) {
                this.mode = 'music';
                this.isExpanded = false;
                this.renderContent();
            }
        });

        window.addEventListener('liquid-island-config-changed', (e) => {
            this._islandConfig = e.detail;
            this._updateVizCanvas();
        });
        // --- Persistent Mode Logic ---
        if (ipcRenderer) {
            

            ipcRenderer.on('app-go-background', () => {
                this.isBackgroundMode = true;
                document.body.classList.add('liquid-background-mode');
                // Ensure island is active if it's supposed to be
                this.renderContent();
            });

            ipcRenderer.on('app-go-foreground', () => {
                this.isBackgroundMode = false;
                document.body.classList.remove('liquid-background-mode');
                this.renderContent();
            });

            ipcRenderer.on('open-search', () => {
                this.openSpotlightSearch();
            });

            // Hit testing for click-through
            this.el.addEventListener('mouseenter', () => {
                if (this.isBackgroundMode && (ipcRenderer)) {
                    ipcRenderer.send('set-ignore-mouse', false);
                }
            });

            this.el.addEventListener('mouseleave', () => {
                if (this.isBackgroundMode && (ipcRenderer)) {
                    ipcRenderer.send('set-ignore-mouse', true, { forward: true });
                }
            });

            window.addEventListener('liquid-island-persistent-changed', () => {
                this.syncPersistentSetting();
            });

            // --- Volume Scroll Support ---
            this.el.addEventListener('wheel', (e) => {
                // Allow scroll in idle or music mode
                if (this.isExpanded && this.mode !== 'music') return;

                e.preventDefault();
                const delta = e.deltaY < 0 ? 5 : -5;
                if (localStorage.getItem('liquid_player_wheel_app_volume') !== 'false') {
                    this.adjustCurrentMediaVolume(delta);
                } else {
                    this.adjustVolume(delta);
                }
            }, { passive: false });
        }
    },

    showContextMenu(x, y) {
        this.isContextMenuOpen = true;

        // Remove existing context menu if any (y compris un menu encore en train de se fermer)
        document.querySelectorAll('#island-context-menu, .context-menu.is-closing').forEach((menu) => menu.remove());
        if (this._contextMenuCloseHandler) {
            document.removeEventListener('click', this._contextMenuCloseHandler, true);
            this._contextMenuCloseHandler = null;
        }

        const isPlaying = Boolean(this.musicData?.isPlaying ?? this.isPlaying);
        // Les commandes de lecture n'ont de sens que s'il y a un morceau à piloter.
        const hasMedia = isHistoryTrack(this.musicData || {});
        const micOn = Boolean(this.micConfig?.enabled);
        const isCurrent = (mode) => this.isExpanded && this.mode === mode;
        const item = (action, icon, label, { extraClass = '', badge = '' } = {}) => `
            <button type="button" class="context-menu-item ${extraClass}" role="menuitem" data-action="${action}">
                <i class="ph ${icon}"></i>
                <span>${label}</span>
                ${isCurrent(action) ? '<i class="ph-bold ph-check context-menu-check" aria-label="Affiché"></i>' : badge}
            </button>`;
        const art = hasMedia ? getDisplayMediaArt(this.musicData) : '';
        // Pochette, titre et artiste : on voit ce que pilotent les boutons juste en dessous.
        const mediaSection = hasMedia ? `
            <div class="context-menu-now" aria-hidden="true">
                ${art ? `<img class="context-menu-now-art" src="${escapeHtml(art)}" alt="">` : '<span class="context-menu-now-art is-empty"><i class="ph-fill ph-music-note"></i></span>'}
                <span class="context-menu-now-text">
                    <span class="context-menu-now-title">${escapeHtml(this.musicData.title || '')}</span>
                    <span class="context-menu-now-artist">${escapeHtml(this.musicData.artist || '')}</span>
                </span>
            </div>
            <div class="context-menu-media" role="group" aria-label="Lecture">
                <button type="button" class="context-menu-media-btn" role="menuitem" data-action="prev" title="Précédent" aria-label="Précédent"><i class="ph-fill ph-skip-back"></i></button>
                <button type="button" class="context-menu-media-btn is-primary" role="menuitem" data-action="play" title="${isPlaying ? 'Pause' : 'Lecture'}" aria-label="${isPlaying ? 'Pause' : 'Lecture'}"><i class="ph-fill ${isPlaying ? 'ph-pause' : 'ph-play'}"></i></button>
                <button type="button" class="context-menu-media-btn" role="menuitem" data-action="next" title="Suivant" aria-label="Suivant"><i class="ph-fill ph-skip-forward"></i></button>
            </div>
            <div class="context-menu-separator"></div>` : '';

        // Thème choisi dans les Réglages (matière et couleur d'accent), relu à chaque ouverture.
        const readJson = (key) => {
            try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
        };
        const coverColors = readJson('liquid_cover_colors');
        const coverHex = hasMedia && coverColors.cover && localStorage.getItem('liquid_cover_color_sync') !== 'false' ? coverColors.primary : '';
        const look = themeLook(readJson('liquid_island_config'), coverHex);

        const menu = document.createElement('div');
        menu.id = 'island-context-menu';
        menu.className = `context-menu context-menu-${look.material}`;
        menu.style.setProperty('--menu-accent', look.accent);
        menu.style.setProperty('--menu-accent-rgb', look.accentRgb);
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;
        menu.innerHTML = `
            <div class="context-menu-bg"></div>
            ${mediaSection}
            ${item('music', 'ph-music-notes', 'Lecteur')}
            ${item('control', 'ph-squares-four', 'Centre de contrôle')}
            ${item('mixer', 'ph-sliders-horizontal', 'Mélangeur')}
            ${item('mic', 'ph-microphone', 'Retour micro', { badge: micOn ? '<span class="context-menu-badge">Activé</span>' : '' })}
            <div class="context-menu-separator"></div>
            ${item('layout', 'ph-arrows-out-cardinal', 'Déplacer et redimensionner')}
            ${item('settings', 'ph-gear-six', 'Réglages…')}
            <div class="context-menu-separator"></div>
            ${item('exit', 'ph-power', 'Quitter Nolys', { extraClass: 'danger' })}
        `;

        if (art) {
            const bgLayer = menu.querySelector('.context-menu-bg');
            bgLayer.style.backgroundImage = `url("${art.replace(/\\/g, '/').replace(/"/g, '%22')}")`;
            bgLayer.style.opacity = '0.3';
        }

        document.body.appendChild(menu);

        // Placement : on mesure le vrai menu et on le garde dans la fenêtre ;
        // l'animation part du coin le plus proche du curseur.
        const margin = 8;
        const { width, height } = menu.getBoundingClientRect();
        const openLeft = x + width + margin > window.innerWidth;
        const openUp = y + height + margin > window.innerHeight;
        menu.style.left = `${Math.max(margin, openLeft ? x - width : x)}px`;
        menu.style.top = `${Math.max(margin, openUp ? y - height : y)}px`;
        menu.style.transformOrigin = `${openLeft ? 'right' : 'left'} ${openUp ? 'bottom' : 'top'}`;

        const runAction = (action) => {
            this.closeContextMenu();
            if (action === 'music' || action === 'control' || action === 'mixer' || action === 'mic') {
                this.openExpandedMode(action);
            } else if (action === 'settings') {
                this.setMode('settings');
            } else if (action === 'layout') {
                ipcRenderer.send('set-layout-edit-mode', true);
            } else if (action === 'play') {
                window.spotifyControl('toggle');
            } else if (action === 'next' || action === 'prev') {
                window.spotifyControl(action);
            } else if (action === 'exit' && ipcRenderer) {
                ipcRenderer.send('exit-app');
            }
        };

        menu.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            e.stopPropagation();
            runAction(target.getAttribute('data-action'));
        });

        // Clavier : flèches pour naviguer, Entrée pour valider (bouton natif), Échap pour fermer.
        const entries = [...menu.querySelectorAll('[role="menuitem"]')];
        menu.addEventListener('keydown', (e) => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (step) {
                e.preventDefault();
                const index = entries.indexOf(document.activeElement);
                const next = index === -1 ? (step > 0 ? 0 : entries.length - 1) : (index + step + entries.length) % entries.length;
                entries[next].focus();
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                entries[e.key === 'Home' ? 0 : entries.length - 1].focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeContextMenu();
            }
        });
        // La souris et le clavier partagent la même surbrillance.
        menu.addEventListener('pointermove', (e) => {
            const target = e.target.closest('[role="menuitem"]');
            if (target && document.activeElement !== target) target.focus({ preventScroll: true });
        });
        menu.addEventListener('pointerleave', () => menu.focus({ preventScroll: true }));
        menu.focus({ preventScroll: true });

        // Close only the context menu on outside click; don't collapse/toggle the island.
        this._contextMenuCloseHandler = (event) => {
            const activeMenu = document.getElementById('island-context-menu');
            if (activeMenu && activeMenu.contains(event.target)) return;

            event.stopPropagation();
            event.preventDefault();
            this.closeContextMenu();
        };
        // Delay attaching click listener to prevent immediate closing
        setTimeout(() => {
            if (this._contextMenuCloseHandler) {
                document.addEventListener('click', this._contextMenuCloseHandler, true);
            }
        }, 50);
    },

    closeContextMenu() {
        this.isContextMenuOpen = false;
        if (this._contextMenuCloseHandler) {
            document.removeEventListener('click', this._contextMenuCloseHandler, true);
            this._contextMenuCloseHandler = null;
        }
        // Petit fondu de sortie : le menu ne disparaît plus d'un coup. Il perd son id tout de
        // suite (plus compté comme ouvert ni comme zone cliquable) et ne réagit plus à la souris.
        const menu = document.getElementById('island-context-menu');
        if (menu) {
            menu.removeAttribute('id');
            menu.classList.add('is-closing');
            setTimeout(() => menu.remove(), 140);
        }
        if (!this.isExpanded && !this._layoutEditMode && ipcRenderer) {
            try {
                ipcRenderer.send('set-ignore-mouse', true, { forward: true });
            } catch (e) {}
        }
    },

    updateScrubPosition(e) {
        if (!this.scrubbingBar) return;
        const rect = this.scrubbingBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const clickPct = Math.max(0, Math.min(1, clickX / width));
        
        const data = this.musicData;
        if (data && data.duration) {
            const targetMs = Math.round(clickPct * data.duration);
            
            // Butter-smooth real-time visual feedback
            const currentFill = this.content.querySelector('#music-progress-fill');
            const currentTimeSpan = this.content.querySelector('#music-current-time');
            if (currentFill) currentFill.style.width = (clickPct * 100) + '%';
            if (currentTimeSpan) currentTimeSpan.innerText = formatTime(targetMs);
            this.scrubbingBar.style.setProperty('--progress-pct', (clickPct * 100) + '%');
            
            // Update elastic tooltip position and text during dragging
            this.scrubbingBar.style.setProperty('--tooltip-pct', (clickPct * 100) + '%');
            const tooltip = this.scrubbingBar.querySelector('#music-progress-tooltip');
            if (tooltip) tooltip.innerText = formatTime(targetMs);
        }
    },
};
