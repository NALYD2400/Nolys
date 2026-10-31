export const time = ms => {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

// Reuse the collator: constructing its options for every comparison dominates
// sorting a large library. Weak entries disappear with the old library snapshot.
const collator = new Intl.Collator('fr', { numeric: true });
const searchText = new WeakMap();
function searchable(track) {
    const text = `${track.title} ${track.artist} ${track.album}`;
    let cached = searchText.get(track);
    if (cached?.text !== text) {
        cached = { text, normalized: normalize(text) };
        searchText.set(track, cached);
    }
    return cached.normalized;
}

export function trackPage(tracks, page = 0, pageSize = 150) {
    const pages = Math.max(1, Math.ceil(tracks.length / pageSize));
    const index = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
    const start = index * pageSize;
    return { page: index, pages, start, tracks: tracks.slice(start, start + pageSize) };
}

export function tracksFor(library, view, playback, query = '', sort = 'title') {
    const playlist = library.playlists.find(playlist => playlist.id === view);
    const byId = view === 'queue' || playlist ? new Map(library.tracks.map(track => [track.id, track])) : null;
    let tracks = view === 'queue' ? (playback.queue || []).map(id => byId.get(id)).filter(Boolean)
        : playlist ? playlist.trackIds.map(id => byId.get(id)).filter(Boolean)
        : library.tracks.filter(track => view !== 'favorites' || track.favorite);
    const search = normalize(query.trim());
    if (search) tracks = tracks.filter(track => searchable(track).includes(search));
    if (!playlist && view !== 'queue') tracks = [...tracks].sort((a, b) => {
        if (sort === 'recent') return b.addedAt - a.addedAt;
        return collator.compare(String(a[sort] || ''), String(b[sort] || '')) || collator.compare(a.title, b.title);
    });
    return tracks;
}

export function moveTrack(ids, id, direction) {
    const next = [...ids];
    const from = next.indexOf(id);
    const to = from + direction;
    if (from >= 0 && to >= 0 && to < next.length) [next[from], next[to]] = [next[to], next[from]];
    return next;
}
