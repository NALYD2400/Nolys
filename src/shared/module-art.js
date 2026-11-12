// Les PNG ne portent que le relief nacré ; la lumière est dessinée en CSS.
// Catalogue interne : aucune URL ni couleur issue des raccourcis personnels.
const colors = {
    files: '255 188 73',
    replay: '255 40 52',
    control: '70 186 255',
    music: '52 136 255',
    'music-history': '132 150 255',
    timer: '52 225 207',
    mixer: '58 205 221',
    mic: '150 86 255',
    library: '113 100 255',
    settings: '170 148 255',
    menu: '94 131 255',
    layout: '100 196 239',
    exit: '255 65 77',
    'customize-menu': '173 141 235',
    taskmgr: '74 207 163',
    calc: '93 187 218',
    terminal: '144 215 181',
    notepad: '116 182 237',
    paint: '217 128 204',
    snipping: '255 83 100',
    'music-search': '115 168 255',
    explorer: '255 188 73',
    'windows-settings': '114 182 255',
};

const reusedSymbols = { explorer: 'files', 'windows-settings': 'settings' };
const simpleActions = new Set(['layout', 'exit', 'customize-menu']);
const commandIcons = new Map([
    ['explorer.exe', 'explorer'], ['ms-settings:', 'windows-settings'],
    ['taskmgr.exe', 'taskmgr'], ['calc.exe', 'calc'], ['cmd.exe', 'terminal'],
    ['notepad.exe', 'notepad'], ['ms-paint:', 'paint'], ['ms-screenclip:', 'snipping'],
]);

/** Les anciens raccourcis sont reconnus par leur commande, sans modifier la sauvegarde. */
export function moduleArtworkId(id, command = '') {
    if (Object.hasOwn(colors, id)) return id;
    if (typeof command !== 'string') return null;
    const cmd = command.trim().toLowerCase();
    if (cmd.startsWith('liquid:') && Object.hasOwn(colors, cmd.slice(7))) return cmd.slice(7);
    return commandIcons.get(cmd) || null;
}

export function moduleArtwork(id, command) {
    const key = moduleArtworkId(id, command);
    if (!key || simpleActions.has(key)) return null;
    const symbol = Object.hasOwn(reusedSymbols, key) ? reusedSymbols[key] : key;
    return { src: `/assets/modules/neutral/${symbol}.png`, color: colors[key] };
}

export function moduleArtworkStyle(id, command) {
    const art = moduleArtwork(id, command);
    return art ? { '--module-color': art.color, '--module-mask': `url("${art.src}")` } : {};
}

/** Même rendu statique dans le menu natif et les composants React. */
export function renderModuleArtwork(id, command) {
    const art = moduleArtwork(id, command);
    if (!art) return '';
    return `<div class="module-art" style="--module-color:${art.color};--module-mask:url('${art.src}')" aria-hidden="true"><img src="${art.src}" width="128" height="128" alt="" draggable="false"></div>`;
}
