/** Préférences d’affichage : position, animations, mode éco, persistance. */
import { ipcRenderer } from '../../../shared/ipc.js';
import { visualizerService } from '../../../services/AudioVisualizerService.js';
import { MOTION_LEVELS } from '../helpers/constants.js';

export const preferenceMethods = {
    /** Configuration appliquée par le cœur natif (taille = zoom réel de la fenêtre). */
    applyLayoutConfig(layout) {
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
        // Zoom réel de la fenêtre : la barre de placement s'en sert pour garder sa taille à l'écran.
        container.style.setProperty('--island-layout-scale', safeScale.toString());
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
        ipcRenderer.send('layout-config-changed', { scale: next });
    },

    /**
     * Barre de placement immobile pendant qu'on clique sur − / + : la pilule grandit et
     * poussait la barre vers le bas, le bouton fuyait sous la souris. On la fige à l'écran
     * au premier clic, puis elle rejoint sa place sous la pilule une fois les clics finis.
     */
    freezeLayoutToolbar() {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar) return;
        const scale = Number(this._layoutConfig.scale) || 1;
        if (!this._toolbarAnchor) {
            // Haut de la barre sans son décalage, en pixels CSS (indépendant du zoom de la fenêtre).
            const top = toolbar.getBoundingClientRect().top - (this._toolbarShift || 0) / scale;
            const screenTop = top * scale + (this._toolbarShift || 0);
            this._toolbarAnchor = { top, screenTop };
            toolbar.classList.remove('is-settling');
        }
        clearTimeout(this._toolbarReleaseTimer);
        this._toolbarReleaseTimer = setTimeout(() => this.releaseLayoutToolbar(), 900);
    },

    releaseLayoutToolbar() {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar || !this._toolbarAnchor) return;
        // Souris encore sur la barre : on attend qu'elle en sorte.
        if (toolbar.matches(':hover')) {
            toolbar.addEventListener('pointerleave', () => this.releaseLayoutToolbar(), { once: true });
            return;
        }
        this._toolbarAnchor = null;
        toolbar.classList.add('is-settling');
        this.anchorLayoutToolbar();
    },

    anchorLayoutToolbar() {
        const toolbar = document.getElementById('layout-edit-toolbar');
        if (!toolbar) return;
        const anchor = this._toolbarAnchor;
        const scale = Number(this._layoutConfig.scale) || 1;
        // Pixels d'écran : la barre a un zoom inverse de celui de la fenêtre (styles/base.css).
        this._toolbarShift = anchor ? Math.round(anchor.screenTop - anchor.top * scale) : 0;
        toolbar.style.transform = this._toolbarShift ? `translateY(${this._toolbarShift}px)` : '';
    },

    /**
     * Glisser de l'Island en mode placement. Le curseur est suivi côté Rust : le glisser natif de
     * Windows ne laisse pas remonter la fenêtre au-dessus du bord de l'écran.
     */
    bindLayoutDrag() {
        for (const target of [document.getElementById('layout-drag-surface'), document.getElementById('dynamic-island')]) {
            if (!target || target.dataset.layoutDrag) continue; // une seule fois, même après plusieurs activations
            target.dataset.layoutDrag = 'true';
            target.addEventListener('pointerdown', (e) => {
                if (!this._layoutEditMode || e.button !== 0) return;
                e.preventDefault();
                target.setPointerCapture(e.pointerId);
                ipcRenderer.send('layout-drag-begin');

                let frame = 0;
                const onMove = () => {
                    if (frame) return;
                    frame = requestAnimationFrame(() => {
                        frame = 0;
                        ipcRenderer.send('layout-drag-move');
                    });
                };
                const onUp = () => {
                    target.removeEventListener('pointermove', onMove);
                    target.removeEventListener('pointerup', onUp);
                    target.removeEventListener('pointercancel', onUp);
                    if (frame) cancelAnimationFrame(frame);
                    ipcRenderer.send('layout-drag-end');
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
                target.addEventListener('pointercancel', onUp);
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
            if (!action) return;
            e.stopPropagation();
            if (action === 'smaller' || action === 'bigger') {
                this.freezeLayoutToolbar();
                this.stepLayoutScale(action === 'bigger' ? 1 : -1);
            }
            else if (action === 'center') ipcRenderer.send('layout-reset');
            else if (action === 'preview') this.toggleLayoutPreview();
            else if (action === 'done') ipcRenderer.send('set-layout-edit-mode', false);
        });

        // Molette au-dessus de l'Island ou de la barre : taille.
        const onWheel = (e) => {
            if (!this._layoutEditMode) return;
            e.preventDefault();
            e.stopPropagation();
            this.stepLayoutScale(e.deltaY < 0 ? 1 : -1);
        };
        document.getElementById('dynamic-island-container')?.addEventListener('wheel', onWheel, { passive: false, capture: true });

        document.addEventListener('keydown', (e) => {
            if (!this._layoutEditMode) return;
            if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                ipcRenderer.send('set-layout-edit-mode', false);
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

    getMotionLevel() {
        const saved = localStorage.getItem('liquid_motion_level') || 'fluid';
        return MOTION_LEVELS.includes(saved) ? saved : 'fluid';
    },

    syncMotionPreference() {
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
        if (this._layoutEditMode === Boolean(enabled)) return;
        this._layoutEditMode = Boolean(enabled);
        document.body.classList.toggle('layout-edit-mode', this._layoutEditMode);

        if (this._layoutEditMode) {
            this.closeContextMenu();
            // Toujours la pilule repliée pour le placement. Une ouverture en cours est annulée
            // (elle finissait sinon après coup), et renderContent retire les classes de taille
            // de la vue ouverte : avec renderIdle seul, la pilule gardait la hauteur du lecteur
            // ou du centre de contrôle (grand carré avec le titre au milieu).
            this._transitionToken = (this._transitionToken || 0) + 1;
            this._queuedTransition = null;
            this._transitionInProgress = false;
            this._isTransitioning = false;
            this.el.classList.remove('animating');
            this.mode = 'music';
            this.isExpanded = false;
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
            document.body.classList.remove('layout-edit-dragging');
            document.body.classList.remove('layout-edit-armed');
            clearTimeout(this._layoutEditArmTimeout);
            // Fin du placement : l'aperçu ouvert se referme.
            if (this._layoutPreview) {
                this.setLayoutPreviewButton(false);
                this.isExpanded = false;
                this.renderContent();
            }
        }
    },

    /**
     * Aperçu pendant le placement : l'Island s'affiche ouverte (lecteur), sans animation,
     * pour vérifier qu'à cet endroit elle ne cache rien d'important. Rien n'y est cliquable
     * (le placement coupe les clics du contenu) et elle se replie en quittant le mode.
     */
    toggleLayoutPreview(force) {
        if (!this._layoutEditMode) return;
        const on = typeof force === 'boolean' ? force : !this._layoutPreview;
        this.setLayoutPreviewButton(on);
        this.mode = 'music';
        this.isExpanded = on;
        this.renderContent();
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
