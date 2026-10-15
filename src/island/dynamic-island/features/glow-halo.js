/**
 * Halo de la pilule (couche #island-halo, voir effects.css) : elle suit la pilule en
 * position, taille, forme et transformation, et reprend ses couleurs et sa lueur.
 *
 * Sa pulsation (« Halo qui respire ») est cadencée ici à 24 images par seconde, comme le
 * visualiseur. Une animation CSS suivait le rafraîchissement de l'écran (jusqu'à 360 fois
 * par seconde) et faisait recomposer toute la fenêtre à chaque fois : c'était l'essentiel
 * du processeur consommé pendant la lecture. Le halo variant lentement, 24 i/s suffisent
 * à garder le même mouvement à l'œil.
 */
const HALO_VARS = ['--island-glow-size', '--island-glow-rgb', '--island-glow-opacity'];
const BREATH_FPS = 24;

/** Courbe CSS ease-in-out, cubic-bezier(0.42, 0, 0.58, 1) : y pour x entre 0 et 1. */
function easeInOut(x) {
    // x(t) = 1,26 t (1 - t)² + 1,74 t² (1 - t) + t³ : on cherche t par la méthode de Newton.
    let t = x;
    for (let i = 0; i < 6; i++) {
        const fx = ((0.52 * t - 0.78) * t + 1.26) * t - x;
        const slope = (1.56 * t - 1.56) * t + 1.26;
        if (Math.abs(fx) < 1e-5 || slope < 1e-6) break;
        t -= fx / slope;
    }
    return t * t * (3 - 2 * t);
}

export const glowHaloMethods = {
    initGlowHalo() {
        this._halo = document.getElementById('island-halo');
        if (!this._halo) return;
        this._glowSatellites = [...document.querySelectorAll('.island-satellite')];

        const sync = () => this.syncGlowHalo();
        new ResizeObserver(sync).observe(this.el);
        new MutationObserver(sync).observe(this.el, { attributes: true, attributeFilter: ['style', 'class'] });
        // Mode sobre, animations vives ou « Halo qui respire » changés dans les réglages.
        new MutationObserver(() => this.updateGlowBreath()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        // Une bulle qui apparaît ou disparaît (micro, minuteur).
        const satelliteObserver = new MutationObserver(() => this.updateGlowBreath());
        for (const satellite of this._glowSatellites) {
            satelliteObserver.observe(satellite, { attributes: true, attributeFilter: ['class'] });
        }

        // Pendant une transition (ressort, survol, appui), la pilule change d'une image à l'autre :
        // on suit alors image par image, puis on s'arrête dès que plus rien ne bouge.
        const follow = () => {
            if (this._haloRaf) return;
            const step = () => {
                this.syncGlowHalo();
                const moving = this.el.getAnimations().some((animation) => animation.transitionProperty);
                this._haloRaf = moving ? requestAnimationFrame(step) : null;
            };
            this._haloRaf = requestAnimationFrame(step);
        };
        this.el.addEventListener('transitionrun', follow);
        this.el.addEventListener('transitionend', sync);
        this.syncGlowHalo();
    },

    syncGlowHalo() {
        const halo = this._halo;
        if (!halo) return;
        const el = this.el;
        const style = getComputedStyle(el);
        const box = this._glowHaloBox(style);
        halo.style.left = `${box.left}px`;
        halo.style.top = `${box.top}px`;
        halo.style.width = `${box.width}px`;
        halo.style.height = `${box.height}px`;
        halo.style.borderRadius = style.borderRadius;
        halo.style.transform = style.transform === 'none' ? '' : style.transform;
        halo.style.transformOrigin = style.transformOrigin;
        for (const name of HALO_VARS) {
            halo.style.setProperty(name, style.getPropertyValue(name).trim());
        }
        this.updateGlowBreath();
    },

    /**
     * Boîte de la pilule avant sa transformation, au sous-pixel près : offsetLeft et offsetWidth
     * arrondissent au pixel, et le liseré du halo se décalait alors d'une fraction de pixel
     * sur le bord de la pilule. On repart de sa position à l'écran et on retire l'agrandissement.
     */
    _glowHaloBox(style) {
        const el = this.el;
        const parent = this._halo.offsetParent;
        const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
        if (!parent || !matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) {
            return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        }
        const rect = el.getBoundingClientRect();
        const origin = parent.getBoundingClientRect();
        const [originX, originY] = style.transformOrigin.split(' ').map(parseFloat);
        return {
            left: rect.left - origin.left - parent.clientLeft - originX * (1 - matrix.a) - matrix.e,
            top: rect.top - origin.top - parent.clientTop - originY * (1 - matrix.d) - matrix.f,
            width: rect.width / matrix.a,
            height: rect.height / matrix.d,
        };
    },

    /**
     * Fenêtre masquée ou réaffichée (événement du cœur natif). Masquée, rien n'est visible :
     * les animations CSS sont mises en pause (motion.css) et la respiration s'arrête. Elles
     * reprennent là où elles en étaient.
     */
    setWindowHidden(hidden) {
        this._windowHidden = hidden;
        document.body.classList.toggle('island-window-hidden', hidden);
        this.updateGlowBreath();
    },

    /** Durée d'une respiration, ou 0 si le halo ne doit pas respirer. */
    _glowBreathPeriod() {
        const body = document.body.classList;
        const classes = this.el.classList;
        if (body.contains('motion-sober') || body.contains('no-glow-breath')) return 0;
        if (!classes.contains('playing-music-glow') && !classes.contains('island-active-music')) return 0;
        if (body.contains('motion-vivid')) return 2400;
        return classes.contains('playing-music-glow') ? 4000 : 3000;
    },

    /** Lance ou arrête la pulsation selon l'état de la pilule et des réglages. */
    updateGlowBreath() {
        const period = this._glowBreathPeriod();
        this._glowBreathMs = period;
        // La matière Métal gardait son ombre fixe (la pulsation ne passait pas son !important) :
        // la pilule garde alors son halo, seules les bulles respirent.
        const pillBreathes = Boolean(period) && !this.el.classList.contains('material-metal');
        this.el.classList.toggle('glow-breathing', pillBreathes);
        this._halo.classList.toggle('is-breathing', pillBreathes);
        const running = Boolean(this._glowBreathTimer || this._glowBreathRaf);
        if (!period) {
            this._glowBreathPausedAt = 0;
            this._stopGlowBreath();
            return;
        }
        if (this._windowHidden) {
            // Pause : on retient l'instant pour reprendre au même point de la respiration.
            if (running) this._glowBreathPausedAt = performance.now();
            this._stopGlowBreath();
            return;
        }
        if (running) return;
        if (this._glowBreathPausedAt) {
            this._glowBreathStart += performance.now() - this._glowBreathPausedAt;
            this._glowBreathPausedAt = 0;
        } else {
            // Comme l'ancienne animation : chaque respiration repart de l'état au repos.
            this._glowBreathStart = performance.now();
        }
        const tick = () => {
            this._glowBreathRaf = null;
            // Le visualiseur a déjà fait avancer le halo dans son image : pas d'image en plus.
            if (performance.now() - (this._glowBreathSharedAt || 0) > 1000 / BREATH_FPS) {
                this._applyGlowBreath();
            }
            this._glowBreathTimer = setTimeout(() => {
                this._glowBreathTimer = null;
                this._glowBreathRaf = requestAnimationFrame(tick);
            }, 1000 / BREATH_FPS);
        };
        this._glowBreathRaf = requestAnimationFrame(tick);
    },

    /** Appelé à chaque image du visualiseur : le halo avance dans la même image. */
    shareGlowBreathFrame() {
        if (!this._glowBreathMs) return;
        this._glowBreathSharedAt = performance.now();
        this._applyGlowBreath();
    },

    _applyGlowBreath() {
        const period = this._glowBreathMs;
        if (!period) return;
        // 0 au repos, 1 au pic : même courbe que l'ancienne animation (ease-in-out à l'aller et au retour).
        const phase = ((performance.now() - this._glowBreathStart) % period) / period;
        const value = easeInOut(phase < 0.5 ? phase * 2 : 2 - phase * 2).toFixed(4);
        this._halo.style.setProperty('--glow-breath', value);
        // Les bulles ne respirent que visibles : cachées sous la pilule, elles restent figées.
        for (const satellite of this._glowSatellites) {
            if (satellite.classList.contains('is-visible') && satellite.classList.contains('is-glowing')) {
                satellite.style.setProperty('--glow-breath', value);
            }
        }
    },

    _stopGlowBreath() {
        clearTimeout(this._glowBreathTimer);
        cancelAnimationFrame(this._glowBreathRaf);
        this._glowBreathTimer = null;
        this._glowBreathRaf = null;
    },
};
