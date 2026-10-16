/**
 * Apparence du thème choisi dans Réglages → Island, partagée par le menu clic
 * droit de l'Island et les Réglages.
 *
 * Le thème actif n'est pas stocké : on le déduit des réglages qu'il pose
 * (matière de la pilule, couleur du halo, sinon couleur du visualiseur).
 */

const DEFAULT_ACCENT = '#D49460';

const parseHex = (hex) => {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return match ? [1, 2, 3].map((i) => parseInt(match[i], 16)) : null;
};

const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Mélange deux couleurs ; `weight` = part de la seconde, en %. */
const blend = (a, b, weight) => {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return a;
    const w = Math.max(0, Math.min(100, weight)) / 100;
    return toHex(ca.map((v, i) => v * (1 - w) + cb[i] * w));
};

/**
 * @param config réglages de la pilule (clé `liquid_island_config`)
 * @param coverHex couleur dominante de la pochette, ou rien (pas de morceau, synchro coupée)
 * @returns {{ material: 'glass'|'metal'|'holo', accent: string, accentRgb: string }}
 */
export function themeLook(config = {}, coverHex = '') {
    const cover = parseHex(coverHex) ? coverHex : '';
    let accent;

    if (config.glowEnabled !== false) {
        // Même calcul que la couleur du halo de la pilule (ThemeService).
        const fixed = config.glowColor || DEFAULT_ACCENT;
        const mode = config.glowColorMode || 'mix';
        if (cover && mode === 'cover') accent = cover;
        else if (cover && mode === 'mix') accent = blend(fixed, cover, config.glowBlend ?? 65);
        else accent = fixed;
    } else {
        // Sans halo (Minimal), on suit la couleur du visualiseur.
        const mode = config.vizColorMode || 'cover';
        if (mode === 'solid') accent = config.vizColorSolid || DEFAULT_ACCENT;
        else if (mode === 'gradient') accent = config.vizColorGradA || DEFAULT_ACCENT;
        else accent = cover || DEFAULT_ACCENT;
    }

    const material = ['glass', 'metal', 'holo'].includes(config.materialStyle) ? config.materialStyle : 'glass';
    const rgb = parseHex(accent) || parseHex(DEFAULT_ACCENT);
    return { material, accent: toHex(rgb), accentRgb: rgb.join(', ') };
}
