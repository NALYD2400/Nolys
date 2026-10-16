export const time = ms => {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

export function tracksFor(library, view, playback, query = '', sort = 'title') {
    const byId = new Map(library.tracks.map(track => [track.id, track]));
    const playlist = library.playlists.find(playlist => playlist.id === view);
    let tracks = view === 'queue' ? (playback.queue || []).map(id => byId.get(id)).filter(Boolean)
        : playlist ? playlist.trackIds.map(id => byId.get(id)).filter(Boolean)
        : library.tracks.filter(track => view !== 'favorites' || track.favorite);
    const search = normalize(query.trim());
    if (search) tracks = tracks.filter(track => normalize(`${track.title} ${track.artist} ${track.album}`).includes(search));
    if (!playlist && view !== 'queue') tracks = [...tracks].sort((a, b) => {
        if (sort === 'recent') return b.addedAt - a.addedAt;
        return String(a[sort] || '').localeCompare(String(b[sort] || ''), 'fr', { numeric: true }) || a.title.localeCompare(b.title, 'fr');
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
