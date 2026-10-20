import { mountFiles } from '../../../files/controller.js';
import { files, initFiles, select, start, message, notify } from '../../../files/store.js';
import { native } from '../../../shared/ipc.js';
import { themeLook } from '../../../shared/theme-look.js';
import { capsuleSettled, afterIntro } from './library.js';

export const filesView = {
    initFiles() {
        initFiles();
        let enterTimer, leaveTimer, position, openedAt, selectionAction = null, session = null;
        const receiver = document.createElement('div');
        receiver.className = 'island-file-receiver';
        receiver.setAttribute('aria-hidden', 'true');
        receiver.innerHTML = `<div class="files-receiver-label"><i class="ph ph-tray-arrow-down"></i><strong>Déposez pour choisir</strong><span>Convertir, transformer ou garder à portée de main</span></div><div class="files-receiver-targets"><div data-file-target="png"><i class="ph ph-image"></i><strong>PNG</strong></div><div data-file-target="choose"><i class="ph ph-files"></i><strong>Choisir une action</strong></div><div data-file-target="copy"><i class="ph ph-copy"></i><strong>Créer une copie</strong></div></div>`;
        this.el.append(receiver);
        const hide = () => {
            clearTimeout(enterTimer); clearTimeout(leaveTimer); enterTimer = null;
            this._fileReceiving = false; this.el.classList.remove('island-file-receiving');
            receiver.querySelectorAll('.is-targeted').forEach(el => el.classList.remove('is-targeted'));
            window.dispatchEvent(new Event('nolys-hit-region-changed'));
        };
        const show = point => {
            if (this._layoutEditMode || files.busy || files.outgoing) return;
            this._fileReceiving = true;
            const look = themeLook(this._islandConfig, this._coverColors?.primary);
            receiver.style.setProperty('--files-accent', look.accent);
            this.el.classList.add('island-file-receiving');
            openedAt = point;
            window.dispatchEvent(new Event('nolys-hit-region-changed'));
        };
        native.listen('files-drag', payload => {
            if (payload.type === 'enter' || payload.type === 'over') {
                if (session !== payload.session) {
                    hide(); session = payload.session; selectionAction = null; this._fileDropAction = null;
                }
                clearTimeout(leaveTimer);
                position = payload.position;
                if (!this._fileReceiving && !enterTimer) enterTimer = setTimeout(() => show(position), 120);
                if (!this._fileReceiving || !position) return;
                const moved = openedAt && Math.hypot(position.x - openedAt.x, position.y - openedAt.y) > 10;
                selectionAction = null;
                receiver.querySelectorAll('[data-file-target]').forEach(target => {
                    const r = target.getBoundingClientRect();
                    const hit = moved && position.x >= r.left && position.x <= r.right && position.y >= r.top && position.y <= r.bottom;
                    target.classList.toggle('is-targeted', hit);
                    if (hit) selectionAction = target.dataset.fileTarget;
                });
            } else if (payload.type === 'drop') {
                this._fileDropAction = selectionAction;
                hide();
            } else {
                clearTimeout(enterTimer); enterTimer = null;
                leaveTimer = setTimeout(() => { selectionAction = null; hide(); }, 250);
            }
        }).catch(message);
        native.listen('files-selection', async payload => {
            hide(); select(payload.inputs); this.openFiles();
            const action = this._fileDropAction; this._fileDropAction = null;
            if (action === 'copy') await start('copy');
            if (action === 'png' && payload.inputs.every(input => ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(input.extension))) await start('convert', { format: 'png' });
        }).catch(message);
        native.listen('files-error', () => { hide(); this.openFiles(); }).catch(() => {});
        // A native drop must never navigate the WebView to a local file.
        document.addEventListener('dragover', event => event.preventDefault());
        document.addEventListener('drop', event => event.preventDefault());
    },
    openFiles() {
        if (this._layoutEditMode) return;
        if (this.mode === 'files' && this.isExpanded) return;
        if (this.mode !== 'files') this._filesReturnState = { mode: this.mode, isExpanded: this.isExpanded };
        ++this._transitionToken;
        this._transitionInProgress = false; this._isTransitioning = false; this._queuedTransition = null;
        this.el.classList.remove('animating');
        this.transitionState(() => { this.mode = 'files'; this.isExpanded = true; this.renderContent(); });
    },
    renderFiles() {
        this.el.classList.remove(...this.getIslandSizeClasses());
        this.el.classList.add('island-expanded', 'island-mode-files');
        const fitted = this.fittedHeight('files');
        this.el.style.height = fitted ? `${fitted}px` : ''; this.el.style.width = '';
        const look = themeLook(this._islandConfig, this._coverColors?.primary);
        this.el.style.setProperty('--files-accent', look.accent);
        if (this._filesHost?.isConnected) { this.syncGlassControls(); return; }
        if (this._isTransitioning) return;
        this._filesHost = document.createElement('div');
        this._filesHost.className = 'island-library-view files-panel-host';
        this.applyFittedHeight(this._filesHost, 'files');
        this.el.append(this._filesHost);
        const host = this._filesHost;
        const settled = capsuleSettled(this.el);
        // La capsule suit le contenu (liste, activité, aperçu), au plus la taille du module.
        const refit = () => this.fitToContent(host, 'files', true, 496);
        this._filesController = mountFiles(host, {
            ready: settled,
            onClose: () => this.closeFiles(),
            onBack: () => this.closeFiles(),
            onPreviewChange: expanded => {
                this.el.classList.toggle('island-files-preview', expanded);
                const width = Math.min(680, window.innerWidth - 40);
                this.el.style.setProperty('--files-preview-width', `${width}px`);
                host.style.setProperty('--panel-width', `${expanded ? width : 560}px`);
                refit();
            },
            onRender: () => { refit(); settled.then(() => afterIntro(() => { if (this._filesHost === host && this.mode === 'files') this.syncGlassControls(); })); },
        });
        // Contenu qui change sans nouveau rendu complet (fichiers ajoutés, tâche, message).
        this._filesResize = new ResizeObserver(refit);
        for (const id of ['#files-content', '#files-notice']) {
            const element = host.shadowRoot?.querySelector(id);
            if (element) this._filesResize.observe(element);
        }
        window.dispatchEvent(new Event('nolys-hit-region-changed'));
    },
    closeFiles() {
        if (this._filesController?.busy) return;
        const previous = this._filesReturnState || { mode: 'music', isExpanded: false };
        this._filesReturnState = null;
        this.transitionState(() => {
            this.leaveFiles(); this.mode = previous.mode; this.isExpanded = previous.isExpanded; this.renderContent();
        });
    },
    leaveFiles() {
        this._filesResize?.disconnect(); this._filesResize = null;
        this._filesController?.destroy(); this._filesController = null;
        this._filesHost?.remove(); this._filesHost = null;
        this.el.classList.remove('island-mode-files', 'island-files-preview');
    },
    filesNotify(text) { files.notice = text; notify(); },
};
