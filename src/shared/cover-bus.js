/**
 * Pochette et couleurs du morceau en cours, publiées par l'Island et lues par les Réglages
 * (même page : plus besoin de passer par le cœur natif). La dernière valeur est gardée pour
 * qu'une ouverture des Réglages ait tout de suite la pochette, pas seulement au morceau suivant.
 */
let current = null;
const listeners = new Set();

export function publishCover(payload) {
    if (!payload) return;
    current = payload;
    listeners.forEach((listener) => listener(payload));
}

export function currentCover() {
    return current;
}

/** Renvoie la fonction de désabonnement. */
export function onCover(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
