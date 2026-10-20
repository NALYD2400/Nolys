import { useEffect, useState } from 'react';
import { Card, Reveal, Row, Segmented, Select, SliderRow, Toggle } from '../components/controls.jsx';
import { useMicMonitor } from '../state/useSettings.js';

const LATENCY_OPTIONS = [
    { value: 'low', label: 'Faible' },
    { value: 'normal', label: 'Normale' },
    { value: 'safe', label: 'Sûre' },
];

const toPct = (linear) => {
    const db = linear > 0.00001 ? 20 * Math.log10(linear) : -80;
    return Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
};

/** Le périphérique choisi reste dans la liste même débranché (Windows ne liste que les actifs). */
const deviceOptions = (devices, defaultLabel, current, icon) => [
    { value: '', label: defaultLabel, icon: 'ph-windows-logo' },
    ...devices.map((device) => ({ value: device.id, label: device.name, icon })),
    ...(current && !devices.some((device) => device.id === current) ? [{ value: current, label: 'Choix précédent (débranché)', icon: 'ph-plugs' }] : []),
];

const FALLBACK_NOTE = 'Débranché : celui de Windows prend le relais, retour automatique dès qu’il revient.';

/** Vumètre : entrée du micro en transparence, ce qui part dans le casque par-dessus, seuil de la porte. */
function LevelMeter({ config, subscribeLevels }) {
    const [levels, setLevels] = useState({ inputLevel: 0, outputLevel: 0 });
    useEffect(() => subscribeLevels(({ inputLevel, outputLevel }) => setLevels({ inputLevel, outputLevel })), [subscribeLevels]);
    const gate = toPct(10 ** ((config.gateThreshold ?? -50) / 20));
    return (
        <div className="mic-level" aria-hidden="true">
            <div className="mic-level-in" style={{ width: `${toPct(levels.inputLevel)}%` }} />
            <div className="mic-level-out" style={{ width: `${toPct(levels.outputLevel)}%` }} />
            {config.gateEnabled && <div className="mic-level-gate" style={{ left: `${gate}%` }} />}
        </div>
    );
}

export default function MicMonitor() {
    const { status, inputs, outputs, update, subscribeLevels } = useMicMonitor();
    const [satellite, setSatellite] = useState(() => localStorage.getItem('liquid_mic_satellite') !== 'false');

    if (!status) return null;
    const config = status.config;
    const running = config.enabled && status.running;

    let state = 'Coupé';
    if (config.enabled && status.error) state = status.error;
    else if (running) state = `En direct · environ ${status.latencyMs} ms de latence`;
    else if (config.enabled) state = 'Démarrage…';

    return (
        <>
            <Card footer={running && status.outputKind === 'speakers' ? 'Sortie sur des enceintes : le micro risque de les capter (effet Larsen). Un casque est conseillé.' : undefined}>
                <Toggle
                    label="Retour micro"
                    description="Entends ta propre voix dans le casque, en direct, comme sur un casque de jeu ou un téléphone."
                    checked={Boolean(config.enabled)}
                    onChange={(enabled) => update({ enabled })}
                />
                <Row label="État" description={state}>
                    <LevelMeter config={config} subscribeLevels={subscribeLevels} />
                </Row>
            </Card>

            <Card title="Son">
                <SliderRow
                    live
                    label="Volume du retour"
                    description="Au-delà de 100 %, la voix est amplifiée (avec une saturation douce)."
                    value={config.volume ?? 60}
                    min={0}
                    max={200}
                    step={1}
                    format={(v) => `${Math.round(v)} %`}
                    onChange={(volume) => update({ volume: Math.round(volume) })}
                />
                <SliderRow
                    live
                    label="Balance"
                    value={config.balance ?? 0}
                    min={-100}
                    max={100}
                    step={5}
                    format={(v) => (v === 0 ? 'Centre' : v < 0 ? `G ${-v}` : `D ${v}`)}
                    onChange={(balance) => update({ balance: Math.round(balance) })}
                />
            </Card>

            <Card title="Traitement" footer="L’anti-bruit utilise RNNoise (réseau de neurones open source de Xiph), directement dans l’app : rien ne part sur Internet.">
                <Toggle
                    label="Anti-bruit IA"
                    description={status.denoiseAvailable === false ? 'Indisponible avec ce micro : Windows refuse de le convertir en 48 kHz.' : 'Retire clavier, ventilateur et souffle. Ajoute 10 ms de latence.'}
                    checked={Boolean(config.denoise)}
                    onChange={(denoise) => update({ denoise })}
                />
                <Toggle
                    label="Porte de bruit"
                    description="Coupe le retour quand tu ne parles pas."
                    checked={Boolean(config.gateEnabled)}
                    onChange={(gateEnabled) => update({ gateEnabled })}
                />
                <Reveal when={Boolean(config.gateEnabled)}>
                    <SliderRow
                        live
                        label="Seuil"
                        description="Le repère blanc sur le vumètre. Tu peux aussi le glisser dans l’Island."
                        value={config.gateThreshold ?? -50}
                        min={-80}
                        max={-10}
                        step={1}
                        format={(v) => `${Math.round(v)} dB`}
                        onChange={(gateThreshold) => update({ gateThreshold: Math.round(gateThreshold) })}
                    />
                </Reveal>
                <Toggle
                    label="Coupe-bas"
                    description="Filtre les graves sous 90 Hz : chocs sur le bureau, souffle, ronflement."
                    checked={Boolean(config.highPass)}
                    onChange={(highPass) => update({ highPass })}
                />
                <Segmented
                    label="Latence"
                    description="Faible : le plus réactif. Sûre : si tu entends des craquements."
                    value={config.latency || 'normal'}
                    options={LATENCY_OPTIONS}
                    onChange={(latency) => update({ latency })}
                />
            </Card>

            <Card title="Périphériques">
                <Row label="Micro" description={running && status.inputFallback ? FALLBACK_NOTE : undefined}>
                    <Select
                        title="Micros"
                        value={config.inputId || ''}
                        options={deviceOptions(inputs, 'Par défaut de Windows', config.inputId, 'ph-microphone')}
                        onChange={(inputId) => update({ inputId })}
                    />
                </Row>
                <Row label="Sortie du retour" description={running && status.outputFallback ? FALLBACK_NOTE : 'Le casque dans lequel tu veux t’entendre.'}>
                    <Select
                        title="Sorties"
                        value={config.outputId || ''}
                        options={deviceOptions(outputs, 'Par défaut de Windows', config.outputId, 'ph-headphones')}
                        onChange={(outputId) => update({ outputId })}
                    />
                </Row>
            </Card>

            <Card title="Island">
                <Toggle
                    label="Bulle d’activité"
                    description="Une petite bulle à côté de la pilule montre que le retour est actif et bouge avec ta voix. Clic : régler. Deux clics droits : couper."
                    checked={satellite}
                    onChange={(value) => {
                        setSatellite(value);
                        localStorage.setItem('liquid_mic_satellite', String(value));
                    }}
                />
            </Card>
        </>
    );
}
