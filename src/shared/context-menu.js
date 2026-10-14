/**
 * Coupe le menu clic droit du navigateur intégré (Retour, Actualiser, Imprimer,
 * Inspecter…) : il n'a rien à faire dans une application. Il reste dans les champs
 * de texte, où il sert à copier et coller.
 */
export function disableNativeContextMenu() {
    document.addEventListener('contextmenu', (e) => {
        const editable = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
        if (!editable) e.preventDefault();
    });
}
