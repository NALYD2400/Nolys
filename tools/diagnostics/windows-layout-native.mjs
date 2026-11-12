import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { nativeSession, runtime, workspace } from './native-session.mjs';

const session = await nativeSession(process.argv[2] || path.join(runtime, 'nolys-diagnostic.exe'), { seed: data => {
    fs.writeFileSync(path.join(data, 'replay-config.json'), JSON.stringify({ enginePath: path.join(data, 'no-capture.exe'), systemAudio: false, microphone: false }));
} });
const checks = [];
try {
    await session.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    const displays = await session.evaluate(async () => {
        const core = window.__TAURI__.core, raw = core.invoke;
        core.invoke = async (command, args) => {
            const value = await raw(command, args);
            return command === 'get_media_info' ? { title: '', artist: '', isPlaying: false, cover: '' } : value;
        };
        window.island.returnToMusicIdle();
        return core.invoke('get_displays');
    });
    assert.ok(displays.length > 0);
    for (const display of displays) {
        for (const scale of [.65, 1, 1.5]) {
            for (const corner of ['top-left', 'bottom-right']) {
                const geometry = await session.evaluate(async ({ display, scale, corner }) => {
                    const invoke = window.__TAURI__.core.invoke, island = window.island;
                    island.returnToMusicIdle();
                    const a = display.workArea;
                    await invoke('set_layout_config', { layout: { displayId: display.id, scale,
                        x: corner === 'top-left' ? a.x - 1e6 : a.x + 1e6,
                        y: corner === 'top-left' ? a.y - 1e6 : a.y + 1e6 } });
                    await new Promise(resolve => setTimeout(resolve, 250));
                    const state = await invoke('get_layout_state');
                    const compact = island.el.getBoundingClientRect().toJSON();
                    const views = [];
                    for (const mode of ['music', 'menu', 'settings']) {
                        if (mode === 'settings') island.openSettings('general'); else island.openExpandedMode(mode);
                        const until = performance.now() + 10000;
                        while (island._transitionInProgress || mode === 'settings' && !island._settingsHost?.shadowRoot?.querySelector('h1')) {
                            if (performance.now() > until) throw Error(`Vue ${mode} indisponible.`);
                            await new Promise(resolve => setTimeout(resolve, 30));
                        }
                        await Promise.allSettled(island.el.getAnimations().map(a => a.finished));
                        await new Promise(resolve => setTimeout(resolve, 150));
                        views.push({ mode, rect: island.el.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight });
                    }
                    island.returnToMusicIdle(); await new Promise(resolve => setTimeout(resolve, 800));
                    const restored = island.el.getBoundingClientRect().toJSON();
                    return { scale, corner, compact, restored, views, state, pixelRatio: devicePixelRatio };
                }, { display, scale, corner });
                const bounds = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'tools/diagnostics/window-bounds.ps1'), '-DiagnosticRootProcessId', String(session.child.pid)], { windowsHide: true, encoding: 'utf8' }).replace(/^\uFEFF/, ''));
                geometry.nativeBounds = bounds;
                assert.ok(Math.abs(bounds.x - display.workArea.x * display.scaleFactor) < 2);
                assert.ok(Math.abs(bounds.y - display.workArea.y * display.scaleFactor) < 2);
                assert.ok(Math.abs(bounds.width - display.workArea.width * display.scaleFactor) < 2);
                assert.ok(Math.abs(bounds.height - display.workArea.height * display.scaleFactor) < 2);
                assert.ok(Math.abs(geometry.compact.x - geometry.restored.x) < 1 && Math.abs(geometry.compact.y - geometry.restored.y) < 1, `Retour compact : ${JSON.stringify(geometry)}`);
                for (const { mode, rect, width, height } of geometry.views) {
                    assert.ok(rect.left >= 6 && rect.top >= 6 && rect.right <= width - 6 && rect.bottom <= height - 6, `${mode} coupé : ${JSON.stringify({ rect, width, height })}`);
                }
                checks.push({ display: display.id, ...geometry });
            }
        }
    }
    const fallback = await session.evaluate(async () => {
        await window.__TAURI__.core.invoke('set_layout_config', { layout: { displayId: '__diagnostic_disconnected__', x: 1e6, y: 1e6, scale: 1 } });
        await new Promise(resolve => setTimeout(resolve, 200));
        return window.__TAURI__.core.invoke('get_layout_state');
    });
    assert.notEqual(fallback.layout.displayId, '__diagnostic_disconnected__');
    assert.ok(fallback.layout.x + 540 <= fallback.display.x + fallback.display.width - 59);
    assert.ok(fallback.layout.y + 192 <= fallback.display.y + fallback.display.height - 39);
    fs.writeFileSync(path.join(session.data, 'windows-layout.json'), JSON.stringify({ displays, checks, fallback,
        limitations: ['Écran absent simulé par identifiant ; aucun moniteur physique débranché.', 'Aucune modification de résolution/DPI Windows ni mise en veille du poste.'] }, null, 2));
    console.log(JSON.stringify({ status: 'passed', displayCount: displays.length, placements: checks.length, views: checks.length * 3, scales: displays.map(d => d.scaleFactor), data: session.data }));
} finally { await session.close(); }
