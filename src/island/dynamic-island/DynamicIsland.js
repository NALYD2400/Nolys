/**
 * Dynamic Island — composant principal.
 *
 * La classe ne contient que l'état initial (constructeur). Les méthodes sont
 * regroupées par fonctionnalité dans `features/` et `views/`, puis ajoutées
 * au prototype : le comportement est identique à une classe d'un seul bloc.
 */
import { ipcRenderer } from '../../shared/ipc.js';
import { activeHotkeys, hotkeyLabel, readHotkeys } from '../../shared/hotkeys.js';

import { visualizerMethods } from './features/visualizer.js';
import { preferenceMethods } from './features/preferences.js';
import { coverThemeMethods } from './features/cover-theme.js';
import { eventMethods } from './features/events.js';
import { loopMethods } from './features/loops.js';
import { navigationMethods } from './features/navigation.js';
import { playbackMethods } from './features/playback.js';
import { musicHistoryMethods } from './features/music-history.js';
import { volumeMethods } from './features/volume.js';
import { mixerMethods } from './features/mixer.js';
import { glassMethods } from './features/glass.js';
import { micMonitorMethods } from './features/mic-monitor.js';
import { idleView } from './views/idle.js';
import { musicView } from './views/music.js';
import { musicSearchView } from './views/music-search.js';
import { searchView } from './views/search.js';
import { controlCenterView } from './views/control-center.js';
import { menuView } from './views/menu.js';
import { notificationView } from './views/notification.js';
import { systemViews } from './views/system.js';
import { micMonitorView } from './views/mic-monitor.js';
import { glowHaloMethods } from './features/glow-halo.js';
import { framePacerMethods } from './features/frame-pacer.js';

export class DynamicIsland {
    constructor() {
        window.island = this; // Bind globally for absolute safety!
        this.el = document.getElementById('dynamic-island');
        this.dragSurface = document.getElementById('layout-drag-surface');
        this.content = this.el.querySelector('.island-content');
        this.isExpanded = false;
        this.isPlaying = false;
        this.mode = 'music';
        this.timerValue = 0; // secondes : écoulées (chrono) ou restantes (minuteur)
        this.isTimerRunning = false;
        this.timerMode = 'stopwatch'; // 'stopwatch' | 'countdown'
        this.timerPreset = 0; // dernière durée choisie pour le minuteur, en secondes
        this.fps = 60;
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.isBackgroundMode = false;
        this.lastMediaUpdate = Date.now();

        // Audio visualizer state
        this._vizBands = [0, 0, 0, 0, 0];
        this._vizUnsub = null;
        this._vizCanvas = null;
        this._vizRaf = null;
        this._mediaPollTimer = null;
        this._smoothTimer = null;
        this._mediaPollingActive = false;
        this._smoothLoopActive = false;
        this.isEcoMode = localStorage.getItem('liquid_eco_mode') === 'true';

        // Album art color sync state
        this._coverColors = null;
        this._lastCoverUrl = null;
        this._preloadedMediaArt = new Set();
        this._pendingMediaArt = new Set();
        this._lastStableDisplayArt = "";
        this._islandConfig = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
        this._lastRenderedTrack = null;
        this._lastTrackId = null;
        this._isNewTrackSignal = false;
        this._pendingCoverAnimationTrackKey = "";
        this._layoutConfig = JSON.parse(localStorage.getItem('liquid_layout_config') || '{"scale":1}');
        this._layoutEditMode = false;
        this._layoutEditArmTimeout = null;
        this.musicHistory = this.loadMusicHistory();

        // Audio sessions mixer state
        this.audioSessions = [];
        this.isScrubbingMixer = false;
        this.scrubbingPid = null;
        this.audioDevices = [];
        this.isAudioDeviceDropdownOpen = false;
        this.audioInputDevices = [];
        this.isMicDeviceDropdownOpen = false;
        this._transitionInProgress = false;
        this._transitionToken = 0;
        this._controlSliderCleanup = null;
        this._mediaControlPendingUntil = 0;
        this._mediaControlExpectedIsPlaying = null;
        this._mediaControlPendingTrackKey = "";
        this._mediaStateRequestInFlight = false;
        this._lastMixerRowCount = null;
        this._isTransitioning = false; // Flag to prevent layout reflow lag during size transitions

        this.renderIdle();
        this.applyLayoutConfig(this._layoutConfig);
        this.initEvents();
        this.initGlowHalo();
        this.initFramePacer();
        this.startMainLoop();
        this.startProgressSmoothLoop();
        this.syncPersistentSetting();
        this.syncMotionPreference();
        this.syncEcoMode();
        this.initMicMonitor();
        this.initTimerSatellite();

        // Raccourcis globaux (afficher / masquer, lecture, placement…) enregistrés au démarrage.
        // Une combinaison refusée (prise par Windows ou une autre appli) est signalée dans l'Island.
        ipcRenderer.invoke('register-shortcuts', activeHotkeys(readHotkeys()))
            .then((conflicts) => {
                if (!conflicts?.length) return;
                const names = conflicts.map((conflict) => `${hotkeyLabel(conflict.action)} (${conflict.accelerator})`).join(', ');
                setTimeout(() => this.showNotification('Raccourci indisponible', `À changer dans les Réglages : ${names}`, 'ph-keyboard'), 4000);
            })
            .catch(() => {});

        // Apply persistent modes on load
        if (localStorage.getItem('liquid_focus_mode') === 'true') {
            document.body.classList.add('focus-mode-active');
        }

        // Start visualizer service (simulation until audio is playing)
        this._startVisualizer();
    }
}

const METHOD_GROUPS = [
    glowHaloMethods,
    framePacerMethods,
    visualizerMethods,
    preferenceMethods,
    coverThemeMethods,
    eventMethods,
    loopMethods,
    navigationMethods,
    playbackMethods,
    musicHistoryMethods,
    volumeMethods,
    mixerMethods,
    glassMethods,
    micMonitorMethods,
    idleView,
    musicView,
    musicSearchView,
    searchView,
    controlCenterView,
    menuView,
    notificationView,
    systemViews,
    micMonitorView,
];

// Méthodes non énumérables, comme celles déclarées directement dans une classe.
for (const group of METHOD_GROUPS) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(group))) {
        Object.defineProperty(DynamicIsland.prototype, name, { ...descriptor, enumerable: false });
    }
}
