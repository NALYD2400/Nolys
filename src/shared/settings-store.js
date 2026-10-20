/**
 * Réglages de l'interface partagés entre `npm run dev`, l'appli installée et ses mises à jour.
 *
 * Le localStorage de WebView2 est séparé par origine (localhost:1420 en dev, tauri.localhost
 * une fois installée) : chaque version avait ses propres réglages. La référence est désormais
 * `ui-settings.json` dans le dossier de données (src-tauri/src/ui_settings.rs).
 *
 * Le reste du code continue de lire localStorage de façon synchrone :
 * - au premier chargement de la session, le localStorage est remplacé par l'instantané du
 *   fichier, injecté par Rust avant tout script (`window.__NOLYS_UI_SETTINGS__`) ;
 * - ensuite chaque écriture d'une clé `liquid_*` est aussi envoyée au fichier, par lots.
 *
 * Ce module doit être importé avant tout autre (voir island/main.js).
 */
const LOADED_KEY = 'nolys_ui_settings_loaded';

export const isSyncedKey = (key) => typeof key === 'string' && (key.startsWith('liquid_') || key === 'island_standalone_config');

export function installSettingsStore({ storage, session, snapshot, invoke, proto }) {
    if (!storage || !proto || !snapshot || typeof invoke !== 'function') return false;
    const { setItem, removeItem, clear } = proto;

    const syncedKeys = () => {
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (isSyncedKey(key)) keys.push(key);
        }
        return keys;
    };

    // Envois en série : le fichier reçoit les modifications dans l'ordre.
    let chain = Promise.resolve();
    const send = (command, args) => {
        chain = chain.then(() => invoke(command, args)).catch((error) => console.warn(`[Settings] ${command} a échoué :`, error));
        return chain;
    };

    // Seul le premier chargement de la session reprend le fichier : après un rechargement,
    // le localStorage contient déjà les valeurs, plus récentes que l'instantané injecté.
    let firstLoad = true;
    try {
        firstLoad = session?.getItem(LOADED_KEY) !== '1';
        session?.setItem(LOADED_KEY, '1');
    } catch { /* pas de sessionStorage : on reprend le fichier à chaque fois */ }

    if (firstLoad && snapshot.initialized) {
        const values = snapshot.values || {};
        for (const key of syncedKeys()) {
            if (!Object.hasOwn(values, key)) removeItem.call(storage, key);
        }
        for (const [key, value] of Object.entries(values)) {
            if (!isSyncedKey(key)) continue;
            try { setItem.call(storage, key, value); } catch { /* stockage plein : valeur gardée dans le fichier */ }
        }
    } else if (firstLoad) {
        // Pas encore de fichier : ce localStorage (réglages existants) le remplit.
        const values = {};
        for (const key of syncedKeys()) values[key] = storage.getItem(key);
        send('ui_settings_seed', { values });
    }

    let pending = null;
    const queue = (key, value) => {
        if (!pending) {
            pending = {};
            queueMicrotask(() => {
                const changes = pending;
                pending = null;
                send('ui_settings_write', { changes });
            });
        }
        pending[key] = value;
    };

    proto.setItem = function (key, value) {
        const name = String(key);
        const tracked = this === storage && isSyncedKey(name);
        const changed = tracked && storage.getItem(name) !== String(value);
        setItem.call(this, key, value);
        if (changed) queue(name, String(value));
    };
    proto.removeItem = function (key) {
        const name = String(key);
        const tracked = this === storage && isSyncedKey(name) && storage.getItem(name) !== null;
        removeItem.call(this, key);
        if (tracked) queue(name, null);
    };
    proto.clear = function () {
        const keys = this === storage ? syncedKeys() : [];
        clear.call(this);
        keys.forEach((key) => queue(key, null));
    };
    return true;
}

if (typeof window !== 'undefined' && typeof Storage !== 'undefined') {
    try {
        let session = null;
        try { session = window.sessionStorage; } catch { /* indisponible */ }
        installSettingsStore({
            storage: window.localStorage,
            session,
            snapshot: window.__NOLYS_UI_SETTINGS__,
            invoke: window.__TAURI__?.core?.invoke,
            proto: Storage.prototype,
        });
    } catch (error) {
        console.warn('[Settings] Stockage fichier indisponible :', error);
    }
}
