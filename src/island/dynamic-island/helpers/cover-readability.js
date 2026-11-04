const linear = channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const luminance = channel => linear(channel / 255);

/** Préserve la teinte d'une pochette sombre tout en gardant ses commandes visibles. */
export function coverAccent(color) {
    const lightness = value => .2126 * luminance(value.r) + .7152 * luminance(value.g) + .0722 * luminance(value.b);
    if (lightness(color) >= .23) return color;
    let low = 0, high = 1;
    const mix = amount => Object.fromEntries(['r', 'g', 'b'].map(key => [key, Math.round(color[key] + (255 - color[key]) * amount)]));
    for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        if (lightness(mix(middle)) >= .23) high = middle;
        else low = middle;
    }
    return mix(high);
}

/** Point clair de la pochette, calculé une seule fois sur l'échantillon déjà extrait. */
export function coverLightness(pixels) {
    let brightest = 0;
    for (let i = 0; i + 3 < pixels.length; i += 4) {
        if (pixels[i + 3] < 200) continue;
        const value = .2126 * luminance(pixels[i]) + .7152 * luminance(pixels[i + 1]) + .0722 * luminance(pixels[i + 2]);
        brightest = Math.max(brightest, value);
    }
    return brightest <= .0031308 ? 12.92 * brightest : 1.055 * brightest ** (1 / 2.4) - .055;
}

/** Protection des libellés secondaires (blanc à 55 %), sans modifier l'opacité choisie. */
export function coverShade(lightness, opacity) {
    const amount = Number.isFinite(opacity) ? Math.max(0, Math.min(.9, opacity)) : 0;
    if (!amount) return 0;
    const source = Number.isFinite(lightness) ? Math.max(0, Math.min(1, lightness)) : 1;
    const background = 18 * (1 - amount) + 255 * source * amount;
    const contrast = shade => {
        const surface = background * (1 - shade);
        const foreground = surface + (255 - surface) * .55;
        return (luminance(foreground) + .05) / (luminance(surface) + .05);
    };
    if (contrast(0) >= 4.5) return 0;
    let low = 0, high = .85;
    for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        if (contrast(middle) >= 4.5) high = middle;
        else low = middle;
    }
    return Math.min(.85, high + .08);
}
