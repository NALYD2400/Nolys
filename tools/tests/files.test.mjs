import assert from 'node:assert/strict';
import { test } from 'node:test';

const handlers = new Map();
let invoke = async command => {
    if (command === 'files_snapshot') {
        handlers.get('files-changed')({ payload: { sequence: 2, jobs: [{ id: 'new' }], destination: 'exports', error: null } });
        return { sequence: 1, jobs: [{ id: 'old' }], destination: 'old', error: null };
    }
};
globalThis.window = { __TAURI__: {
    core: { invoke: (...args) => invoke(...args) },
    webviewWindow: { getCurrentWebviewWindow: () => ({ listen: async (channel, callback) => { handlers.set(channel, callback); return () => handlers.delete(channel); } }) },
} };
const { files, initFiles, select, start, copy, pick, remove, retry, configure } = await import('../../src/files/store.js');

test('a newer job event survives the snapshot received while mounting', async () => {
    await initFiles();
    assert.equal(files.sequence, 2);
    assert.equal(files.jobs[0].id, 'new');
    assert.equal(files.destination, 'exports');
});

test('a second click while starting a job cannot enqueue a duplicate operation', async () => {
    let release;
    const calls = [];
    invoke = async (command, parameters) => {
        calls.push({ command, parameters });
        await new Promise(resolve => { release = resolve; });
        return 'job';
    };
    select([{ id: 'native-token', name: 'été.png', extension: 'png', size: 20 }]);
    const first = start('convert');
    await start('convert');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].parameters.ids, ['native-token']);
    release(); await first;
    assert.equal(files.busy, false);
});

test('a failed native clipboard transfer clears the old success message', async () => {
    files.notice = 'Fichiers copiés.';
    invoke = async () => { throw new Error('Le presse-papiers est occupé.'); };
    await copy(['result-token']);
    assert.equal(files.notice, '');
    assert.match(files.error, /presse-papiers/);
});

test('mixed and unsupported selections open the available file actions', () => {
    select([{ id: 'image', extension: 'png' }, { id: 'video', extension: 'mp4' }]);
    assert.equal(files.tab, 'actions');
    select([{ id: 'folder', extension: 'png', directory: true }]);
    assert.equal(files.tab, 'actions');
    select([{ id: 'image', extension: 'png' }]);
    assert.equal(files.tab, 'convert');
});

test('native cumulative selections survive another pick and individual removal', async () => {
    const first = { id: 'one', name: 'one.png', extension: 'png' };
    const second = { id: 'two', name: 'two.png', extension: 'png' };
    select([first]);
    invoke = async (command, args) => {
        if (command === 'files_pick') return [first, second];
        if (command === 'files_remove_inputs') { assert.deepEqual(args.ids, ['one']); return [second]; }
    };
    await pick();
    assert.deepEqual(files.inputs.map(input => input.id), ['one', 'two']);
    await remove(['one']);
    assert.deepEqual(files.inputs.map(input => input.id), ['two']);
});

test('retry submits the native job identity and prevents double clicks', async () => {
    let release;
    const calls = [];
    invoke = async (command, args) => { calls.push([command, args]); await new Promise(resolve => { release = resolve; }); };
    const first = retry('partial-job');
    await retry('partial-job');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'files_retry');
    assert.equal(calls[0][1].jobId, 'partial-job');
    assert.equal(typeof calls[0][1].requestId, 'string');
    release(); await first;
    assert.match(files.notice, /en échec/);
});

test('saving preferences accepts a snapshot that clears the previous repair error', async () => {
    files.repairable = true; files.error = 'Corrupt history';
    const preferences = { format: 'webp', quality: 82, maxEdge: 1280, background: null, historyLimit: 20 };
    invoke = async (command, args) => {
        assert.equal(command, 'files_preferences'); assert.deepEqual(args.preferences, preferences);
        return { sequence: 5, jobs: [], inputs: [], destination: 'exports', preferences, repairable: false, error: null };
    };
    await configure('files_preferences', { preferences });
    assert.equal(files.preferences.historyLimit, 20);
    assert.equal(files.error, ''); assert.equal(files.repairable, false);
});

test('failed preference writes keep the saved configuration and report the error', async () => {
    const before = files.preferences;
    invoke = async () => { throw new Error('Disque indisponible'); };
    await configure('files_preferences', { preferences: { ...before, historyLimit: 50 } });
    assert.equal(files.preferences, before);
    assert.match(files.error, /Disque indisponible/);
});

test('incremental progress updates one job and rejects delayed history snapshots', () => {
    handlers.get('files-job-changed')({ payload: { sequence: 6, job: { id: 'progress-job', completed: 1 }, error: null } });
    assert.equal(files.jobs[0].completed, 1);
    handlers.get('files-changed')({ payload: { sequence: 5, jobs: [], destination: 'old', error: null } });
    assert.equal(files.jobs[0].id, 'progress-job');
    handlers.get('files-job-changed')({ payload: { sequence: 7, job: { id: 'progress-job', completed: 2 }, error: null } });
    assert.equal(files.jobs.length, 1); assert.equal(files.jobs[0].completed, 2);
});
