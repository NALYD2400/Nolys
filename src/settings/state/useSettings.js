/**
 * État des réglages pour l'interface React : lecture initiale, modifications,
 * envoi à l'Island (regroupé à 30 envois/s au maximum pendant un glissement
 * de curseur), profils, mises à jour et position.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcRenderer } from '../../shared/ipc.js';
import { QUICK_PROFILES } from './presets.js';
import {
    fromSnapshot,
    loadCustomProfiles,
    loadSettings,
    saveCustomProfiles,
    saveSettings,
    toSnapshot,
} from './storage.js';
import { playClick } from './sound.js';

const SEND_INTERVAL_MS = 33;

export function useSettings() {
    const [settings, setSettings] = useState(loadSettings);
    const [customProfiles, setCustomProfiles] = useState(loadCustomProfiles);
    const pending = useRef(null);
    const timer = useRef(null);

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
            const next = { ...current, ...patch, activeProfile: patch.activeProfile ?? 'custom' };
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
        const payload = {
            type: 'liquid-dynamic-island-settings',
            version: 1,
            exportedAt: new Date().toISOString(),
            activeProfile: settings.activeProfile,
            settings: toSnapshot(settings),
            profiles: loadCustomProfiles(),
            musicHistory: JSON.parse(localStorage.getItem('liquid_music_history') || '[]'),
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `nolys-reglages-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, [settings]);

    const importSettings = useCallback(async (file) => {
        const payload = JSON.parse(await file.text());
        if (Array.isArray(payload.profiles)) {
            saveCustomProfiles(payload.profiles);
            setCustomProfiles(loadCustomProfiles());
        }
        if (Array.isArray(payload.musicHistory)) {
            localStorage.setItem('liquid_music_history', JSON.stringify(payload.musicHistory.slice(0, 20)));
        }
        if (payload.settings) {
            setSettings((current) => {
                const next = { ...fromSnapshot(current, payload.settings), activeProfile: payload.activeProfile || 'custom' };
                commit(next);
                return next;
            });
        }
    }, [commit]);

    const setShortcut = useCallback((shortcut) => {
        update({ shortcut });
        ipcRenderer.send('register-shortcut', shortcut);
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
        setShortcut,
    }), [settings, update, customProfiles, applyQuickProfile, applyCustomProfile, saveCurrentAsProfile, deleteProfile, exportSettings, importSettings, setShortcut]);
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
        setScale: (scale) => {
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

/** Pochette et couleurs du morceau en cours, pour le fond de la fenêtre. */
export function useCoverTheme(enabled) {
    const [cover, setCover] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('liquid_cover_colors') || '{}');
        } catch {
            return {};
        }
    });
    useEffect(() => ipcRenderer.on('cover-color-changed', (_event, next) => next && setCover(next)), []);
    return enabled ? cover : {};
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

    useEffect(() => {
        let alive = true;
        // Envoi en cours : niveaux à jour, mais on garde les réglages affichés (sinon le curseur
        // qu'on glisse revient en arrière à chaque rafraîchissement).
        const receive = (next) => {
            if (!alive || !next) return;
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

    return { status, inputs, outputs, update };
}
