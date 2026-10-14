import { Card, Reveal, Row, Select, Toggle } from '../components/controls.jsx';
import { COMPACT_MODE_OPTIONS } from '../state/presets.js';

export default function Music({ store }) {
    const { settings, update } = store;

    return (
        <>
            <Card>
                <Toggle
                    label="Lecteur de musique"
                    description="Spotify, Deezer, YouTube, navigateurs et autres lecteurs Windows."
                    checked={settings.musicEnabled}
                    onChange={(musicEnabled) => update({ musicEnabled })}
                />
            </Card>

            <Reveal when={settings.musicEnabled}>
                <Card title="Lecteur">
                    <Row label="Pilule réduite" description="Ce qui s’affiche quand l’Island est repliée.">
                        <Select
                            value={settings.idleCompactMode}
                            options={COMPACT_MODE_OPTIONS}
                            onChange={(idleCompactMode) => update({ idleCompactMode })}
                        />
                    </Row>
                    <Toggle label="Afficher la durée" checked={settings.showTimes} onChange={(showTimes) => update({ showTimes })} />
                    <Toggle
                        label="Boutons rapides"
                        description="Historique, favoris et widgets en haut du lecteur."
                        checked={settings.showActions}
                        onChange={(showActions) => update({ showActions })}
                    />
                    <Toggle
                        label="La molette règle l’application"
                        description="Change le volume du lecteur plutôt que celui de Windows."
                        checked={settings.wheelAppVolume}
                        onChange={(wheelAppVolume) => update({ wheelAppVolume })}
                    />
                </Card>

                <p className="card-footer">Visualiseur, pochette et titre de la pilule : page Island.</p>
            </Reveal>
        </>
    );
}
