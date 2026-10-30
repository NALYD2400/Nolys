import { offlineArt } from '../../../shared/privacy.js';
/** Pochettes, icônes d’applications et visuels de repli. */

export const APP_LOGO_ART = '/assets/app-logo.png';

// Monogrammes dessinés pour Nolys, embarqués : aucun serveur d'icônes tiers.
const badge = (letters, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color}"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="29" font-weight="600" text-anchor="middle" fill="white">${letters}</text></svg>`)}`;
export const APP_ICONS = Object.fromEntries([
    ['spotify','S','#187b42'], ['netflix','N','#a71923'], ['youtube','YT','#b92222'], ['disney','D+','#204789'],
    ['crunchyroll','C','#a94a16'], ['tiktok','TT','#34343d'], ['instagram','IG','#a72d63'], ['twitch','Tw','#6743a7'],
    ['facebook','f','#2365a0'], ['x','X','#34343d'], ['reddit','R','#a83b1d'], ['snapchat','Sc','#887600'],
    ['pinterest','P','#a02330'], ['linkedin','in','#205f8d'], ['threads','Th','#34343d'], ['bluesky','B','#2671b4'],
    ['soundcloud','SC','#aa4317'], ['deezer','Dz','#7b36ad'], ['chrome','Ch','#326b43'], ['edge','E','#236987'],
    ['firefox','Fx','#994020'], ['vlc','V','#97541d'],
].map(([name, letters, color]) => [name, badge(letters, color)]));

/**
 * Lecteurs dédiés : l'application qui joue est connue avec certitude. Le titre du
 * morceau ne doit alors jamais la remplacer (« STRUCT - Tiktok Version » sur
 * Spotify affichait le logo TikTok à la place de la pochette).
 */
const DEDICATED_PLAYER_APPS = /spotify|deezer|soundcloud|tidal|applemusic|itunes|amazonmusic|zunemusic|qobuz|vlc|foobar|musicbee|aimp|winamp|mediaplayer/;

export function isDedicatedPlayerApp(appId) {
    return DEDICATED_PLAYER_APPS.test((appId || '').toLowerCase().replace(/[\s.]/g, ''));
}

export function getFallbackIcon(appId, title, artist = '', windowTitle = '') {
    if (appId === 'nolys-local') return APP_LOGO_ART;
    const id = appId ? appId.toLowerCase().replace('.exe', '') : '';
    const t = `${title || ''} ${artist || ''} ${windowTitle || ''}`.toLowerCase();

    // Priorité 1 : service deviné d'après le titre, utile seulement dans un navigateur
    // (un onglet peut jouer YouTube, Netflix…). Ignoré pour un lecteur dédié.
    if (isDedicatedPlayerApp(appId)) return getAppIcon(id);
    if (t.includes('netflix')) return APP_ICONS.netflix;
    if (t.includes('disney')) return APP_ICONS.disney;
    if (t.includes('crunchyroll')) return APP_ICONS.crunchyroll;
    if (t.includes('youtube') || t.includes('yt music')) return APP_ICONS.youtube;
    if (t.includes('spotify')) return APP_ICONS.spotify;
    if (t.includes('tiktok') || t.includes('tik tok')) return APP_ICONS.tiktok;
    if (t.includes('instagram')) return APP_ICONS.instagram;
    if (t.includes('twitch')) return APP_ICONS.twitch;
    if (t.includes('facebook')) return APP_ICONS.facebook;
    if (t.includes('twitter') || t.includes('x.com')) return APP_ICONS.x;
    if (t.includes('reddit')) return APP_ICONS.reddit;
    if (t.includes('snapchat')) return APP_ICONS.snapchat;
    if (t.includes('pinterest')) return APP_ICONS.pinterest;
    if (t.includes('linkedin')) return APP_ICONS.linkedin;
    if (t.includes('threads')) return APP_ICONS.threads;
    if (t.includes('bluesky') || t.includes('bsky')) return APP_ICONS.bluesky;
    if (t.includes('soundcloud')) return APP_ICONS.soundcloud;
    if (t.includes('deezer')) return APP_ICONS.deezer;

    // Priorité 2 : d'après l'application
    return getAppIcon(id);
}

function getAppIcon(id) {
    if (id.includes('spotify')) return APP_ICONS.spotify;
    if (id.includes('netflix')) return APP_ICONS.netflix;
    if (id.includes('tiktok')) return APP_ICONS.tiktok;
    if (id.includes('instagram')) return APP_ICONS.instagram;
    if (id.includes('twitch')) return APP_ICONS.twitch;
    if (id.includes('facebook')) return APP_ICONS.facebook;
    if (id.includes('twitter') || id.includes('x.com')) return APP_ICONS.x;
    if (id.includes('reddit')) return APP_ICONS.reddit;
    if (id.includes('snapchat')) return APP_ICONS.snapchat;
    if (id.includes('pinterest')) return APP_ICONS.pinterest;
    if (id.includes('linkedin')) return APP_ICONS.linkedin;
    if (id.includes('threads')) return APP_ICONS.threads;
    if (id.includes('bluesky') || id.includes('bsky')) return APP_ICONS.bluesky;
    if (id.includes('soundcloud')) return APP_ICONS.soundcloud;
    if (id.includes('deezer')) return APP_ICONS.deezer;
    if (id.includes('vlc')) return APP_ICONS.vlc;
    return null;
}

export function shouldPreferServiceIcon(appId, title, artist) {
    const id = (appId || '').toLowerCase().replace('.exe', '');
    const t = (title || '').trim().toLowerCase();
    const a = (artist || '').trim().toLowerCase();

    if (!id) return false;

    const streamingServices = ['netflix', 'youtube', 'disney', 'crunchyroll', 'primevideo', 'deezer'];
    if (!streamingServices.some(service => id.includes(service))) {
        return false;
    }

    // Browser SMTC often returns a tiny favicon/browser icon instead of real artwork.
    // If the metadata is basically just the service name, prefer the service icon.
    return !t || !a || t === a || t === id || a === id;
}

export function isSocialFallbackIcon(iconUrl) {
    return [
        APP_ICONS.tiktok,
        APP_ICONS.instagram,
        APP_ICONS.twitch,
        APP_ICONS.facebook,
        APP_ICONS.x,
        APP_ICONS.reddit,
        APP_ICONS.snapchat,
        APP_ICONS.pinterest,
        APP_ICONS.linkedin,
        APP_ICONS.threads,
        APP_ICONS.bluesky
    ].includes(iconUrl);
}

export function getServiceArtStyle(size = 'large') {
    if (size === 'small') {
        return "box-sizing: border-box; object-fit: contain; background: #050505; padding: 8px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);";
    }

    return "box-sizing: border-box; object-fit: contain; background: #050505; padding: 16px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 5px 15px rgba(0,0,0,0.3);";
}

export function getEffectiveMediaArt(data) {
    if (!data) return "";

    const appIcon = getFallbackIcon(data.appId, data.title, data.artist, data.windowTitle);
    const preferServiceIcon = shouldPreferServiceIcon(data.appId, data.title, data.artist);
    if (appIcon && (preferServiceIcon || isSocialFallbackIcon(appIcon))) {
        return appIcon;
    }

    return offlineArt(data.cover);
}

export function getRawDisplayMediaArt(data) {
    if (!data) return "";
    return getEffectiveMediaArt(data) || offlineArt(data.transientCover) || getFallbackIcon(data.appId, data.title, data.artist, data.windowTitle) || "";
}

export function getDisplayMediaArt(data) {
    if (!data) return "";
    return offlineArt(data.displayCover) || getRawDisplayMediaArt(data);
}

/**
 * Flou de la pochette en fond (Réglages → Apparence → Flou de la pochette). La valeur par défaut,
 * 30, donne 24 px derrière le lecteur (`scale` 0,8) et 16 px dans la pilule (0,55).
 */
export function coverBlurPx(scale) {
    let blur = 30;
    try {
        const value = JSON.parse(localStorage.getItem('liquid_island_config') || '{}').blur;
        if (Number.isFinite(value)) blur = value;
    } catch { /* réglage illisible : valeur par défaut */ }
    return Math.round(blur * scale);
}
