import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleArtwork, moduleArtworkId, renderModuleArtwork } from '../../src/shared/module-art.js';
import { sanitizeMenus, menuEntry } from '../../src/shared/menu-config.js';

test('saved screenshot shortcuts receive their illustration without rewriting command, name or order', () => {
    const menus = sanitizeMenus({ contextVersion: 1, replayVersion: 1, context: [
        { id: 'replay' },
        { id: 'custom-capture', name: 'Capture d’écran', cmd: 'ms-screenclip:', icon: 'ph-app-window' },
        { id: 'settings' },
    ] });
    const before = structuredClone(menus);
    const entry = menuEntry(menus.context[1]);
    assert.equal(moduleArtworkId(entry.id, entry.cmd), 'snipping');
    assert.match(renderModuleArtwork(entry.id, entry.cmd), /neutral\/snipping\.png/);
    assert.deepEqual(menus, before);
});

test('Nolys settings and Windows settings use distinct artwork accents with a shared neutral shape', () => {
    const nolys = moduleArtwork('settings');
    const windows = moduleArtwork('custom-windows', ' ms-settings: ');
    assert.equal(nolys.src, windows.src);
    assert.notEqual(nolys.color, windows.color);
    assert.equal(moduleArtworkId(null, 'liquid:music-search'), 'music-search');
});

test('personal icons remain the fallback and untrusted names or commands cannot become image URLs', () => {
    for (const id of ['__proto__', 'constructor', '<img onerror=alert(1)>', 'custom-private']) {
        assert.equal(renderModuleArtwork(id, 'https://example.com/private'), '');
    }
    assert.equal(moduleArtworkId(null, null), null);
    assert.equal(moduleArtworkId('custom-terminal', ' CMD.EXE '), 'terminal');
});
