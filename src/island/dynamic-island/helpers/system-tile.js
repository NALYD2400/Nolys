/** One native toggle, with confirmed state and protection against late reads. */
export function bindSystemTile({ element, key, channel, invoke, labels = {}, onError = () => {} }) {
    let value = null, writing = false, reading = false, version = 0, disposed = false;
    const errors = { denied: 'Accès refusé', not_found: 'Absent', disabled: 'Verrouillé', unknown: 'Indisponible', failed: 'Échec', error: 'Échec' };
    const current = () => !disposed && element.isConnected;
    function paint(state, message = '') {
        if (!current()) return;
        value = state;
        element.classList.toggle('active', state === true);
        element.classList.toggle('has-error', Boolean(message) && state !== null);
        element.classList.toggle('is-unavailable', state === null && !writing);
        element.classList.toggle('is-busy', writing);
        element.disabled = writing || state === null;
        element.setAttribute('aria-pressed', state === null ? 'mixed' : String(state));
        element.setAttribute('aria-busy', String(writing || (state === null && reading)));
        const text = element.querySelector('.ic-tile-status');
        if (text) text.textContent = message || (state ? labels.on || 'Activé' : labels.off || 'Désactivé');
        if (state !== null && !writing) localStorage.setItem(key, String(state));
    }
    async function refresh() {
        if (!current() || reading || writing) return;
        reading = true;
        const request = version;
        if (value === null) paint(null, 'Vérification…');
        let status;
        try { status = await invoke(channel, 'status'); } catch { status = 'unknown'; }
        reading = false;
        if (!current() || request !== version || writing) return;
        paint(status === 'on' ? true : status === 'off' ? false : null, status === 'on' || status === 'off' ? '' : errors[status] || 'Indisponible');
    }
    element.onclick = async () => {
        if (!current() || writing || value === null) return;
        const previous = value, target = !previous;
        ++version; writing = true;
        paint(previous, labels.pending || 'Application…');
        let result;
        try {
            result = await invoke(channel, target ? 'on' : 'off');
            if (result === 'ok') {
                const status = await invoke(channel, 'status');
                if (status === (target ? 'on' : 'off')) {
                    writing = false; paint(target); return;
                }
                if (status === 'on' || status === 'off') {
                    writing = false; paint(status === 'on', 'Non appliqué');
                    onError('Windows n’a pas appliqué la commande.'); return;
                }
                result = status;
            }
        } catch { result = 'error'; }
        writing = false;
        if (!current()) return;
        const message = errors[result] || 'Échec';
        paint(previous, message);
        onError(message);
    };
    return { refresh, dispose() { disposed = true; ++version; } };
}
