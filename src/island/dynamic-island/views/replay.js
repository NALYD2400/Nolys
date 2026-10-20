import { mountReplay } from '../../../replay/controller.js';
import { replay, initReplay } from '../../../replay/store.js';
import { duration, activeCapture } from '../../../replay/model.js';
import { capsuleSettled, afterIntro } from './library.js';

export const replayView = {
    initReplay() {
        const indicator = document.createElement('button');
        indicator.type = 'button'; indicator.id = 'island-replay-satellite';
        indicator.className = 'island-satellite island-satellite-replay';
        indicator.tabIndex = -1; indicator.setAttribute('aria-hidden', 'true');
        indicator.innerHTML = '<span class="satellite-bg" aria-hidden="true"></span><i class="ph ph-video-camera satellite-icon" aria-hidden="true"></i>';
        this.el.before(indicator); this._replaySatellite = indicator;
        indicator.addEventListener('click', event => { event.stopPropagation(); this.openReplay(); });
        replay.subscribe(({ snapshot }) => {
            if (!snapshot) return;
            this.syncReplaySatellite();
        });
        initReplay();
    },
    syncReplaySatellite() {
        const indicator = this._replaySatellite;
        if (!indicator) return;
        const snapshot = replay.state.snapshot;
        const visible = activeCapture(snapshot) && !this.isExpanded && !this._layoutEditMode;
        indicator.classList.toggle('is-visible', visible);
        indicator.classList.toggle('is-recording', Boolean(snapshot?.recording));
        indicator.tabIndex = visible ? 0 : -1;
        indicator.setAttribute('aria-hidden', String(!visible));
        indicator.title = snapshot?.recording ? `REC ${duration(snapshot.recordingSeconds)} · ouvrir Replay & REC` : snapshot?.phase === 'starting' ? 'Préparation du replay · ouvrir les commandes' : 'Replay actif · ouvrir les commandes';
        indicator.setAttribute('aria-label', indicator.title);
        this.positionMicSatellite?.();
    },
    openReplay() {
        if (this._layoutEditMode || (this.mode === 'replay' && this.isExpanded)) return;
        this.openExpandedMode('replay');
    },
    renderReplay() {
        this.syncReplaySatellite();
        if (this._replayHost?.isConnected) { this.syncGlassControls(); return; }
        this.leaveReplay();
        const host = document.createElement('div'); host.className = 'island-library-view replay-panel-host';
        this.applyFittedHeight(host, 'replay');
        this.content.replaceChildren(host); this._replayHost = host;
        const settled = capsuleSettled(this.el);
        // Capture et Clips (et clip en lecture) : la capsule suit le contenu. Réglages, long et
        // défilant, garde la taille du module.
        const refit = () => {
            const tab = host.shadowRoot?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;
            this.fitToContent(host, 'replay', Boolean(tab) && tab !== 'settings', 536);
        };
        this._replayController = mountReplay(host, {
            ready: settled,
            onClose: () => this.collapseIsland({ force: true }), onBack: () => this.setMode('menu'),
            onPlaybackChange: expanded => {
                this.el.classList.toggle('island-replay-player', expanded);
                const width = Math.min(680, window.innerWidth - 40);
                this.el.style.setProperty('--replay-player-width', `${width}px`);
                host.style.setProperty('--panel-width', `${expanded ? width : 560}px`);
                refit();
            },
            onRender: () => { refit(); settled.then(() => afterIntro(() => { if (this._replayHost === host) this.syncGlassControls(); })); },
        });
        // Le contenu change aussi sans nouveau rendu (capture lancée, enregistrement, erreur).
        this._replayResize = new ResizeObserver(refit);
        for (const id of ['#replay-content', '#replay-feedback']) {
            const element = host.shadowRoot?.querySelector(id);
            if (element) this._replayResize.observe(element);
        }
    },
    leaveReplay() {
        this._replayResize?.disconnect(); this._replayResize = null;
        this._replayController?.destroy(); this._replayController = null; this._replayHost = null;
    },
};
