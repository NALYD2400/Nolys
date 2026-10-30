import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayStore, activeCapture, duration, presets, queryClips } from '../../src/replay/model.js';
const snapshot = (phase = 'idle') => ({ phase, config: { fps: 60, sourceId: '', microphone: false, destination: 'C:\\Videos' }, clips: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('clip discovery remains searchable beyond 200 with deterministic sort and bounded pages', () => {
    const clips = Array.from({ length: 260 }, (_, i) => ({ id: `${i}`, name: `Partie ${i}.mp4`, path: `C:/Vidéos/${i}.mp4`, kind: i % 2 ? 'recording' : 'replay', createdAt: i, bytes: 260 - i }));
    const last = queryClips(clips, { sort: 'oldest', page: 999 });
    assert.equal(last.pages, 11); assert.equal(last.page, 10); assert.equal(last.clips.length, 10);
    assert.equal(queryClips(clips, { search: 'partie 259', kind: 'recording' }).clips[0].id, '259');
    assert.equal(queryClips(clips, { search: 'PARTIE 259', kind: 'replay' }).total, 0);
    assert.equal(queryClips(clips, { sort: 'size' }).clips[0].id, '0');
    assert.equal(clips[0].id, '0', 'queries do not mutate persisted order');
});

test('group deletion preserves successful progress and stops on the first refused recycle', async () => {
    let clips = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]; const calls = [];
    const store = createReplayStore(async (command, args) => {
        if (command === 'replay_snapshot') return { ...snapshot(), clips };
        calls.push(args.id); if (args.id === 'two') throw new Error('Fichier utilisé');
        clips = clips.filter(c => c.id !== args.id); return { ...snapshot(), clips };
    });
    await store.refresh(); assert.equal(await store.deleteClips(['one', 'one', 'two', 'three']), false);
    assert.deepEqual(calls, ['one', 'two']); assert.deepEqual(store.state.snapshot.clips.map(c => c.id), ['two', 'three']);
});

test('rapid recording requests cannot start duplicate operations', async () => {
    const wait = deferred(); let calls = 0;
    const store = createReplayStore(async command => command === 'replay_snapshot' ? snapshot() : (calls++, wait.promise));
    await store.refresh(); const first = store.action('record');
    assert.equal(await store.action('record'), false); assert.equal(calls, 1);
    wait.resolve(snapshot('starting')); assert.equal(await first, true); assert.equal(store.state.busy, false);
});
test('an older snapshot cannot replace the latest native state', async () => {
    const first = deferred(), second = deferred(); let calls = 0;
    const store = createReplayStore(() => ++calls === 1 ? first.promise : second.promise);
    const a = store.refresh(), b = store.refresh(); second.resolve(snapshot('buffering')); await b;
    first.resolve(snapshot('idle')); await a;
    assert.equal(store.state.snapshot.phase, 'buffering');
});
test('dirty settings survive native telemetry, save before start, and lock during capture', async () => {
    const calls = []; const store = createReplayStore(async (command, args) => {
        calls.push([command, args]);
        if (command === 'replay_configure') return { ...snapshot(), config: args.config };
        return snapshot(command === 'replay_action' ? 'starting' : 'idle');
    });
    await store.refresh(); store.update('fps', 120); await store.refresh();
    assert.equal(store.state.draft.fps, 120); await store.action('start');
    assert.deepEqual(calls.slice(-2).map(c => c[0]), ['replay_configure', 'replay_action']);
    assert.equal(calls.at(-2)[1].config.fps, 120);
    store.update('fps', 30); assert.equal(store.state.draft.fps, 60);
});
test('failed configuration never starts the capture and preserves user edits', async () => {
    const calls = []; const store = createReplayStore(async command => {
        calls.push(command); if (command === 'replay_configure') throw new Error('Dossier inaccessible'); return snapshot();
    });
    await store.refresh(); store.update('fps', 120);
    assert.equal(await store.action('start'), false);
    assert.equal(calls.includes('replay_action'), false); assert.equal(store.state.dirty, true);
    assert.match(store.state.error, /Dossier inaccessible/); assert.equal(store.state.busy, false);
});
test('presets preserve source and privacy choices; elapsed labels remain bounded', async () => {
    const store = createReplayStore(async () => snapshot()); await store.refresh();
    store.update('sourceId', 'window:123:1'); store.preset('quality');
    assert.equal(store.state.draft.sourceId, 'window:123:1'); assert.equal(store.state.draft.microphone, false);
    assert.equal(store.state.draft.fps, presets.quality.fps);
    assert.equal(duration(-5), '00:00'); assert.equal(duration(125.9), '02:05');
    assert.equal(activeCapture(snapshot('starting')), true); assert.equal(activeCapture(snapshot('error')), false);
});

test('failed deletion preserves the clip and a successful deletion blocks stale refreshes', async () => {
    const old = { ...snapshot('buffering'), clips: [{ id: 'one' }] };
    const stale = deferred(); let reads = 0, rejected = true;
    const store = createReplayStore(async command => {
        if (command === 'replay_snapshot') return ++reads === 1 ? old : stale.promise;
        if (rejected) throw new Error('Fichier utilisé');
        return snapshot('buffering');
    });
    await store.refresh();
    assert.equal(await store.deleteClip('one'), false);
    assert.equal(store.state.snapshot.clips.length, 1);
    rejected = false; const refresh = store.refresh();
    assert.equal(await store.deleteClip('one'), true);
    stale.resolve(old); await refresh;
    assert.equal(store.state.snapshot.clips.length, 0);
    assert.equal(store.state.snapshot.phase, 'buffering');
});

test('renaming preserves a rejected clip and prevents an old snapshot undoing a successful rename', async () => {
    const old = { ...snapshot(), clips: [{ id: 'one', name: 'Before.mp4' }] };
    const stale = deferred(); let reads = 0, rejected = true;
    const store = createReplayStore(async (command, args) => {
        if (command === 'replay_snapshot') return ++reads === 1 ? old : stale.promise;
        assert.equal(command, 'replay_rename'); assert.deepEqual(args, { id: 'one', name: 'After' });
        if (rejected) throw new Error('Ce nom existe déjà');
        return { ...old, clips: [{ id: 'one', name: 'After.mp4' }] };
    });
    await store.refresh(); assert.equal(await store.renameClip('one', 'After'), false);
    assert.equal(store.state.snapshot.clips[0].name, 'Before.mp4');
    rejected = false; const refresh = store.refresh();
    assert.equal(await store.renameClip('one', 'After'), true);
    stale.resolve(old); await refresh;
    assert.equal(store.state.snapshot.clips[0].name, 'After.mp4');
});
