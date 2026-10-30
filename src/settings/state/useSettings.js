import { offlineArt } from '../../shared/privacy.js';
/**
 * État des réglages pour l'interface React : lecture initiale, modifications,
 * envoi à l'Island (regroupé à 30 envois/s au maximum pendant un glissement
 * de curseur), profils, mises à jour et position.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcRenderer, native } from '../../shared/ipc.js';
import { currentCover, onCover } from '../../shared/cover-bus.js';
import { QUICK_PROFILES } from './presets.js';
import { activeHotkeys, sanitizeHotkeys } from '../../shared/hotkeys.js';
import {
    fromSnapshot,
    loadCustomProfiles,
    loadSettings,
    saveCustomProfiles,
    saveSettings,
    toSnapshot,
} from './storage.js';
import { playClick } from './sound.js';
import { whileBusy } from './busy.js';
import { sanitizeSettings, validateBackup } from './validation.js';
import { isSyncedKey, ensureSettingsSaved } from '../../shared/settings-store.js';
import { readJSON } from '../../shared/safe-storage.js';
import { preferenceTransaction } from './preference-transaction.js';

const backupKey = key => isSyncedKey(key) || key === 'nolys_library_player';
const localValues = () => Object.fromEntries(Object.keys(localStorage).filter(key => backupKey(key) && !key.startsWith('liquid_recovery_')).map(key => [key, localStorage.getItem(key)]));
const restoreValues = values => { for (const key of Object.keys(localStorage)) if (backupKey(key) && !key.startsWith('liquid_recovery_') && !(key in values)) localStorage.removeItem(key); for (const [key, value] of Object.entries(values)) if (backupKey(key)) localStorage.setItem(key, value); };

const SEND_INTERVAL_MS = 33;

export function useSettings() {
    const [settings, setSettings] = useState(loadSettings);
    const [customProfiles, setCustomProfiles] = useState(loadCustomProfiles);
    const pending = useRef(null);
    const timer = useRef(null);
    // Combinaisons refusées par Windows ou une autre application (renvoyées par le cœur natif).
    const [hotkeyConflicts, setHotkeyConflicts] = useState([]);
    const hotkeysKey = JSON.stringify(activeHotkeys(settings.hotkeys));

    const flush = useCallback(() => {
        timer.current = null;
        if (!pending.current) return;
        const config = saveSettings(pending.current);
        pending.current = null;
        ipcRenderer.send('config-changed', config);
    }, []);

    const commit = useCallback((next) => {
        pending.current = next;
        if (!timer.current) timer.current = setTimeout(flush, SEND_INTERVAL_MS);
    }, [flush]);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        flush();
    }, [flush]);

    /** Modifie un ou plusieurs réglages. Toute modification manuelle sort du profil actif. */
    const update = useCallback((patch) => {
        setSettings((current) => {
            const next = sanitizeSettings({ ...current, ...patch, activeProfile: patch.activeProfile ?? 'custom' });
            commit(next);
            return next;
        });
    }, [commit]);

    const applyQuickProfile = useCallback((key) => {
        const profile = QUICK_PROFILES[key];
        if (!profile) return;
        playClick();
        localStorage.setItem('liquid_focus_mode', profile.focus);
        localStorage.setItem('liquid_dnd_enabled', profile.dnd);
        setSettings((current) => {
            const next = { ...fromSnapshot(current, profile), activeProfile: key };
            commit(next);
            return next;
        });
        ipcRenderer.invoke('set-system-volume', profile.volume).catch(() => {});
        ipcRenderer.invoke('dnd-control', profile.dnd ? 'on' : 'off').catch(() => {});
    }, [commit]);

    const applyCustomProfile = useCallback((profile) => {
        playClick();
        setSettings((current) => {
            const next = { ...fromSnapshot(current, profile.settings), activeProfile: profile.id };
            commit(next);
            return next;
        });
    }, [commit]);

    const saveCurrentAsProfile = useCallback((name) => {
        const clean = name.trim().slice(0, 24);
        if (!clean) return;
        const id = `custom-${Date.now()}`;
        const profiles = [...loadCustomProfiles(), { id, name: clean, icon: 'ph-user-circle', locked: false, settings: toSnapshot(settings) }];
        saveCustomProfiles(profiles);
        setCustomProfiles(profiles);
        update({ activeProfile: id });
    }, [settings, update]);

    const deleteProfile = useCallback((id) => {
        const profiles = loadCustomProfiles().filter((profile) => profile.id !== id);
        saveCustomProfiles(profiles);
        setCustomProfiles(profiles);
        if (settings.activeProfile === id) update({});
    }, [settings.activeProfile, update]);

    const exportSettings = useCallback(() => {
        return whileBusy(async () => {
        flush();
        await ensureSettingsSaved();
        const nativePreferences = await native.invoke('preferences_bundle');
        const payload = {
            type: 'liquid-dynamic-island-settings',
            version: 2,
            exportedAt: new Date().toISOString(),
            activeProfile: settings.activeProfile,
            settings: toSnapshot(settings),
            profiles: loadCustomProfiles(),
            musicHistory: readJSON('liquid_music_history', [], Array.isArray),
            uiValues: localValues(), nativePreferences,
        };
        // Fenêtre « Enregistrer sous » de Windows : un téléchargement WebView2 ouvrirait son
        // panneau au-dessus de l'Island et lui ferait perdre le focus.
        return native.invoke('save_settings_file', {
            contents: JSON.stringify(payload, null, 2),
            fileName: `nolys-reglages-${new Date().toISOString().slice(0, 10)}.json`,
        });
        });
    }, [settings, flush]);

    const importSettings = useCallback(async (file) => {
        if (file.size > 16 * 1024 * 1024) throw new Error('La sauvegarde dépasse 16 Mio.');
        const payload = validateBackup(JSON.parse(await file.text()));
        flush();
        const next = fromSnapshot(settings, payload.settings);
        const previous = localValues();
        const previousNative = await native.invoke('preferences_bundle');
        localStorage.setItem('liquid_recovery_before_import', JSON.stringify({ uiValues: previous, nativePreferences: previousNative }));
        let nativeChanged = false;
        await preferenceTransaction(async () => {
            if (payload.nativePreferences) { await native.invoke('preferences_restore', { bundle: payload.nativePreferences }); nativeChanged = true; }
            if (payload.uiValues) restoreValues(payload.uiValues);
            if (payload.profiles) saveCustomProfiles(payload.profiles);
            if (payload.musicHistory) localStorage.setItem('liquid_music_history', JSON.stringify(payload.musicHistory.slice(0, 20)));
            saveSettings(next);
            await ensureSettingsSaved();
        }, [() => restoreValues(previous), ensureSettingsSaved,
            () => nativeChanged && previousNative ? native.invoke('preferences_restore', { bundle: previousNative }) : undefined]);
        setCustomProfiles(loadCustomProfiles()); setSettings(next);
        ipcRenderer.send('config-changed', saveSettings(next));
        window.dispatchEvent(new Event('nolys-preferences-restored'));
    }, [settings, flush]);

    const resetPage = useCallback(async page => {
        const keys = { general: ['persistent','gameDetection','notifications','soundEffects','ecoMode','maxFps'], island: ['pillCoverShape','pillShowTitle','pillMaxWidth','titleScroll','vizStyle','vizBars','vizGlow','vizInPill','showVisualizer','vizColorMode','vizColorSolid','vizColorGradA','vizColorGradB','visualizerSensitivity','playerCoverBg'], appearance: ['motion','opacity','blur','materialStyle','grainEffect','glowEnabled','glowDensity','glowColorMode','glowBlend','glowColor','coverSync','idleCoverBg','glowBreath'], music: ['musicEnabled','showTimes','showActions','wheelAppVolume','idleCompactMode','onlineCovers','offlineMode'], wallpaper: ['wallpaperSync','wallpaperSyncStyle','wallpaperBlurIntensity','wallpaperDarken','wallpaperDelay'], control: ['controlEnabled','timerEnabled','widgetType','weatherCity','shortcuts'], menus: ['menus'], shortcuts: ['hotkeys'] };
        flush();
        const nativePreferences = await native.invoke('preferences_bundle');
        localStorage.setItem('liquid_recovery_before_reset', JSON.stringify({uiValues: localValues(), nativePreferences}));
        if (page === 'position') { ipcRenderer.send('layout-reset'); return; }
        if (page === 'mic') { await native.invoke('reset_microphone_preferences'); window.dispatchEvent(new Event('nolys-preferences-restored')); return; }
        const defaults = sanitizeSettings({});
        update(Object.fromEntries((keys[page] || []).map(key => [key, defaults[key] ?? (key === 'wallpaperSyncStyle' ? 'blur' : '')])));
    }, [update, flush]);

    const recoverImport = useCallback(async (kind = 'import') => {
        flush();
        const backup = readJSON(`liquid_recovery_before_${kind === 'reset' ? 'reset' : 'import'}`, null, value => value && typeof value.uiValues === 'object');
        if (!backup) throw new Error('Aucune sauvegarde de récupération disponible.');
        const previous = localValues(), previousNative = await native.invoke('preferences_bundle');
        let nativeChanged = false;
        await preferenceTransaction(async () => {
            if (backup.nativePreferences) { await native.invoke('preferences_restore', { bundle: backup.nativePreferences }); nativeChanged = true; }
            restoreValues(backup.uiValues);
            await ensureSettingsSaved();
        }, [() => restoreValues(previous), ensureSettingsSaved,
            () => nativeChanged && previousNative ? native.invoke('preferences_restore', {bundle: previousNative}) : undefined]);
        const restored = loadSettings(); setSettings(restored); setCustomProfiles(loadCustomProfiles()); ipcRenderer.send('config-changed', saveSettings(restored));
        window.dispatchEvent(new Event('nolys-preferences-restored'));
    }, [flush]);

    // Enregistre les raccourcis à chaque changement (réglage, profil, import). Une réponse périmée
    // (changement entre-temps) est ignorée.
    useEffect(() => {
        let active = true;
        ipcRenderer.invoke('register-shortcuts', JSON.parse(hotkeysKey))
            .then((conflicts) => active && setHotkeyConflicts(conflicts || []))
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [hotkeysKey]);

    /** Remplace les raccourcis (une action modifiée ou désactivée, ou les valeurs par défaut). */
    const setHotkeys = useCallback((hotkeys) => {
        update({ hotkeys: sanitizeHotkeys(hotkeys) });
    }, [update]);

    return useMemo(() => ({
        settings,
        update,
        customProfiles,
        applyQuickProfile,
        applyCustomProfile,
        saveCurrentAsProfile,
        deleteProfile,
        exportSettings,
        importSettings,
        resetPage, recoverImport,
        hotkeyConflicts,
        setHotkeys,
    }), [settings, update, customProfiles, applyQuickProfile, applyCustomProfile, saveCurrentAsProfile, deleteProfile, exportSettings, importSettings, resetPage, recoverImport, hotkeyConflicts, setHotkeys]);
}

/** Démarrage automatique (géré par Windows, pas par le localStorage). */
export function useAutoStart() {
    const [enabled, setEnabled] = useState(localStorage.getItem('liquid_auto_start_enabled') === 'true');
    useEffect(() => {
        ipcRenderer.invoke('get-auto-start').then((value) => setEnabled(Boolean(value))).catch(() => {});
    }, []);
    const change = useCallback(async (next) => {
        setEnabled(next);
        const actual = Boolean(await ipcRenderer.invoke('set-auto-start', next));
        setEnabled(actual);
        localStorage.setItem('liquid_auto_start_enabled', String(actual));
    }, []);
    return [enabled, change];
}

/** Position, taille et écran de l'Island (gérés par le cœur natif). */
export function useLayout() {
    const [layout, setLayout] = useState({ x: 0, y: 0, scale: 1, displayId: 'primary' });
    const [editMode, setEditMode] = useState(false);
    const [displays, setDisplays] = useState([]);

    useEffect(() => {
        ipcRenderer.invoke('get-layout-state').then((state) => {
            if (state?.layout) setLayout(state.layout);
            setEditMode(Boolean(state?.editMode));
        }).catch(() => {});
        ipcRenderer.invoke('get-displays').then((list) => setDisplays(list || [])).catch(() => {});
        const offLayout = ipcRenderer.on('layout-config-changed', (_event, next) => next && setLayout(next));
        const offEdit = ipcRenderer.on('layout-edit-mode-changed', (_event, next) => setEditMode(Boolean(next)));
        return () => {
            offLayout();
            offEdit();
        };
    }, []);

    return {
        layout,
        editMode,
        displays,
        /** Taille par pas de 5 % (65 à 150 %), comme la barre du mode placement. */
        stepScale: (direction) => {
            const scale = Math.min(1.5, Math.max(0.65, Math.round(((layout.scale || 1) + direction * 0.05) * 100) / 100));
            if (scale === layout.scale) return;
            setLayout((current) => ({ ...current, scale }));
            ipcRenderer.send('layout-config-changed', { scale });
        },
        setDisplay: (displayId) => ipcRenderer.send('set-target-display', displayId),
        toggleEditMode: () => ipcRenderer.send('set-layout-edit-mode', !editMode),
        recenter: () => ipcRenderer.send('layout-reset'),
    };
}

/** État des mises à jour (vérification, téléchargement, installation). */
export function useUpdates() {
    const [status, setStatus] = useState({ state: 'idle' });
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        ipcRenderer.invoke('get-update-status').then(setStatus).catch(() => {});
        return ipcRenderer.on('update-status-changed', (_event, next) => setStatus(next));
    }, []);
    const run = useCallback(async (channel) => {
        setBusy(true);
        try {
            setStatus(await ipcRenderer.invoke(channel));
        } catch (error) {
            setStatus((current) => ({ ...current, state: 'error', error: error?.message || 'Action impossible' }));
        } finally {
            setBusy(false);
        }
    }, []);
    return {
        status,
        busy,
        check: () => run('check-for-updates-manual'),
        download: () => run('download-update-manual'),
        install: () => run('install-downloaded-update'),
    };
}

/** Pochette et couleurs du morceau en cours (publiées par l'Island), pour le fond des Réglages. */
export function useCoverTheme(enabled) {
    const [cover, setCover] = useState(() => {
        const known = currentCover();
        if (known) return known;
        try {
            return JSON.parse(localStorage.getItem('liquid_cover_colors') || '{}');
        } catch {
            return {};
        }
    });
    useEffect(() => onCover(setCover), []);
    return enabled ? { ...cover, cover: offlineArt(cover.cover) } : {};
}

/**
 * Retour micro (géré par le cœur natif) : réglages, niveaux en direct et listes
 * de périphériques. Les changements faits dans l'Island arrivent par événement.
 */
export function useMicMonitor() {
    const [status, setStatus] = useState(null);
    const [inputs, setInputs] = useState([]);
    const [outputs, setOutputs] = useState([]);
    const pending = useRef(null);
    const sending = useRef(false);
    // Niveaux du vumètre : ~15 fois par seconde, transmis au seul vumètre (subscribeLevels).
    // Le reste de la page ne se redessine que si un réglage ou l'état change vraiment.
    const levels = useRef({ inputLevel: 0, outputLevel: 0, listeners: new Set() });
    const statusKey = useRef('');
    const subscribeLevels = useCallback((listener) => {
        levels.current.listeners.add(listener);
        listener(levels.current);
        return () => levels.current.listeners.delete(listener);
    }, []);

    useEffect(() => {
        let alive = true;
        // Envoi en cours : niveaux à jour, mais on garde les réglages affichés (sinon le curseur
        // qu'on glisse revient en arrière à chaque rafraîchissement).
        const receive = (next) => {
            if (!alive || !next) return;
            const { inputLevel = 0, outputLevel = 0 } = next;
            Object.assign(levels.current, { inputLevel, outputLevel });
            levels.current.listeners.forEach((listener) => listener(levels.current));
            const key = JSON.stringify({ ...next, inputLevel: 0, outputLevel: 0 });
            if (key === statusKey.current) return;
            statusKey.current = key;
            setStatus((current) => (sending.current && current ? { ...next, config: current.config } : next));
        };
        const refresh = () => ipcRenderer.invoke('get-mic-monitor').then(receive).catch(() => {});
        refresh();
        ipcRenderer.invoke('get-audio-input-devices').then((list) => alive && setInputs(list || [])).catch(() => {});
        ipcRenderer.invoke('get-audio-devices').then((list) => alive && setOutputs(list || [])).catch(() => {});
        const off = ipcRenderer.on('mic-monitor-changed', (_event, next) => receive(next));
        // Vumètre : ~15 rafraîchissements par seconde tant que la page est ouverte.
        const timer = setInterval(refresh, 66);
        return () => {
            alive = false;
            clearInterval(timer);
            off();
        };
    }, []);

    /**
     * Un seul envoi à la fois, les modifications suivantes regroupées : un curseur glissé
     * envoyait sinon des dizaines de réglages par seconde (chacun écrit sur le disque), qui
     * pouvaient arriver dans le désordre et laisser une ancienne valeur active.
     */
    const update = useCallback(async (patch) => {
        setStatus((current) => (current ? { ...current, config: { ...current.config, ...patch } } : current));
        pending.current = { ...pending.current, ...patch };
        if (sending.current) return;
        sending.current = true;
        try {
            while (pending.current) {
                // Réglages actuels relus à chaque fois : l'Island a pu en changer entre-temps.
                const current = await ipcRenderer.invoke('get-mic-monitor').catch(() => null);
                const batch = pending.current;
                pending.current = null;
                const next = await ipcRenderer.invoke('set-mic-monitor', { ...(current?.config || {}), ...batch }).catch(() => null);
                if (next && !pending.current) setStatus(next);
            }
        } finally {
            sending.current = false;
        }
    }, []);

    return { status, inputs, outputs, update, subscribeLevels };
}
