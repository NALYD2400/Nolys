/**
 * Effet verre (Liquid Glass) sur les commandes du lecteur et du centre de contrôle.
 *
 * Le verre réfracte la couche `.island-glass-backdrop` (la pochette floutée en
 * fond de l'Island), pas le bureau Windows. Il n'est donc activé que dans les
 * vues dépliées listées ci-dessous. Le SDK n'est chargé qu'au premier usage, et
 * la scène est libérée dès qu'on quitte ces vues.
 */
import { rgbToHex } from '../helpers/color.js';

// Couleurs Apple des tuiles allumées (mêmes teintes que le style CSS sans verre).
const TILE_TINTS = {
    'ic-wifi': '#007aff',
    'ic-bluetooth': '#007aff',
    'ic-dnd': '#af52de',
    'ic-focus': '#5856d6',
    'ic-eco': '#34c759',
    'ic-mic': '#e08a5a',
};

/**
 * Surfaces en verre par vue. `options` peut être une fonction (élément, teinte
 * de la pochette) pour les surfaces dont l'aspect dépend de leur état.
 * `hoverOnly` : le verre n'apparaît qu'au survol (icône seule au repos).
 */
const SURFACES_BY_MODE = {
    music: [
        { selector: '.music-controls .control-btn-music:not(.play-btn)', options: { material: 'clear', radius: 'circle', interactive: true }, hoverOnly: true },
        { selector: '.music-controls .play-btn', options: (_, coverTint) => ({ material: 'regular', radius: 'circle', interactive: true, tint: coverTint }) },
        { selector: '.music-action-cluster', options: { material: 'clear', radius: 'capsule' } },
    ],
    control: [
        { selector: '.ic-header-actions', options: { material: 'clear', radius: 'capsule' } },
        {
            selector: '.ic-toggles-grid .ic-tile',
            options: (element) => {
                const active = element.classList.contains('active');
                return { material: active ? 'regular' : 'clear', radius: 12, interactive: true, tint: active ? TILE_TINTS[element.id] : undefined };
            },
        },
        { selector: '.ic-now-playing-card, .ic-launchpad-card, .ic-stats-card, .ic-weather-card, .ic-mixer-card, .ic-machine-card', options: { material: 'clear', radius: 18 } },
        { selector: '.ic-np-btn.play', options: (_, coverTint) => ({ material: 'regular', radius: 'circle', interactive: true, tint: coverTint }) },
        { selector: '.ic-vertical-slider', options: { material: 'clear', radius: 20 } },
    ],
    // Mini-lecteur et boutons ronds de la Bibliothèque (dans son shadow DOM, voir surfaceRoot).
    library: [
        { selector: '.lib-player', options: { material: 'clear', radius: 24 } },
        { selector: '.lib-header .round-btn', options: { material: 'clear', radius: 'circle', interactive: true } },
        { selector: '.player-controls .ctl-btn:not(.is-play)', options: { material: 'clear', radius: 'circle', interactive: true }, hoverOnly: true },
        { selector: '.player-controls .ctl-btn.is-play', options: (_, coverTint) => ({ material: 'regular', radius: 'circle', interactive: true, tint: legibleTint(coverTint) }) },
    ],
    'music-history': [
        { selector: '.lib-header .round-btn', options: { material: 'clear', radius: 'circle', interactive: true } },
    ],
    files: [
        { selector: '.lib-header .round-btn', options: { material: 'clear', radius: 'circle', interactive: true } },
    ],
    replay: [
        { selector: '.lib-header .round-btn', options: { material: 'clear', radius: 'circle', interactive: true } },
    ],
};

/** Une pochette très sombre teinterait le verre en noir sur fond noir : on l'éclaircit. */
function legibleTint(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!match) return hex;
    const rgb = [1, 2, 3].map(i => parseInt(match[i], 16));
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (luminance >= 0.35) return hex;
    const mix = Math.min(1, (0.35 - luminance) / (1 - luminance) + 0.08);
    return rgbToHex(...rgb.map(v => Math.round(v + (255 - v) * mix)));
}

let glassModule = null;
const loadGlass = () => (glassModule ??= import('../../glass-scene.js'));

export const glassMethods = {
    isGlassControlsEnabled() {
        return this._islandConfig?.glassControls !== false
            && localStorage.getItem('liquid_eco_mode') !== 'true';
    },

    /** La vue courante a-t-elle des surfaces en verre ? */
    hasGlassSurfaces() {
        return this.isExpanded && Object.hasOwn(SURFACES_BY_MODE, this.mode);
    },

    /** Retire le verre des boutons, et libère la scène si elle ne sert plus. */
    releaseGlassControls({ keepScene = false } = {}) {
        this._glassToken = (this._glassToken || 0) + 1;
        (this._glassCleanups || []).forEach((cleanup) => cleanup());
        this._glassCleanups = [];
        this.el.classList.remove('glass-controls');
        if (!keepScene && this._glassScene) {
            this._glassScene.dispose();
            this._glassScene = null;
        }
    },

    /** À appeler après chaque rendu d'une vue en verre : ses éléments ont été recréés. */
    async syncGlassControls() {
        const wanted = this.isGlassControlsEnabled() && this.hasGlassSurfaces();
        this.releaseGlassControls({ keepScene: wanted });
        if (!wanted) return;

        const token = this._glassToken;
        const mode = this.mode;
        let createGlassScene;
        try {
            ({ createGlassScene } = await loadGlass());
        } catch (e) {
            console.warn('[Glass] SDK indisponible, boutons classiques conservés.', e);
            return;
        }
        if (token !== this._glassToken) return; // un autre rendu est passé entre-temps

        try {
            if (!this._glassScene) {
                this._glassScene = createGlassScene(this.el, { maxSurfaces: 24 });
                this._glassScene.setContent(this.el.querySelector('.island-glass-backdrop'));
            }
            const coverTint = this._coverColors && localStorage.getItem('liquid_cover_color_sync') !== 'false'
                ? rgbToHex(this._coverColors.primary.r, this._coverColors.primary.g, this._coverColors.primary.b)
                : undefined;

            const scene = this._glassScene;
            const attach = (element, surfaceOptions) => {
                element.classList.add('lg-surface');
                const remove = scene.addSurface(element, surfaceOptions);
                return () => {
                    remove();
                    element.classList.remove('lg-surface');
                };
            };

            // Bibliothèque et Historique vivent dans un shadow DOM : leurs boutons y sont cherchés.
            const surfaceRoot = { library: this._libraryHost, 'music-history': this._historyHost, files: this._filesHost, replay: this._replayHost }[mode]?.shadowRoot ?? this.content;
            if (!surfaceRoot) return;
            for (const { selector, options, hoverOnly } of SURFACES_BY_MODE[mode]) {
                for (const element of surfaceRoot.querySelectorAll(selector)) {
                    const resolved = typeof options === 'function' ? options(element, coverTint) : options;
                    const surfaceOptions = { ...resolved, appearance: 'dark' };
                    if (!hoverOnly) {
                        this._glassCleanups.push(attach(element, surfaceOptions));
                        continue;
                    }
                    let detach = null;
                    const show = () => { detach ??= attach(element, surfaceOptions); };
                    const hide = () => { detach?.(); detach = null; };
                    element.addEventListener('pointerenter', show);
                    element.addEventListener('pointerleave', hide);
                    if (element.matches(':hover')) show();
                    this._glassCleanups.push(() => {
                        element.removeEventListener('pointerenter', show);
                        element.removeEventListener('pointerleave', hide);
                        hide();
                    });
                }
            }
            this.el.classList.add('glass-controls');
        } catch (e) {
            console.warn('[Glass] Échec de l’activation du verre.', e);
            this.releaseGlassControls();
        }
    },
};
