import { DEFAULT_SHORTCUTS } from './presets.js';
import { sanitizeHotkeys } from '../../shared/hotkeys.js';
import { cleanShortcutCommand, sanitizeMenus } from '../../shared/menu-config.js';
import { isRecord } from '../../shared/safe-storage.js';
import { validateTimerState } from '../../island/dynamic-island/features/timer-state.js';
import { validMicProfiles } from '../../shared/mic-profiles.js';

const flags = { persistent: true, gameDetection: true, notifications: true, soundEffects: true, ecoMode: false,
    coverSync: true, idleCoverBg: true, musicEnabled: true, showTimes: true, showVisualizer: true, showActions: true,
    wheelAppVolume: true, glowEnabled: true, glassControls: true, vizGlow: true, vizInPill: true,
    pillShowTitle: true, titleScroll: true, glowBreath: true, wallpaperSync: false, controlEnabled: true, timerEnabled: true,
    onlineCovers: true, offlineMode: false };
const numbers = { opacity: [10, 100, 92], blur: [0, 80, 30], glowDensity: [0, 60, 20], glowBlend: [0, 100, 65],
    visualizerSensitivity: [.1, 10, 2.5], vizBars: [3, 9, 5], pillMaxWidth: [120, 500, 240], playerCoverBg: [0, 100, 50],
    wallpaperDarken: [0, 50, 20], wallpaperDelay: [0, 10000, 800] };
const enums = { motion: ['system', 'sober', 'fluid', 'vivid'], materialStyle: ['glass', 'metal', 'holo'], grainEffect: ['none', 'light', 'medium'],
    glowColorMode: ['mix', 'cover', 'fixed'], vizColorMode: ['cover', 'cyberpunk', 'solid', 'gradient'], vizStyle: ['capsules', 'bars', 'dots', 'wave'],
    pillCoverShape: ['round', 'rounded', 'square'], visualizerMode: ['real', 'simulation'], wallpaperSyncStyle: ['blur', 'sharp', 'cinematic'],
    wallpaperBlurIntensity: ['light', 'moderate', 'strong'], widgetType: ['launchpad', 'stats', 'machine', 'weather', 'mixer'],
    idleCompactMode: ['cover', 'title', 'volume', 'progress'] };

export function sanitizeShortcuts(value) {
    return DEFAULT_SHORTCUTS.map((fallback, index) => {
        const entry = Array.isArray(value) && isRecord(value[index]) ? value[index] : fallback;
        return { ...fallback, name: typeof entry.name === 'string' ? entry.name.trim().slice(0, 40) : fallback.name,
            cmd: typeof entry.cmd === 'string' && !/[\r\n\0]/.test(entry.cmd) ? cleanShortcutCommand(entry.cmd) : fallback.cmd,
            icon: typeof entry.icon === 'string' && /^ph(?: ph)?[\w -]*$/.test(entry.icon) ? entry.icon.slice(0, 80) : fallback.icon,
            preset: typeof entry.preset === 'string' ? entry.preset.slice(0, 60) : 'custom' };
    });
}

export function sanitizeSettings(value) {
    const source = isRecord(value) ? value : {};
    const result = { ...source };
    for (const [key, fallback] of Object.entries(flags)) result[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
    for (const [key, [min, max, fallback]] of Object.entries(numbers)) result[key] = typeof source[key] === 'number' && Number.isFinite(source[key]) ? Math.max(min, Math.min(max, source[key])) : fallback;
    const enumDefaults = { motion: 'system', wallpaperBlurIntensity: 'moderate' };
    for (const [key, choices] of Object.entries(enums)) result[key] = choices.includes(source[key]) ? source[key] : enumDefaults[key] || choices[0];
    for (const key of ['glowColor', 'vizColorSolid', 'vizColorGradA', 'vizColorGradB']) result[key] = /^#[\da-f]{6}$/i.test(source[key]) ? source[key] : key === 'vizColorGradB' ? '#EDBC89' : '#D49460';
    result.hotkeys = sanitizeHotkeys(source.hotkeys);
    result.menus = sanitizeMenus(source.menus);
    result.shortcuts = sanitizeShortcuts(source.shortcuts);
    result.weatherCity = typeof source.weatherCity === 'string' ? source.weatherCity.trim().slice(0, 100) : '';
    result.activeProfile = typeof source.activeProfile === 'string' ? source.activeProfile.slice(0, 100) : 'custom';
    result.maxFps = ['0', '24', '30', '60', '90', '120', '144', '165', '240'].includes(String(source.maxFps)) ? String(source.maxFps) : '60';
    return result;
}

function checkSnapshot(value) {
    if (!isRecord(value)) throw new Error('Les réglages doivent être un objet.');
    for (const key of ['glow', 'modules', 'player', 'appConfig', 'hotkeys', 'menus', 'layout']) if (value[key] !== undefined && !isRecord(value[key])) throw new Error(`Champ de sauvegarde invalide : ${key}.`);
    if (value.shortcuts !== undefined && (!Array.isArray(value.shortcuts) || value.shortcuts.length > 40 || value.shortcuts.some(v => !isRecord(v) || typeof v.name !== 'string' || typeof v.cmd !== 'string'))) throw new Error('Les raccourcis de la sauvegarde sont invalides.');
    const values = { ...value, ...(value.glow || {}) };
    for (const [key, [min, max]] of Object.entries(numbers)) if (values[key] !== undefined && (typeof values[key] !== 'number' || !Number.isFinite(values[key]) || values[key] < min || values[key] > max)) throw new Error(`Valeur hors limites : ${key}.`);
    for (const key of Object.keys(flags)) if (values[key] !== undefined && typeof values[key] !== 'boolean') throw new Error(`Interrupteur invalide : ${key}.`);
    for (const [key, choices] of Object.entries(enums)) if (values[key] !== undefined && !choices.includes(values[key])) throw new Error(`Choix invalide : ${key}.`);
    for (const [key, flag] of Object.entries(value.modules || {})) if (typeof flag !== 'boolean') throw new Error(`Module invalide : ${key}.`);
    for (const [key, flag] of Object.entries(value.player || {})) if (['showTimes','showVisualizer','showActions','wheelAppVolume'].includes(key) && typeof flag !== 'boolean') throw new Error(`Réglage lecteur invalide : ${key}.`);
}

export function validateBackup(payload) {
    if (!isRecord(payload) || payload.type !== 'liquid-dynamic-island-settings' || ![1, 2].includes(payload.version)) throw new Error('Ce fichier n’est pas une sauvegarde Nolys compatible.');
    checkSnapshot(payload.settings);
    if (payload.profiles !== undefined && (!Array.isArray(payload.profiles) || payload.profiles.length > 100)) throw new Error('Liste de profils invalide.');
    for (const profile of payload.profiles || []) {
        if (!isRecord(profile) || typeof profile.id !== 'string' || typeof profile.name !== 'string' || profile.name.length > 100) throw new Error('Un profil est invalide.');
        checkSnapshot(profile.settings);
    }
    if (payload.musicHistory !== undefined && (!Array.isArray(payload.musicHistory) || payload.musicHistory.length > 200 || payload.musicHistory.some(item => !isRecord(item) || typeof item.title !== 'string' || typeof item.artist !== 'string'))) throw new Error('Historique musical invalide.');
    if (payload.uiValues !== undefined && (!isRecord(payload.uiValues) || Object.entries(payload.uiValues).some(([k, v]) => (!k.startsWith('liquid_') && !['island_standalone_config','nolys_library_player'].includes(k)) || k.startsWith('liquid_recovery_') || k.length > 200 || typeof v !== 'string' || v.length > 4 * 1024 * 1024))) throw new Error('Préférences brutes invalides.');
    for (const key of ['liquid_island_config', 'liquid_global_theme', 'island_standalone_config', 'liquid_cover_colors', 'liquid_menus']) {
        const raw = payload.uiValues?.[key];
        if (raw !== undefined && !isRecord(JSON.parse(raw))) throw new Error(`Préférence invalide : ${key}.`);
    }
    if (payload.uiValues?.liquid_timer_state !== undefined && !validateTimerState(JSON.parse(payload.uiValues.liquid_timer_state))) throw new Error('État des minuteurs invalide.');
    if (payload.uiValues?.liquid_mic_device_profiles !== undefined && !validMicProfiles(JSON.parse(payload.uiValues.liquid_mic_device_profiles))) throw new Error('Profils micro invalides.');
    return payload;
}
