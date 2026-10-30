import { useEffect, useState } from 'react';
import { readJSON } from '../../shared/safe-storage.js';
import { MIC_PROFILES_KEY, EMPTY_MIC_PROFILES, validMicProfiles, findMicProfile, saveMicProfile, micProfilePatch } from '../../shared/mic-profiles.js';

export function useMicProfiles(config, update) {
    const [profiles, setProfiles] = useState(() => readJSON(MIC_PROFILES_KEY, EMPTY_MIC_PROFILES, validMicProfiles));
    const [message, setMessage] = useState('');
    useEffect(() => {
        const reload = () => { setProfiles(readJSON(MIC_PROFILES_KEY, EMPTY_MIC_PROFILES, validMicProfiles)); setMessage(''); };
        window.addEventListener('nolys-preferences-restored', reload);
        return () => window.removeEventListener('nolys-preferences-restored', reload);
    }, []);
    const profile = findMicProfile(profiles, config?.inputId || '', config?.outputId || '');
    const persist = next => {
        if (!next) { setMessage('Profil invalide ou limite de 32 profils atteinte.'); return false; }
        try { localStorage.setItem(MIC_PROFILES_KEY, JSON.stringify(next)); }
        catch { setMessage('Profil non enregistré : stockage indisponible.'); return false; }
        setProfiles(next); return true;
    };
    return { saved: Boolean(profile), message,
        save: () => { if (persist(saveMicProfile(profiles, config))) setMessage('Profil enregistré pour ce micro et cette sortie.'); },
        apply: async () => {
            const patch = micProfilePatch(profile);
            if (!patch) return;
            await update(patch);
            setMessage('Profil appliqué. Retour coupé : réactive-le quand tu es prêt.');
        },
        remove: () => {
            if (persist({ version: 1, profiles: profiles.profiles.filter(item => item !== profile) })) setMessage('Profil retiré.');
        },
    };
}
