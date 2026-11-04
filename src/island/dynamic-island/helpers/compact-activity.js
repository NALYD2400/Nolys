import { formatTime } from './format.js';

/** Une échéance proche prime sur REC ; un replay en attente laisse la place à la musique. */
export function compactActivity(timer, capture, musicPlaying = false) {
    const timerInfo = timer ? {
        kind: 'timer', mode: 'timer', icon: 'ph-timer',
        label: timer.name || 'Chrono', value: formatTime(Math.max(0, timer.value) * 1000),
        urgent: timer.mode === 'countdown' && timer.value <= 60,
    } : null;
    if (timerInfo?.urgent) return timerInfo;
    if (capture?.recording) return {
        kind: 'recording', mode: 'replay', icon: 'ph-record', label: 'REC',
        value: formatTime(Math.max(0, capture.recordingSeconds || 0) * 1000), urgent: false,
    };
    if (timerInfo) return timerInfo;
    if (!musicPlaying && ['starting', 'buffering', 'stopping'].includes(capture?.phase)) return {
        kind: 'replay', mode: 'replay', icon: 'ph-video-camera', label: 'Replay',
        value: capture.phase === 'buffering' ? 'Actif' : capture.phase === 'starting' ? 'Démarrage' : 'Arrêt', urgent: false,
    };
    return null;
}
