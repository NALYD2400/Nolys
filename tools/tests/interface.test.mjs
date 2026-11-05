import test from 'node:test';
import assert from 'node:assert/strict';
import { coverAccent, coverLightness, coverShade } from '../../src/island/dynamic-island/helpers/cover-readability.js';
import { compactActivity } from '../../src/island/dynamic-island/helpers/compact-activity.js';

test('bright cover details are protected even when the average cover is dark', () => {
    const dark = new Uint8ClampedArray(400);
    for (let i = 3; i < dark.length; i += 4) dark[i] = 255;
    assert.equal(coverShade(coverLightness(dark), .9), 0);
    dark.set([255, 255, 255, 255], 0);
    assert.ok(coverShade(coverLightness(dark), .9) > .7);
});

test('transparent pixels and disabled cover backgrounds do not darken the player', () => {
    assert.equal(coverLightness(new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255])), 0);
    assert.equal(coverShade(1, 0), 0);
    assert.ok(coverShade(1, .9) > coverShade(1, .2));
    assert.ok(Number.isFinite(coverShade(undefined, .55)));
});

test('dark cover accents remain visible and already bright colors retain their identity', () => {
    const bright = { r: 255, g: 255, b: 255 };
    assert.deepEqual(coverAccent(bright), bright);
    const dark = coverAccent({ r: 0, g: 0, b: 0 });
    assert.ok(dark.r >= 130 && dark.r === dark.g && dark.g === dark.b);
    const blue = coverAccent({ r: 0, g: 0, b: 80 });
    assert.ok(blue.b > blue.r && blue.r === blue.g);
});

test('without music a timer in its last minute takes priority over recording and retains its identity', () => {
    const activity = compactActivity({ name: 'Thé', mode: 'countdown', value: 45 }, { recording: true, recordingSeconds: 10 }, false);
    assert.equal(activity.kind, 'timer');
    assert.equal(activity.label, 'Thé');
    assert.equal(activity.value, '00:45');
    assert.equal(activity.urgent, true);
});

test('music leaves both the stopwatch and countdowns in their satellite', () => {
    for (const timer of [
        { mode: 'stopwatch', name: 'Chrono', value: 872 },
        { mode: 'countdown', name: 'Cuisine', value: 300 },
        { mode: 'countdown', name: 'Thé', value: 45 },
    ]) {
        assert.equal(compactActivity(timer, { phase: 'idle' }, true), null);
        assert.equal(compactActivity(timer, { phase: 'idle' }, false).kind, 'timer');
    }
});

test('recording takes priority over a distant timer and exposes the actual duration', () => {
    const activity = compactActivity({ name: 'Cuisine', mode: 'countdown', value: 300 }, { recording: true, recordingSeconds: 125 }, true);
    assert.equal(activity.kind, 'recording');
    assert.equal(activity.value, '02:05');
    assert.equal(activity.mode, 'replay');
});

test('a background replay leaves music visible and remains visible without music', () => {
    const capture = { phase: 'buffering', recording: false };
    assert.equal(compactActivity(null, capture, true), null);
    assert.equal(compactActivity(null, capture, false).kind, 'replay');
    assert.equal(compactActivity(null, { phase: 'idle' }, false), null);
});
