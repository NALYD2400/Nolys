import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateConfigEvents, stampConfig, isCurrentConfigEvent } from '../../src/shared/config-sequence.js';

test('une restauration invalide un écho déjà reçu ou retardé, puis accepte le nouvel état', () => {
    const imported = stampConfig({ motion: 'sober' });
    assert.equal(isCurrentConfigEvent(imported), true);
    invalidateConfigEvents();
    assert.equal(isCurrentConfigEvent(imported), false);
    const restored = stampConfig({ motion: 'system' });
    assert.equal(isCurrentConfigEvent(restored), true);
    assert.equal(isCurrentConfigEvent(imported), false);
    assert.equal(isCurrentConfigEvent({ motion: 'fluid' }), true);
    assert.equal(isCurrentConfigEvent({ _uiSequence: { source: 'another-window', revision: 1 } }), true);
});
