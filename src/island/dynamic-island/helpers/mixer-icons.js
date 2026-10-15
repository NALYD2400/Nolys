/** Icônes du mixeur audio par application. */
import { APP_ICONS } from './media-art.js';

export const MIXER_ICONS = {
    spotify: APP_ICONS.spotify,
    discord: 'https://api.iconify.design/logos:discord-icon.svg',
    chrome: APP_ICONS.chrome,
    edge: APP_ICONS.edge,
    firefox: APP_ICONS.firefox,
    vlc: APP_ICONS.vlc,
    steam: 'https://api.iconify.design/logos:steam-icon.svg',
    youtube: APP_ICONS.youtube,
    netflix: APP_ICONS.netflix,
    deezer: APP_ICONS.deezer,
    tiktok: APP_ICONS.tiktok,
    instagram: APP_ICONS.instagram,
    twitch: APP_ICONS.twitch,
    facebook: APP_ICONS.facebook,
    x: APP_ICONS.x,
    reddit: APP_ICONS.reddit,
    snapchat: APP_ICONS.snapchat,
    pinterest: APP_ICONS.pinterest,
    linkedin: APP_ICONS.linkedin,
    threads: APP_ICONS.threads,
    bluesky: APP_ICONS.bluesky,
    soundcloud: APP_ICONS.soundcloud
};

/** Icône d'une sortie audio d'après son nom Windows (casque, écran, enceintes). */
export function getOutputDeviceIcon(name = '') {
    const n = String(name).toLowerCase();
    if (n.includes('casque') || n.includes('headphones') || n.includes('headset') || n.includes('earphone')) return 'ph-headphones';
    if (n.includes('hdmi') || n.includes('tv') || n.includes('display') || n.includes('moniteur') || n.includes('nvidia') || n.includes('intel') || n.includes('amd')) return 'ph-monitor';
    return 'ph-speaker-high';
}

/** Icône d'une entrée micro d'après son nom Windows. */
export function getInputDeviceIcon(name = '') {
    const n = String(name).toLowerCase();
    return n.includes('headset') || n.includes('casque') || n.includes('écouteurs') || n.includes('earphone') ? 'ph-microphone-stage' : 'ph-microphone';
}

/** Icône de volume : barré en muet, sinon selon le niveau. */
export function getMuteIcon(isMuted, volume = 0) {
    if (isMuted) return 'ph-speaker-slash';
    return volume < 50 ? 'ph-speaker-low' : 'ph-speaker-high';
}

export function getMixerIcon(name, title) {
    const n = (name || '').toLowerCase();
    const t = (title || '').toLowerCase();

    // In the mixer, show the app icon first. A Chrome tab can play YouTube,
    // but the session volume still belongs to Chrome.
    if (n.includes('spotify')) return MIXER_ICONS.spotify;
    if (n.includes('discord')) return MIXER_ICONS.discord;
    if (n.includes('tiktok')) return MIXER_ICONS.tiktok;
    if (n.includes('instagram')) return MIXER_ICONS.instagram;
    if (n.includes('twitch')) return MIXER_ICONS.twitch;
    if (n.includes('facebook')) return MIXER_ICONS.facebook;
    if (n.includes('twitter') || n.includes('x.com')) return MIXER_ICONS.x;
    if (n.includes('reddit')) return MIXER_ICONS.reddit;
    if (n.includes('snapchat')) return MIXER_ICONS.snapchat;
    if (n.includes('pinterest')) return MIXER_ICONS.pinterest;
    if (n.includes('linkedin')) return MIXER_ICONS.linkedin;
    if (n.includes('threads')) return MIXER_ICONS.threads;
    if (n.includes('bluesky') || n.includes('bsky')) return MIXER_ICONS.bluesky;
    if (n.includes('soundcloud')) return MIXER_ICONS.soundcloud;
    if (n.includes('chrome')) return MIXER_ICONS.chrome;
    if (n.includes('msedge') || n.includes('edge')) return MIXER_ICONS.edge;
    if (n.includes('firefox')) return MIXER_ICONS.firefox;
    if (n.includes('vlc')) return MIXER_ICONS.vlc;
    if (n.includes('steam')) return MIXER_ICONS.steam;

    if (t.includes('youtube')) return MIXER_ICONS.youtube;
    if (t.includes('spotify')) return MIXER_ICONS.spotify;
    if (t.includes('discord')) return MIXER_ICONS.discord;
    if (t.includes('netflix')) return MIXER_ICONS.netflix;
    if (t.includes('deezer')) return MIXER_ICONS.deezer;
    if (t.includes('tiktok') || t.includes('tik tok')) return MIXER_ICONS.tiktok;
    if (t.includes('instagram')) return MIXER_ICONS.instagram;
    if (t.includes('twitch')) return MIXER_ICONS.twitch;
    if (t.includes('facebook')) return MIXER_ICONS.facebook;
    if (t.includes('twitter') || t.includes('x.com')) return MIXER_ICONS.x;
    if (t.includes('reddit')) return MIXER_ICONS.reddit;
    if (t.includes('snapchat')) return MIXER_ICONS.snapchat;
    if (t.includes('pinterest')) return MIXER_ICONS.pinterest;
    if (t.includes('linkedin')) return MIXER_ICONS.linkedin;
    if (t.includes('threads')) return MIXER_ICONS.threads;
    if (t.includes('bluesky') || t.includes('bsky')) return MIXER_ICONS.bluesky;
    if (t.includes('soundcloud')) return MIXER_ICONS.soundcloud;
    
    return null;
}
