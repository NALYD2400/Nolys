// Pictogrammes locaux partagés par l'Island et les réglages.
// Les raccourcis personnels conservent le symbole choisi dans leurs préférences.
const icons = {
    files: 'folder', replay: 'arrow-counter-clockwise', control: 'sliders',
    music: 'music-notes', 'music-history': 'clock-counter-clockwise',
    timer: 'timer', mixer: 'sliders-horizontal', mic: 'microphone',
    library: 'books', settings: 'gear-six', menu: 'squares-four',
    taskmgr: 'chart-bar', calc: 'calculator', terminal: 'terminal-window',
    notepad: 'notebook', paint: 'paint-brush', snipping: 'scissors',
    'music-search': 'magnifying-glass', explorer: 'folder', 'windows-settings': 'gear-six',
    layout: 'arrows-out-cardinal', exit: 'power', 'customize-menu': 'pencil-simple',
    link: 'arrow-square-out', globe: 'globe', app: 'app-window', star: 'star',
    game: 'game-controller', code: 'code',
};
const commandIcons = new Map([
    ['explorer.exe', 'explorer'], ['ms-settings:', 'windows-settings'],
    ['taskmgr.exe', 'taskmgr'], ['calc.exe', 'calc'], ['cmd.exe', 'terminal'],
    ['notepad.exe', 'notepad'], ['ms-paint:', 'paint'], ['ms-screenclip:', 'snipping'],
]);
const shortcutIcons = {
    'ph-arrow-square-out': 'link', 'ph-folder': 'files', 'ph-globe': 'globe',
    'ph-app-window': 'app', 'ph-star': 'star', 'ph-game-controller': 'game',
    'ph-code': 'code', 'ph-music-notes': 'music',
};
const glassSymbols = new Set(Object.keys(icons));

export function moduleArtworkId(id, command = '') {
    if (Object.hasOwn(icons, id)) return id;
    if (typeof command !== 'string') return null;
    const cmd = command.trim().toLowerCase();
    if (cmd.startsWith('liquid:') && Object.hasOwn(icons, cmd.slice(7))) return cmd.slice(7);
    return commandIcons.get(cmd) || null;
}

export function moduleArtwork(id, command, selectedIcon, preferIcon = false) {
    const chosen = typeof id === 'string' && id.startsWith('custom-') && Object.hasOwn(shortcutIcons, selectedIcon)
        ? shortcutIcons[selectedIcon] : null;
    const key = (preferIcon && chosen) || moduleArtworkId(id, command) || chosen;
    if (!key) return null;
    const symbol = key === 'explorer' ? 'files' : key === 'windows-settings' ? 'settings' : key;
    return { icon: `ph-${icons[key]}`, src: glassSymbols.has(symbol) ? `/assets/modules/glass-outline/${symbol}.png` : null };
}

export function renderModuleArtwork(id, command, selectedIcon, preferIcon) {
    const art = moduleArtwork(id, command, selectedIcon, preferIcon);
    if (!art) return '';
    return `<div class="module-art" aria-hidden="true">${art.src ? `<img src="${art.src}" alt="" draggable="false">` : `<i class="ph ${art.icon}"></i>`}</div>`;
}
