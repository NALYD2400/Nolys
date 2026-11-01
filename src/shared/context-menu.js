const nonTextInputTypes = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden']);

/** Reconnaît les champs de saisie, y compris dans les vues en shadow DOM. */
export function isTextInputEvent(event) {
    // La cible est l'hôte à l'extérieur d'un shadow DOM ; le chemin garde le champ réel.
    return event.composedPath().some(target => target instanceof Element
        && (target.matches('textarea, [contenteditable]:not([contenteditable="false"])')
            || (target.localName === 'input' && !nonTextInputTypes.has(target.type))));
}

/** Coupe le menu du navigateur intégré, en gardant copier/coller dans les champs. */
export function disableNativeContextMenu() {
    document.addEventListener('contextmenu', (e) => {
        if (!isTextInputEvent(e)) e.preventDefault();
    });
}
