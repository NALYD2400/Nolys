// Diagnostic local : ressources embarquées, données et profil WebView propres à chaque session.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { HOTKEY_ACTIONS } from '../../src/shared/hotkeys.js';

export const workspace = fileURLToPath(new URL('../../', import.meta.url));
export const runtime = path.join(workspace, '.impeccable/runtime');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function nativeSession(executable, { settings = {}, seed = () => {} } = {}) {
    const exe = fs.realpathSync(executable), relative = path.relative(fs.realpathSync(runtime), exe);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Le diagnostic exige un binaire local dans .impeccable/runtime.');
    const manifest = JSON.parse(fs.readFileSync(`${exe}.json`, 'utf8').replace(/^\uFEFF/, ''));
    const hash = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    if (manifest.profile !== 'debug' || !manifest.isolatedData || !manifest.customProtocol || manifest.sha256 !== hash) {
        throw Error('Reconstruire le binaire avec tools/diagnostics/build-native.ps1 : isolation non prouvée.');
    }
    const data = fs.mkdtempSync(path.join(runtime, 'diagnostic-'));
    fs.writeFileSync(path.join(data, 'ui-settings.json'), JSON.stringify({ version: 1, values: {
        liquid_tray_hint_shown: 'true', liquid_sound_effects_enabled: 'false', liquid_online_covers: 'false',
        liquid_game_detection_enabled: 'false', liquid_offline_mode: 'true',
        liquid_hotkeys: JSON.stringify(Object.fromEntries(HOTKEY_ACTIONS.map(({ id }) => [id, { enabled: false }]))),
        ...settings,
    } }));
    await seed(data);
    const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const log = fs.openSync(path.join(data, 'process.log'), 'a');
    const child = spawn(exe, [], { windowsHide: true, stdio: ['ignore', log, log], env: {
        ...process.env, NOLYS_DEV_DATA_DIR: data, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    } });
    let socket, sequence = 0, closed = false;
    const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP : délai dépassé (${method})`)); }, 30000);
        pending.set(id, { resolve: message => { clearTimeout(timer); resolve(message); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (fn, arg) => {
        const result = await call('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
        if (result.error || result.result?.exceptionDetails) throw Error(JSON.stringify(result.error || result.result.exceptionDetails));
        return result.result.result.value;
    };
    const close = async () => {
        if (closed) return; closed = true;
        if (socket?.readyState === WebSocket.OPEN) {
            try { await evaluate(() => window.__TAURI__.core.invoke('exit_app')); } catch { /* échec de démarrage ou fermeture en cours */ }
            socket.close();
        }
        if (child.exitCode === null) {
            await Promise.race([once(child, 'exit'), sleep(2500)]);
            if (child.exitCode === null) child.kill(); // Uniquement le processus créé ici.
        }
        for (const request of pending.values()) request.reject(Error('Session fermée'));
        pending.clear(); fs.closeSync(log);
    };
    try {
        let spawnError; child.on('error', error => { spawnError = error; });
        let target;
        for (let i = 0; i < 120; i++) {
            if (spawnError) throw spawnError;
            if (child.exitCode !== null) throw Error(`Diagnostic terminé au démarrage : ${child.exitCode}`);
            try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.url.endsWith('/island/index.html')); } catch { /* CDP en cours de démarrage */ }
            if (target) break; await sleep(250);
        }
        if (!target) throw Error('WebView de diagnostic introuvable.');
        socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
        socket.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.resolve(message); pending.delete(message.id); };
        socket.onclose = () => { for (const request of pending.values()) request.reject(Error('WebView déconnectée')); pending.clear(); };
        await call('Page.enable'); await call('Performance.enable');
        const frame = await call('Page.getFrameTree');
        if (frame.result.frameTree.frame.url === 'about:blank') {
            await call('Page.stopLoading'); await call('Page.navigate', { url: target.url });
        }
        let ready = false;
        for (let i = 0; i < 100; i++) {
            // Le constructeur expose le lecteur avant le retour de get_layout_state.
            // Attendre aussi cette configuration évite de piloter un mode pendant l'initialisation.
            ready = await evaluate(() => document.readyState === 'complete' && Boolean(window.island?.localPlayer)
                && typeof window.island._layoutConfig?.displayId === 'string' && Boolean(window.island._windowViewport));
            if (ready) break; await sleep(100);
        }
        if (!ready) throw Error('Initialisation du frontend incomplète.');
        return { child, data, manifest, evaluate, call, close };
    } catch (error) { await close(); throw error; }
}
