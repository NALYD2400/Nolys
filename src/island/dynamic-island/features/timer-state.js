/** Horloges persistantes : les rappels rafraîchissent l'affichage, jamais le temps. */
export const TIMER_STATE_KEY = 'liquid_timer_state';
export const MAX_TIMER_SECONDS = 99 * 3600;
export const MAX_TIMERS = 8;
const duration = value => Number.isInteger(value) && value >= 1000 && value <= MAX_TIMER_SECONDS * 1000;
const timestamp = value => Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const nameOf = value => typeof value === 'string' ? value.trim().slice(0, 40) : '';

export function formatTimerPreset(seconds) {
    if (seconds % 3600 === 0) return `${seconds / 3600} h`;
    if (seconds % 60 === 0) return `${seconds / 60} min`;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Les nombres seuls sont des minutes, deux blocs m:ss, trois blocs h:mm:ss. */
export function parseTimerInput(text) {
    const raw = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    let seconds = null, match;
    if ((match = raw.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/))) {
        if (Number(match[2]) > 59 || Number(match[3]) > 59) return null;
        seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    } else if ((match = raw.match(/^(\d{1,4}):(\d{1,2})$/))) {
        if (Number(match[2]) > 59) return null;
        seconds = Number(match[1]) * 60 + Number(match[2]);
    } else if ((match = raw.match(/^(\d{1,2})h(\d{1,2})?$/))) {
        if (Number(match[2] || 0) > 59) return null;
        seconds = Number(match[1]) * 3600 + Number(match[2] || 0) * 60;
    } else if ((match = raw.match(/^(\d{1,4})(min|m)?$/))) seconds = Number(match[1]) * 60;
    return seconds !== null && seconds >= 1 && seconds <= MAX_TIMER_SECONDS ? seconds : null;
}

export function createTimerState() {
    return { version: 1, mode: 'stopwatch', selectedId: 'timer-1', stopwatch: { elapsedMs: 0, startedAt: null },
        timers: [{ id: 'timer-1', name: 'Minuteur 1', presetMs: 300000, remainingMs: 300000, deadline: null, completed: false }] };
}

/** Un état incohérent est refusé en entier ; la lecture ne modifie pas le stockage. */
export function validateTimerState(value) {
    if (!value || value.version !== 1 || !['stopwatch', 'countdown'].includes(value.mode)
        || !Array.isArray(value.timers) || !value.timers.length || value.timers.length > MAX_TIMERS) return null;
    const clock = value.stopwatch;
    if (!clock || !timestamp(clock.elapsedMs) || (clock.startedAt !== null && !timestamp(clock.startedAt))) return null;
    const ids = new Set();
    const timers = [];
    for (const timer of value.timers) {
        if (!timer || typeof timer.id !== 'string' || !/^[\w-]{1,80}$/.test(timer.id) || ids.has(timer.id)
            || !nameOf(timer.name) || !duration(timer.presetMs) || !Number.isFinite(timer.remainingMs)
            || timer.remainingMs < 0 || timer.remainingMs > timer.presetMs || typeof timer.completed !== 'boolean'
            || (timer.deadline !== null && (!timestamp(timer.deadline) || timer.completed))) return null;
        ids.add(timer.id);
        timers.push({ id: timer.id, name: nameOf(timer.name), presetMs: timer.presetMs,
            remainingMs: timer.remainingMs, deadline: timer.deadline, completed: timer.completed });
    }
    if (!ids.has(value.selectedId)) return null;
    return { version: 1, mode: value.mode, selectedId: value.selectedId,
        stopwatch: { elapsedMs: clock.elapsedMs, startedAt: clock.startedAt }, timers };
}

export class TimerState {
    constructor(snapshot, now = Date.now) {
        this.state = validateTimerState(snapshot) || createTimerState();
        this.now = now;
    }
    get selected() { return this.state.timers.find(timer => timer.id === this.state.selectedId); }
    get running() { return this.state.mode === 'stopwatch' ? this.state.stopwatch.startedAt !== null : this.selected.deadline !== null; }
    remaining(timer, now = this.now()) {
        return timer.deadline === null ? timer.remainingMs : Math.max(0, timer.deadline - now);
    }
    elapsed(now = this.now()) {
        const clock = this.state.stopwatch;
        return clock.elapsedMs + (clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt));
    }
    get value() { return this.state.mode === 'stopwatch' ? Math.floor(this.elapsed() / 1000) : Math.ceil(this.remaining(this.selected) / 1000); }
    select(id) {
        if (!this.state.timers.some(timer => timer.id === id)) return false;
        this.state.selectedId = id;
        this.state.mode = 'countdown';
        return true;
    }
    setMode(mode) {
        if (!['countdown', 'stopwatch'].includes(mode)) return false;
        this.state.mode = mode;
        return true;
    }
    setDuration(seconds) {
        if (!Number.isInteger(seconds) || !duration(seconds * 1000)) return false;
        Object.assign(this.selected, { presetMs: seconds * 1000, remainingMs: seconds * 1000, deadline: null, completed: false });
        this.state.mode = 'countdown';
        return true;
    }
    toggle() {
        const now = this.now();
        if (this.state.mode === 'stopwatch') {
            const clock = this.state.stopwatch;
            if (clock.startedAt !== null) { clock.elapsedMs = this.elapsed(now); clock.startedAt = null; }
            else clock.startedAt = now;
        } else {
            const timer = this.selected;
            if (timer.deadline !== null) { timer.remainingMs = this.remaining(timer, now); timer.deadline = null; }
            else {
                if (timer.remainingMs === 0) timer.remainingMs = timer.presetMs;
                timer.deadline = now + timer.remainingMs;
                timer.completed = false;
            }
        }
    }
    reset() {
        if (this.state.mode === 'stopwatch') Object.assign(this.state.stopwatch, { elapsedMs: 0, startedAt: null });
        else Object.assign(this.selected, { remainingMs: this.selected.presetMs, deadline: null, completed: false });
    }
    add(name) {
        if (this.state.timers.length >= MAX_TIMERS) return false;
        let index = 1;
        while (this.state.timers.some(timer => timer.id === `timer-${index}`)) index++;
        const timer = { id: `timer-${index}`, name: nameOf(name) || `Minuteur ${index}`, presetMs: 300000, remainingMs: 300000, deadline: null, completed: false };
        this.state.timers.push(timer);
        this.select(timer.id);
        return true;
    }
    rename(name) {
        if (!nameOf(name)) return false;
        this.selected.name = nameOf(name);
        return true;
    }
    remove() {
        if (this.state.timers.length === 1 || this.selected.deadline !== null) return false;
        this.state.timers = this.state.timers.filter(timer => timer.id !== this.state.selectedId);
        this.state.selectedId = this.state.timers[0].id;
        return true;
    }
    /** L'expiration consomme l'alarme : persister avant de l'annoncer garantit une reprise unique. */
    tick() {
        const now = this.now();
        const due = this.state.timers.filter(timer => timer.deadline !== null && timer.deadline <= now);
        for (const timer of due) Object.assign(timer, { deadline: null, remainingMs: 0, completed: true });
        return due;
    }
    get satellite() {
        const timers = this.state.timers.filter(timer => timer.deadline !== null).sort((a, b) => a.deadline - b.deadline);
        if (timers.length) {
            const timer = timers[0];
            return { id: timer.id, name: timer.name, mode: 'countdown', value: Math.ceil(this.remaining(timer) / 1000), preset: timer.presetMs / 1000, count: timers.length };
        }
        if (this.state.stopwatch.startedAt !== null) return { mode: 'stopwatch', name: 'Chrono', value: Math.floor(this.elapsed() / 1000), preset: 0, count: 1 };
        return null;
    }
}
