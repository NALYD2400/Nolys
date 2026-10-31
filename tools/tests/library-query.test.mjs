import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tracksFor, trackPage } from '../../src/library/model.js';

test('large library pages remain bounded and clamp after removal without changing order', () => {
    const tracks = Array.from({ length: 3000 }, (_, i) => ({ id: `t${i}`, title: `Titre ${3000-i}`, artist: 'Été', album: 'Test', addedAt: i }));
    const library = { tracks, playlists: [{id:'playlist',trackIds:['t2','t0']}] };
    const sorted = tracksFor(library, 'all', {}, 'ete');
    assert.equal(sorted[0].title, 'Titre 1');
    assert.equal(sorted.at(-1).title, 'Titre 3000');
    for (let page = 0; page < 20; page++) assert.equal(trackPage(sorted, page).tracks.length, 150);
    assert.equal(trackPage(sorted, 100).page, 19);
    assert.equal(trackPage(sorted.slice(0, 151), 19).tracks.length, 1);
    assert.deepEqual(tracksFor(library, 'playlist', {}).map(t=>t.id), ['t2','t0']);
    assert.deepEqual(tracksFor(library, 'queue', {queue:['t0','t2']}).map(t=>t.id), ['t0','t2']);
    assert.equal(tracks[0].id, 't0', 'sorting never rewrites the persisted order');
    tracks[0].artist = 'Hiver';
    assert.equal(tracksFor(library, 'all', {}, 'hiver')[0].id, 't0', 'cached search text follows metadata edits');
});
