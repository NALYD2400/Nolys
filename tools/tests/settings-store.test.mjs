import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installSettingsStore, isSyncedKey } from '../../src/shared/settings-store.js';

/** Stockage minimal au comportement de `Storage` (méthodes sur le prototype). */
function createEnvironment(initial = {}) {
    class FakeStorage {
        constructor(entries) { this.data = new Map(Object.entries(entries)); }
        get length() { return this.data.size; }
        key(index) { return [...this.data.keys()][index] ?? null; }
        getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
        setItem(key, value) { this.data.set(String(key), String(value)); }
        removeItem(key) { this.data.delete(String(key)); }
        clear() { this.data.clear(); }
    }
    const storage = new FakeStorage(initial);
    const session = new FakeStorage({});
    const calls = [];
    const invoke = async (command, args) => { calls.push([command, structuredClone(args)]); return true; };
    return { storage, session, calls, invoke, proto: FakeStorage.prototype };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('only interface keys are synced', () => {
    assert.ok(isSyncedKey('liquid_motion_level'));
    assert.ok(isSyncedKey('island_standalone_config'));
    assert.ok(!isSyncedKey('nolys_ui_settings_loaded'));
    assert.ok(!isSyncedKey(null));
});

test('the settings file replaces this origin values on first load', async () => {
    const env = createEnvironment({ liquid_motion_level: 'sober', liquid_dev_only: '1', other: 'kept' });
    const snapshot = { initialized: true, values: { liquid_motion_level: 'vivid', liquid_eco_mode: 'true' } };
    assert.ok(installSettingsStore({ ...env, snapshot }));
    assert.equal(env.storage.getItem('liquid_motion_level'), 'vivid');
    assert.equal(env.storage.getItem('liquid_eco_mode'), 'true');
    assert.equal(env.storage.getItem('liquid_dev_only'), null);
    assert.equal(env.storage.getItem('other'), 'kept');
    await flush();
    assert.deepEqual(env.calls, [], 'reading the file writes nothing back');
});

test('a reload keeps newer local values instead of the stale snapshot', () => {
    const env = createEnvironment({ liquid_motion_level: 'fluid' });
    env.session.setItem('nolys_ui_settings_loaded', '1');
    installSettingsStore({ ...env, snapshot: { initialized: true, values: { liquid_motion_level: 'vivid' } } });
    assert.equal(env.storage.getItem('liquid_motion_level'), 'fluid');
});

test('without a file, existing local settings seed it', async () => {
    const env = createEnvironment({ liquid_motion_level: 'sober', other: 'x' });
    installSettingsStore({ ...env, snapshot: { initialized: false, values: {} } });
    await flush();
    assert.deepEqual(env.calls, [['ui_settings_seed', { values: { liquid_motion_level: 'sober' } }]]);
    assert.equal(env.storage.getItem('liquid_motion_level'), 'sober');
});

test('writes are batched, deduplicated and sent in order', async () => {
    const env = createEnvironment({ liquid_a: '1' });
    installSettingsStore({ ...env, snapshot: { initialized: true, values: { liquid_a: '1' } } });
    env.storage.setItem('liquid_a', '1'); // inchangé : rien à écrire
    env.storage.setItem('liquid_b', true);
    env.storage.setItem('other', 'x');
    env.storage.removeItem('liquid_a');
    env.storage.removeItem('liquid_missing');
    await flush();
    env.storage.setItem('liquid_b', 'false');
    await flush();
    assert.deepEqual(env.calls, [
        ['ui_settings_write', { changes: { liquid_b: 'true', liquid_a: null } }],
        ['ui_settings_write', { changes: { liquid_b: 'false' } }],
    ]);
    assert.equal(env.storage.getItem('liquid_b'), 'false');
});

test('other storages are not synced', async () => {
    const env = createEnvironment();
    installSettingsStore({ ...env, snapshot: { initialized: true, values: {} } });
    env.session.setItem('liquid_x', '1');
    await flush();
    assert.deepEqual(env.calls, []);
});

test('nothing is installed outside Tauri', () => {
    const env = createEnvironment();
    assert.equal(installSettingsStore({ ...env, snapshot: undefined }), false);
    assert.equal(installSettingsStore({ ...env, invoke: undefined, snapshot: { initialized: true, values: {} } }), false);
});
