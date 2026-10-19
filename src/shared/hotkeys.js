/**
 * Raccourcis clavier globaux : actions, combinaisons par défaut et lecture du stockage.
 *
 * Partagé par l'Island et les Réglages. Chaque action a une combinaison et un
 * interrupteur : une action désactivée garde sa combinaison, elle n'est juste
 * plus enregistrée auprès de Windows. Les identifiants correspondent à
 * `src-tauri/src/shortcut.rs`.
 */

export const HOTKEY_ACTIONS = [
    { id: 'toggleVisibility', group: 'Island', label: 'Afficher ou masquer l’Island', accelerator: 'Alt+I' },
    { id: 'layoutEdit', group: 'Island', label: 'Mode placement', description: 'Déplacer l’Island à la souris.', accelerator: 'Ctrl+Alt+M' },
    { id: 'openMusic', group: 'Island', label: 'Ouvrir le lecteur', accelerator: 'Ctrl+Alt+1' },
    { id: 'openControl', group: 'Island', label: 'Ouvrir le centre de contrôle', accelerator: 'Ctrl+Alt+2' },
    { id: 'openMic', group: 'Island', label: 'Ouvrir le retour micro', accelerator: 'Ctrl+Alt+3' },
    { id: 'openMixer', group: 'Island', label: 'Ouvrir le mixer', accelerator: 'Ctrl+Alt+4' },
    { id: 'mediaToggle', group: 'Musique', label: 'Lecture / pause', accelerator: 'Ctrl+Alt+K' },
    { id: 'mediaPrev', group: 'Musique', label: 'Titre précédent', accelerator: 'Ctrl+Alt+J' },
    { id: 'mediaNext', group: 'Musique', label: 'Titre suivant', accelerator: 'Ctrl+Alt+L' },
    { id: 'quickScreenshot', group: 'Outils', label: 'Capture d’écran rapide', description: 'Ouvre l’outil Capture d’écran de Windows.', accelerator: 'Ctrl+Alt+S' },
    { id: 'openSettings', group: 'Outils', label: 'Ouvrir les Réglages', accelerator: 'Ctrl+Alt+P' },
    { id: 'openFiles', group: 'Outils', label: 'Ouvrir les fichiers', accelerator: 'Ctrl+Alt+F' },
    { id: 'openReplay', group: 'Replay & REC', label: 'Ouvrir Replay & REC', accelerator: 'Ctrl+Alt+R' },
    { id: 'saveReplay', group: 'Replay & REC', label: 'Sauvegarder le replay', accelerator: 'Ctrl+Shift+F10' },
    { id: 'toggleReplay', group: 'Replay & REC', label: 'Activer ou arrêter le replay', accelerator: 'Ctrl+Shift+F9' },
    { id: 'toggleRecording', group: 'Replay & REC', label: 'Démarrer ou terminer REC', accelerator: 'Ctrl+Shift+F11' },
];

/** `{ [id]: { accelerator, enabled } }` : les réglages par défaut de chaque action. */
export const DEFAULT_HOTKEYS = Object.fromEntries(
    HOTKEY_ACTIONS.map(({ id, accelerator }) => [id, { accelerator, enabled: true }]),
);

export const hotkeyLabel = (id) => HOTKEY_ACTIONS.find((action) => action.id === id)?.label ?? id;

/**
 * Nettoie des raccourcis lus (stockage, profil, fichier importé) : une action absente
 * ou mal formée prend sa valeur par défaut, les actions inconnues sont ignorées.
 */
export function sanitizeHotkeys(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(HOTKEY_ACTIONS.map(({ id }) => {
        const entry = source[id];
        const accelerator = typeof entry?.accelerator === 'string'
            ? entry.accelerator.trim().slice(0, 80)
            : DEFAULT_HOTKEYS[id].accelerator;
        return [id, { accelerator, enabled: entry?.enabled !== false }];
    }));
}

/**
 * Raccourcis enregistrés dans le stockage partagé. Sans `liquid_hotkeys` (version
 * précédente), reprend l'ancien raccourci d'affichage `liquid_island_shortcut`.
 */
export function readHotkeys() {
    try {
        const stored = JSON.parse(localStorage.getItem('liquid_hotkeys') || 'null');
        if (stored && typeof stored === 'object') return sanitizeHotkeys(stored);
        const legacy = localStorage.getItem('liquid_island_shortcut');
        if (legacy) return sanitizeHotkeys({ toggleVisibility: { accelerator: legacy, enabled: true } });
    } catch {
        // Stockage illisible : valeurs par défaut, rien d'autre ne casse.
    }
    return sanitizeHotkeys(null);
}

/** Liste envoyée au cœur natif : seulement les actions activées qui ont une combinaison. */
export const activeHotkeys = (hotkeys) => HOTKEY_ACTIONS
    .filter(({ id }) => hotkeys[id]?.enabled !== false && hotkeys[id]?.accelerator)
    .map(({ id }) => ({ action: id, accelerator: hotkeys[id].accelerator }));
