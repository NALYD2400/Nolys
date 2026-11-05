/** Ignore les anciens échos natifs de cette fenêtre pendant une restauration. */
const source = globalThis.crypto.randomUUID();
let revision = 0;

export function invalidateConfigEvents() {
    revision++;
}

export function stampConfig(config) {
    return { ...config, _uiSequence: { source, revision: ++revision } };
}

export function isCurrentConfigEvent(config) {
    const sequence = config?._uiSequence;
    return !sequence || sequence.source !== source || sequence.revision === revision;
}
