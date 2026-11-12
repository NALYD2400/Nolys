// Mesure locale reproductible : aucune capture ni commande média vers un autre lecteur.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { nativeSession, runtime, workspace, sleep } from './native-session.mjs';

const executable = process.argv[2] || path.join(runtime, 'nolys-diagnostic.exe');
const soakSeconds = Number(process.argv[3] ?? 3600);
if (!Number.isInteger(soakSeconds) || soakSeconds < 60 || soakSeconds > 7200) throw Error('Observation : 60 à 7200 secondes.');
const session = await nativeSession(executable, { seed: data => {
    const samples = 44100 * 30, audio = Buffer.alloc(44 + samples * 2);
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(88200, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
    audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
    const track = path.join(data, 'diagnostic-silence.wav'); fs.writeFileSync(track, audio);
    const cover = path.join(data, 'diagnostic-cover.png'); fs.copyFileSync(path.join(workspace, 'src/public/assets/app-logo.png'), cover);
    fs.writeFileSync(path.join(data, 'music-library.json'), JSON.stringify({ tracks: [{
        id: 'diagnostic', path: track, title: 'Diagnostic local', artist: 'Nolys', album: '', duration: 30000,
        cover, favorite: false, addedAt: 0, missing: false,
    }], playlists: [] }));
    fs.writeFileSync(path.join(data, 'replay-config.json'), JSON.stringify({ enginePath: path.join(data, 'no-capture-engine.exe'), systemAudio: false, microphone: false }));
} });
const rows = [], stages = [], heap = [], previous = new Map();
const metricsPath = path.join(session.data, 'process-metrics.ndjson');
let collector, pending = '', lastTime, collectorError = '';
const logicalProcessors = os.cpus().length;
const checkpoint = extra => fs.writeFileSync(path.join(session.data, 'progress.json'), JSON.stringify({
    profilePid: process.pid, nativePid: session.child.pid, updated: Date.now(), executable, manifest: session.manifest,
    logicalProcessors, stages, sampleCount: rows.length, heap, ...extra,
}, null, 2));
const record = line => {
    if (!line.trim()) return;
    const sample = JSON.parse(line.replace(/^\uFEFF/, ''));
    let deltaCpu = 0;
    for (const p of sample.processes) {
        const key = `${p.id}:${p.started}`, before = previous.get(key);
        if (before !== undefined) deltaCpu += Math.max(0, p.cpuSeconds - before);
        previous.set(key, p.cpuSeconds);
    }
    const seconds = lastTime ? (sample.time - lastTime) / 1000 : 0; lastTime = sample.time;
    const row = { ...sample, stage: stages.at(-1)?.name || 'warmup',
        cpuOneCorePercent: seconds > 0 ? 100 * deltaCpu / seconds : null,
        privateMiB: sample.processes.reduce((sum, p) => sum + p.privateBytes, 0) / 1048576,
        workingSetMiB: sample.processes.reduce((sum, p) => sum + p.workingSetBytes, 0) / 1048576 };
    row.cpuMachinePercent = row.cpuOneCorePercent === null ? null : row.cpuOneCorePercent / logicalProcessors;
    rows.push(row); fs.appendFileSync(metricsPath, `${JSON.stringify(row)}\n`);
};
const stage = async (name, seconds, setup) => {
    await session.evaluate(setup);
    await sleep(5000); // Les transitions et chargements initiaux sont mesurés hors de la phase stable.
    const entry = { name, started: Date.now() }; stages.push(entry);
    console.log(JSON.stringify({ stage: name, seconds, data: session.data, pid: session.child.pid }));
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
        if (collectorError || collector.exitCode !== null || rows.length && Date.now() - rows.at(-1).time > 15000) {
            checkpoint({ phase: name, invalid: true, collectorError, collectorExitCode: collector.exitCode });
            throw Error(`Collecte arrêtée ou périmée : ${collectorError || collector.exitCode}`);
        }
        const metrics = await session.call('Performance.getMetrics');
        heap.push({ time: Date.now(), stage: name, ...Object.fromEntries(metrics.result.metrics.filter(m => ['JSHeapUsedSize', 'Nodes', 'Documents'].includes(m.name)).map(m => [m.name, m.value])) });
        const ui = await session.evaluate(() => ({ mode: window.island.mode, expanded: window.island.isExpanded,
            localPlaying: window.island.localPlayer.snapshot.isPlaying, muted: window.island.localPlayer.audio.muted,
            economy: window.island.isEcoMode }));
        const expectedExpanded = ['music-expanded', 'settings', 'control'].includes(name);
        const expectedMode = name === 'settings' ? 'settings' : name === 'control' ? 'control' : 'music';
        if (ui.expanded !== expectedExpanded || ui.mode !== expectedMode || (name !== 'idle' && name !== 'idle-after-soak' && !ui.localPlaying)) {
            checkpoint({ phase: name, invalid: true, ui });
            throw Error(`État inattendu pendant ${name} : ${JSON.stringify(ui)}`);
        }
        checkpoint({ phase: name, ui });
        if (session.child.exitCode !== null) throw Error('Processus terminé pendant la mesure.');
        await sleep(Math.min(5000, Math.max(1, until - Date.now())));
    }
    entry.ended = Date.now();
    checkpoint({ phase: name, phaseCompleted: true });
};
try {
    await session.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await session.evaluate(async () => {
        // La fenêtre visible du diagnostic ne doit pas pouvoir être ouverte ou
        // refermée par un clic manuel pendant une phase de mesure.
        for (const event of ['pointerdown', 'mousedown', 'click', 'contextmenu', 'keydown', 'wheel']) {
            window.addEventListener(event, e => { e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, passive: false });
        }
        const island = window.island, p = island.localPlayer, raw = p.invoke;
        p.invoke = async (command, args) => {
            if (command === 'media_control') throw Error('Commandes média externes interdites dans ce diagnostic.');
            return raw(command, args);
        };
        if (p.invoke === raw) throw Error('Isolation des commandes média impossible.');
        const update = island.updateMediaState.bind(island);
        island.updateMediaState = async () => {
            if (p.snapshot.isPlaying) return update();
            // Le pont Tauri est gelé : contrôler la présentation au niveau du lecteur,
            // tout en exécutant la détection native pour inclure son coût dans les mesures.
            await window.__TAURI__.core.invoke('get_media_info');
            island.updateMusic({ title: '', artist: '', cover: '', isPlaying: false, progress: 0, duration: 0, trackKey: 'diagnostic:idle' });
        };
        p.audio.muted = true; p.audio.volume = 0; p.audio.loop = true;
        await p.reload(); window.island.returnToMusicIdle();
    });
    collector = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'tools/diagnostics/process-metrics.ps1'), '-DiagnosticRootProcessId', String(session.child.pid)], { windowsHide: true });
    collector.stdout.setEncoding('utf8'); collector.stderr.setEncoding('utf8');
    collector.stdout.on('data', chunk => { pending += chunk; let cut; while ((cut = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, cut); pending = pending.slice(cut + 1); try { record(line); } catch (error) { collectorError ||= String(error); } } });
    collector.stderr.on('data', chunk => { collectorError += chunk; fs.appendFileSync(path.join(session.data, 'collector-error.log'), chunk); });
    collector.on('error', error => { collectorError += String(error); });
    await stage('idle', 45, () => { window.island.localPlayer.stop(); window.island.returnToMusicIdle(); });
    await stage('music-compact', 45, async () => { const p = window.island.localPlayer; p.active = true; await p.play('diagnostic'); window.island.returnToMusicIdle(); if (!p.snapshot.isPlaying) throw Error('Lecture locale inactive.'); });
    await stage('music-expanded', 45, () => window.island.openExpandedMode('music'));
    await stage('settings', 45, () => window.island.openSettings('general'));
    await stage('control', 45, () => window.island.openExpandedMode('control'));
    await stage('economy-music', 45, () => { localStorage.setItem('liquid_eco_mode', 'true'); window.island.syncEcoMode(); window.island.returnToMusicIdle(); });
    await stage('soak-music', soakSeconds, () => { localStorage.setItem('liquid_eco_mode', 'false'); window.island.syncEcoMode(); window.island.returnToMusicIdle(); });
    await stage('idle-after-soak', 45, () => { window.island.localPlayer.stop(); window.island.returnToMusicIdle(); });
    if (collectorError) throw Error(`Collecte incomplète : ${collectorError}`);
    const average = values => values.reduce((sum, v) => sum + v, 0) / values.length;
    const summary = stages.map(s => {
        const samples = rows.filter(r => r.time >= s.started + 5000 && r.time <= s.ended && r.cpuOneCorePercent !== null);
        if (samples.length < 3) throw Error(`Trop peu de mesures : ${s.name}`);
        const gpu = samples.filter(r => r.gpuAvailable).map(r => r.gpu3dEnginePercentSum);
        return { ...s, count: samples.length, averageCpuOneCorePercent: average(samples.map(r => r.cpuOneCorePercent)),
            averageCpuMachinePercent: average(samples.map(r => r.cpuMachinePercent)), averagePrivateMiB: average(samples.map(r => r.privateMiB)),
            privateStartMiB: samples[0].privateMiB, privateEndMiB: samples.at(-1).privateMiB, peakPrivateMiB: Math.max(...samples.map(r => r.privateMiB)),
            processCount: samples.at(-1).processes.length, averageGpu3dEnginePercentSum: gpu.length ? average(gpu) : null };
    });
    fs.writeFileSync(path.join(session.data, 'summary.json'), JSON.stringify({ executable, manifest: session.manifest, logicalProcessors, stages: summary,
        limitations: ['Binaire debug embarqué, pas une mesure de la version publiée.', 'WAV silencieux local, volume nul ; les niveaux audio système des autres applications ne sont pas contrôlés.', 'Détection média native exécutée ; données présentées contrôlées.', 'Somme des mémoires privées ; working set somme aussi des pages partagées.', 'GPU : somme des moteurs 3D des processus possédés, sans composition DWM.', 'Premier échantillon de chaque nouveau processus sans delta CPU ; transitions exclues des phases stables.', 'Autres applications du bureau non contrôlées.'], heap }, null, 2));
    console.log(JSON.stringify({ status: 'passed', data: session.data, stages: summary }));
} catch (error) {
    checkpoint({ invalid: true, error: String(error), collectorError, collectorExitCode: collector?.exitCode });
    fs.writeFileSync(path.join(session.data, 'failure.json'), JSON.stringify({ error: String(error), collectorError, collectorExitCode: collector?.exitCode }, null, 2));
    throw error;
} finally {
    collector?.kill();
    await session.close();
}
