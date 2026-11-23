import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { moduleArtwork, moduleArtworkId, renderModuleArtwork } from '../../src/shared/module-art.js';
import { sanitizeMenus, menuEntry, SHORTCUT_ICONS } from '../../src/shared/menu-config.js';

test('saved screenshot shortcuts receive their illustration without rewriting command, name or order', () => {
    const menus = sanitizeMenus({ contextVersion: 1, replayVersion: 1, context: [
        { id: 'replay' },
        { id: 'custom-capture', name: 'Capture d’écran', cmd: 'ms-screenclip:', icon: 'ph-app-window' },
        { id: 'settings' },
    ] });
    const before = structuredClone(menus);
    const entry = menuEntry(menus.context[1]);
    assert.equal(moduleArtworkId(entry.id, entry.cmd), 'snipping');
    assert.match(renderModuleArtwork(entry.id, entry.cmd), /glass-outline\/snipping\.png/);
    assert.deepEqual(menus, before);
});

test('Nolys settings and Windows settings share a neutral symbol', () => {
    const nolys = moduleArtwork('settings');
    const windows = moduleArtwork('custom-windows', ' ms-settings: ');
    assert.equal(nolys.icon, windows.icon);
    assert.equal(nolys.src, windows.src);
    assert.equal(moduleArtworkId(null, 'liquid:music-search'), 'music-search');
});

test('each generated module image exists locally', () => {
    for (const id of ['files', 'replay', 'control', 'music', 'music-history', 'timer', 'mixer', 'mic', 'library', 'settings', 'menu', 'music-search', 'taskmgr', 'calc', 'terminal', 'notepad', 'paint', 'snipping', 'layout', 'exit', 'customize-menu', 'link', 'globe', 'app', 'star', 'game', 'code']) {
        const art = moduleArtwork(id);
        assert.ok(art.src, id);
        assert.ok(existsSync(new URL(`../../src/public${art.src}`, import.meta.url)), id);
    }
});

test('personal shortcuts use their selected icon without trusting arbitrary icon strings', () => {
    for (const icon of SHORTCUT_ICONS) {
        const art = moduleArtwork('custom-user', 'https://example.com', icon);
        assert.ok(art?.src, icon);
        assert.ok(existsSync(new URL(`../../src/public${art.src}`, import.meta.url)), icon);
        assert.match(renderModuleArtwork('custom-user', 'https://example.com', icon), /<img/);
    }
    assert.equal(moduleArtwork('custom-user', 'https://example.com', '../../secret'), null);
    assert.match(moduleArtwork('custom-user', 'explorer.exe', 'ph-globe', true).src, /globe\.png$/);
    assert.match(moduleArtwork('custom-user', 'explorer.exe', 'ph-app-window').src, /files\.png$/);
    const menus = sanitizeMenus({ modules: [{ id: 'custom-user', name: 'Lien', cmd: 'explorer.exe', icon: 'ph-globe', preferIcon: true }] });
    assert.equal(menus.modules[0].preferIcon, true);
});

test('personal icons remain the fallback and untrusted names or commands cannot become image URLs', () => {
    for (const id of ['__proto__', 'constructor', '<img onerror=alert(1)>', 'custom-private']) {
        assert.equal(renderModuleArtwork(id, 'https://example.com/private'), '');
    }
    assert.equal(moduleArtworkId(null, null), null);
    assert.equal(moduleArtworkId('custom-terminal', ' CMD.EXE '), 'terminal');
});
