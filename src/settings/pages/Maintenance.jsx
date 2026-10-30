import { useEffect, useState } from 'react';
import { native } from '../../shared/ipc.js';
import { Button, Card, Row } from '../components/controls.jsx';
import { whileBusy } from '../state/busy.js';

const size = value => value == null ? 'Indisponible' : `${(value / 1024 / 1024).toLocaleString('fr-FR', {maximumFractionDigits: 1})} Mio`;

export default function Maintenance({ store }) {
    const [info, setInfo] = useState(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = () => native.invoke('maintenance_info').then(setInfo);
    useEffect(() => { let alive = true; native.invoke('maintenance_info').then(value => alive && setInfo(value)).catch(() => {}); return () => { alive = false; }; }, []);
    const run = async action => {
        setBusy(true); setMessage('');
        try { await whileBusy(action); await refresh(); setMessage('Action terminée.'); }
        catch (error) { setMessage(String(error?.message || error)); }
        finally { setBusy(false); }
    };
    return <>
        <Card title="Récupération" footer="Le retour micro reste désactivé après une restauration. Les captures se relancent manuellement.">
            <Row label="Annuler le dernier import" description="Retrouve les préférences conservées juste avant l’import."><Button disabled={busy || !localStorage.getItem('liquid_recovery_before_import')} onClick={() => run(() => store.recoverImport('import'))}>Restaurer</Button></Row>
            <Row label="Annuler la dernière réinitialisation"><Button disabled={busy || !localStorage.getItem('liquid_recovery_before_reset')} onClick={() => run(() => store.recoverImport('reset'))}>Restaurer</Button></Row>
        </Card>
        <Card title="Espace utilisé" footer="Les tailles des vidéos et des exports correspondent aux fichiers indexés. Les nettoyages concernent uniquement les aperçus générés.">
            <Row label="Vidéos indexées" description={`${info?.replay?.clips ?? '—'} clips`}>{size(info?.replay?.indexedBytes)}</Row>
            <Row label="Exports de fichiers indexés">{size(info?.files?.exportBytes)}</Row>
            <Row label="Vignettes des clips" description={`${size(info?.replay?.cache?.bytes)} · plafond 128 Mio`}><Button disabled={busy} onClick={() => run(() => native.invoke('replay_cache', {clear: true}))}>Effacer les vignettes</Button></Row>
            <Row label="Pochettes de la bibliothèque" description={`${size(info?.library?.cache?.bytes)} · ${size(info?.library?.cache?.orphanBytes)} récupérables`}><Button disabled={busy} onClick={() => run(() => native.invoke('library_clean_cache'))}>Nettoyer les orphelines</Button></Row>
            <Row label="Actualiser les tailles"><Button disabled={busy} onClick={() => run(refresh)}>Actualiser</Button></Row>
        </Card>
        <Card title="Diagnostic" footer="Le fichier contient la version, l’état des modules, les compteurs et les tailles. Il exclut les noms, chemins, titres de médias, identifiants de périphériques et journaux bruts.">
            <Row label="Exporter un diagnostic"><Button disabled={busy} icon="ph-export" onClick={() => run(() => native.invoke('export_diagnostics'))}>Exporter le diagnostic</Button></Row>
        </Card>
        {message && <p className="card-footer" role="status">{message}</p>}
    </>;
}
