import { useRef, useState } from 'react';
import { ipcRenderer } from '../../shared/ipc.js';
import { Button, Card, Icon, Row } from '../components/controls.jsx';
import { useUpdates } from '../state/useSettings.js';
import { whileBusy } from '../state/busy.js';

const UPDATE_COPY = {
    idle: { icon: 'ph-shield-check', title: 'Version installée', text: 'Vérifie s’il existe une nouvelle version.' },
    dev: { icon: 'ph-code', title: 'Version de développement', text: 'Les mises à jour sont actives dans la version installée.' },
    checking: { icon: 'ph-arrows-clockwise', title: 'Recherche en cours…', text: 'Vérification de la dernière version.' },
    'up-to-date': { icon: 'ph-check-circle', title: 'Application à jour', text: 'Tu as la dernière version.' },
    available: { icon: 'ph-download-simple', title: 'Nouvelle version disponible', text: 'Elle sera téléchargée seulement si tu le demandes.' },
    downloading: { icon: 'ph-cloud-arrow-down', title: 'Téléchargement…', text: 'Tu pourras l’installer juste après.' },
    downloaded: { icon: 'ph-rocket-launch', title: 'Prête à installer', text: 'L’application redémarrera pour appliquer la mise à jour.' },
    installing: { icon: 'ph-rocket-launch', title: 'Installation…', text: 'L’application va redémarrer.' },
    error: { icon: 'ph-warning-circle', title: 'Vérification impossible', text: '' },
};

function Updates({ updates }) {
    const { status, busy, check, download, install } = updates;
    const state = status.state || 'idle';
    const copy = UPDATE_COPY[state] || UPDATE_COPY.idle;
    const progress = Math.max(0, Math.min(100, Number(status.progress || 0)));

    let action = null;
    if (status.canInstall) action = <Button tone="accent" icon="ph-rocket-launch" disabled={busy} onClick={install}>Installer</Button>;
    else if (status.canDownload) action = <Button tone="accent" icon="ph-download-simple" disabled={busy} onClick={download}>Télécharger {status.availableVersion}</Button>;
    else action = <Button icon="ph-arrows-clockwise" disabled={busy || !status.canCheck} onClick={check}>Rechercher</Button>;

    return (
        <Card title="Mises à jour">
            <div className={`update update-${state}`}>
                <span className="update-icon"><Icon name={copy.icon} /></span>
                <div className="row-text">
                    <span className="row-label">{copy.title}</span>
                    <span className="row-description">{state === 'error' ? status.error : copy.text}</span>
                </div>
                <div className="row-control">{action}</div>
            </div>
            {state === 'downloading' && (
                <div className="progress"><span style={{ width: `${progress}%` }} /></div>
            )}
        </Card>
    );
}

export default function About({ store }) {
    const fileInput = useRef(null);
    const [importError, setImportError] = useState('');
    const updates = useUpdates();
    const version = updates.status.currentVersion;

    return (
        <>
            <div className="about-hero">
                <img src="/assets/app-logo.png" alt="" className="about-logo" />
                <div>
                    <h2>Nolys</h2>
                    {version && <p>Version {version}</p>}
                </div>
            </div>

            <Updates updates={updates} />

            <Card title="Sauvegarde" footer={importError || 'Le fichier contient tes réglages, tes profils et ton historique musical.'}>
                <Row label="Exporter les réglages">
                    <Button icon="ph-export" onClick={() => store.exportSettings().catch(() => setImportError('Export impossible : le fichier n’a pas pu être écrit.'))}>Exporter</Button>
                </Row>
                <Row label="Importer un fichier">
                    <Button icon="ph-download-simple" onClick={() => {
                        const input = fileInput.current;
                        if (!input) return;
                        // Sélecteur Windows ouvert : l'Island ne se replie pas en perdant le focus.
                        // Fin : fichier choisi, annulation, ou à défaut retour du focus dans l'Island.
                        whileBusy(new Promise((resolve) => {
                            input.addEventListener('change', resolve, { once: true });
                            input.addEventListener('cancel', resolve, { once: true });
                            window.addEventListener('focus', resolve, { once: true });
                        }));
                        input.click();
                    }}>Importer</Button>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={async (event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file) return;
                            try {
                                await store.importSettings(file);
                                setImportError('');
                            } catch {
                                setImportError('Ce fichier n’est pas une sauvegarde valide.');
                            }
                        }}
                    />
                </Row>
            </Card>

            <Card>
                <Row label="Quitter l’application" description="Ferme l’Island et rétablit ton fond d’écran.">
                    <Button tone="danger" icon="ph-power" onClick={() => ipcRenderer.send('exit-app')}>Quitter</Button>
                </Row>
            </Card>
        </>
    );
}
