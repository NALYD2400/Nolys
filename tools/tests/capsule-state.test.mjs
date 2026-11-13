import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsuleSnapshot, decide } from '../../src/shared/capsule-state.js';

const compact = capsuleSnapshot();
const music = capsuleSnapshot({ mode: 'music', expanded: true });
const collapsing = capsuleSnapshot({ mode: 'music', expanded: true, transitioning: true });
const placing = capsuleSnapshot({ placement: true });

test('ouvrir un module pendant le repli le laisse déplié à l’arrivée', () => {
    const decision = decide(collapsing, { type: 'open', mode: 'control', expand: true });
    assert.equal(decision.effect, 'defer');
    assert.equal(decision.reason, 'transition');
    assert.equal(decision.next.mode, 'control');
    assert.equal(decision.next.expanded, true);
});

test('le placement refuse d’ouvrir, de replier et de basculer', () => {
    for (const intent of [
        { type: 'open', mode: 'replay', expand: true },
        { type: 'collapse' },
        { type: 'toggle' },
        { type: 'reset' },
    ]) {
        const decision = decide(placing, intent);
        assert.equal(decision.effect, 'refuse', intent.type);
        assert.equal(decision.reason, 'placement');
        assert.equal(decision.next.placement, true);
        assert.equal(decision.next.expanded, false);
    }
});

test('l’aperçu n’existe que dans le placement et replie en sortant', () => {
    assert.equal(decide(music, { type: 'toggle-preview' }).effect, 'refuse');
    const shown = decide(placing, { type: 'toggle-preview', on: true });
    assert.equal(shown.effect, 'apply');
    assert.equal(shown.next.expanded, true);
    assert.equal(shown.next.mode, 'music');
    const left = decide(shown.next, { type: 'leave-placement' });
    assert.equal(left.next.placement, false);
    assert.equal(left.next.preview, false);
    assert.equal(left.next.expanded, false);
});

test('entrer en placement annule la vue ouverte et le ressort', () => {
    const decision = decide(capsuleSnapshot({ mode: 'settings', expanded: true, transitioning: true }), { type: 'enter-placement' });
    assert.equal(decision.effect, 'apply');
    assert.deepEqual(
        { mode: decision.next.mode, expanded: decision.next.expanded, placement: decision.next.placement, transitioning: decision.next.transitioning },
        { mode: 'music', expanded: false, placement: true, transitioning: false },
    );
});

test('un repli occupé reste refusé, sauf force pour Replay et les Réglages', () => {
    const replay = capsuleSnapshot({ mode: 'replay', expanded: true, busy: 'replay' });
    assert.equal(decide(replay, { type: 'collapse' }).reason, 'replay-busy');
    assert.equal(decide(replay, { type: 'collapse', force: true }).effect, 'apply');
    const library = capsuleSnapshot({ mode: 'library', expanded: true, busy: 'library' });
    assert.equal(decide(library, { type: 'collapse', force: true }).reason, 'library-busy');
    const settings = capsuleSnapshot({ mode: 'settings', expanded: true, busy: 'settings' });
    assert.equal(decide(settings, { type: 'collapse' }).reason, 'settings-busy');
    assert.equal(decide(settings, { type: 'collapse', force: true }).next.expanded, false);
});

test('Fichiers et une notification ont leur propre fermeture', () => {
    assert.equal(decide(capsuleSnapshot({ mode: 'files', expanded: true }), { type: 'collapse' }).reason, 'close-files');
    assert.equal(decide(capsuleSnapshot({ mode: 'notification', expanded: true }), { type: 'collapse' }).reason, 'dismiss-notification');
    assert.equal(decide(compact, { type: 'collapse' }).effect, 'noop');
});

test('un module sans nom est refusé et le basculement inverse le dépliage', () => {
    assert.equal(decide(music, { type: 'open' }).reason, 'missing-mode');
    const folded = decide(music, { type: 'toggle' });
    assert.equal(folded.next.expanded, false);
    assert.equal(folded.next.mode, 'music');
});
