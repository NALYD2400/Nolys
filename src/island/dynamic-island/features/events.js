/** Écouteurs d’événements, menu contextuel et barre de progression. */
import { ipcRenderer, native } from '../../../shared/ipc.js';
import { escapeHtml, formatTime } from '../helpers/format.js';
import { getDisplayMediaArt } from '../helpers/media-art.js';
import { isHistoryTrack } from '../helpers/music-search.js';
import { themeLook } from '../../../shared/theme-look.js';
import { readMenus, visibleMenuEntries } from '../../../shared/menu-config.js';
import { isTextInputEvent } from '../../../shared/context-menu.js';
import { renderModuleArtwork } from '../../../shared/module-art.js';

/** Méthodes de l'Island qu'un bouton peut appeler par `data-island-action` (liste fermée). */
const ISLAND_ACTIONS = new Set([
    'setMode', 'openSettings', 'updateAudioSessions', 'dismissNotification', 'toggleCurrentMusicFavorite',
    'toggleAudioDeviceDropdown', 'toggleMicDeviceDropdown', 'selectAudioDevice', 'selectMicDevice',
    'setTimerMode', 'resetTimer', 'toggleTimer', 'openCompactActivity',
]);

export const eventMethods = {
    initEvents() {
        // Les menus locaux traitent l'événement avant ce repli commun à toutes les vues.
        this.el.addEventListener('contextmenu', (e) => {
            if (e.defaultPrevented || isTextInputEvent(e)) return;
            e.preventDefault();
            e.stopPropagation();
            if (this._fileReceiving) return;
            this.showContextMenu(e.clientX, e.clientY);
        });

        this.el.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isTextInputEvent(e) || this._fileReceiving) return;
            if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
            e.preventDefault();
            e.stopPropagation();
            const target = e.composedPath().find(node => node instanceof Element);
            const rect = (target || this.el).getBoundingClientRect();
            this.showContextMenu(rect.left, rect.bottom);
            document.querySelector('#island-context-menu [role="menuitem"]')?.focus({ preventScroll: true });
        });

        this.el.addEventListener('click', (e) => {
            if (this.mode === 'files' || this._fileReceiving) return;
            if (this._layoutEditMode) return;
            if (this.mode === 'library' || this.mode === 'settings' || this.mode === 'replay') return;
            if (this.isExpanded && (this.mode === 'search' || this.mode === 'music-search' || this.mode === 'music-history' || this.mode === 'control' || this.mode === 'mixer' || this.mode === 'mic')) return; // Don't toggle expansion on interactive screens

            if (this.mode === 'ai-thinking' || this.mode === 'ai-action') {
                window.dispatchEvent(new CustomEvent('liquid-open-widget', { detail: 'ai' }));
                return;
            }

            if (this.mode === 'notification') {
                if (!this.isExpanded) this.expandNotification();
                return;
            }
            this.toggleExpand();
        });

        this.el.addEventListener('keydown', (e) => {
            if (this.mode !== 'notification' || this._layoutEditMode) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                this.dismissNotification();
            } else if (!this.isExpanded && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.expandNotification();
            }
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
            const ecoHadFocus = document.activeElement?.id === 'ic-eco';
            localStorage.setItem('liquid_eco_mode', !!e.detail);
            this.syncEcoMode();
            this.renderContent();
            if (ecoHadFocus) this.content.querySelector('#ic-eco')?.focus({ preventScroll: true });
        });

        // Permanent delegated mousedown listener for progress bar scrubbing (persists across re-renders)
        this.content.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
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
            if (e.button !== 0) return;
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
        this.content.addEventListener('input', event => {
            const slider = event.target.closest('.mixer-volume-slider, .ic-mixer-slider');
            if (slider) this.setMixerVolume(slider, Number(slider.value));
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

        // Boutons des vues : `data-island-action` (et `data-arg`) au lieu de onclick en ligne,
        // interdits par la CSP. Écouté avant les autres : le clic ne remonte pas jusqu'à la
        // capsule (sinon elle se replierait), comme avec l'ancien event.stopPropagation().
        this.content.addEventListener('click', (e) => {
            const button = e.target.closest('[data-island-action]');
            if (!button || !this.content.contains(button)) return;
            e.stopImmediatePropagation();
            const { islandAction: action, arg } = button.dataset;
            if (action === 'media') window.spotifyControl?.(arg);
            else if (action === 'closeSearch') window.dispatchEvent(new CustomEvent('liquid-search-close'));
            else if (action === 'setTimerPreset') this.setTimerPreset(Number(arg));
            else if (ISLAND_ACTIONS.has(action)) arg === undefined ? this[action]() : this[action](arg);
        });

        // Image qui ne charge pas (`data-fallback`) : icône voisine, ou pastille note de musique.
        this.el.addEventListener('error', (e) => {
            const image = e.target;
            if (!(image instanceof HTMLImageElement) || !image.dataset.fallback) return;
            if (image.dataset.fallback === 'next') {
                image.style.display = 'none';
                if (image.nextElementSibling) image.nextElementSibling.style.display = 'inline-flex';
            } else if (image.dataset.fallback === 'note') {
                const note = document.createElement('div');
                note.className = 'idle-cover-fallback';
                note.style.borderRadius = image.style.borderRadius;
                note.innerHTML = '<i class="ph ph-music-note"></i>';
                image.replaceWith(note);
            }
        }, true);

        // Prevent click events on specific child elements from bubbling and collapsing the island
        this.content.addEventListener('click', (e) => {
            if (e.target.closest('.progress-bar, .music-search-panel, .mixer-volume-slider, .ic-mixer-slider, .mixer-mute-btn, .ic-mixer-mute')) {
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
            // Le bouton peut avoir été remplacé pendant son clic (mode éco).
            // Le chemin d'origine reste fiable, même lorsque la cible est détachée.
            if (this.isExpanded && !e.composedPath().includes(this.el)) {
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
        if (!this.isContextMenuOpen) {
            let focused = document.activeElement;
            while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
            this._contextMenuReturnFocus = focused;
        }
        this.isContextMenuOpen = true;
        ipcRenderer?.send('set-ignore-mouse', false);

        // Remove existing context menu if any (y compris un menu encore en train de se fermer)
        document.querySelectorAll('#island-context-menu, .context-menu.is-closing').forEach((menu) => menu.remove());
        if (this._contextMenuCloseHandler) {
            document.removeEventListener('click', this._contextMenuCloseHandler, true);
            this._contextMenuCloseHandler = null;
        }

        const isPlaying = Boolean(this.musicData?.isPlaying ?? this.isPlaying);
        // Les commandes de lecture n'ont de sens que s'il y a un morceau à piloter.
        const menus = readMenus();
        const menuEntries = visibleMenuEntries('context', menus);
        const hasMedia = menus.showMedia && isHistoryTrack(this.musicData || {});
        const micOn = Boolean(this.micConfig?.enabled);
        const isCurrent = (mode) => this.isExpanded && this.mode === mode;
        const item = (action, icon, label, { extraClass = '', badge = '', command } = {}) => `
            <button type="button" class="context-menu-item ${extraClass}" role="menuitem" data-action="${action}">
                ${renderModuleArtwork(action, command) || `<i class="ph ${icon}" aria-hidden="true"></i>`}
                <span>${escapeHtml(label)}</span>
                ${isCurrent(action) ? '<i class="ph-bold ph-check context-menu-check" aria-hidden="true"></i>' : badge}
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
        menu.setAttribute('aria-label', 'Raccourcis Nolys');
        menu.tabIndex = -1;
        menu.innerHTML = `
            <div class="context-menu-bg"></div>
            ${mediaSection}
            <div class="context-menu-entries">
                ${menuEntries.map(entry => item(entry.id, entry.icon, entry.label, {
                    command: entry.cmd,
                    extraClass: entry.id === 'exit' ? 'danger' : '',
                    badge: entry.id === 'mic' && micOn ? '<span class="context-menu-badge">Activé</span>' : '',
                })).join('')}
            </div>
            <div class="context-menu-separator" role="separator"></div>
            ${item('customize-menu', 'ph-pencil-simple', 'Personnaliser ce menu…')}
        `;

        if (art) {
            const bgLayer = menu.querySelector('.context-menu-bg');
            bgLayer.style.backgroundImage = `url("${art.replace(/\\/g, '/').replace(/"/g, '%22')}")`;
            bgLayer.style.opacity = '0.3';
        }

        document.body.appendChild(menu);

        // Placement : on mesure le vrai menu et on le garde dans la fenêtre ;
        // l'animation part du coin le plus proche du curseur.
        const position = (area) => {
            // Petite marge au bord du moniteur. Sans information native, garder
            // la réserve d'ombre de la fixture limitée à sa seule WebView.
            const inset = area ? 8 : 80;
            const left = Math.max(inset, (area?.x ?? -80) + 8);
            const top = Math.max(inset, (area?.y ?? -80) + 8);
            const right = Math.min(innerWidth - inset, area ? area.x + area.width - 8 : innerWidth);
            const bottom = Math.min(innerHeight - inset, area ? area.y + area.height - 8 : innerHeight);
            const availableWidth = Math.max(1, right - left), availableHeight = Math.max(1, bottom - top);
            menu.style.minWidth = `${Math.min(196, availableWidth)}px`;
            menu.style.maxWidth = `${availableWidth}px`;
            menu.style.maxHeight = `${availableHeight}px`;
            const width = menu.offsetWidth, height = menu.offsetHeight;
            const openLeft = x + width > right, openUp = y + height > bottom;
            menu.style.left = `${Math.max(left, Math.min(right - width, openLeft ? x - width : x))}px`;
            menu.style.top = `${Math.max(top, Math.min(bottom - height, openUp ? y - height : y))}px`;
            menu.style.transformOrigin = `${openLeft ? 'right' : 'left'} ${openUp ? 'bottom' : 'top'}`;
            window.dispatchEvent(new Event('nolys-hit-region-changed'));
        };
        position();
        // Attendre la zone réelle du moniteur avant le premier affichage : la
        // fenêtre transparente peut dépasser du bureau, notamment près du bas.
        menu.style.opacity = '0';
        menu.style.animation = 'none';
        native.invoke('context_menu_viewport', { size: [menu.offsetWidth, menu.offsetHeight] }).then(area => {
            if (menu.id !== 'island-context-menu' || !menu.isConnected) return;
            position(area || undefined);
        }).catch(() => {}).finally(() => {
            if (menu.id === 'island-context-menu' && menu.isConnected) {
                menu.style.opacity = '';
                menu.style.animation = '';
            }
        });

        const runAction = (action) => {
            this.closeContextMenu();
            const entry = menuEntries.find(item => item.id === action);
            if (action === 'customize-menu') {
                this.setMode('settings', { page: 'menus' });
            } else if (entry) {
                this.activateMenuEntry(entry);
            } else if (action === 'play') {
                window.spotifyControl('toggle');
            } else if (action === 'next' || action === 'prev') {
                window.spotifyControl(action);
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
        entries.forEach(entry => { entry.tabIndex = -1; });
        menu.addEventListener('keydown', (e) => {
            e.stopPropagation();
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
                this.closeContextMenu({ restoreFocus: true });
            } else if (e.key === 'Tab') {
                this.closeContextMenu({ restoreFocus: true });
            }
        });
        menu.addEventListener('contextmenu', event => event.preventDefault());
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

    closeContextMenu({ restoreFocus = false } = {}) {
        this.isContextMenuOpen = false;
        if (this._contextMenuCloseHandler) {
            document.removeEventListener('click', this._contextMenuCloseHandler, true);
            this._contextMenuCloseHandler = null;
        }
        // Petit fondu de sortie : le menu ne disparaît plus d'un coup. Il perd son id tout de
        // suite (plus compté comme ouvert ni comme zone cliquable) et ne réagit plus à la souris.
        const menu = document.getElementById('island-context-menu');
        if (menu) {
            if (restoreFocus && this._contextMenuReturnFocus?.isConnected) {
                this._contextMenuReturnFocus.focus({ preventScroll: true });
            }
            menu.inert = true;
            menu.removeAttribute('id');
            menu.classList.add('is-closing');
            setTimeout(() => {
                menu.remove();
                if (!document.getElementById('island-context-menu')) native.invoke('context_menu_viewport', { size: null }).catch(() => {});
            }, 140);
        }
        this._contextMenuReturnFocus = null;
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
