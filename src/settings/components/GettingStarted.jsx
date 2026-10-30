import { useState } from 'react';
import { Button, Card, Row } from './controls.jsx';

export default function GettingStarted({ always = false }) {
    const [done, setDone] = useState(localStorage.getItem('liquid_getting_started') === 'true');
    if (done && !always) return null;
    return <Card title="Bien démarrer">
        <Row label="1 · Place ton Island" description="Dans Position, choisis ton écran, puis déplace la pilule et règle sa taille." />
        <Row label="2 · Choisis tes modules" description="Dans Menus, garde les outils utiles. Le clic droit sur la pilule ouvre les raccourcis." />
        <Row label="3 · Prépare ton premier clip" description="Dans Replay & REC, choisis la source et le dossier, puis vérifie l’aperçu et les niveaux audio avant de lancer la capture." />
        {!always && <Row label="Ce guide reste disponible dans À propos."><Button onClick={() => { localStorage.setItem('liquid_getting_started', 'true'); setDone(true); }}>Compris</Button></Row>}
    </Card>;
}
