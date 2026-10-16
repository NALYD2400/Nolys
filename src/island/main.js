/**
 * Point d'entrée de la fenêtre de l'Island : services, API globales historiques
 * (`window.island`, `window.spotifyControl`…) et écoute des réglages.
 */
import { ipcRenderer, native } from '../shared/ipc.js';
import { LocalMusicPlayer } from '../services/LocalMusicPlayer.js';
import { disableNativeContextMenu } from '../shared/context-menu.js';
import { enableWindowDragging } from '../shared/window-drag.js';
import { ThemeService } from '../services/ThemeService.js';
import { visualizerService } from '../services/AudioVisualizerService.js';
import { DynamicIsland } from './dynamic-island/DynamicIsland.js';
import { trackHitRegion } from './hit-region.js';

let mediaControlSyncToken = 0;

// 1. BOOTSTRAP LEGACY GLOBAL APIs FOR 100% PARITY
window.wm = {
    open(widget) {
        if (widget === 'settings') {
            if (window.island) {
                window.island.setMode('settings');
            }
        }
    },
    toggle(widget) {
        this.open(widget);
    }
};

window.spotifyControl = async (action) => {
    try {
        if (window.island?.localPlayer?.active) {
            await window.island.localPlayer.control({ type: 'media', action });
            return;
        }
        const cleanAction = String(action || '').trim().toLowerCase();
        let actionToSend = action;
        const isPlaybackAction = ['toggle', 'play', 'pause'].includes(cleanAction);
        const syncToken = isPlaybackAction ? ++mediaControlSyncToken : mediaControlSyncToken;

        if (window.island && isPlaybackAction) {
            const nextPlaying = cleanAction === 'toggle' ? !window.island.isPlaying : cleanAction === 'play';
            actionToSend = nextPlaying ? 'play' : 'pause';
            if (typeof window.island.applyOptimisticPlaybackState === 'function') {
                window.island.applyOptimisticPlaybackState(nextPlaying);
            }
        }

        ipcRenderer.send('spotify-control', actionToSend);
        // Browser players can lag behind SMTC after pause; resync several times.
        if (window.island && window.island.updateMediaState) {
            [120, 450, 1200, 3200, 6800].forEach((delay) => {
                setTimeout(() => {
                    if (!isPlaybackAction || syncToken === mediaControlSyncToken) {
                        window.island.updateMediaState();
                    }
                }, delay);
            });
        }
    } catch (e) {
        console.error(e);
    }
};

// 2. INITIALIZE SERVICES & ISLAND CLASS
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Island Widget] Bootstrapping Nolys...');
    
    // Theme setup
    ThemeService.applyGlobalTheme();
    ThemeService.applyIslandSettings();

    // Create the exact original DynamicIsland class
    const island = new DynamicIsland();
    window.island = island;
    island.localPlayer = new LocalMusicPlayer({
        ...native,
        onMedia: media => { if (media) island.updateMusic(media); else island.updateMediaState(); },
        onError: message => island.showNotification('Bibliothèque', message, 'ph-warning-circle'),
    });
    island.localPlayer.init().catch(error => console.warn('[Library]', error));
    native.listen('local-library-open', () => island.openLibrary()).catch(error => console.warn('[Library]', error));

    // Première fois seulement : Windows range l'icône de la barre dans la zone masquée (flèche ^).
    // Une indication dans l'Island évite de croire que l'app n'a pas démarré.
    const TRAY_HINT_KEY = 'liquid_tray_hint_shown';
    try {
        if (localStorage.getItem(TRAY_HINT_KEY) !== 'true') {
            setTimeout(() => {
                island.showNotification(
                    'Icône dans la barre des tâches',
                    'Elle est dans la flèche ^ à côté de l’horloge. Glisse-la sur la barre pour la garder visible.',
                    'ph-push-pin',
                );
                localStorage.setItem(TRAY_HINT_KEY, 'true');
            }, 4000);
        }
    } catch (e) {
        // Stockage indisponible : pas d'indication, rien d'autre ne casse.
    }

    // Send the initial wallpaper sync status to the main process
    const isWallpaperSync = localStorage.getItem('liquid_wallpaper_sync') === 'true';
    const wallpaperSyncStyle = localStorage.getItem('liquid_wallpaper_sync_style') || 'blur';
    const wallpaperBlurIntensity = localStorage.getItem('liquid_wallpaper_blur_intensity') || 'moderate';
    const wallpaperDarken = parseInt(localStorage.getItem('liquid_wallpaper_darken') || '20');
    const wallpaperDelay = parseInt(localStorage.getItem('liquid_wallpaper_delay') || '800');
    ipcRenderer.send('wallpaper-sync-status', {
        enabled: isWallpaperSync,
        style: wallpaperSyncStyle,
        intensity: wallpaperBlurIntensity,
        darken: wallpaperDarken,
        delay: wallpaperDelay
    });

    // Masquer l'Island quand une application plein écran (jeu, vidéo) est au premier plan.
    ipcRenderer.send('set-game-detection', localStorage.getItem('liquid_game_detection_enabled') !== 'false');

    ipcRenderer.invoke('get-layout-state').then((state) => {
        if (!state || !window.island) return;
        if (state.layout) {
            localStorage.setItem('liquid_layout_config', JSON.stringify(state.layout));
            window.island.applyLayoutConfig(state.layout);
        }
        window.island.setLayoutEditMode(Boolean(state.editMode));
    }).catch((err) => {
        console.warn('[Layout] Failed to load initial state:', err);
    });

    // 3. SECURE CLICK-THROUGH HOVER BOUNDARIES
    const capsule = document.getElementById('dynamic-island');
    trackHitRegion();
    enableWindowDragging();
    disableNativeContextMenu();

    capsule.addEventListener('mouseenter', () => {
        // Enforce mouse capture when hovering over the active pill
        ipcRenderer.send('set-ignore-mouse', false);
    });

    capsule.addEventListener('mouseleave', () => {
        // Enforce click-through when leaving the idle pill, unless context menu is active
        if (!island.isExpanded && !island.isContextMenuOpen && !island._layoutEditMode) {
            ipcRenderer.send('set-ignore-mouse', true, { forward: true });
        }
    });

    // Listen to settings configurations IPC changes in real-time
    const applyConfig = (config) => {
        if (config.aiAgentMonitor !== undefined) {
            localStorage.setItem('liquid_ai_agent_monitor', config.aiAgentMonitor);
        }
        // Save in localStorage so ThemeService and DynamicIsland can fetch them!
        if (config.glow) {
            localStorage.setItem('liquid_island_config', JSON.stringify(config.glow));
            if (window.island) {
                window.island._islandConfig = config.glow;
            }
        }
        if (config.modules) {
            if (config.modules.music !== undefined) localStorage.setItem('liquid_music_enabled', config.modules.music);
            if (config.modules.timer !== undefined) localStorage.setItem('liquid_island_timer_enabled', config.modules.timer);
            if (config.modules.control !== undefined) localStorage.setItem('liquid_island_control_enabled', config.modules.control);
            if (config.modules.gameDetection !== undefined) localStorage.setItem('liquid_game_detection_enabled', config.modules.gameDetection);
        }
        if (config.ecoMode !== undefined && String(config.ecoMode) !== localStorage.getItem('liquid_eco_mode')) {
            window.dispatchEvent(new CustomEvent('liquid-eco-mode-changed', { detail: Boolean(config.ecoMode) }));
        }
        if (config.maxFps !== undefined) {
            localStorage.setItem('liquid_max_fps', config.maxFps);
            if (window.island) window.island.setMaxFps(Number(config.maxFps));
        }
        if (config.idleCompactMode !== undefined) {
            localStorage.setItem('liquid_idle_compact_mode', config.idleCompactMode);
            if (window.island) window.island._vizCanvas = null;
        }
        if (config.isPersistent !== undefined) {
            localStorage.setItem('liquid_island_persistent', config.isPersistent);
            if (window.island && typeof window.island.syncPersistentSetting === 'function') {
                window.island.syncPersistentSetting();
            }
        }
        if (config.isCoverSync !== undefined) {
            localStorage.setItem('liquid_cover_color_sync', config.isCoverSync);
        }
        if (config.isIdleCoverBg !== undefined) {
            localStorage.setItem('liquid_island_idle_cover_bg', config.isIdleCoverBg);
        }
        if (config.isWallpaperSync !== undefined) {
            localStorage.setItem('liquid_wallpaper_sync', config.isWallpaperSync);
        }
        if (config.wallpaperSyncStyle !== undefined) {
            localStorage.setItem('liquid_wallpaper_sync_style', config.wallpaperSyncStyle);
        }
        if (config.wallpaperBlurIntensity !== undefined) {
            localStorage.setItem('liquid_wallpaper_blur_intensity', config.wallpaperBlurIntensity);
        }
        if (config.wallpaperDarken !== undefined) {
            localStorage.setItem('liquid_wallpaper_darken', config.wallpaperDarken);
        }
        if (config.wallpaperDelay !== undefined) {
            localStorage.setItem('liquid_wallpaper_delay', config.wallpaperDelay);
        }
        if (config.visualizerMode !== undefined) {
            localStorage.setItem('liquid_visualizer_mode', config.visualizerMode);
            if (visualizerService) {
                visualizerService.setMode(config.visualizerMode).catch(() => {});
            }
        }
        if (config.visualizerSensitivity !== undefined) {
            localStorage.setItem('liquid_visualizer_sensitivity', config.visualizerSensitivity);
        }
        if (config.hotkeys !== undefined) {
            localStorage.setItem('liquid_hotkeys', JSON.stringify(config.hotkeys));
        }
        if (config.widgetType !== undefined) {
            localStorage.setItem('liquid_control_widget_type', config.widgetType);
        }
        if (config.activeProfile !== undefined) {
            localStorage.setItem('liquid_active_profile', config.activeProfile);
        }
        if (config.shortcuts !== undefined) {
            localStorage.setItem('liquid_control_shortcuts', JSON.stringify(config.shortcuts));
        }
        if (config.player !== undefined) {
            if (config.player.showTimes !== undefined) localStorage.setItem('liquid_player_show_times', config.player.showTimes);
            if (config.player.showVisualizer !== undefined) localStorage.setItem('liquid_player_show_visualizer', config.player.showVisualizer);
            if (config.player.showActions !== undefined) localStorage.setItem('liquid_player_show_actions', config.player.showActions);
            if (config.player.wheelAppVolume !== undefined) localStorage.setItem('liquid_player_wheel_app_volume', config.player.wheelAppVolume);
        }
        
        // Niveau de mouvement : appliqué tout de suite (il n'était lu qu'au démarrage), avant le
        // nouveau rendu qui en dépend (défilement des titres en mode sobre).
        if (config.motion !== undefined) {
            localStorage.setItem('liquid_motion_level', config.motion);
            window.island?.syncMotionPreference?.();
        }

        // Un profil rapide peut avoir changé le mode Focus (écrit dans le stockage partagé).
        document.body.classList.toggle('focus-mode-active', localStorage.getItem('liquid_focus_mode') === 'true');

        // Re-apply styles
        ThemeService.applyIslandSettings();
        
        // Force refresh DynamicIsland rendering if expanded
        if (window.island) {
            window.island.renderContent();
        }
        
        // Broadcast custom change event
        window.dispatchEvent(new CustomEvent('liquid-island-config-changed', { detail: config.glow }));
    };

    // Réglages modifiés : on n'applique que le dernier reçu, au plus une fois toutes les 16 ms.
    // Chaque application redessine toute l'Island ; pendant qu'on glisse un curseur, les envois
    // s'empilaient plus vite qu'ils n'étaient traités et l'Island affichait avec du retard.
    // (Chaque envoi contient tous les réglages : sauter les intermédiaires ne perd rien.)
    let pendingConfig = null;
    ipcRenderer.on('config-changed', (event, config) => {
        const scheduled = pendingConfig !== null;
        pendingConfig = config || {};
        if (scheduled) return;
        setTimeout(() => {
            const next = pendingConfig;
            pendingConfig = null;
            applyConfig(next);
        }, 16);
    });

    // Listen to custom alert triggers
    ipcRenderer.on('trigger-notif', (event, data) => {
        if (!data || typeof data !== 'object') return;
        if (window.island && typeof window.island.showNotification === 'function') {
            window.island.showNotification(data.title, data.message, data.icon);
        }
    });

    ipcRenderer.on('layout-config-changed', (event, layout) => {
        if (!window.island || !layout) return;
        localStorage.setItem('liquid_layout_config', JSON.stringify(layout));
        window.island.applyLayoutConfig(layout);
    });

    // Fenêtre masquée (plein écran, raccourci) : animations en pause tant que rien n'est visible.
    ipcRenderer.on('island-visibility-changed', (event, visible) => {
        if (window.island) window.island.setWindowHidden(!visible);
    });

    ipcRenderer.on('layout-edit-mode-changed', (event, enabled) => {
        if (!window.island) return;
        window.island.setLayoutEditMode(Boolean(enabled));
    });

    // Raccourcis « ouvrir le lecteur / centre de contrôle / retour micro » : même ouverture que le clic droit.
    ipcRenderer.on('shortcut-open-mode', (event, mode) => {
        if (window.island && ['music', 'control', 'mic', 'mixer'].includes(mode)) {
            window.island.openExpandedMode(mode);
        }
    });
});
