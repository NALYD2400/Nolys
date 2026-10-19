import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeMenus, readMenus, visibleMenuEntries, moduleMenuSize, MAX_MENU_ITEMS } from '../../src/shared/menu-config.js';
import { loadSettings, saveSettings, toSnapshot, fromSnapshot } from '../../src/settings/state/storage.js';

const data = new Map();
globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
const custom = { id: 'custom-test', enabled: true, name: 'Dossier', cmd: 'C:\\Documents', icon: 'ph-folder' };

test('defaults keep existing modules, and corrupt data falls back without losing settings access', () => {
    assert.equal(sanitizeMenus().modules.length, 9);
    data.set('liquid_menus', '{invalid');
    assert.equal(readMenus().context.length, 11);
    assert.deepEqual(sanitizeMenus({ modules: [], context: [{ id: 'settings', enabled: false }] }).modules, [{ id: 'settings', enabled: true }]);
    assert.equal(sanitizeMenus({ context: [{ id: 'settings', enabled: false }] }).context[0].enabled, true);
    data.clear();
});

test('all modules appear in the context menu, including existing saved menus, without resetting hidden buttons', () => {
    const defaults = sanitizeMenus();
    const contextIds = new Set(defaults.context.map(entry => entry.id));
    assert.ok(defaults.modules.every(entry => contextIds.has(entry.id)));
    const migrated = sanitizeMenus({ context: ['music', 'control', 'mixer', 'mic', 'layout', 'settings', 'exit']
        .map(id => ({ id, enabled: id !== 'mic' })) });
    assert.ok(defaults.modules.every(entry => migrated.context.some(item => item.id === entry.id)));
    assert.equal(migrated.context.find(entry => entry.id === 'mic').enabled, false);
    assert.deepEqual(sanitizeMenus(migrated), migrated);
    migrated.context.find(entry => entry.id === 'files').enabled = false;
    assert.equal(sanitizeMenus(migrated).context.find(entry => entry.id === 'files').enabled, false);
});

test('sanitizing rejects duplicate actions, unknown actions and injected icons; preserves order and visibility', () => {
    const value = sanitizeMenus({ modules: [{ id: 'music', enabled: false }, { id: 'music' }, { id: 'exit' }, null, custom, { id: 'custom-unsafe', name: 'Lien', cmd: 'https://example.com', icon: 'x" onclick="alert(1)' }] });
    assert.deepEqual(value.modules.map(entry => entry.id), ['music', 'custom-test', 'custom-unsafe', 'settings']);
    assert.equal(value.modules[2].icon, 'ph-arrow-square-out');
    assert.deepEqual(visibleMenuEntries('modules', value).map(entry => entry.id), ['custom-test', 'custom-unsafe', 'settings']);
});

test('menus honor disabled modules without deleting their configured position', () => {
    const value = sanitizeMenus();
    const disabled = { getItem: key => key === 'liquid_music_enabled' ? 'false' : null };
    assert.equal(visibleMenuEntries('modules', value, disabled).length, 7);
    assert.equal(value.modules.length, 9);
});

test('adding a ninth module grows the capsule; many items and narrow windows remain bounded', () => {
    assert.ok(moduleMenuSize(9).height > moduleMenuSize(8).height);
    assert.equal(moduleMenuSize(9).columns, 4);
    assert.equal(moduleMenuSize(40).height, 496);
    assert.equal(moduleMenuSize(1).columns, 1);
    const small = moduleMenuSize(40, 210, 250);
    assert.ok(small.width <= 210 && small.height <= 250);
    assert.equal(small.columns, 2);
});

test('settings save, restart and profile export/import retain menus; old profiles preserve them', () => {
    data.clear();
    const settings = loadSettings();
    settings.menus = sanitizeMenus({ modules: [custom], context: [{ id: 'library' }], showMedia: false });
    const config = saveSettings(settings);
    assert.deepEqual(loadSettings().menus, config.menus);
    const snapshot = toSnapshot(settings);
    assert.deepEqual(fromSnapshot(loadSettings(), snapshot).menus, settings.menus);
    assert.deepEqual(fromSnapshot(settings, {}).menus, settings.menus);
    const bounded = sanitizeMenus({ modules: Array.from({ length: 80 }, (_, i) => ({ ...custom, id: `custom-${i}` })) });
    assert.ok(bounded.modules.length <= MAX_MENU_ITEMS + 1); // accès aux réglages toujours conservé
    data.clear();
});
