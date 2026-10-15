/** Préréglages : raccourcis du centre de contrôle, profils rapides et listes de choix. */

export const SHORTCUT_PRESETS = {
    explorer: { name: 'Explorateur', icon: 'ph ph-folder', cmd: 'explorer.exe' },
    settings: { name: 'Paramètres', icon: 'ph ph-gear', cmd: 'ms-settings:' },
    taskmgr: { name: 'Gestionnaire', icon: 'ph ph-cpu', cmd: 'taskmgr.exe' },
    calc: { name: 'Calculatrice', icon: 'ph ph-calculator', cmd: 'calc.exe' },
    terminal: { name: 'Terminal', icon: 'ph ph-terminal', cmd: 'cmd.exe' },
    notepad: { name: 'Bloc-notes', icon: 'ph ph-note-pencil', cmd: 'notepad.exe' },
    paint: { name: 'Paint', icon: 'ph ph-palette', cmd: 'ms-paint:' },
    snipping: { name: 'Capture d’écran', icon: 'ph ph-camera', cmd: 'ms-screenclip:' },
    music: { name: 'Lecteur', icon: 'ph ph-music-notes', cmd: 'liquid:music' },
    history: { name: 'Historique', icon: 'ph ph-clock-counter-clockwise', cmd: 'liquid:music-history' },
    musicSearch: { name: 'Recherche', icon: 'ph ph-magnifying-glass', cmd: 'liquid:music-search' },
    widgets: { name: 'Widgets', icon: 'ph ph-squares-four', cmd: 'liquid:menu' },
    mixer: { name: 'Mixer', icon: 'ph ph-sliders-horizontal', cmd: 'liquid:mixer' },
    islandSettings: { name: 'Réglages', icon: 'ph ph-gear-six', cmd: 'liquid:settings' },
    custom: { name: 'Perso', icon: 'ph ph-sparkle', cmd: '' },
};

/** Groupes affichés dans le menu de choix d'un raccourci. */
export const SHORTCUT_GROUPS = [
    { label: 'Windows', keys: ['explorer', 'settings', 'taskmgr', 'calc', 'terminal', 'notepad', 'paint', 'snipping'] },
    { label: 'Island', keys: ['music', 'history', 'musicSearch', 'widgets', 'mixer', 'islandSettings'] },
    { label: 'Autre', keys: ['custom'] },
];

export const DEFAULT_SHORTCUTS = [
    { name: 'Explorer', preset: 'explorer', icon: 'ph ph-folder', cmd: 'explorer.exe' },
    { name: 'Settings', preset: 'settings', icon: 'ph ph-gear', cmd: 'ms-settings:' },
    { name: 'TaskMgr', preset: 'taskmgr', icon: 'ph ph-cpu', cmd: 'taskmgr.exe' },
    { name: 'Calc', preset: 'calc', icon: 'ph ph-calculator', cmd: 'calc.exe' },
];

export const MOTION_OPTIONS = [
    { value: 'sober', label: 'Sobre' },
    { value: 'fluid', label: 'Fluide' },
    { value: 'vivid', label: 'Vivante' },
];

/** Plafond d'images par seconde des animations continues ('0' : cadence de l'écran). */
export const FPS_OPTIONS = [
    { value: '30', label: '30' },
    { value: '60', label: '60' },
    { value: '120', label: '120' },
    { value: '144', label: '144' },
    { value: '240', label: '240' },
    { value: '0', label: 'Écran' },
];

export const MATERIAL_OPTIONS = [
    { value: 'glass', label: 'Verre', icon: 'ph-drop' },
    { value: 'metal', label: 'Métal', icon: 'ph-circle-half' },
    { value: 'holo', label: 'Holo', icon: 'ph-sparkle' },
];

export const GRAIN_OPTIONS = [
    { value: 'none', label: 'Aucun' },
    { value: 'light', label: 'Léger' },
    { value: 'medium', label: 'Marqué' },
];

export const GLOW_COLOR_OPTIONS = [
    { value: 'cover', label: 'Pochette' },
    { value: 'mix', label: 'Mixte' },
    { value: 'fixed', label: 'Fixe' },
];

export const VIZ_COLOR_OPTIONS = [
    { value: 'cyberpunk', label: 'Liquide' },
    { value: 'cover', label: 'Pochette' },
    { value: 'solid', label: 'Unie' },
    { value: 'gradient', label: 'Dégradé' },
];

export const VIZ_STYLE_OPTIONS = [
    { value: 'capsules', label: 'Gélules', icon: 'ph-waveform' },
    { value: 'bars', label: 'Égaliseur', icon: 'ph-chart-bar' },
    { value: 'wave', label: 'Onde', icon: 'ph-wave-sine' },
    { value: 'dots', label: 'Points', icon: 'ph-dots-nine' },
];

export const COVER_SHAPE_OPTIONS = [
    { value: 'round', label: 'Ronde' },
    { value: 'rounded', label: 'Arrondie' },
    { value: 'square', label: 'Carrée' },
];

/**
 * Thèmes en un clic : chaque thème remplace seulement les réglages listés,
 * le reste (modules, raccourcis…) ne bouge pas.
 */
export const THEME_PRESETS = [
    {
        value: 'copper', label: 'Cuivre', icon: 'ph-sun-horizon',
        patch: {
            materialStyle: 'glass', opacity: 92, blur: 30, grainEffect: 'none', glowEnabled: true, glowColorMode: 'mix',
            glowBlend: 65, glowColor: '#D49460', glowDensity: 20, glowBreath: true, vizStyle: 'capsules', vizColorMode: 'cover',
            vizGlow: true, pillCoverShape: 'round', coverSync: true, idleCoverBg: true, playerCoverBg: 50,
        },
    },
    {
        value: 'neon', label: 'Néon', icon: 'ph-lightning',
        patch: {
            materialStyle: 'holo', opacity: 90, blur: 30, grainEffect: 'none', glowEnabled: true, glowColorMode: 'fixed',
            glowColor: '#00E5FF', glowDensity: 38, glowBreath: true, vizStyle: 'bars', vizColorMode: 'gradient',
            vizColorGradA: '#00E5FF', vizColorGradB: '#FF2BD6', vizGlow: true, pillCoverShape: 'rounded', coverSync: false,
            idleCoverBg: false, playerCoverBg: 25,
        },
    },
    {
        value: 'minimal', label: 'Minimal', icon: 'ph-circle',
        patch: {
            materialStyle: 'glass', opacity: 100, blur: 20, grainEffect: 'none', glowEnabled: false, glowBreath: false,
            vizStyle: 'capsules', vizColorMode: 'solid', vizColorSolid: '#FFFFFF', vizGlow: false, pillCoverShape: 'round',
            coverSync: false, idleCoverBg: false, playerCoverBg: 0,
        },
    },
    {
        value: 'cover', label: 'Pochette', icon: 'ph-vinyl-record',
        patch: {
            materialStyle: 'glass', opacity: 85, blur: 40, grainEffect: 'light', glowEnabled: true, glowColorMode: 'cover',
            glowDensity: 30, glowBreath: true, vizStyle: 'wave', vizColorMode: 'cover', vizGlow: true, pillCoverShape: 'round',
            coverSync: true, idleCoverBg: true, playerCoverBg: 75,
        },
    },
    {
        value: 'night', label: 'Nuit', icon: 'ph-moon-stars',
        patch: {
            materialStyle: 'metal', opacity: 100, blur: 10, grainEffect: 'medium', glowEnabled: true, glowColorMode: 'fixed',
            glowColor: '#5E5CE6', glowDensity: 12, glowBreath: false, vizStyle: 'dots', vizColorMode: 'solid',
            vizColorSolid: '#A5A3FF', vizGlow: false, pillCoverShape: 'square', coverSync: false, idleCoverBg: false, playerCoverBg: 20,
        },
    },
];

export const COMPACT_MODE_OPTIONS = [
    { value: 'cover', label: 'Pochette et visualiseur' },
    { value: 'title', label: 'Titre du morceau' },
    { value: 'volume', label: 'Volume de l’application' },
    { value: 'progress', label: 'Progression' },
];

export const WALLPAPER_STYLE_OPTIONS = [
    { value: 'blur', label: 'Flou ambiant', icon: 'ph-drop-half' },
    { value: 'cinematic', label: 'Cinématique', icon: 'ph-film-strip' },
    { value: 'sharp', label: 'Pochette nette', icon: 'ph-image' },
];

export const WALLPAPER_BLUR_OPTIONS = [
    { value: 'light', label: 'Léger' },
    { value: 'moderate', label: 'Moyen' },
    { value: 'strong', label: 'Fort' },
];

export const WIDGET_OPTIONS = [
    { value: 'launchpad', label: 'Raccourcis', icon: 'ph-rocket-launch' },
    { value: 'stats', label: 'Performance', icon: 'ph-chart-line' },
    { value: 'machine', label: 'Batterie', icon: 'ph-battery-high' },
    { value: 'weather', label: 'Météo', icon: 'ph-cloud-sun' },
    { value: 'mixer', label: 'Mélangeur', icon: 'ph-sliders-horizontal' },
];

/** Profils rapides ; les profils musique et travail suivent la palette cuivre. */
export const QUICK_PROFILES = {
    music: {
        name: 'Musique',
        icon: 'ph-music-notes',
        motion: 'vivid',
        widgetType: 'mixer',
        persistent: true,
        notifications: true,
        modules: { music: true, timer: false, control: true, gameDetection: true },
        coverSync: true,
        idleCoverBg: true,
        wallpaperSync: false,
        visualizerSensitivity: 2.5,
        focus: false,
        eco: false,
        dnd: false,
        volume: 70,
        glow: {
            opacity: 94, blur: 30, glowEnabled: true, glowDensity: 28, glowColorMode: 'cover', glowBlend: 80,
            glowColor: '#D49460', vizColorMode: 'cover', vizColorSolid: '#D49460', vizColorGradA: '#D49460',
            vizColorGradB: '#EDBC89', materialStyle: 'glass', grainEffect: 'none',
        },
    },
    work: {
        name: 'Travail',
        icon: 'ph-briefcase',
        motion: 'fluid',
        widgetType: 'launchpad',
        persistent: true,
        notifications: true,
        modules: { music: true, timer: true, control: true, gameDetection: true },
        coverSync: true,
        idleCoverBg: true,
        wallpaperSync: false,
        visualizerSensitivity: 2.5,
        focus: false,
        eco: false,
        dnd: false,
        volume: 55,
        glow: {
            opacity: 92, blur: 30, glowEnabled: true, glowDensity: 20, glowColorMode: 'mix', glowBlend: 70,
            glowColor: '#D49460', vizColorMode: 'cover', vizColorSolid: '#D49460', vizColorGradA: '#D49460',
            vizColorGradB: '#EDBC89', materialStyle: 'glass', grainEffect: 'light',
        },
    },
    gaming: {
        name: 'Gaming',
        icon: 'ph-game-controller',
        motion: 'sober',
        widgetType: 'mixer',
        persistent: true,
        notifications: false,
        modules: { music: false, timer: false, control: true, gameDetection: true },
        coverSync: false,
        idleCoverBg: false,
        wallpaperSync: false,
        visualizerSensitivity: 2.5,
        focus: false,
        eco: true,
        dnd: true,
        volume: 85,
        glow: {
            opacity: 88, blur: 14, glowEnabled: false, glowDensity: 8, glowColorMode: 'fixed', glowBlend: 0,
            glowColor: '#00f3ff', vizColorMode: 'cyberpunk', vizColorSolid: '#00f3ff', vizColorGradA: '#00f3ff',
            vizColorGradB: '#bc13fe', materialStyle: 'metal', grainEffect: 'none',
        },
    },
};
