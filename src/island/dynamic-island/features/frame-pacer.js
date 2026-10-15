/**
 * Plafond d'images par seconde (réglage « Images par seconde », 60 par défaut).
 *
 * Une animation CSS sans fin (titre qui défile, matière holographique, chargements…) se
 * redessine au rythme de l'écran : 360 fois par seconde sur un écran 360 Hz, et WebView2
 * recompose toute la fenêtre à chaque fois. WebView2 n'a pas de réglage pour plafonner sa
 * cadence ; on reprend donc la main sur ces animations : elles sont mises en pause, et on les
 * fait avancer nous-mêmes au rythme choisi, à partir de l'heure réelle (même vitesse, même
 * position qu'avant, seulement moins d'images). Les transitions et les animations courtes
 * (ouverture, agrandissement) gardent la cadence de l'écran.
 *
 * Seules les animations redessinées à chaque image (ombre, couleur, fond…) sont concernées.
 * Celles qui ne font que déplacer, agrandir ou fondre (titre qui défile…) sont jouées par la
 * carte graphique sans redessin : mesuré, les plafonner coûte deux fois plus que les laisser
 * à 360 Hz (0,8 % contre 0,4 %), car chaque image passe alors par la page.
 */
const DEFAULT_FPS = 60;
const SCAN_INTERVAL = 1000;
const GPU_PROPERTIES = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity']);
const KEYFRAME_FIELDS = new Set(['offset', 'computedOffset', 'easing', 'composite']);

/** L'animation ne touche que des propriétés jouées par la carte graphique. */
function isGpuOnly(animation) {
    const keyframes = animation.effect?.getKeyframes() || [];
    return keyframes.every((frame) => Object.keys(frame).every((key) => KEYFRAME_FIELDS.has(key) || GPU_PROPERTIES.has(key)));
}

export const framePacerMethods = {
    initFramePacer() {
        this._pacedAnimations = new Map();
        this._gpuAnimations = new WeakSet();
        // Une animation qui démarre (classe ajoutée, vue ouverte) : on la reprend aussitôt.
        document.addEventListener('animationstart', () => this._scanPacedAnimations(), true);
        const stored = localStorage.getItem('liquid_max_fps');
        this.setMaxFps(stored === null ? DEFAULT_FPS : Number(stored));
    },

    /** 0 : cadence de l'écran, sans plafond. */
    setMaxFps(fps) {
        const value = Number.isFinite(fps) && fps >= 0 ? fps : DEFAULT_FPS;
        if (value === this._maxFps) return;
        this._maxFps = value;
        if (!value) {
            this._releasePacedAnimations();
            return;
        }
        this._scanPacedAnimations();
    },

    _scanPacedAnimations() {
        if (!this._maxFps) return;
        const now = performance.now();
        for (const animation of document.getAnimations()) {
            if (!(animation instanceof CSSAnimation) || this._pacedAnimations.has(animation)) continue;
            if (this._gpuAnimations.has(animation) || animation.effect?.getTiming().iterations !== Infinity) continue;
            if (isGpuOnly(animation)) {
                this._gpuAnimations.add(animation);
                continue;
            }
            if (animation.playState !== 'running' && animation.playState !== 'paused') continue;
            // L'animation garde sa position : on part de son temps actuel.
            this._pacedAnimations.set(animation, { origin: now - (animation.currentTime || 0) });
            animation.pause();
        }
        if (this._pacedAnimations.size) this._startFramePacer();
    },

    _startFramePacer() {
        if (this._pacerTimer || this._pacerRaf) return;
        this._pacerLastTick = performance.now();
        this._pacerLastScan = this._pacerLastTick;
        const tick = () => {
            this._pacerRaf = null;
            this._tickPacedAnimations();
            if (!this._maxFps || !this._pacedAnimations.size) return;
            this._pacerTimer = setTimeout(() => {
                this._pacerTimer = null;
                this._pacerRaf = requestAnimationFrame(tick);
            }, Math.max(0, 1000 / this._maxFps - 4));
        };
        this._pacerRaf = requestAnimationFrame(tick);
    },

    _tickPacedAnimations() {
        const now = performance.now();
        const elapsed = now - this._pacerLastTick;
        this._pacerLastTick = now;
        if (now - this._pacerLastScan > SCAN_INTERVAL) {
            this._pacerLastScan = now;
            this._scanPacedAnimations();
        }
        for (const [animation, paced] of this._pacedAnimations) {
            const target = animation.effect?.target;
            // Animation retirée par le CSS (classe enlevée, élément supprimé) : on l'oublie.
            if (animation.playState === 'idle' || !target?.isConnected) {
                this._pacedAnimations.delete(animation);
                continue;
            }
            // Mise en pause par le CSS (titre en pause, fenêtre masquée) : elle reste où elle est.
            if (this._windowHidden || this._isPausedByCss(animation, target)) {
                paced.origin += elapsed;
                continue;
            }
            animation.currentTime = now - paced.origin;
        }
    },

    /** animation-play-state du CSS : une animation reprise par le script ne le suit plus d'elle-même. */
    _isPausedByCss(animation, target) {
        const style = getComputedStyle(target, animation.effect.pseudoElement || null);
        const names = style.animationName.split(',').map((name) => name.trim());
        const states = style.animationPlayState.split(',').map((state) => state.trim());
        const index = Math.max(0, names.indexOf(animation.animationName));
        return states[index % states.length] === 'paused';
    },

    /** Retour à la cadence de l'écran : les animations reprennent d'elles-mêmes. */
    _releasePacedAnimations() {
        clearTimeout(this._pacerTimer);
        cancelAnimationFrame(this._pacerRaf);
        this._pacerTimer = null;
        this._pacerRaf = null;
        const now = performance.now();
        for (const [animation, paced] of this._pacedAnimations) {
            const target = animation.effect?.target;
            if (animation.playState === 'idle' || !target?.isConnected) continue;
            animation.currentTime = now - paced.origin;
            if (!this._isPausedByCss(animation, target)) animation.play();
        }
        this._pacedAnimations.clear();
    },
};
