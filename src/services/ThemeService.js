const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
        str: `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    } : { r: 212, g: 148, b: 96, str: '212, 148, 96' };
};

const rgbToHex = (r, g, b) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

const blendHexColors = (baseHex, coverHex, coverWeight = 65) => {
    const base = hexToRgb(baseHex);
    const cover = hexToRgb(coverHex);
    const weight = Math.max(0, Math.min(100, coverWeight)) / 100;
    const r = Math.round(base.r * (1 - weight) + cover.r * weight);
    const g = Math.round(base.g * (1 - weight) + cover.g * weight);
    const b = Math.round(base.b * (1 - weight) + cover.b * weight);
    return rgbToHex(r, g, b);
};

export const ThemeService = {
    buildIslandShadow(size = 20, rgb = '212, 148, 96', enabled = true) {
        const glowStrength = enabled ? 1 : 0;
        return [
            'inset 0 1px 0 rgba(255, 255, 255, 0.16)',
            '0 8px 24px rgba(0, 0, 0, 0.42)',
            `0 0 ${Math.round(size * 0.8)}px rgba(${rgb}, ${0.42 * glowStrength})`,
            `0 0 ${Math.round(size * 1.8)}px rgba(${rgb}, ${0.22 * glowStrength})`,
            `0 0 0 1px rgba(${rgb}, ${0.22 * glowStrength})`
        ].join(', ');
    },

    applyGlobalTheme() {
        const theme = JSON.parse(localStorage.getItem('liquid_global_theme') || '{}');

        // Apply primary and secondary variables to document
        const primary = theme.primary || '#D49460';
        const secondary = theme.secondary || '#EDBC89';
        const rgb = hexToRgb(primary);
        
        document.documentElement.style.setProperty('--neon-primary', primary);
        document.documentElement.style.setProperty('--neon-accent', primary);
        document.documentElement.style.setProperty('--neon-primary-rgb', rgb.str);
        document.documentElement.style.setProperty('--neon-secondary', secondary);
        
        this.applyIslandSettings();
    },

    applyIslandSettings() {
        const config = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
        const coverColors = JSON.parse(localStorage.getItem('liquid_cover_colors') || '{}');
        const island = document.getElementById('dynamic-island');
        if (!island) return;

        // Custom fluid dark crystal settings
        const opacity = config.opacity !== undefined ? config.opacity : 92;
        island.style.setProperty('--island-bg', `rgba(10, 10, 15, ${opacity / 100})`);
        
        const blur = config.blur !== undefined ? config.blur : 30;
        island.style.setProperty('--island-blur', `${blur}px`);

        // Material and Grain styling
        const material = config.materialStyle || 'glass';
        island.classList.remove('material-glass', 'material-metal', 'material-holo');
        island.classList.add(`material-${material}`);

        const grain = config.grainEffect || 'none';
        island.classList.remove('effect-grain-none', 'effect-grain-light', 'effect-grain-medium');
        island.classList.add(`effect-grain-${grain}`);

        // Halo qui respire pendant la lecture (réglage de la page Island).
        document.body.classList.toggle('no-glow-breath', config.glowBreath === false);

        // Glow Settings
        if (config.glowEnabled === false) {
            island.style.setProperty('--island-glow-opacity', '0');
            island.style.boxShadow = this.buildIslandShadow(0, '212, 148, 96', false);
        } else {
            island.style.setProperty('--island-glow-opacity', '1');
            const size = config.glowDensity || 20;
            const glowMode = config.glowColorMode || 'mix';
            const fixedColor = config.glowColor || '#D49460';
            const canUseCover = localStorage.getItem('liquid_cover_color_sync') !== 'false' && coverColors.primary;
            let color = fixedColor;

            if (canUseCover && glowMode === 'cover') {
                color = coverColors.primary;
            } else if (canUseCover && glowMode === 'mix') {
                color = blendHexColors(fixedColor, coverColors.primary, config.glowBlend ?? 65);
            }

            const rgb = hexToRgb(color);
            
            island.style.setProperty('--island-glow-size', `${size}px`);
            island.style.setProperty('--island-glow-color', color);
            island.style.setProperty('--island-glow-rgb', rgb.str);
            island.style.boxShadow = this.buildIslandShadow(size, rgb.str, true);
        }

        const bgLayer = island.querySelector('.island-bg-layer');
        if (bgLayer && config.bgImage) {
            bgLayer.style.backgroundImage = `url('${config.bgImage}')`;
            bgLayer.style.opacity = (config.imgOpacity !== undefined ? config.imgOpacity : 100) / 100;
        }
    },

    saveIslandSettings(settings) {
        localStorage.setItem('liquid_island_config', JSON.stringify(settings));
        this.applyIslandSettings();
        window.dispatchEvent(new CustomEvent('liquid-island-config-changed', { detail: settings }));
    }
};
