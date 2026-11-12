import { useState } from 'react';
import { Button, Card, Row } from './controls.jsx';

export default function GettingStarted({ always = false, onNavigate }) {
    const [done, setDone] = useState(localStorage.getItem('liquid_getting_started') === 'true');
    if (done && !always) return null;
    return <Card title="Bien démarrer">
        <Row label="Ouvre tes outils" description="Clique sur la pilule pour ouvrir son contenu. Le clic droit affiche ton menu de raccourcis ; le bouton Menu ouvre les modules. Échap referme la vue." />
        <Row label="Place ton Island" description="Choisis ton écran, puis déplace la pilule et règle sa taille. Clique sur Terminer pour conserver la position.">
            <Button onClick={() => onNavigate('position')}>Position</Button>
        </Row>
        <Row label="Choisis tes modules" description="Garde les outils utiles dans le menu des modules et personnalise les actions du clic droit.">
            <Button onClick={() => onNavigate('menus')}>Menus</Button>
        </Row>
        <Row label="Prépare ton premier clip" description="Ouvre Replay & REC depuis les modules. Choisis la source et le dossier, puis vérifie l’aperçu et les niveaux audio avant de lancer la capture." />
        <Row label="Retrouve les raccourcis clavier" description="Consulte les combinaisons et active celles qui te conviennent.">
            <Button onClick={() => onNavigate('shortcuts')}>Raccourcis</Button>
        </Row>
        {!always && <Row label="Ce guide reste disponible dans À propos."><Button onClick={() => { localStorage.setItem('liquid_getting_started', 'true'); setDone(true); }}>Compris</Button></Row>}
    </Card>;
}
