import { useRef } from 'react';
import { Card, ChoiceGrid, ColorSwatch, Reveal, Row, Segmented, SliderRow, Toggle } from '../components/controls.jsx';
import IslandPreview from '../components/IslandPreview.jsx';
import { FPS_OPTIONS, GLOW_COLOR_OPTIONS, GRAIN_OPTIONS, MATERIAL_OPTIONS, MOTION_OPTIONS } from '../state/presets.js';
import { useCoverTheme } from '../state/useSettings.js';

export default function Appearance({ store }) {
    const { settings, update } = store;
    const cover = useCoverTheme(true);
    const preview = useRef(null);
    // Pendant un glissement, l'aperçu suit chaque position directement (sans redessiner la page).
    const previewVar = (name, value) => preview.current?.style.setProperty(name, value);

    return (
        <>
            {/* Hors de la carte : son verre éclaircirait l'aperçu, qui doit montrer l'Island telle quelle. */}
            <IslandPreview ref={preview} settings={settings} cover={cover} />
            <Card title="Matériau">
                <ChoiceGrid value={settings.materialStyle} options={MATERIAL_OPTIONS} onChange={(materialStyle) => update({ materialStyle })} />
                {/* Métal et Holo ont leur propre fond opaque : l'opacité n'agit que sur le Verre. */}
                <Reveal when={settings.materialStyle === 'glass'}>
                    <SliderRow
                        label="Opacité"
                        description="Transparence du fond de l’Island."
                        value={settings.opacity}
                        min={50}
                        max={100}
                        format={(v) => `${Math.round(v)} %`}
                        onPreview={(v) => previewVar('--pv-opacity', v / 100)}
                        onChange={(opacity) => update({ opacity: Math.round(opacity) })}
                    />
                </Reveal>
                <SliderRow
                    label="Flou de la pochette"
                    description="Pochette floutée derrière la pilule et le lecteur."
                    value={settings.blur}
                    min={0}
                    max={50}
                    format={(v) => `${Math.round(v)} px`}
                    onPreview={(v) => previewVar('--pv-blur', `${Math.round(v * 0.8)}px`)}
                    onChange={(blur) => update({ blur: Math.round(blur) })}
                />
                <Segmented label="Grain" value={settings.grainEffect} options={GRAIN_OPTIONS} onChange={(grainEffect) => update({ grainEffect })} />
                <Segmented label="Animations" value={settings.motion} options={MOTION_OPTIONS} onChange={(motion) => update({ motion })} />
                <Segmented
                    label="Images par seconde"
                    description="Plafond des animations continues qui se redessinent à chaque image (matières animées, effets lumineux…). Plus haut : plus fluide sur un écran rapide, mais plus de processeur. « Écran » suit sa fréquence."
                    value={String(settings.maxFps)}
                    options={FPS_OPTIONS}
                    onChange={(maxFps) => update({ maxFps })}
                />
            </Card>

            <Card title="Halo lumineux">
                <Toggle
                    label="Halo autour de l’Island"
                    checked={settings.glowEnabled}
                    onChange={(glowEnabled) => update({ glowEnabled })}
                />
                <Reveal when={settings.glowEnabled}>
                    <Segmented
                        label="Couleur"
                        value={settings.glowColorMode}
                        options={GLOW_COLOR_OPTIONS}
                        onChange={(glowColorMode) => update({ glowColorMode })}
                    />
                    {settings.glowColorMode !== 'cover' && (
                        <Row label="Couleur fixe" description={settings.glowColorMode === 'mix' ? 'Utilisée en l’absence de pochette.' : undefined}>
                            <ColorSwatch label="Couleur fixe" value={settings.glowColor} onChange={(glowColor) => update({ glowColor })} />
                        </Row>
                    )}
                    {settings.glowColorMode === 'mix' && (
                        <SliderRow
                            label="Part de la pochette"
                            value={settings.glowBlend}
                            min={0}
                            max={100}
                            format={(v) => `${Math.round(v)} %`}
                            onChange={(glowBlend) => update({ glowBlend: Math.round(glowBlend) })}
                        />
                    )}
                    <SliderRow
                        label="Intensité"
                        onPreview={(v) => previewVar('--pv-glow-size', `${Math.round(v)}px`)}
                        value={settings.glowDensity}
                        min={5}
                        max={50}
                        format={(v) => `${Math.round(v)} px`}
                        onChange={(glowDensity) => update({ glowDensity: Math.round(glowDensity) })}
                    />
                </Reveal>
            </Card>

            <Card title="Couleurs">
                <Toggle
                    label="Couleurs adaptées à la pochette"
                    description="L’Island et cette fenêtre prennent les teintes du morceau en cours."
                    checked={settings.coverSync}
                    onChange={(coverSync) => update({ coverSync })}
                />
            </Card>
        </>
    );
}
