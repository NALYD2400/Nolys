import { Button, Card, Row, Select } from '../components/controls.jsx';
import { useLayout } from '../state/useSettings.js';

export default function Position() {
    const { layout, displays, stepScale, setDisplay, toggleEditMode, recenter } = useLayout();
    const displayOptions = displays.map((display) => ({ value: display.id, label: display.label }));
    const scale = Math.round((layout.scale || 1) * 100);

    return (
        <>
            <Card footer="Les Réglages suivent la taille de l’Island.">
                {displayOptions.length > 1 && (
                    <Row label="Écran">
                        <Select value={layout.displayId} options={displayOptions} onChange={setDisplay} />
                    </Row>
                )}
                {/* Boutons plutôt qu'un curseur : la taille zoome toute la fenêtre de l'Island,
                    Réglages compris, et un curseur glissait sous le pointeur pendant le réglage. */}
                <Row label="Taille">
                    <div className="stepper">
                        <Button icon="ph-minus" aria-label="Plus petite" disabled={scale <= 65} onClick={() => stepScale(-1)} />
                        <span className="stepper-value">{scale} %</span>
                        <Button icon="ph-plus" aria-label="Plus grande" disabled={scale >= 150} onClick={() => stepScale(1)} />
                    </div>
                </Row>
            </Card>

            <Card footer="Les Réglages se referment pendant le placement et reviennent ici une fois terminé.">
                <Row label="Déplacer l’Island" description="Aussi par clic droit sur l’Island.">
                    <Button icon="ph-hand-grabbing" onClick={toggleEditMode}>Déplacer</Button>
                </Row>
                <Row label="Recentrer" description="En haut, au centre, sans changer la taille.">
                    <Button icon="ph-arrows-in-cardinal" onClick={recenter}>Recentrer</Button>
                </Row>
            </Card>
        </>
    );
}
