/**
 * Boîte de dialogue Windows ouverte depuis les Réglages (importer, exporter) : la fenêtre de
 * l'Island perd le focus, ce qui replie normalement l'Island. Tant qu'un dialogue est ouvert,
 * la vue se déclare occupée et le repli est ignoré (voir collapseIsland).
 */
let count = 0;
let listener = () => {};

export function onBusyChange(callback) {
    listener = callback;
    return () => {
        if (listener === callback) listener = () => {};
    };
}

export function isBusy() {
    return count > 0;
}

/** Marque la vue occupée le temps de `task` (promesse ou fonction asynchrone). */
export async function whileBusy(task) {
    count += 1;
    listener(true);
    try {
        return await (typeof task === 'function' ? task() : task);
    } finally {
        // Le focus revient à l'Island juste après la fermeture du dialogue : on attend ce
        // retour avant de réautoriser le repli (sinon un blur tardif refermerait la vue).
        setTimeout(() => {
            count -= 1;
            listener(count > 0);
        }, 250);
    }
}
