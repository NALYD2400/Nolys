// One still image in memory, shared across panel reopenings. No polling or disk cache.
let cached = null;
let flight = null;
const listeners = new Set();

export function createSourcePreview(root, { invoke, onStateChange }) {
    let current = null, key = '', attempted = null, failed = false, destroyed = false;

    function paint() {
        const image = root.querySelector('#replay-source-image');
        if (!image) return;
        const frame = cached?.key === key ? cached.image : null;
        const status = root.querySelector('#replay-source-preview-status');
        image.hidden = !frame; status.hidden = Boolean(frame);
        if (frame) {
            if (image.getAttribute('src') !== frame) image.src = frame;
        } else image.removeAttribute('src');
        const message = !current?.enabled ? 'Moteur vidéo indisponible'
            : current.active ? 'Miniature disponible après l’arrêt de la capture'
            : failed ? 'Aperçu indisponible · cliquez sur Actualiser'
            : 'Préparation de la miniature…';
        if (status.textContent !== message) status.textContent = message;
    }

    function visible() {
        return current?.visible && !document.hidden && !document.body.classList.contains('island-window-hidden');
    }

    function update() {
        if (destroyed) return;
        paint();
        if (!visible() || !current.enabled || current.active || current.busy || flight || attempted === key) return;
        const requestKey = key;
        const config = structuredClone(current.config);
        attempted = requestKey; failed = false;
        // Serialize rapid source changes: discard the obsolete reply, then capture
        // the newest selection, without launching competing native capture probes.
        flight = Promise.resolve().then(() => invoke(config)).then(image => {
            if (destroyed || key !== requestKey) return;
            if (typeof image !== 'string' || image.length > 700_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw Error('Invalid source preview');
            cached = { key: requestKey, image }; attempted = requestKey;
        }).catch(() => {
            if (!destroyed && key === requestKey) {
                if (cached?.key === requestKey) cached = null;
                failed = true; attempted = requestKey;
            }
        }).finally(() => {
            flight = null;
            for (const notify of listeners) notify();
        });
        paint(); onStateChange();
    }

    function imageError(event) {
        if (event.target.id !== 'replay-source-image' || !event.target.getAttribute('src')) return;
        if (cached?.key === key) cached = null;
        failed = true; paint();
    }
    const visibilityChanged = () => update();
    const changed = () => { update(); onStateChange(); };
    listeners.add(changed);
    root.addEventListener('error', imageError, true);
    document.addEventListener('visibilitychange', visibilityChanged);
    const observer = new MutationObserver(visibilityChanged);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    return {
        get pending() { return Boolean(flight); },
        sync(state) {
            if (destroyed) return;
            const nextKey = state.config ? JSON.stringify([state.config.sourceId, state.config.capture, state.config.enginePath]) : '';
            if (nextKey !== key || state.visible && !current?.visible && !flight && !state.active) {
                attempted = null; failed = false;
            }
            key = nextKey; current = state;
            update();
        },
        refresh() { if (!flight) { attempted = null; failed = false; update(); } },
        destroy() {
            destroyed = true; observer.disconnect();
            listeners.delete(changed);
            root.removeEventListener('error', imageError, true);
            document.removeEventListener('visibilitychange', visibilityChanged);
        },
    };
}
