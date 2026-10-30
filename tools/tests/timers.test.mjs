import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimerState, createTimerState, validateTimerState, parseTimerInput, MAX_TIMERS } from '../../src/island/dynamic-island/features/timer-state.js';

function clock() {
    let now = 100000;
    const model = new TimerState(null, () => now);
    return { model, advance: milliseconds => { now += milliseconds; }, now: () => now };
}

test('a delayed UI callback counts real elapsed time and fractional pause time survives resume', () => {
    const { model, advance } = clock();
    model.toggle(); advance(3200);
    assert.equal(model.value, 3);
    model.toggle(); advance(10000);
    assert.equal(model.value, 3);
    model.toggle(); advance(800);
    assert.equal(model.value, 4);
});

test('countdown uses a deadline, rounds remaining seconds up and announces completion exactly once', () => {
    const { model, advance } = clock();
    model.setDuration(5); model.toggle(); advance(3200);
    assert.equal(model.value, 2);
    assert.deepEqual(model.tick(), []);
    advance(1800);
    assert.equal(model.value, 0);
    assert.equal(model.tick().length, 1);
    assert.equal(model.selected.completed, true);
    assert.equal(model.running, false);
    assert.deepEqual(model.tick(), []);
    model.toggle();
    assert.equal(model.value, 5);
});

test('paused countdown retains milliseconds and reset never starts it', () => {
    const { model, advance } = clock();
    model.setDuration(10); model.toggle(); advance(2500); model.toggle(); advance(60000);
    assert.equal(model.value, 8);
    model.toggle(); advance(7500);
    assert.equal(model.tick().length, 1);
    model.reset();
    assert.equal(model.value, 10);
    assert.equal(model.running, false);
});

test('multiple named timers and stopwatch run independently, including unselected expirations', () => {
    const { model, advance } = clock();
    model.toggle();
    model.setDuration(10); model.rename('Cuisine'); model.toggle();
    const first = model.selected.id;
    model.add('Thé'); model.setDuration(5); model.toggle();
    const second = model.selected.id;
    assert.equal(model.satellite.name, 'Thé');
    model.setMode('stopwatch'); advance(6000);
    assert.equal(model.value, 6);
    assert.deepEqual(model.tick().map(timer => timer.id), [second]);
    assert.equal(model.satellite.id, first);
    assert.equal(model.satellite.value, 4);
    model.select(first);
    assert.equal(model.running, true);
    assert.equal(model.remove(), false);
    model.toggle();
    assert.equal(model.remove(), true);
    model.setMode('stopwatch');
    assert.equal(model.running, true);
});

test('restart preserves paused state and catches elapsed deadlines once after a long sleep', () => {
    const { model, advance, now } = clock();
    model.toggle();
    model.setDuration(5); model.rename('Pause');
    model.add('Réveil'); model.setDuration(10); model.toggle();
    const saved = JSON.stringify(model.state);
    advance(86400000);
    const restored = new TimerState(JSON.parse(saved), now);
    assert.equal(restored.tick().length, 1);
    assert.equal(restored.state.timers.find(timer => timer.name === 'Pause').remainingMs, 5000);
    assert.equal(Math.floor(restored.elapsed() / 1000), 86400);
    const again = new TimerState(JSON.parse(JSON.stringify(restored.state)), now);
    assert.deepEqual(again.tick(), []);
});

test('invalid persisted structures are rejected without trusting duplicate IDs or nonfinite clocks', () => {
    for (const invalid of [null, [], 1, { version: 2 }, { ...createTimerState(), selectedId: 'missing' },
        { ...createTimerState(), stopwatch: { elapsedMs: Infinity, startedAt: null } },
        { ...createTimerState(), timers: [null] }]) {
        assert.equal(validateTimerState(invalid), null);
        assert.deepEqual(new TimerState(invalid).state, createTimerState());
    }
    const duplicate = createTimerState(); duplicate.timers.push({ ...duplicate.timers[0] });
    assert.equal(validateTimerState(duplicate), null);
    const runningCompleted = createTimerState(); Object.assign(runningCompleted.timers[0], { deadline: 123, completed: true });
    assert.equal(validateTimerState(runningCompleted), null);
});

test('timer collection bounds, names and duration validation keep state valid', () => {
    const { model } = clock();
    assert.equal(model.remove(), false);
    assert.equal(model.rename('  '), false);
    model.rename('  ' + 'A'.repeat(80) + '  ');
    assert.equal(model.selected.name.length, 40);
    for (const invalid of [0, -1, 0.5, NaN, Infinity, '60', 99 * 3600 + 1]) assert.equal(model.setDuration(invalid), false);
    assert.equal(model.setMode('unknown'), false);
    assert.equal(model.select('missing'), false);
    while (model.state.timers.length < MAX_TIMERS) assert.equal(model.add(), true);
    assert.equal(model.add(), false);
    assert.ok(validateTimerState(model.state));
});

test('duration text rejects impossible clock components and preserves documented formats', () => {
    for (const [text, seconds] of [['90', 5400], ['1h 30', 5400], ['1:30', 90], ['1:30:00', 5400], ['00:01', 1], ['99h', 356400]]) assert.equal(parseTimerInput(text), seconds);
    for (const text of ['0', '-5', '1:99', '1:60:00', '1h99', '100h', '99:00:01', 'NaN', '<script>']) assert.equal(parseTimerInput(text), null);
});
