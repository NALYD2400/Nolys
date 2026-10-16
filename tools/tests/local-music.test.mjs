import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMusicPlayer } from '../../src/services/LocalMusicPlayer.js';
import { tracksFor, moveTrack } from '../../src/library/model.js';

class AudioFixture extends EventTarget {
    currentTime = 0; duration = 60; paused = true; ended = false; volume = .8; src = '';
    async play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); }
    pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
    removeAttribute() { this.src = ''; }
    load() {}
}
const tracks = [
    { id: 'a', title: 'Été', artist: 'Alice', album: 'Voyage', duration: 60000, path: 'a.wav', favorite: true, addedAt: 1 },
    { id: 'b', title: 'Nuit', artist: 'Bob', album: 'Lune', duration: 60000, path: 'b.wav', addedAt: 2 },
    { id: 'c', title: 'Matin', artist: 'Alice', album: 'Voyage', duration: 60000, path: 'c.wav', addedAt: 3 },
];
function fixture(overrides = {}) {
    const calls = [];
    const player = new LocalMusicPlayer({ audio: new AudioFixture(), storage: { getItem: () => null, setItem: () => {} },
        invoke: async (command, args) => { calls.push([command, args]); if (command === 'library_get') return { tracks: structuredClone(tracks), playlists: [] }; },
        listen: async () => {}, fileSrc: path => path || '', onMedia: () => {}, onError: () => {}, random: () => 0, ...overrides,
    });
    player.library = { tracks: structuredClone(tracks), playlists: [] };
    return { player, calls };
}

test('lecture locale, pause, reprise, position et volume', async () => {
    const { player, calls } = fixture();
    await player.play('a', ['a', 'b']);
    assert.equal(player.media.trackKey, 'local:a');
    assert.equal(player.media.isPlaying, true);
    assert.ok(calls.some(([command]) => command === 'library_check_track'));
    await player.control({ type: 'media', action: 'toggle' });
    assert.equal(player.snapshot.isPlaying, false);
    await player.control({ type: 'media', action: 'play' });
    await player.control({ type: 'seek', value: 15000 });
    assert.equal(player.audio.currentTime, 15);
    await player.control({ type: 'volume', value: .3 });
    assert.equal(player.snapshot.volume, .3);
    await player.control({ type: 'seek', value: Infinity });
    assert.equal(player.audio.currentTime, 15);
});

test('fin de file, répétition et piste suivante', async () => {
    const { player } = fixture();
    await player.play('a', ['a', 'b']);
    await player.next(true);
    assert.equal(player.currentId, 'b');
    await player.next(true);
    assert.equal(player.currentId, 'b');
    player.repeat = 'all';
    await player.next(true);
    assert.equal(player.currentId, 'a');
    player.repeat = 'one'; player.audio.currentTime = 40;
    await player.next(true);
    assert.equal(player.currentId, 'a');
    assert.equal(player.audio.currentTime, 0);
});

test('aléatoire parcourt tous les morceaux sans boucle lorsque la répétition est désactivée', async () => {
    const { player } = fixture();
    player.shuffle = true;
    await player.play('a', ['a', 'b', 'c']);
    await player.next(true); assert.equal(player.currentId, 'b');
    await player.next(true); assert.equal(player.currentId, 'c');
    await player.next(true); assert.equal(player.currentId, 'c');
    player.repeat = 'all';
    await player.next(true); assert.equal(player.currentId, 'a');
});

test('deux clics rapides ne laissent pas une lecture ancienne remplacer la dernière', async () => {
    const pending = new Map();
    const { player } = fixture({ invoke: (command, args) => command === 'library_check_track' ? new Promise(resolve => pending.set(args.id, resolve)) : Promise.resolve() });
    const first = player.play('a');
    const second = player.play('b');
    pending.get('b')(); await second;
    pending.get('a')(); await first;
    assert.equal(player.currentId, 'b');
});

test('arrêter annule une lecture encore en préparation', async () => {
    let release;
    const { player } = fixture({ invoke: command => command === 'library_check_track' ? new Promise(resolve => { release = resolve; }) : Promise.resolve() });
    const playing = player.play('a'); player.stop(); release(); await playing;
    assert.equal(player.active, false); assert.equal(player.currentId, '');
});

test('une file est nettoyée et la suppression du morceau courant arrête la lecture', async () => {
    const { player } = fixture({ invoke: async command => command === 'library_get' ? { tracks: [], playlists: [] } : undefined });
    await player.play('a', ['a', 'b', 'b', 'inconnu']);
    assert.deepEqual(player.queue, ['a', 'b']);
    await player.reload(); assert.equal(player.active, false); assert.deepEqual(player.queue, []);
});

test('fichier absent : la lecture demandée échoue sans remplacer le titre courant', async () => {
    const { player } = fixture({ invoke: async command => { if (command === 'library_check_track') throw new Error('Fichier introuvable'); } });
    await assert.rejects(player.play('a'), /introuvable/);
    assert.equal(player.active, false);
});

test('recherche sans accents, favoris et ordre des playlists', () => {
    const library = { tracks, playlists: [{ id: 'p', trackIds: ['b', 'a'] }] };
    assert.deepEqual(tracksFor(library, 'all', {}, 'ete').map(t => t.id), ['a']);
    assert.deepEqual(tracksFor(library, 'favorites', {}).map(t => t.id), ['a']);
    assert.deepEqual(tracksFor(library, 'p', {}).map(t => t.id), ['b', 'a']);
    assert.deepEqual(moveTrack(['b', 'a'], 'a', -1), ['a', 'b']);
    assert.deepEqual(moveTrack(['a', 'b'], 'a', -1), ['a', 'b']);
});

test('retrouver le fichier courant utilise sa nouvelle URL sans changer son identité', async () => {
    const { player } = fixture({ invoke: async command => command === 'library_get' ? { tracks: [{ ...tracks[0], path: 'nouveau.wav' }], playlists: [] } : undefined });
    await player.play('a');
    assert.equal(player.audio.src, 'a.wav');
    await player.reload();
    await player.play('a');
    assert.equal(player.audio.src, 'nouveau.wav');
    assert.equal(player.media.trackKey, 'local:a');
});

test('une ancienne préparation rejetée ne coupe pas le morceau choisi ensuite', async () => {
    let rejectOld;
    const { player } = fixture({ invoke: (command, args) => command === 'library_check_track' && args.id === 'a' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve() });
    const old = player.control({ type: 'play', id: 'a' }).catch(error => player.fail(error));
    await player.control({ type: 'play', id: 'b' });
    rejectOld(new Error('ancien fichier introuvable')); await old;
    assert.equal(player.currentId, 'b');
    assert.equal(player.snapshot.isPlaying, true);
    assert.equal(player.error, '');
});
