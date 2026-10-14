import { Card, ChoiceGrid, ColorSwatch, Reveal, Row, Segmented, SliderRow, Toggle } from '../components/controls.jsx';
import { GLOW_COLOR_OPTIONS, GRAIN_OPTIONS, MATERIAL_OPTIONS, MOTION_OPTIONS } from '../state/presets.js';

export default function Appearance({ store }) {
    const { settings, update } = store;

    return (
        <>
            <Card title="Matériau">
                <ChoiceGrid value={settings.materialStyle} options={MATERIAL_OPTIONS} onChange={(materialStyle) => update({ materialStyle })} />
                <SliderRow
                    label="Opacité"
                    value={settings.opacity}
                    min={50}
                    max={100}
                    format={(v) => `${Math.round(v)} %`}
                    onChange={(opacity) => update({ opacity: Math.round(opacity) })}
                />
                <SliderRow
                    label="Flou d’arrière-plan"
                    value={settings.blur}
                    min={0}
                    max={50}
                    format={(v) => `${Math.round(v)} px`}
                    onChange={(blur) => update({ blur: Math.round(blur) })}
                />
                <Segmented label="Grain" value={settings.grainEffect} options={GRAIN_OPTIONS} onChange={(grainEffect) => update({ grainEffect })} />
                <Segmented label="Animations" value={settings.motion} options={MOTION_OPTIONS} onChange={(motion) => update({ motion })} />
                <Toggle
                    label="Boutons en verre dans le lecteur"
                    description="Effet Liquid Glass sur les commandes de lecture. Désactivé en mode Éco."
                    checked={settings.glassControls}
                    onChange={(glassControls) => update({ glassControls })}
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
