import { native } from '../shared/ipc.js';

// Bounded across panel openings; failed previews retain the ordinary video icon.
const cache = new Map();
export function createThumbnails(root, on) {
    let disposed = false, running = false, queue = [];
    const list = root.querySelector('#list');
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            queue.push(entry.target);
        }
        drain();
    }, { root: list, rootMargin: '100px' });

    async function drain() {
        if (running || disposed) return;
        running = true;
        try {
            while (queue.length && !disposed) {
                const img = queue.shift();
                if (!img.isConnected) continue;
                const key = img.dataset.thumbnail;
                if (!cache.has(key)) {
                    const result = native.invoke('replay_thumbnail', { id: img.closest('[data-clip]').dataset.clip })
                        .then(path => path ? native.fileSrc(path) : null).catch(() => null);
                    cache.set(key, result);
                    if (cache.size > 200) cache.delete(cache.keys().next().value);
                }
                const source = await cache.get(key);
                if (disposed || !img.isConnected || !source) continue;
                img.src = source;
            }
        } finally { running = false; }
    }
    on(root, 'load', event => {
        if (event.target.matches('.replay-thumbnail img')) event.target.classList.add('is-loaded');
    }, { capture: true });
    on(root, 'error', event => {
        if (event.target.matches('.replay-thumbnail img')) event.target.classList.remove('is-loaded');
    }, { capture: true });
    return {
        refresh() {
            observer.disconnect(); queue = [];
            root.querySelectorAll('.replay-thumbnail img').forEach(img => observer.observe(img));
        },
        destroy() { disposed = true; observer.disconnect(); queue = []; },
    };
}
