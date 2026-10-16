/** Fournisseurs de recherche musicale et clés de l’historique. */
import { isDedicatedPlayerApp } from './media-art.js';

export function getMusicSearchProvider(data = {}) {
    if (data.appId === 'nolys-local') return { key: 'local', label: 'Bibliothèque Nolys', icon: 'ph-vinyl-record' };
    const appId = (data.appId || '').toLowerCase();
    const title = (data.title || '').toLowerCase();
    const artist = (data.artist || '').toLowerCase();
    const windowTitle = (data.windowTitle || '').toLowerCase();
    // Lecteur dédié : seule l'application compte, pas les mots du titre (cf. media-art.js).
    const haystack = isDedicatedPlayerApp(appId) ? appId : `${appId} ${title} ${artist} ${windowTitle}`;
    const isBrowser = /chrome|msedge|edge|firefox|brave|opera|arc/.test(appId);

    if (haystack.includes('tiktok') || haystack.includes('tik tok')) return { key: 'tiktok', label: 'TikTok', icon: 'ph-video' };
    if (haystack.includes('instagram')) return { key: 'instagram', label: 'Instagram', icon: 'ph-instagram-logo' };
    if (haystack.includes('twitch')) return { key: 'twitch', label: 'Twitch', icon: 'ph-twitch-logo' };
    if (haystack.includes('spotify')) {
        return isBrowser
            ? { key: 'spotify-web', label: 'Spotify Web', icon: 'ph-spotify-logo' }
            : { key: 'spotify', label: 'Spotify', icon: 'ph-spotify-logo' };
    }
    if (haystack.includes('youtube music') || haystack.includes('yt music')) return { key: 'youtube-music', label: 'YouTube Music', icon: 'ph-youtube-logo' };
    if (haystack.includes('youtube')) return { key: 'youtube-music', label: 'YouTube Music', icon: 'ph-youtube-logo' };
    if (haystack.includes('deezer')) return { key: 'deezer', label: 'Deezer', icon: 'ph-music-notes' };
    if (haystack.includes('apple music') || haystack.includes('itunes')) return { key: 'apple-music', label: 'Apple Music', icon: 'ph-music-notes' };
    if (haystack.includes('soundcloud')) return { key: 'soundcloud', label: 'SoundCloud', icon: 'ph-cloud' };
    if (haystack.includes('tidal')) return { key: 'tidal', label: 'Tidal', icon: 'ph-waveform' };
    if (haystack.includes('amazon music')) return { key: 'amazon-music', label: 'Amazon Music', icon: 'ph-music-notes' };
    if (isBrowser) return { key: 'web-music', label: 'Web musique', icon: 'ph-globe' };

    return { key: 'web-music', label: 'Web musique', icon: 'ph-magnifying-glass' };
}

export function getMusicSearchTarget(query, provider) {
    const encoded = encodeURIComponent(query.trim());

    switch (provider.key) {
        case 'spotify':
            return `spotify:search:${encoded}`;
        case 'spotify-web':
            return `https://open.spotify.com/search/${encoded}`;
        case 'youtube-music':
            return `https://music.youtube.com/search?q=${encoded}`;
        case 'deezer':
            return `https://www.deezer.com/search/${encoded}`;
        case 'apple-music':
            return `https://music.apple.com/search?term=${encoded}`;
        case 'soundcloud':
            return `https://soundcloud.com/search?q=${encoded}`;
        case 'tidal':
            return `https://listen.tidal.com/search?q=${encoded}`;
        case 'amazon-music':
            return `https://music.amazon.com/search/${encoded}`;
        case 'tiktok':
            return `https://www.tiktok.com/search?q=${encoded}`;
        case 'instagram':
            return `https://www.instagram.com/explore/search/keyword/?q=${encoded}`;
        case 'twitch':
            return `https://www.twitch.tv/search?term=${encoded}`;
        default:
            return `https://www.google.com/search?q=${encoded}%20music`;
    }
}

export function getCurrentTrackSearchQuery(data = {}) {
    const title = (data.title || '').trim();
    const artist = (data.artist || '').trim();
    const ignoredTitles = ['Aucune lecture', 'Sans titre'];
    const ignoredArtists = ['Systeme', 'Système', 'Artiste inconnu', 'Lecteur media', 'Lecteur mÃ©dia'];
    const parts = [];

    if (artist && !ignoredArtists.includes(artist)) parts.push(artist);
    if (title && !ignoredTitles.includes(title)) parts.push(title);

    return parts.join(' ').trim();
}

export function getMusicHistoryKey(data = {}) {
    return `${data.title || ''}::${data.artist || ''}::${data.appId || ''}`.toLowerCase();
}

export function isHistoryTrack(data = {}) {
    const title = (data.title || '').trim();
    const artist = (data.artist || '').trim();

    if (!title || title === 'Aucune lecture' || title === 'Sans titre') return false;
    if (artist === 'Système' || artist === 'SystÃ¨me') return false;

    return getCurrentTrackSearchQuery(data).length > 0;
}
