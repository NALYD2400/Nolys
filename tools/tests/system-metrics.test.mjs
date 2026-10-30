import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentLabel, systemMetrics } from '../../src/shared/system-metrics.js';
import { saveMicProfile, micProfilePatch, validMicProfiles, findMicProfile } from '../../src/shared/mic-profiles.js';

test('metrics preserve zero, reject invalid percentages and never turn missing disk values into capacity', () => {
    assert.deepEqual(systemMetrics({ cpu: 0, ram: 100, diskFree: 0, diskTotal: 100 }), { cpu: 0, ram: 100, diskFree: 0, diskTotal: 100 });
    for (const bad of [null, NaN, Infinity, -1, 101, '12']) assert.equal(percentLabel(bad), '—');
    assert.equal(percentLabel(0), '0%');
    assert.deepEqual(systemMetrics({ cpu: null, ram: '45', diskFree: 100, diskTotal: 50 }), { cpu: null, ram: null, diskFree: null, diskTotal: null });
    assert.equal(systemMetrics({ diskFree: null, diskTotal: 100 }).diskFree, null);
});

const config = { inputId: 'micro', outputId: 'casque', volume: 60, balance: 0, gateThreshold: -50,
    latency: 'normal', denoise: true, gateEnabled: false, highPass: true, enabled: true };

test('device profiles isolate microphone/output pairs and never restore enabled state', () => {
    let value = saveMicProfile({ version: 1, profiles: [] }, config);
    value = saveMicProfile(value, { ...config, outputId: 'autre', volume: 40 });
    assert.equal(value.profiles.length, 2);
    assert.equal(findMicProfile(value, 'micro', 'casque').settings.volume, 60);
    assert.equal(findMicProfile(value, 'micro', 'autre').settings.volume, 40);
    assert.equal(findMicProfile(value, 'inconnu', 'casque'), undefined);
    value = saveMicProfile(value, { ...config, volume: 80 });
    assert.equal(value.profiles.length, 2);
    const profile = findMicProfile(value, 'micro', 'casque');
    assert.equal(Object.hasOwn(profile.settings, 'enabled'), false);
    profile.settings.enabled = true;
    assert.equal(micProfilePatch(profile).enabled, false);
    assert.equal(micProfilePatch(profile).volume, 80);
});

test('profile validation rejects corrupt data and invalid processing values', () => {
    for (const value of [null, [], { version: 2, profiles: [] }, { version: 1, profiles: [null] }]) assert.equal(validMicProfiles(value), false);
    assert.equal(saveMicProfile({ version: 1, profiles: [] }, { ...config, volume: 201 }), null);
    assert.equal(saveMicProfile({ version: 1, profiles: [] }, { ...config, gateEnabled: 'true' }), null);
    const value = saveMicProfile({ version: 1, profiles: [] }, config);
    value.profiles.push(value.profiles[0]);
    assert.equal(validMicProfiles(value), false);
});
