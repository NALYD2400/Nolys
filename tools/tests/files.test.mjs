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
const { files, initFiles, select, start, copy } = await import('../../src/files/store.js');

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
