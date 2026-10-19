import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayStore, activeCapture, duration, presets } from '../../src/replay/model.js';
const snapshot = (phase = 'idle') => ({ phase, config: { fps: 60, sourceId: '', microphone: false, destination: 'C:\\Videos' }, clips: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

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
