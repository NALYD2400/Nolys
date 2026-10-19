/** Catalogue commun aux réglages et aux deux menus de l'Island. */
export const MENU_STORAGE_KEY = 'liquid_menus';
export const MENU_ACTIONS = [
    { id: 'files', label: 'Fichiers', icon: 'ph-files' },
    { id: 'control', label: 'Centre de contrôle', shortLabel: 'Contrôle', icon: 'ph-sliders', flag: 'liquid_island_control_enabled' },
    { id: 'music', label: 'Lecteur', icon: 'ph-music-notes', flag: 'liquid_music_enabled' },
    { id: 'music-history', label: 'Historique', icon: 'ph-clock-counter-clockwise', flag: 'liquid_music_enabled' },
    { id: 'timer', label: 'Chronomètre et minuteur', shortLabel: 'Chrono', icon: 'ph-timer', flag: 'liquid_island_timer_enabled' },
    { id: 'mixer', label: 'Mélangeur', icon: 'ph-sliders-horizontal' },
    { id: 'mic', label: 'Retour micro', shortLabel: 'Micro', icon: 'ph-microphone' },
    { id: 'library', label: 'Bibliothèque', icon: 'ph-vinyl-record' },
    { id: 'settings', label: 'Réglages', icon: 'ph-gear-six' },
    { id: 'menu', label: 'Menu des modules', icon: 'ph-squares-four', contextOnly: true },
    { id: 'layout', label: 'Déplacer et redimensionner', icon: 'ph-arrows-out-cardinal', contextOnly: true },
    { id: 'exit', label: 'Quitter Nolys', icon: 'ph-power', contextOnly: true },
];

export const SHORTCUT_ICONS = ['ph-arrow-square-out', 'ph-folder', 'ph-globe', 'ph-app-window', 'ph-star', 'ph-game-controller', 'ph-code', 'ph-music-notes'];
const byId = new Map(MENU_ACTIONS.map(action => [action.id, action]));
const defaults = {
    modules: MENU_ACTIONS.filter(action => !action.contextOnly).map(action => action.id),
    context: ['files', 'control', 'music', 'music-history', 'timer', 'mixer', 'mic', 'library', 'layout', 'settings', 'exit'],
};
export const MAX_MENU_ITEMS = 40;
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Les anciens réglages reçoivent aussi les modules ajoutés au clic droit. */
export function sanitizeMenus(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = { contextVersion: 1, showMedia: source.showMedia !== false };
    for (const surface of ['modules', 'context']) {
        const entries = Array.isArray(source[surface]) ? source[surface] : defaults[surface].map(id => ({ id }));
        const seen = new Set();
        result[surface] = [];
        for (const entry of entries.slice(0, MAX_MENU_ITEMS)) {
            if (!entry || typeof entry !== 'object' || seen.has(entry.id)) continue;
            const action = byId.get(entry.id);
            if (action && !(surface === 'modules' && action.contextOnly)) {
                result[surface].push({ id: action.id, enabled: action.id === 'settings' || entry.enabled !== false });
            } else if (/^custom-[\w-]{1,80}$/.test(entry.id)) {
                const name = cleanText(entry.name, 40);
                const cmd = cleanText(entry.cmd, 2048);
                if (!name || !cmd) continue;
                result[surface].push({ id: entry.id, enabled: entry.enabled !== false, name, cmd,
                    icon: SHORTCUT_ICONS.includes(entry.icon) ? entry.icon : SHORTCUT_ICONS[0] });
            } else continue;
            seen.add(entry.id);
        }
        if (!seen.has('settings')) result[surface].push({ id: 'settings', enabled: true });
    }
    // Une seule migration : garder ensuite l'ordre et les boutons masqués choisis par l'utilisateur.
    if (source.contextVersion !== 1 && Array.isArray(source.context)) {
        const missing = defaults.modules.filter(id => !result.context.some(entry => entry.id === id))
            .map(id => ({ id, enabled: true }));
        const tools = result.context.findIndex(entry => entry.id === 'layout');
        result.context.splice(tools < 0 ? result.context.length : tools, 0,
            ...missing.slice(0, Math.max(0, MAX_MENU_ITEMS - result.context.length)));
    }
    return result;
}

export function readMenus() {
    try { return sanitizeMenus(JSON.parse(localStorage.getItem(MENU_STORAGE_KEY) || 'null')); }
    catch { return sanitizeMenus(); }
}

export function menuEntry(entry) {
    const action = byId.get(entry.id);
    return action ? { ...entry, ...action } : { ...entry, label: entry.name, shortLabel: entry.name };
}

export function visibleMenuEntries(surface, menus = readMenus(), storage = localStorage) {
    return menus[surface].filter(entry => entry.enabled !== false)
        .map(menuEntry).filter(action => !action.flag || storage.getItem(action.flag) !== 'false');
}

/** Même métrique que la grille CSS : ligne de 70 px, intervalle de 14 px, marges de 28 px. */
export function moduleMenuSize(count, maxWidth = 328, maxHeight = 496) {
    const widthLimit = Math.max(1, maxWidth);
    const columns = Math.min(4, Math.max(1, count), Math.max(1, Math.floor((widthLimit - 40) / 72)));
    const rows = Math.max(1, Math.ceil(count / columns));
    return {
        columns,
        width: Math.min(widthLimit, Math.max(132, columns * 72 + 40)),
        height: Math.min(Math.max(1, maxHeight), 56 + rows * 70 + (rows - 1) * 14),
    };
}
