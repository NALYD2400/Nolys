import { Card, ChoiceGrid, ColorSwatch, Reveal, Row, Segmented, SliderRow, Toggle } from '../components/controls.jsx';
import { COVER_SHAPE_OPTIONS, THEME_PRESETS, VIZ_COLOR_OPTIONS, VIZ_STYLE_OPTIONS } from '../state/presets.js';

/**
 * Intensité du visualiseur en % (100 % = réglage par défaut). Stockée sous l'ancienne
 * « sensibilité » (2,5 par défaut) que l'Island lit déjà : intensité = √(sensibilité / 2,5).
 */
const sensitivityToIntensity = (sensitivity) => {
    const pct = Math.sqrt((Number(sensitivity) || 2.5) / 2.5) * 100;
    return Math.max(20, Math.min(200, Math.round(pct / 5) * 5));
};
const intensityToSensitivity = (intensity) => Math.round(2.5 * (intensity / 100) ** 2 * 1000) / 1000;

/** Thème actif : celui dont tous les réglages correspondent à l'état courant. */
function activeTheme(settings) {
    const match = THEME_PRESETS.find((theme) => Object.entries(theme.patch).every(([key, value]) => settings[key] === value));
    return match ? match.value : '';
}

export default function Island({ store }) {
    const { settings, update } = store;
    const vizShown = settings.showVisualizer || settings.vizInPill;

    return (
        <>
            <Card title="Thèmes" footer="Un clic règle d’un coup la matière, le halo, le visualiseur et les couleurs. Tu peux ensuite tout ajuster ci-dessous.">
                <ChoiceGrid
                    value={activeTheme(settings)}
                    options={THEME_PRESETS}
                    columns={5}
                    onChange={(value) => update(THEME_PRESETS.find((theme) => theme.value === value).patch)}
                />
            </Card>

            <Card title="Pilule repliée">
                <Segmented
                    label="Forme de la pochette"
                    value={settings.pillCoverShape}
                    options={COVER_SHAPE_OPTIONS}
                    onChange={(pillCoverShape) => update({ pillCoverShape })}
                />
                <Toggle
                    label="Titre du morceau"
                    description="Entre la pochette et le visualiseur. Sans titre, la pilule reste compacte."
                    checked={settings.pillShowTitle}
                    onChange={(pillShowTitle) => update({ pillShowTitle })}
                />
                <Reveal when={settings.pillShowTitle}>
                    <SliderRow
                        label="Largeur maximale"
                        description="La pilule s’adapte au titre jusqu’à cette largeur."
                        value={settings.pillMaxWidth}
                        min={180}
                        max={340}
                        step={10}
                        format={(v) => `${Math.round(v)} px`}
                        onChange={(pillMaxWidth) => update({ pillMaxWidth: Math.round(pillMaxWidth) })}
                    />
                </Reveal>
                <Toggle
                    label="Titres longs qui défilent"
                    description="En boucle dans la pilule et le lecteur. Sinon, ils sont coupés par « … »."
                    checked={settings.titleScroll}
                    onChange={(titleScroll) => update({ titleScroll })}
                />
                <Toggle
                    label="Pochette en fond de la pilule"
                    description="La pochette floutée colore la pilule pendant la lecture."
                    checked={settings.idleCoverBg}
                    onChange={(idleCoverBg) => update({ idleCoverBg })}
                />
            </Card>

            <Card title="Visualiseur">
                <Toggle label="Dans la pilule" checked={settings.vizInPill} onChange={(vizInPill) => update({ vizInPill })} />
                <Toggle label="Dans le lecteur" checked={settings.showVisualizer} onChange={(showVisualizer) => update({ showVisualizer })} />
                <Reveal when={vizShown}>
                    <ChoiceGrid value={settings.vizStyle} options={VIZ_STYLE_OPTIONS} onChange={(vizStyle) => update({ vizStyle })} />
                    <SliderRow
                        label="Nombre de barres"
                        value={settings.vizBars}
                        min={3}
                        max={9}
                        step={1}
                        format={(v) => `${Math.round(v)}`}
                        onChange={(vizBars) => update({ vizBars: Math.round(vizBars) })}
                    />
                    <Toggle
                        label="Halo des barres"
                        description="Une lueur douce autour du visualiseur."
                        checked={settings.vizGlow}
                        onChange={(vizGlow) => update({ vizGlow })}
                    />
                    <Segmented
                        label="Couleurs"
                        value={settings.vizColorMode}
                        options={VIZ_COLOR_OPTIONS}
                        onChange={(vizColorMode) => update({ vizColorMode })}
                    />
                    {settings.vizColorMode === 'solid' && (
                        <Row label="Couleur">
                            <ColorSwatch label="Couleur" value={settings.vizColorSolid} onChange={(vizColorSolid) => update({ vizColorSolid })} />
                        </Row>
                    )}
                    {settings.vizColorMode === 'gradient' && (
                        <Row label="Dégradé" description="De la première barre à la dernière.">
                            <div className="swatch-pair">
                                <ColorSwatch label="Début" value={settings.vizColorGradA} onChange={(vizColorGradA) => update({ vizColorGradA })} />
                                <span className="swatch-arrow" />
                                <ColorSwatch label="Fin" value={settings.vizColorGradB} onChange={(vizColorGradB) => update({ vizColorGradB })} />
                            </div>
                        </Row>
                    )}
                    <SliderRow
                        label="Intensité"
                        description="Amplitude du mouvement. Le volume, lui, est déjà compensé automatiquement."
                        value={sensitivityToIntensity(settings.visualizerSensitivity)}
                        min={20}
                        max={200}
                        step={5}
                        format={(v) => `${Math.round(v)} %`}
                        onChange={(intensity) => update({ visualizerSensitivity: intensityToSensitivity(intensity) })}
                    />
                </Reveal>
            </Card>

            <Card title="Lecteur et halo">
                <SliderRow
                    label="Pochette en fond du lecteur"
                    description="0 % : fond uni ; 100 % : pochette bien visible."
                    value={settings.playerCoverBg}
                    min={0}
                    max={100}
                    step={5}
                    format={(v) => `${Math.round(v)} %`}
                    onChange={(playerCoverBg) => update({ playerCoverBg: Math.round(playerCoverBg) })}
                />
                <Toggle
                    label="Halo qui respire"
                    description="Le halo pulse doucement pendant la lecture. Réglages du halo : page Apparence."
                    checked={settings.glowBreath}
                    onChange={(glowBreath) => update({ glowBreath })}
                />
            </Card>
        </>
    );
}
