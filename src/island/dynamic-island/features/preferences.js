/** Préférences d’affichage : position, animations, mode éco, persistance. */
import { ipcRenderer, native } from '../../../shared/ipc.js';
import { visualizerService } from '../../../services/AudioVisualizerService.js';
import { MOTION_LEVELS } from '../helpers/constants.js';
import { decide } from '../../../shared/capsule-state.js';

export const preferenceMethods = {
    applyWindowViewport(viewport) {
        if (!viewport) return;
        this._windowViewport = viewport;
        this.syncWindowViewport();
    },

    syncWindowViewport() {
        const viewport = this._windowViewport;
        if (!viewport) return;
        const zoom = (window.devicePixelRatio || 1) / (viewport.monitorScale || 1);
        const offsetX = (viewport.offsetX + 540) * viewport.scale / zoom - 540;
        const offsetY = (viewport.offsetY + 192) * viewport.scale / zoom - 192;
        window.__NOLYS_VIEWPORT__ = { ...viewport, scale: zoom, offsetX, offsetY };
        const container = document.getElementById('dynamic-island-container');
        container?.style.setProperty('--island-frame-width', '1080px');
        container?.style.setProperty('--island-viewport-x', `${offsetX}px`);
        container?.style.setProperty('--island-viewport-y', `${offsetY}px`);
        const scale = this._layoutEditMode ? (this._paintLayoutScale ?? this._layoutConfig.scale ?? 1) : viewport.scale;
        container?.style.setProperty('--island-placement-scale', String(scale / zoom));
        this.anchorLayoutToolbar();
        this.syncGlowHalo?.();
        window.dispatchEvent(new Event('nolys-hit-region-changed'));
    },

    /** Configuration native ; le placement prévisualise l’échelle dans le contenu. */
    applyLayoutConfig(layout) {
        if (!this._windowViewport && window.__NOLYS_VIEWPORT__) this.applyWindowViewport(window.__NOLYS_VIEWPORT__);
        this._layoutConfig = {
            ...this._layoutConfig,
            ...(layout || {})
        };

        const container = document.getElementById('dynamic-island-container');
        if (!container) return;

        const scale = Number(this._layoutConfig.scale);
        const safeScale = Number.isFinite(scale) ? Math.min(1.5, Math.max(0.65, scale)) : 1;
        // Taille demandée atteinte : les clics suivants repartent de la valeur réelle.
        if (this._pendingLayoutScale === safeScale) this._pendingLayoutScale = null;
        // Les vues normales gardent également l'échelle enregistrée dans le contenu.
        container.style.setProperty('--island-layout-scale', safeScale.toString());
        this.paintLayoutScale(this._pendingLayoutScale ?? safeScale, this._layoutEditMode);
        this.updateLayoutScaleLabel();
        this.anchorLayoutToolbar();
    },

    updateLayoutScaleLabel() {
        const scaleLabel = document.querySelector('#layout-edit-toolbar .layout-edit-scale');
        const scale = this._pendingLayoutScale ?? (Number(this._layoutConfig.scale) || 1);
        if (scaleLabel) scaleLabel.textContent = `${Math.round(scale * 100)} %`;
    },

    /**
     * Change la taille par pas de 5 %, dans les limites du cœur natif (65 à 150 %).
     * La valeur demandée est gardée à part : des clics rapides, plus rapides que la réponse
     * du cœur natif, repartaient sinon d'une ancienne taille (clics perdus).
     */
    stepLayoutScale(direction) {
        const current = this._pendingLayoutScale ?? (Number(this._layoutConfig.scale) || 1);
        const next = Math.min(1.5, Math.max(0.65, Math.round((current + direction * 0.05) * 100) / 100));
        if (next === current) return;
        this._pendingLayoutScale = next;
        this.updateLayoutScaleLabel(); // pourcentage à jour sans attendre le cœur natif
        if (this._layoutEditMode) this.paintLayoutScale(next, true);
        ipcRenderer.send('layout-config-changed', { scale: next });
    },

    /** Le zoom de la WebView reste fixe en placement ; seule la pilule évolue. */
    paintLayoutScale(scale, animate = false) {
        if (animate && this._layoutScaleTarget === scale && this._layoutScaleFrame) return;
        cancelAnimationFrame(this._layoutScaleFrame);
        this._layoutScaleFrame = 0;
        this._layoutScaleTarget = scale;
        const container = document.getElementById('dynamic-island-container');
        if (!container) return;
        const from = this._paintLayoutScale ?? scale;
        const paint = value => {
            this._paintLayoutScale = value;
            const zoom = this._windowViewport ? (window.devicePixelRatio || 1) / (this._windowViewport.monitorScale || 1) : 1;
            const shown = this._layoutEditMode ? value : (this._windowViewport?.scale ?? zoom);
            container.style.setProperty('--island-placement-scale', String(shown / zoom));
            this.anchorLayoutToolbar();
            this.syncGlowHalo?.();
        };
        if (!animate || this.getMotionLevel() === 'sober' || Math.abs(scale - from) < 0.0001) {
            paint(scale);
            document.body.classList.remove('layout-scaling');
            return;
        }
        document.body.classList.add('layout-scaling');
        const started = performance.now();
        const frame = now => {
            const progress = Math.min(1, (now - started) / 140);
            paint(from + (scale - from) * (1 - Math.pow(1 - progress, 3)));
            this._layoutScaleFrame = progress < 1 ? requestAnimationFrame(frame) : 0;
            if (progress === 1) document.body.classList.remove('layout-scaling');
        };
        this._layoutScaleFrame = requestAnimationFrame(frame);
    },

    layoutViewport() {
        if (this._windowViewport) return window.__NOLYS_VIEWPORT__ || this._windowViewport;
        const { x = 0, y = 0, scale = 1 } = this._layoutConfig;
        return this._layoutEditMode
            ? { x: x + 1080 * (scale - 1) / 2, y: y + 192 * (scale - 1), scale: 1 }
            : { x, y, scale };
    },

    /**
     * Barre de placement immobile pendant qu'on clique sur − / + : la pilule grandit et
     * poussait la barre vers le bas, le bouton fuyait sous la souris. On la fige à l'écran
     * au premier clic, puis elle rejoint sa place sous la pilule une fois les clics finis.
     */
    freezeLayoutToolbar() {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar) return;
        const { x, y, scale } = this.layoutViewport();
        if (!this._toolbarAnchor) {
            const rect = toolbar.getBoundingClientRect();
            // Position à l'écran en DIP, indépendante de l'échelle de la pilule.
            this._toolbarAnchor = {
                x: x + rect.left * scale,
                y: y + rect.top * scale,
            };
            toolbar.classList.remove('is-settling');
        }
        clearTimeout(this._toolbarReleaseTimer);
        this._toolbarBusyUntil = performance.now() + 900;
        this._toolbarReleaseTimer = setTimeout(() => this.releaseLayoutToolbar(), 900);
    },

    releaseLayoutToolbar(force = false) {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar || !this._toolbarAnchor) return;
        clearTimeout(this._toolbarReleaseTimer);
        const remaining = (this._toolbarBusyUntil || 0) - performance.now();
        if (!force && remaining > 0) {
            this._toolbarReleaseTimer = setTimeout(() => this.releaseLayoutToolbar(), remaining);
            return;
        }
        // Souris encore sur la barre : on attend qu'elle en sorte.
        if (!force && toolbar.matches(':hover')) return;
        this._toolbarAnchor = null;
        toolbar.classList.toggle('is-settling', !force);
        this.anchorLayoutToolbar();
    },

    anchorLayoutToolbar() {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar) return;
        const anchor = this._toolbarAnchor;
        const { x: originX, y: originY, scale } = this.layoutViewport();
        const previous = this._toolbarShift || { x: 0, y: 0 };
        const rect = toolbar.getBoundingClientRect();
        // La barre conserve le zoom fixe de la fenêtre pendant le placement.
        const x = anchor ? anchor.x - (originX + rect.left * scale - previous.x) : 0;
        const y = anchor ? anchor.y - (originY + rect.top * scale - previous.y) : 0;
        this._toolbarShift = { x, y };
        toolbar.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
        window.dispatchEvent(new Event('nolys-hit-region-changed'));
    },

    /**
     * Glisser de l'Island en mode placement. Le curseur est suivi côté Rust : le glisser natif de
     * Windows ne laisse pas remonter la fenêtre au-dessus du bord de l'écran.
     */
    bindLayoutDrag() {
        for (const target of [document.getElementById('dynamic-island')]) {
            if (!target || target.dataset.layoutDrag) continue; // une seule fois, même après plusieurs activations
            target.dataset.layoutDrag = 'true';
            target.addEventListener('pointerdown', (e) => {
                if (!this._layoutEditMode || this._layoutFinishing || e.button !== 0) return;
                e.preventDefault();
                this._stopLayoutDrag?.();
                this.releaseLayoutToolbar(true);
                target.setPointerCapture(e.pointerId);
                ipcRenderer.send('layout-drag-begin');

                let frame = 0, stopped = false;
                const onMove = () => {
                    if (frame || !this._layoutEditMode || this._layoutFinishing) return;
                    frame = requestAnimationFrame(() => {
                        frame = 0;
                        if (this._layoutEditMode && !this._layoutFinishing) ipcRenderer.send('layout-drag-move');
                    });
                };
                const onUp = () => {
                    if (stopped) return;
                    stopped = true;
                    target.removeEventListener('pointermove', onMove);
                    target.removeEventListener('pointerup', onUp);
                    target.removeEventListener('pointercancel', onUp);
                    target.removeEventListener('lostpointercapture', onUp);
                    window.removeEventListener('blur', onUp);
                    if (frame) cancelAnimationFrame(frame);
                    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
                    this._stopLayoutDrag = null;
                    document.body.classList.remove('layout-edit-dragging');
                    ipcRenderer.send('layout-drag-end');
                };
                this._stopLayoutDrag = onUp;
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
                target.addEventListener('pointercancel', onUp);
                target.addEventListener('lostpointercapture', onUp);
                window.addEventListener('blur', onUp);
            });
        }
    },

    /** Barre de placement sous l'Island : taille, recentrage, fin du mode. Branchée une seule fois. */
    initLayoutEditToolbar() {
        this.bindLayoutDrag();
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar || toolbar.dataset.ready) return;
        toolbar.dataset.ready = 'true';

        toolbar.addEventListener('click', (e) => {
            const action = e.target.closest('[data-layout]')?.dataset.layout;
            if (!action || this._layoutFinishing) return;
            e.stopPropagation();
            if (action === 'smaller' || action === 'bigger') {
                this.freezeLayoutToolbar();
                this.stepLayoutScale(action === 'bigger' ? 1 : -1);
            }
            else if (action === 'center') { this.releaseLayoutToolbar(true); ipcRenderer.send('layout-reset'); }
            else if (action === 'preview') this.toggleLayoutPreview();
            else if (action === 'done') this.finishLayoutEdit();
        });
        toolbar.addEventListener('pointerleave', () => this.releaseLayoutToolbar());
        const resize = new ResizeObserver(() => this.anchorLayoutToolbar());
        resize.observe(toolbar);
        resize.observe(this.el);
        window.addEventListener('resize', () => { this.syncWindowViewport(); this.anchorLayoutToolbar(); });

        // Molette au-dessus de l'Island ou de la barre : taille.
        const onWheel = (e) => {
            if (!this._layoutEditMode || this._layoutFinishing) return;
            e.preventDefault();
            e.stopPropagation();
            if (toolbar.contains(e.target)) this.freezeLayoutToolbar();
            this.stepLayoutScale(e.deltaY < 0 ? 1 : -1);
        };
        document.getElementById('dynamic-island-container')?.addEventListener('wheel', onWheel, { passive: false, capture: true });

        document.addEventListener('keydown', (e) => {
            if (!this._layoutEditMode || this._layoutFinishing) return;
            if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                this.finishLayoutEdit();
            } else if (e.key === '+' || e.key === '=' || e.key === '-') {
                e.preventDefault();
                this.stepLayoutScale(e.key === '-' ? -1 : 1);
            } else if (e.key.startsWith('Arrow')) {
                // Déplacement au clavier : pas de limite de curseur, donc on peut aller jusqu'en haut de tous les écrans.
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const moves = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
                if (moves[e.key]) ipcRenderer.send('layout-nudge', ...moves[e.key]);
            }
        });
    },

    /** Refermer l'aperçu au même endroit avant de quitter le placement. */
    async finishLayoutEdit() {
        if (!this._layoutEditMode || this._layoutFinishing) return;
        this._layoutFinishing = true;
        this._stopLayoutDrag?.();
        const toolbar = document.getElementById('layout-edit-toolbar');
        toolbar.inert = true;
        try {
            if (this._layoutPreview) {
                this.toggleLayoutPreview(false);
                void this.el.offsetHeight;
                await Promise.all(this.el.getAnimations().filter(a => ['width', 'height'].includes(a.transitionProperty))
                    .map(a => a.finished.catch(() => {})));
            }
            if (this._layoutEditMode) await native.invoke('set_layout_edit_mode', { enabled: false });
        } catch (error) {
            console.warn('[Placement] Fin du placement impossible :', error);
        } finally {
            toolbar.inert = false;
            this._layoutFinishing = false;
        }
    },

    getMotionLevel() {
        const saved = localStorage.getItem('liquid_motion_level') || 'system';
        if (MOTION_LEVELS.includes(saved) && saved !== 'system') return saved;
        return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'sober' : 'fluid';
    },

    syncMotionPreference() {
        if (!this._motionMediaQuery && globalThis.matchMedia) {
            this._motionMediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
            this._motionMediaQuery.addEventListener('change', () => this.syncMotionPreference());
        }
        const level = this.getMotionLevel();
        document.body.classList.remove('motion-sober', 'motion-fluid', 'motion-vivid');
        document.body.classList.add(`motion-${level}`);
        return level;
    },

    syncEcoMode() {
        this.isEcoMode = localStorage.getItem('liquid_eco_mode') === 'true';
        document.body.classList.toggle('eco-mode', this.isEcoMode);
        visualizerService.setEcoMode(this.isEcoMode);
        this.syncVisualizerActivity();
        return this.isEcoMode;
    },

    setLayoutEditMode(enabled) {
        this.initLayoutEditToolbar();
        // Le cœur natif renvoie l'état du mode à chaque changement de taille ou de position :
        // seul un vrai changement compte (sinon − / + repliait l'aperçu de l'Island ouverte).
        const beforePlacement = this.capsuleSnapshot();
        if (beforePlacement.placement === Boolean(enabled)) return;
        if (!enabled) this._stopLayoutDrag?.();
        this._layoutEditMode = Boolean(enabled);
        document.body.classList.toggle('layout-edit-mode', this._layoutEditMode);
        this.paintLayoutScale(Number(this._layoutConfig.scale) || 1);

        if (this._layoutEditMode) {
            // Placement lancé depuis les Réglages : ils se referment (la pilule doit être repliée)
            // et reviennent sur la page Position une fois le placement terminé.
            this._settingsAfterLayout = this.mode === 'settings' && this.isExpanded;
            this.clearNotification();
            this.closeContextMenu();
            // Toujours la pilule repliée pour le placement. Une ouverture en cours est annulée
            // (elle finissait sinon après coup), et renderContent retire les classes de taille
            // de la vue ouverte : avec renderIdle seul, la pilule gardait la hauteur du lecteur
            // ou du centre de contrôle (grand carré avec le titre au milieu).
            const entered = decide(beforePlacement, { type: 'enter-placement' });
            this.cancelTransition();
            this.commitCapsule(entered.next);
            this.setLayoutPreviewButton(false);
            this.renderContent();
            if (ipcRenderer) {
                try {
                    ipcRenderer.send('set-ignore-mouse', false);
                } catch (e) {}
            }
            document.body.classList.remove('layout-edit-armed');
            void document.body.offsetWidth;
            document.body.classList.add('layout-edit-armed');
            clearTimeout(this._layoutEditArmTimeout);
            this._layoutEditArmTimeout = setTimeout(() => {
                document.body.classList.remove('layout-edit-armed');
            }, 1600);
        } else {
            this.releaseLayoutToolbar(true);
            document.body.classList.remove('layout-edit-dragging');
            document.body.classList.remove('layout-edit-armed');
            clearTimeout(this._layoutEditArmTimeout);
            // Fin du placement : l'aperçu ouvert se referme.
            const left = decide(beforePlacement, { type: 'leave-placement' });
            if (beforePlacement.preview) {
                this.setLayoutPreviewButton(false);
                this.commitCapsule(left.next);
                this.renderContent();
            }
            if (this._settingsAfterLayout) {
                this._settingsAfterLayout = false;
                this.openSettings('position');
            }
        }
        this.syncGlowHalo?.();
    },

    /**
     * Aperçu pendant le placement : l'Island et sa barre changent de forme ensemble,
     * pour vérifier qu'à cet endroit elle ne cache rien d'important. Rien n'y est cliquable
     * (le placement coupe les clics du contenu) et elle se replie en quittant le mode.
     */
    toggleLayoutPreview(force) {
        const decision = decide(this.capsuleSnapshot(), {
            type: 'toggle-preview',
            on: typeof force === 'boolean' ? force : undefined,
        });
        if (decision.effect !== 'apply') return;
        this.paintLayoutScale(this._pendingLayoutScale ?? this._layoutConfig.scale);
        this.releaseLayoutToolbar(true);
        this.setLayoutPreviewButton(decision.next.preview);
        this.commitCapsule(decision.next);
        this.renderContent();
        this.anchorLayoutToolbar();
    },

    setLayoutPreviewButton(on) {
        this._layoutPreview = on;
        const button = document.querySelector('#layout-edit-toolbar [data-layout="preview"]');
        if (!button) return;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', String(on));
        button.innerHTML = on ? '<i class="ph ph-arrows-in-simple"></i>Replier' : '<i class="ph ph-arrows-out-simple"></i>Aperçu';
    },

    syncPersistentSetting() {
        if (ipcRenderer) {
            // Activé par défaut (même règle que les Réglages, state/storage.js).
            const enabled = localStorage.getItem('liquid_island_persistent') !== 'false';
            ipcRenderer.send('set-persistent-island', enabled);
        }
    },
};
