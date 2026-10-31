import { Card, ChoiceGrid, Reveal, Row, Select, Toggle } from '../components/controls.jsx';
import { SHORTCUT_GROUPS, SHORTCUT_PRESETS, WIDGET_OPTIONS } from '../state/presets.js';

const SHORTCUT_MENU = SHORTCUT_GROUPS.map((group) => ({
    label: group.label,
    options: group.keys.map((key) => ({
        value: key,
        label: key === 'custom' ? 'Personnalisé…' : SHORTCUT_PRESETS[key].name,
        icon: SHORTCUT_PRESETS[key].icon,
    })),
}));

function ShortcutRow({ index, shortcut, onChange }) {
    const preset = shortcut.preset || 'custom';
    const choosePreset = (key) => {
        const chosen = SHORTCUT_PRESETS[key];
        onChange(
            key === 'custom'
                ? { name: shortcut.name || 'Perso', preset: 'custom', icon: chosen.icon, cmd: shortcut.cmd || '' }
                : { name: chosen.name, preset: key, icon: chosen.icon, cmd: chosen.cmd },
        );
    };

    return (
        <div className="shortcut-row">
            <Row label={`Bouton ${index + 1}`}>
                <Select value={preset} groups={SHORTCUT_MENU} onChange={choosePreset} />
            </Row>
            {preset === 'custom' && (
                <div className="custom-shortcut">
                    <input
                        className="text-input"
                        placeholder="Nom"
                        maxLength={16}
                        value={shortcut.name}
                        onChange={(event) => onChange({ ...shortcut, name: event.target.value })}
                    />
                    <input
                        className="text-input text-input-wide"
                        placeholder="Programme (C:\…\app.exe), lien https://, ms-settings:, discord:…"
                        value={shortcut.cmd}
                        onChange={(event) => onChange({ ...shortcut, cmd: event.target.value })}
                    />
                </div>
            )}
        </div>
    );
}

export default function ControlCenter({ store }) {
    const { settings, update } = store;
    const setShortcut = (index, next) => update({ shortcuts: settings.shortcuts.map((item, i) => (i === index ? next : item)) });

    return (
        <>
            <Card>
                <Toggle
                    label="Centre de contrôle"
                    description="Wi-Fi, Bluetooth, volume, alertes Windows et actions Nolys."
                    checked={settings.controlEnabled}
                    onChange={(controlEnabled) => update({ controlEnabled })}
                />
                <Toggle
                    label="Minuteur et chronomètre"
                    checked={settings.timerEnabled}
                    onChange={(timerEnabled) => update({ timerEnabled })}
                />
            </Card>

            <Reveal when={settings.controlEnabled}>
                <Card title="Widget du bas">
                    <ChoiceGrid value={settings.widgetType} options={WIDGET_OPTIONS} onChange={(widgetType) => update({ widgetType })} />
                </Card>

                <Reveal when={settings.widgetType === 'weather'}>
                    <Card title="Météo" footer="Données Open-Meteo, mises en cache 15 minutes. La ville sert à trouver ses coordonnées, puis à demander la météo.">
                        <Row label="Ville" description="Par exemple : Lyon, Bruxelles, Montréal.">
                            <input
                                className="text-input"
                                placeholder="Ta ville"
                                maxLength={60}
                                value={settings.weatherCity}
                                onChange={(event) => update({ weatherCity: event.target.value })}
                            />
                        </Row>
                    </Card>
                </Reveal>

                <Reveal when={settings.widgetType === 'launchpad'}>
                    <Card title="Raccourcis">
                        {settings.shortcuts.map((shortcut, index) => (
                            <ShortcutRow key={index} index={index} shortcut={shortcut} onChange={(next) => setShortcut(index, next)} />
                        ))}
                    </Card>
                </Reveal>
            </Reveal>
        </>
    );
}
