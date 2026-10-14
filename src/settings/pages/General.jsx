import { useState } from 'react';
import { Button, Card, Icon, Row, Toggle } from '../components/controls.jsx';
import { QUICK_PROFILES } from '../state/presets.js';
import { useAutoStart } from '../state/useSettings.js';
import { playClick } from '../state/sound.js';

function Profiles({ store }) {
    const { settings, customProfiles, applyQuickProfile, applyCustomProfile, saveCurrentAsProfile, deleteProfile } = store;
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    const save = () => {
        saveCurrentAsProfile(name);
        setName('');
        setNaming(false);
    };

    return (
        <Card
            title="Profil"
            footer="Un profil règle d’un coup l’apparence, les modules, le volume et Ne pas déranger."
        >
            <div className="profiles">
                {Object.entries(QUICK_PROFILES).map(([key, profile]) => (
                    <button
                        key={key}
                        type="button"
                        className={`profile${settings.activeProfile === key ? ' is-selected' : ''}`}
                        onClick={() => applyQuickProfile(key)}
                    >
                        <span className={`profile-icon profile-${key}`}><Icon name={profile.icon} /></span>
                        <span>{profile.name}</span>
                    </button>
                ))}
                {customProfiles.map((profile) => (
                    <div key={profile.id} className={`profile${settings.activeProfile === profile.id ? ' is-selected' : ''}`}>
                        <button type="button" className="profile-main" title={`Appliquer le profil ${profile.name}`} onClick={() => applyCustomProfile(profile)}>
                            <span className="profile-icon profile-custom"><Icon name="ph-user-circle" /></span>
                            <span>{profile.name}</span>
                        </button>
                        <button
                            type="button"
                            className="profile-delete"
                            aria-label={`Supprimer ${profile.name}`}
                            onClick={() => {
                                playClick();
                                deleteProfile(profile.id);
                            }}
                        >
                            <Icon name="ph-x" />
                        </button>
                    </div>
                ))}
            </div>
            <Row label="Enregistrer les réglages actuels" description="Crée un profil personnel réutilisable.">
                {naming ? (
                    <form
                        className="inline-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            save();
                        }}
                    >
                        <input
                            autoFocus
                            className="text-input"
                            placeholder="Nom du profil"
                            maxLength={24}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => event.key === 'Escape' && setNaming(false)}
                        />
                        <Button type="submit" disabled={!name.trim()}>Créer</Button>
                    </form>
                ) : (
                    <Button icon="ph-plus" onClick={() => setNaming(true)}>Nouveau profil</Button>
                )}
            </Row>
        </Card>
    );
}

export default function General({ store }) {
    const { settings, update } = store;
    const [autoStart, setAutoStart] = useAutoStart();

    return (
        <>
            <Profiles store={store} />

            <Card title="Démarrage">
                <Toggle label="Lancer au démarrage de Windows" checked={autoStart} onChange={setAutoStart} />
            </Card>

            <Card title="Comportement">
                <Toggle
                    label="Toujours au premier plan"
                    description="L’Island reste devant toutes les fenêtres (navigateur, apps…). Sinon, elle passe derrière celle qui est active."
                    checked={settings.persistent}
                    onChange={(persistent) => update({ persistent })}
                />
                <Toggle
                    label="Masquer en plein écran"
                    description="Jeux et vidéos en plein écran sur le même écran que l’Island."
                    checked={settings.gameDetection}
                    onChange={(gameDetection) => update({ gameDetection })}
                />
                <Toggle
                    label="Notifications dans l’Island"
                    checked={settings.notifications}
                    onChange={(notifications) => update({ notifications })}
                />
                <Toggle
                    label="Effets sonores"
                    checked={settings.soundEffects}
                    onChange={(soundEffects) => update({ soundEffects })}
                />
                <Toggle
                    label="Mode économie"
                    description="Coupe les animations, les flous et le visualiseur."
                    checked={settings.ecoMode}
                    onChange={(ecoMode) => update({ ecoMode })}
                />
            </Card>
        </>
    );
}
