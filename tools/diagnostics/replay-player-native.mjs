import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { nativeSession, runtime, workspace } from './native-session.mjs';

const session = await nativeSession(process.argv[2] || path.join(runtime, 'nolys-diagnostic.exe'), { seed: data => {
    const clip = path.join(data, 'clip-synthetique.mp4');
    execFileSync(path.join(workspace, 'src-tauri/resources/replay/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip], { windowsHide: true });
    fs.writeFileSync(path.join(data, 'replay-config.json'), JSON.stringify({ enginePath: path.join(data, 'no-capture.exe'), destination: data, systemAudio: false, microphone: false }));
    fs.writeFileSync(path.join(data, 'replay-clips.json'), JSON.stringify([{ id: 'diagnostic', name: 'Clip synthétique.mp4', path: clip, kind: 'imported', createdAt: 0, seconds: 3, bytes: fs.statSync(clip).size }]));
} });
const checks = [];
try {
    await session.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await session.evaluate(async () => {
        const invoke = window.__TAURI__.core.invoke;
        await invoke('set_layout_edit_mode', { enabled: true });
        while (!window.island._layoutEditMode) await new Promise(requestAnimationFrame);
        await invoke('set_layout_edit_mode', { enabled: false });
        while (window.island._layoutEditMode) await new Promise(requestAnimationFrame);
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { this.muted = true; return play.call(this); };
        const island = window.island;
        island.openReplay();
        const until = performance.now() + 15000;
        while (!island._replayHost?.shadowRoot?.querySelector('[data-tab="clips"]') || island._transitionInProgress) {
            if (performance.now() > until) throw Error('Ouverture Replay trop lente.');
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        const root = island._replayHost.shadowRoot;
        root.querySelector('[data-tab="clips"]').click();
        root.querySelector('[data-action="play"]').click();
        while (root.querySelector('video')?.readyState < 2 || !root.querySelector('video')) {
            if (performance.now() > until) throw Error('Lecture du clip synthétique indisponible.');
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        root.querySelector('video').pause();
    });
    for (const scale of [.65, 1, 1.5]) {
        await session.evaluate(async scale => {
            const invoke = window.__TAURI__.core.invoke;
            const { display } = await invoke('get_layout_state');
            await invoke('set_layout_config', { layout: { scale, x: display.x + (display.width - 1080 * scale) / 2, y: display.y + 20 - 192 * scale } });
            await new Promise(resolve => setTimeout(resolve, 800));
        }, scale);
        for (const fraction of [.25, .75]) {
            const rect = await session.evaluate(() => window.island._replayHost.shadowRoot.querySelector('.replay-video-seek').getBoundingClientRect().toJSON());
            const coordinates = { x: rect.x + rect.width * fraction, y: rect.y + rect.height / 2 };
            await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...coordinates });
            await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...coordinates });
            const result = await session.evaluate(async () => {
                const root = window.island._replayHost.shadowRoot, video = root.querySelector('video');
                const until = performance.now() + 3000;
                while (video.seeking) { if (performance.now() > until) throw Error('Recherche bloquée.'); await new Promise(requestAnimationFrame); }
                const seek = root.querySelector('.replay-video-seek'), controls = root.querySelector('.replay-video-controls').getBoundingClientRect(), bounds = video.getBoundingClientRect();
                return { fraction: video.currentTime / video.duration, controls: video.controls, inside: controls.top >= bounds.top && controls.bottom <= bounds.bottom + 1,
                    count: root.querySelectorAll('.replay-video-seek').length, label: seek.getAttribute('aria-valuetext') };
            });
            assert.ok(Math.abs(result.fraction - fraction) < .04, JSON.stringify({ scale, fraction, result }));
            assert.ok(result.inside && !result.controls && result.count === 1);
            checks.push({ scale, requested: fraction, ...result });
        }
        await session.evaluate(() => window.island._replayHost.shadowRoot.querySelector('.replay-video-seek').focus());
        await session.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        await session.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
        assert.ok(await session.evaluate(() => window.island._replayHost.shadowRoot.querySelector('video').currentTime < .1));
    }
    const beforeFullscreen = await session.evaluate(() => window.island.el.getBoundingClientRect().toJSON());
    const fullscreenRequest = await session.call('Runtime.evaluate', { expression: "window.island._replayHost.shadowRoot.querySelector('.replay-player').requestFullscreen()", userGesture: true, awaitPromise: true });
    if (fullscreenRequest.error || fullscreenRequest.result?.exceptionDetails) throw Error(JSON.stringify(fullscreenRequest));
    const full = await session.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        const root = window.island._replayHost.shadowRoot, controls = root.querySelector('.replay-video-controls').getBoundingClientRect();
        return { active: Boolean(document.fullscreenElement), enabled: document.fullscreenEnabled, focus: document.hasFocus(), controls: controls.toJSON(), width: innerWidth, height: innerHeight };
    });
    assert.ok(full.active && full.controls.left >= -1 && full.controls.right <= full.width + 1 && full.controls.bottom <= full.height + 1, JSON.stringify(full));
    await session.evaluate(async () => { await document.exitFullscreen(); await new Promise(resolve => setTimeout(resolve, 800)); });
    const afterFullscreen = await session.evaluate(() => window.island.el.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(beforeFullscreen.x - afterFullscreen.x) < 1 && Math.abs(beforeFullscreen.y - afterFullscreen.y) < 1);
    const screenshot = await session.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(session.data, 'clip-player.png'), Buffer.from(screenshot.result.data, 'base64'));
    fs.writeFileSync(path.join(session.data, 'clip-player.json'), JSON.stringify({ checks, fullscreen: full, beforeFullscreen, afterFullscreen, source: 'FFmpeg testsrc2, sans audio, aucune capture du bureau' }, null, 2));
    console.log(JSON.stringify({ status: 'passed', checks: checks.length, maxFractionError: Math.max(...checks.map(c => Math.abs(c.fraction - c.requested))), data: session.data }));
} finally { await session.close(); }
