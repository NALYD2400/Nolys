import { duration } from './model.js';

const icon = name => `<i class="ph-bold ph-${name}" aria-hidden="true"></i>`;
export const clipControls = () => `<div class="replay-video-controls" role="group" aria-label="Commandes du clip">
    <button type="button" data-clip-control="play" aria-label="Lecture">${icon('play')}</button>
    <output class="replay-video-time" aria-label="Temps de lecture" aria-live="off">00:00 / 00:00</output>
    <div class="replay-video-audio"><button type="button" data-clip-control="mute" aria-label="Couper le son">${icon('speaker-high')}</button>
        <input class="slider replay-video-volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume du clip"></div>
    <button type="button" data-clip-control="fullscreen" aria-label="Plein écran">${icon('corners-out')}</button>
    <input class="slider replay-video-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Position dans le clip" disabled>
</div>`;

/** Les contrôles appartiennent au même repère CSS que le clip, y compris au zoom. */
export function mountClipPlayer(player) {
    const video = player.querySelector('video'), seek = player.querySelector('.replay-video-seek');
    const play = player.querySelector('[data-clip-control="play"]'), mute = player.querySelector('[data-clip-control="mute"]');
    const fullscreen = player.querySelector('[data-clip-control="fullscreen"]'), time = player.querySelector('output');
    const volume = player.querySelector('.replay-video-volume');
    const abort = new AbortController();
    const on = (target, event, callback) => target.addEventListener(event, callback, { signal: abort.signal });
    let scrubbing = false;
    let lastVolume = video.volume || 1;
    const length = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const update = () => {
        const total = length(), current = scrubbing ? Number(seek.value) : video.currentTime || 0;
        seek.disabled = !total; seek.max = String(total);
        if (!scrubbing) seek.value = String(current);
        seek.style.setProperty('--pct', `${total ? Math.min(100, 100 * current / total) : 0}%`);
        seek.setAttribute('aria-valuetext', `${duration(current)} sur ${duration(total)}`);
        time.value = `${duration(current)} / ${duration(total)}`;
        const paused = video.paused || video.ended;
        const playLabel = paused ? 'Lecture' : 'Pause';
        if (play.getAttribute('aria-label') !== playLabel || !play.firstElementChild) {
            play.setAttribute('aria-label', playLabel); play.innerHTML = icon(paused ? 'play' : 'pause');
        }
        const silent = video.muted || video.volume === 0;
        if (!silent) lastVolume = video.volume;
        volume.value = String(video.muted ? 0 : video.volume);
        volume.style.setProperty('--pct', `${Number(volume.value) * 100}%`);
        volume.setAttribute('aria-valuetext', `${Math.round(Number(volume.value) * 100)} %`);
        const muteLabel = silent ? 'Activer le son' : 'Couper le son';
        if (mute.getAttribute('aria-label') !== muteLabel || !mute.firstElementChild) {
            mute.setAttribute('aria-label', muteLabel); mute.innerHTML = icon(silent ? 'speaker-slash' : 'speaker-high');
        }
    };
    const toggle = () => { if (video.paused || video.ended) video.play().catch(() => {}); else video.pause(); };
    const toggleMute = () => {
        if (video.muted || video.volume === 0) { video.muted = false; if (!video.volume) video.volume = lastVolume; }
        else video.muted = true;
    };
    on(play, 'click', toggle); on(video, 'click', toggle);
    on(mute, 'click', toggleMute);
    on(volume, 'input', () => { video.muted = false; video.volume = Number(volume.value); });
    fullscreen.hidden = !document.fullscreenEnabled;
    on(fullscreen, 'click', async () => {
        try { if (document.fullscreenElement) await document.exitFullscreen(); else await player.requestFullscreen(); }
        catch { fullscreen.hidden = true; }
    });
    on(document, 'fullscreenchange', () => {
        const active = Boolean(document.fullscreenElement);
        fullscreen.setAttribute('aria-label', active ? 'Quitter le plein écran' : 'Plein écran');
        fullscreen.innerHTML = icon(active ? 'corners-in' : 'corners-out');
    });
    on(seek, 'pointerdown', () => { scrubbing = true; });
    on(seek, 'input', () => {
        if (length()) video.currentTime = Math.min(length(), Math.max(0, Number(seek.value)));
        update();
    });
    const release = () => { if (scrubbing) { scrubbing = false; update(); } };
    on(window, 'pointerup', release); on(window, 'pointercancel', release); on(window, 'blur', release);
    on(seek, 'change', release);
    on(player, 'keydown', event => {
        // Le range conserve Home/End, flèches et PageUp/PageDown natifs.
        if (event.target === video && [' ', 'k'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); toggle(); }
        if (event.target === video && ['ArrowLeft', 'ArrowRight'].includes(event.key) && length()) {
            event.preventDefault(); event.stopPropagation();
            video.currentTime = Math.max(0, Math.min(length(), video.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
        }
        if (event.target === video && event.key.toLowerCase() === 'm') { event.preventDefault(); event.stopPropagation(); toggleMute(); }
        if (event.key === 'Escape' && document.fullscreenElement) event.stopPropagation();
    });
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'ended', 'volumechange', 'emptied']) on(video, event, update);
    update();
    return { destroy() { abort.abort(); } };
}
