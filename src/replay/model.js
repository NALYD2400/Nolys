/** Framework-free state. Commands serialize; delayed snapshots cannot replace newer state. */
export const activeCapture = snapshot => ['starting', 'buffering', 'stopping'].includes(snapshot?.phase);
export const presets = {
    economy: { height: 720, fps: 30, bitrateMbps: 6, seconds: 30, memoryMb: 128, preset: 'speed' },
    balanced: { height: 1080, fps: 60, bitrateMbps: 16, seconds: 60, memoryMb: 256, preset: 'speed' },
    quality: { height: 1440, fps: 60, bitrateMbps: 32, seconds: 120, memoryMb: 512, preset: 'quality' },
};
export const duration = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};
export const size = value => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format((Number(value) || 0) / 1024 ** 2)} Mo`;

export function createReplayStore(invoke) {
    const state = { snapshot: null, draft: null, sources: [], inputs: [], outputs: [], dirty: false, busy: false, error: '', tab: 'capture' };
    const listeners = new Set();
    let generation = 0;
    const emit = () => listeners.forEach(listener => listener(state));
    const fail = error => { state.error = String(error?.message || error); emit(); };
    function accept(snapshot) {
        if (!snapshot) return;
        state.snapshot = snapshot;
        if (!state.dirty) state.draft = structuredClone(snapshot.config);
        emit();
    }
    async function refresh() {
        const request = ++generation;
        try { const snapshot = await invoke('replay_snapshot'); if (request === generation) accept(snapshot); }
        catch (error) { if (request === generation) fail(error); }
    }
    async function loadSources() {
        try {
            const [sources, outputs, inputs] = await Promise.all([invoke('replay_sources'), invoke('get_audio_devices'), invoke('get_audio_input_devices')]);
            state.sources = sources || []; state.outputs = outputs || []; state.inputs = inputs || []; emit();
        } catch (error) { fail(error); }
    }
    async function exclusive(fn) {
        if (state.busy) return false;
        state.busy = true; state.error = ''; emit();
        try { await fn(); return true; }
        catch (error) { fail(error); return false; }
        finally { state.busy = false; emit(); }
    }
    async function saveDraft() {
        if (!state.dirty) return;
        const saved = await invoke('replay_configure', { config: structuredClone(state.draft) });
        ++generation; state.dirty = false; accept(saved);
    }
    return {
        state, refresh, loadSources, fail,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        update(key, value) {
            if (!state.draft || activeCapture(state.snapshot) || state.busy) return;
            state.draft[key] = value; state.dirty = true; emit();
        },
        preset(key) {
            if (!state.draft || activeCapture(state.snapshot) || state.busy || !presets[key]) return;
            Object.assign(state.draft, presets[key]); state.dirty = true; emit();
        },
        save() { return exclusive(saveDraft); },
        action(action) {
            return exclusive(async () => {
                if (['start', 'record'].includes(action) && !activeCapture(state.snapshot)) await saveDraft();
                const snapshot = await invoke('replay_action', { action }); ++generation; accept(snapshot);
            });
        },
        pick(kind) {
            return exclusive(async () => {
                const path = await invoke('replay_pick', { kind });
                if (path && state.draft) { state.draft[kind === 'engine' ? 'enginePath' : 'destination'] = path; state.dirty = true; emit(); }
            });
        },
        async reveal(id = null, recovery = false) { try { await invoke('replay_reveal', { id, recovery }); } catch (error) { fail(error); } },
        async play(id) { try { await invoke('replay_play', { id }); } catch (error) { fail(error); } },
    };
}
