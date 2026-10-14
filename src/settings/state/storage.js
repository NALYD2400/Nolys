/**
 * Lecture et écriture des réglages.
 *
 * Les réglages vivent dans le localStorage partagé avec l'Island, sous les
 * mêmes clés qu'avant. Chaque modification est aussi envoyée à l'Island via
 * `config-changed`, au format qu'elle sait déjà interpréter (island/main.js).
 */
import { DEFAULT_SHORTCUTS } from './presets.js';
import { readHotkeys, sanitizeHotkeys } from '../../shared/hotkeys.js';

const read = (key, fallback = null) => {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
};
const readJson = (key, fallback) => {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};
const flag = (key) => read(key) !== 'false'; // activé par défaut
const optIn = (key) => read(key) === 'true'; // désactivé par défaut
const number = (key, fallback) => {
    const parsed = Number(read(key));
    return read(key) !== null && Number.isFinite(parsed) ? parsed : fallback;
};

export function loadSettings() {
    const glow = readJson('liquid_island_config', {});
    const motion = read('liquid_motion_level', 'fluid');
    const shortcuts = readJson('liquid_control_shortcuts', DEFAULT_SHORTCUTS);

    return {
        // Général
        // Au premier plan par défaut : une Island cachée derrière le navigateur ne sert à rien.
        persistent: flag('liquid_island_persistent'),
        gameDetection: flag('liquid_game_detection_enabled'),
        notifications: flag('liquid_notifications_enabled'),
        soundEffects: flag('liquid_sound_effects_enabled'),
        ecoMode: optIn('liquid_eco_mode'),
        hotkeys: readHotkeys(),
        activeProfile: read('liquid_active_profile', 'custom'),

        // Apparence
        motion: ['sober', 'fluid', 'vivid'].includes(motion) ? motion : 'fluid',
        opacity: glow.opacity ?? 92,
        blur: glow.blur ?? 30,
        materialStyle: glow.materialStyle || 'glass',
        grainEffect: glow.grainEffect || 'none',
        glassControls: glow.glassControls !== false,
        glowEnabled: glow.glowEnabled !== false,
        glowDensity: glow.glowDensity ?? 20,
        glowColorMode: glow.glowColorMode || 'mix',
        glowBlend: glow.glowBlend ?? 65,
        glowColor: glow.glowColor || '#D49460',
        coverSync: flag('liquid_cover_color_sync'),
        idleCoverBg: flag('liquid_island_idle_cover_bg'),

        // Musique
        musicEnabled: flag('liquid_music_enabled'),
        idleCompactMode: read('liquid_idle_compact_mode', 'cover'),
        showTimes: flag('liquid_player_show_times'),
        showVisualizer: flag('liquid_player_show_visualizer'),
        showActions: flag('liquid_player_show_actions'),
        wheelAppVolume: flag('liquid_player_wheel_app_volume'),
        vizColorMode: glow.vizColorMode || 'cover',
        vizColorSolid: glow.vizColorSolid || '#D49460',
        vizColorGradA: glow.vizColorGradA || '#D49460',
        vizColorGradB: glow.vizColorGradB || '#EDBC89',
        visualizerSensitivity: number('liquid_visualizer_sensitivity', 2.5),
        visualizerMode: read('liquid_visualizer_mode', 'real'),
        vizStyle: glow.vizStyle || 'capsules',
        vizBars: glow.vizBars ?? 5,
        vizGlow: glow.vizGlow !== false,
        vizInPill: glow.vizInPill !== false,

        // Pilule et lecteur
        pillCoverShape: glow.pillCoverShape || 'round',
        pillShowTitle: glow.pillShowTitle !== false,
        pillMaxWidth: glow.pillMaxWidth ?? 240,
        titleScroll: glow.titleScroll !== false,
        playerCoverBg: glow.playerCoverBg ?? 50,
        glowBreath: glow.glowBreath !== false,

        // Fond d'écran
        wallpaperSync: optIn('liquid_wallpaper_sync'),
        wallpaperSyncStyle: read('liquid_wallpaper_sync_style', 'blur'),
        wallpaperBlurIntensity: read('liquid_wallpaper_blur_intensity', 'moderate'),
        wallpaperDarken: number('liquid_wallpaper_darken', 20),
        wallpaperDelay: number('liquid_wallpaper_delay', 800),

        // Centre de contrôle
        controlEnabled: flag('liquid_island_control_enabled'),
        timerEnabled: flag('liquid_island_timer_enabled'),
        widgetType: read('liquid_control_widget_type', 'launchpad'),
        weatherCity: read('liquid_weather_city', ''),
        shortcuts: Array.isArray(shortcuts) ? DEFAULT_SHORTCUTS.map((fallback, i) => shortcuts[i] || fallback) : DEFAULT_SHORTCUTS,
    };
}

/** Message `config-changed` attendu par l'Island. */
export function buildConfig(s) {
    return {
        preset: readJson('island_standalone_config', {}).preset || 'copper',
        isPersistent: s.persistent,
        motion: s.motion,
        notifications: s.notifications,
        ecoMode: s.ecoMode,
        idleCompactMode: s.idleCompactMode,
        isCoverSync: s.coverSync,
        isIdleCoverBg: s.idleCoverBg,
        isWallpaperSync: s.wallpaperSync,
        wallpaperSyncStyle: s.wallpaperSyncStyle,
        wallpaperBlurIntensity: s.wallpaperBlurIntensity,
        wallpaperDarken: s.wallpaperDarken,
        wallpaperDelay: s.wallpaperDelay,
        visualizerMode: s.visualizerMode,
        visualizerSensitivity: s.visualizerSensitivity,
        hotkeys: s.hotkeys,
        widgetType: s.widgetType,
        activeProfile: s.activeProfile,
        shortcuts: s.shortcuts,
        player: {
            showTimes: s.showTimes,
            showVisualizer: s.showVisualizer,
            showActions: s.showActions,
            wheelAppVolume: s.wheelAppVolume,
        },
        modules: {
            music: s.musicEnabled,
            timer: s.timerEnabled,
            control: s.controlEnabled,
            gameDetection: s.gameDetection,
        },
        glow: {
            opacity: s.opacity,
            blur: s.blur,
            glowEnabled: s.glowEnabled,
            glowDensity: s.glowDensity,
            glowColorMode: s.glowColorMode,
            glowBlend: s.glowBlend,
            glowColor: s.glowColor,
            bgImage: '',
            imgOpacity: 100,
            vizColorMode: s.vizColorMode,
            vizColorSolid: s.vizColorSolid,
            vizColorGradA: s.vizColorGradA,
            vizColorGradB: s.vizColorGradB,
            materialStyle: s.materialStyle,
            grainEffect: s.grainEffect,
            glassControls: s.glassControls,
            vizStyle: s.vizStyle,
            vizBars: s.vizBars,
            vizGlow: s.vizGlow,
            vizInPill: s.vizInPill,
            pillCoverShape: s.pillCoverShape,
            pillShowTitle: s.pillShowTitle,
            pillMaxWidth: s.pillMaxWidth,
            titleScroll: s.titleScroll,
            playerCoverBg: s.playerCoverBg,
            glowBreath: s.glowBreath,
        },
    };
}

/** Enregistre les réglages sous les clés historiques. */
export function saveSettings(s) {
    const config = buildConfig(s);
    const entries = {
        island_standalone_config: JSON.stringify(config),
        liquid_island_config: JSON.stringify(config.glow),
        liquid_motion_level: s.motion,
        liquid_notifications_enabled: s.notifications,
        liquid_music_enabled: s.musicEnabled,
        liquid_island_timer_enabled: s.timerEnabled,
        liquid_island_control_enabled: s.controlEnabled,
        liquid_game_detection_enabled: s.gameDetection,
        liquid_sound_effects_enabled: s.soundEffects,
        liquid_island_persistent: s.persistent,
        liquid_cover_color_sync: s.coverSync,
        liquid_island_idle_cover_bg: s.idleCoverBg,
        liquid_wallpaper_sync: s.wallpaperSync,
        liquid_wallpaper_sync_style: s.wallpaperSyncStyle,
        liquid_wallpaper_blur_intensity: s.wallpaperBlurIntensity,
        liquid_wallpaper_darken: s.wallpaperDarken,
        liquid_wallpaper_delay: s.wallpaperDelay,
        liquid_visualizer_mode: s.visualizerMode,
        liquid_visualizer_sensitivity: s.visualizerSensitivity,
        liquid_hotkeys: JSON.stringify(s.hotkeys),
        liquid_control_widget_type: s.widgetType,
        liquid_weather_city: (s.weatherCity || '').trim(),
        liquid_control_shortcuts: JSON.stringify(s.shortcuts),
        liquid_active_profile: s.activeProfile,
        liquid_player_show_times: s.showTimes,
        liquid_player_show_visualizer: s.showVisualizer,
        liquid_player_show_actions: s.showActions,
        liquid_player_wheel_app_volume: s.wheelAppVolume,
        // liquid_eco_mode et liquid_idle_compact_mode sont écrits par l'Island,
        // qui détecte ainsi le changement et se met à jour.
    };
    for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, String(value));
    }
    return config;
}

// ---------------------------------------------------------------- Profils et sauvegardes

/** Instantané au format des profils et fichiers d'export existants. */
export function toSnapshot(s, layout) {
    const config = buildConfig(s);
    return {
        motion: s.motion,
        widgetType: s.widgetType,
        persistent: s.persistent,
        notifications: s.notifications,
        coverSync: s.coverSync,
        idleCoverBg: s.idleCoverBg,
        wallpaperSync: s.wallpaperSync,
        wallpaperSyncStyle: s.wallpaperSyncStyle,
        wallpaperBlurIntensity: s.wallpaperBlurIntensity,
        wallpaperDarken: s.wallpaperDarken,
        wallpaperDelay: s.wallpaperDelay,
        visualizerMode: s.visualizerMode,
        visualizerSensitivity: s.visualizerSensitivity,
        modules: config.modules,
        glow: config.glow,
        shortcut: s.hotkeys.toggleVisibility.accelerator,
        hotkeys: s.hotkeys,
        shortcuts: s.shortcuts,
        player: config.player,
        ecoMode: s.ecoMode,
        idleCompactMode: s.idleCompactMode,
        ...(layout ? { layout } : {}),
    };
}

/**
 * Raccourcis d'un instantané. Sans champ (profil rapide, ancien profil), les raccourcis actuels
 * restent : un profil rapide ne doit pas effacer ceux que l'utilisateur a réglés.
 */
function hotkeysFrom(snapshot, current) {
    if (snapshot.hotkeys && typeof snapshot.hotkeys === 'object') return sanitizeHotkeys(snapshot.hotkeys);
    if (typeof snapshot.shortcut === 'string' && snapshot.shortcut.trim()) {
        return sanitizeHotkeys({ ...current, toggleVisibility: { ...current.toggleVisibility, accelerator: snapshot.shortcut } });
    }
    return current;
}

/** Applique un instantané (profil, profil rapide ou fichier importé) sur l'état courant. */
export function fromSnapshot(current, snapshot = {}) {
    const glow = snapshot.glow || snapshot.appConfig?.glow || {};
    const modules = snapshot.modules || snapshot.appConfig?.modules || {};
    const player = snapshot.player || {};
    const pick = (value, fallback) => (value === undefined || value === null ? fallback : value);

    return {
        ...current,
        motion: pick(snapshot.motion, current.motion),
        widgetType: pick(snapshot.widgetType, current.widgetType),
        persistent: snapshot.persistent !== false,
        notifications: snapshot.notifications !== false,
        coverSync: snapshot.coverSync !== false,
        idleCoverBg: snapshot.idleCoverBg !== false,
        wallpaperSync: snapshot.wallpaperSync === true,
        wallpaperSyncStyle: pick(snapshot.wallpaperSyncStyle, current.wallpaperSyncStyle),
        wallpaperBlurIntensity: pick(snapshot.wallpaperBlurIntensity, current.wallpaperBlurIntensity),
        wallpaperDarken: pick(snapshot.wallpaperDarken, current.wallpaperDarken),
        wallpaperDelay: pick(snapshot.wallpaperDelay, current.wallpaperDelay),
        visualizerMode: pick(snapshot.visualizerMode, current.visualizerMode),
        visualizerSensitivity: pick(snapshot.visualizerSensitivity, current.visualizerSensitivity),
        musicEnabled: modules.music !== false,
        timerEnabled: modules.timer !== false,
        controlEnabled: modules.control !== false,
        gameDetection: modules.gameDetection !== false,
        opacity: pick(glow.opacity, current.opacity),
        blur: pick(glow.blur, current.blur),
        glowEnabled: glow.glowEnabled !== false,
        glowDensity: pick(glow.glowDensity, current.glowDensity),
        glowColorMode: pick(glow.glowColorMode, 'cover'),
        glowBlend: pick(glow.glowBlend, 65),
        glowColor: pick(glow.glowColor, '#D49460'),
        vizColorMode: pick(glow.vizColorMode, 'cover'),
        vizColorSolid: pick(glow.vizColorSolid, '#D49460'),
        vizColorGradA: pick(glow.vizColorGradA, '#D49460'),
        vizColorGradB: pick(glow.vizColorGradB, '#EDBC89'),
        materialStyle: pick(glow.materialStyle, current.materialStyle),
        grainEffect: pick(glow.grainEffect, current.grainEffect),
        glassControls: pick(glow.glassControls, current.glassControls),
        vizStyle: pick(glow.vizStyle, current.vizStyle),
        vizBars: pick(glow.vizBars, current.vizBars),
        vizGlow: pick(glow.vizGlow, current.vizGlow),
        vizInPill: pick(glow.vizInPill, current.vizInPill),
        pillCoverShape: pick(glow.pillCoverShape, current.pillCoverShape),
        pillShowTitle: pick(glow.pillShowTitle, current.pillShowTitle),
        pillMaxWidth: pick(glow.pillMaxWidth, current.pillMaxWidth),
        titleScroll: pick(glow.titleScroll, current.titleScroll),
        playerCoverBg: pick(glow.playerCoverBg, current.playerCoverBg),
        glowBreath: pick(glow.glowBreath, current.glowBreath),
        hotkeys: hotkeysFrom(snapshot, current.hotkeys),
        shortcuts: Array.isArray(snapshot.shortcuts) ? snapshot.shortcuts : current.shortcuts,
        showTimes: player.showTimes ?? current.showTimes,
        showVisualizer: player.showVisualizer ?? current.showVisualizer,
        showActions: player.showActions ?? current.showActions,
        wheelAppVolume: player.wheelAppVolume ?? current.wheelAppVolume,
        ecoMode: pick(snapshot.ecoMode ?? snapshot.eco, current.ecoMode),
        idleCompactMode: pick(snapshot.idleCompactMode, current.idleCompactMode),
    };
}

export function loadCustomProfiles() {
    const parsed = readJson('liquid_custom_profiles', []);
    return Array.isArray(parsed) ? parsed.filter((profile) => profile && profile.id && profile.settings) : [];
}

export function saveCustomProfiles(profiles) {
    localStorage.setItem('liquid_custom_profiles', JSON.stringify(profiles.filter((profile) => !profile.locked)));
}
