/** Les images embarquées/locales restent disponibles sans connexion. */
export function offlineArt(value) {
    if (typeof value !== 'string') return '';
    let offline = false;
    try { offline = globalThis.localStorage?.getItem('liquid_offline_mode') === 'true'; } catch { /* lecture interdite */ }
    return offline && /^(https?:)?\/\//i.test(value) ? '' : value;
}
