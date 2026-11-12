import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { nativeSession, runtime } from './native-session.mjs';

const executable = process.argv[2] || path.join(runtime, 'nolys-diagnostic.exe');
const session = await nativeSession(executable, { seed: data => {
    // Cet essai de géométrie n'ouvre ni le bureau ni un périphérique audio.
    fs.writeFileSync(path.join(data, 'replay-config.json'), JSON.stringify({
        enginePath: path.join(data, 'no-capture-engine.exe'), systemAudio: false, microphone: false,
    }));
} });
const checks = [];
try {
    // Géométrie et clavier seulement : laisser l'utilisateur travailler dans une autre
    // fenêtre sans que le repli normal à la perte de focus interrompe ce diagnostic.
    await session.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await session.evaluate(async () => {
        const invoke = window.__TAURI__.core.invoke;
        await invoke('set_layout_edit_mode', { enabled: true });
        while (!window.island._layoutEditMode) await new Promise(requestAnimationFrame);
        await invoke('set_layout_edit_mode', { enabled: false });
        while (window.island._layoutEditMode) await new Promise(requestAnimationFrame);
        window.island.openReplay();
        const until = performance.now() + 10000;
        while (!window.island._replayHost?.shadowRoot.querySelector('#replay-sourceId-trigger') || window.island._transitionInProgress) {
            if (performance.now() > until) throw Error('Replay ne s’ouvre pas.');
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    });
    for (const scale of [.65, 1, 1.25, 1.5]) {
        await session.evaluate(async scale => {
            const state = await window.__TAURI__.core.invoke('get_layout_state'), area = state.display;
            await window.__TAURI__.core.invoke('set_layout_config', { layout: {
                x: area.x + (area.width - 1080 * scale) / 2, y: area.y + 20 - 192 * scale, scale,
            } });
            const until = performance.now() + 5000;
            while (Math.abs((parseFloat(getComputedStyle(window.island.el).zoom) || 1) - scale) > .001) {
                if (performance.now() > until) throw Error('Échelle non appliquée.');
                await new Promise(resolve => setTimeout(resolve, 30));
            }
            const root = window.island._replayHost.shadowRoot;
            root.querySelector('[data-tab="settings"]').click();
            const advanced = root.querySelector('[data-settings-section="advanced"]');
            if (!advanced.open) advanced.querySelector('summary').click();
            await Promise.allSettled(window.island.el.getAnimations().filter(a => ['width', 'height'].includes(a.transitionProperty)).map(a => a.finished));
        }, scale);
        for (const key of ['height', 'fps', 'capture', 'encoder', 'codec', 'preset', 'outputDevice', 'inputDevice', 'audioKbps']) {
            const geometry = await session.evaluate(async key => {
                const root = window.island._replayHost.shadowRoot, trigger = root.querySelector(`#replay-${key}-trigger`);
                trigger.scrollIntoView({ block: 'center' }); await new Promise(requestAnimationFrame);
                trigger.click();
                trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, composed: true }));
                await new Promise(requestAnimationFrame);
                const menu = root.querySelector('.replay-select-menu'), m = menu.getBoundingClientRect();
                const a = trigger.getBoundingClientRect(), p = root.querySelector('.replay-panel').getBoundingClientRect();
                const selected = root.activeElement?.getBoundingClientRect();
                const result = { left: Math.abs(m.left - a.left), width: Math.abs(m.width - a.width),
                    inside: !menu.hidden && m.left >= p.left - 1 && m.right <= p.right + 1 && m.top >= p.top - 1 && m.bottom <= p.bottom + 1,
                    lastVisible: Boolean(selected && selected.top >= m.top - 1 && selected.bottom <= m.bottom + 1),
                    hidden: menu.hidden, disabled: trigger.disabled, anchor: a.toJSON(), menu: m.toJSON(), panel: p.toJSON(), mode: window.island.mode,
                    connected: trigger.isConnected, focus: document.hasFocus(), active: root.activeElement?.id || root.activeElement?.className || null };
                trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
                return result;
            }, key);
            assert.ok(geometry.inside && geometry.lastVisible && geometry.left < 2 && geometry.width < 2, JSON.stringify({ scale, key, geometry }));
            checks.push({ scale, key, ...geometry });
        }
    }
    fs.writeFileSync(path.join(session.data, 'replay-selects.json'), JSON.stringify({ checks }, null, 2));
    console.log(JSON.stringify({ status: 'passed', count: checks.length, maxAlignmentError: Math.max(...checks.map(c => c.left)), data: session.data }));
} finally { await session.close(); }
