/**
 * Aperçu de l'Island dans la page Apparence : les Réglages recouvrent la capsule, on ne voyait
 * donc rien changer en réglant l'opacité ou la matière. Une fausse fenêtre de bureau derrière
 * montre la transparence ; la pochette floutée montre le flou.
 */
import { forwardRef } from 'react';
import { blendHexColors, hexToRgb } from '../../island/dynamic-island/helpers/color.js';

/** Même couleur de halo que l'Island (services/ThemeService.js). */
function glowColor(settings, cover) {
    const coverColor = settings.coverSync && cover.primary;
    if (coverColor && settings.glowColorMode === 'cover') return cover.primary;
    if (coverColor && settings.glowColorMode === 'mix') return blendHexColors(settings.glowColor, cover.primary, settings.glowBlend ?? 65);
    return settings.glowColor || '#D49460';
}

const IslandPreview = forwardRef(function IslandPreview({ settings, cover }, ref) {
    const rgb = hexToRgb(glowColor(settings, cover));
    const style = {
        '--pv-opacity': settings.opacity / 100,
        '--pv-blur': `${Math.round(settings.blur * 0.8)}px`,
        '--pv-glow-rgb': `${rgb.r}, ${rgb.g}, ${rgb.b}`,
        '--pv-glow-size': `${settings.glowEnabled ? settings.glowDensity : 0}px`,
    };
    return (
        <div
            className="island-preview"
            ref={ref}
            style={style}
            data-material={settings.materialStyle}
            data-grain={settings.grainEffect}
            aria-hidden="true"
        >
            <div className="island-preview-desk">
                <span className="island-preview-window" />
                <span className="island-preview-window is-second" />
            </div>
            <div className="island-preview-capsule">
                {cover.cover && <div className="island-preview-cover-bg" style={{ backgroundImage: `url("${cover.cover}")` }} />}
                <div className="island-preview-content">
                    {cover.cover ? <img className="island-preview-art" src={cover.cover} alt="" /> : <span className="island-preview-art is-empty"><i className="ph-fill ph-music-note" /></span>}
                    <span className="island-preview-text">
                        <strong>Aperçu de l’Island</strong>
                        <small>Opacité, matière, flou et halo</small>
                    </span>
                    <span className="island-preview-bars"><i /><i /><i /><i /></span>
                </div>
            </div>
        </div>
    );
});

export default IslandPreview;
