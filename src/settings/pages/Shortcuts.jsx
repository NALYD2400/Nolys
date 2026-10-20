import { useState } from 'react';
import { Button, Card, Row, ShortcutRecorder, Switch } from '../components/controls.jsx';
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS } from '../../shared/hotkeys.js';
import { playClick } from '../state/sound.js';

const GROUPS = ['Island', 'Musique', 'Outils'];

/**
 * Raccourcis globaux : une combinaison par action. L'interrupteur désactive une action
 * sans effacer sa combinaison ; un refus (Windows, autre appli, autre action) est affiché.
 */
export default function Shortcuts({ store }) {
    const { settings, setHotkeys, hotkeyConflicts } = store;
    const hotkeys = settings.hotkeys;
    // Refus côté interface : combinaison déjà donnée à une autre action active.
    const [clashes, setClashes] = useState({});

    const apply = (id, patch) => {
        const next = { ...hotkeys[id], ...patch };
        const clash = next.enabled && next.accelerator
            ? HOTKEY_ACTIONS.find((other) => other.id !== id && hotkeys[other.id].enabled && hotkeys[other.id].accelerator === next.accelerator)
            : null;
        if (clash) {
            setClashes((current) => ({ ...current, [id]: `Déjà utilisée par « ${clash.label} ».` }));
            return;
        }
        setClashes((current) => ({ ...current, [id]: undefined }));
        setHotkeys({ ...hotkeys, [id]: next });
    };

    // Refus renvoyé par Windows, seulement pour la combinaison actuelle de cette action.
    const systemError = (id) => {
        const conflict = hotkeyConflicts.find((item) => item.action === id && item.accelerator === hotkeys[id].accelerator);
        return conflict && hotkeys[id].enabled ? `Indisponible : ${conflict.reason}.` : null;
    };

    return (
        <>
            {GROUPS.map((group) => (
                <Card key={group} title={group}>
                    {HOTKEY_ACTIONS.filter((action) => action.group === group).map((action) => {
                        const { accelerator, enabled } = hotkeys[action.id];
                        const message = clashes[action.id] || systemError(action.id);
                        return (
                            <Row
                                key={action.id}
                                label={action.label}
                                description={message ? <span className="hotkey-error" role="alert">{message}</span> : action.description}
                            >
                                <div className="hotkey-controls">
                                    <ShortcutRecorder
                                        value={accelerator}
                                        label={action.label}
                                        off={!enabled}
                                        onChange={(next) => apply(action.id, { accelerator: next })}
                                    />
                                    <Switch
                                        aria-label={`Activer : ${action.label}`}
                                        checked={enabled}
                                        onCheckedChange={(value) => {
                                            playClick();
                                            apply(action.id, { enabled: value });
                                        }}
                                    />
                                </div>
                            </Row>
                        );
                    })}
                </Card>
            ))}
            <div className="hotkeys-footer">
                <p className="card-footer">
                    Les raccourcis marchent partout, même quand l’Island est masquée. Une combinaison déjà prise par Windows
                    ou une autre application est refusée : choisis-en une autre. Clique sur une combinaison puis appuie sur les touches.
                </p>
                <Button icon="ph-arrow-counter-clockwise" onClick={() => {
                    setClashes({});
                    setHotkeys(DEFAULT_HOTKEYS);
                }}>
                    Rétablir les valeurs par défaut
                </Button>
            </div>
        </>
    );
}
