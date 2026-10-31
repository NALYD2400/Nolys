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

export function queryClips(clips, { search = '', kind = '', sort = 'newest', page = 0, pageSize = 25 } = {}) {
    const text = search.trim().toLocaleLowerCase('fr');
    const filtered = clips.filter(c => (!kind || c.kind === kind) && (!text || `${c.name} ${c.path}`.toLocaleLowerCase('fr').includes(text)));
    const compare = sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }) : sort === 'size' ? (a, b) => b.bytes - a.bytes : sort === 'oldest' ? (a, b) => a.createdAt - b.createdAt : (a, b) => b.createdAt - a.createdAt;
    filtered.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
    return { clips: filtered.slice(page * pageSize, (page + 1) * pageSize), total: filtered.length, page, pages };
}

export function createReplayStore(invoke) {
    const state = { snapshot: null, draft: null, sources: [], inputs: [], outputs: [], dirty: false, busy: false, error: '', tab: 'capture' };
    const listeners = new Set();
    let generation = 0;
    let statusRefresh = null, latestStatus = null;
    const emit = () => listeners.forEach(listener => listener(state));
    const fail = error => { state.error = String(error?.message || error); emit(); };
    function accept(snapshot) {
        if (!snapshot) return;
        if (Number.isSafeInteger(snapshot.clipsRevision) && snapshot.clipsRevision === state.snapshot?.clipsRevision) {
            snapshot = { ...snapshot, clips: state.snapshot.clips };
        }
        state.snapshot = snapshot;
        if (!state.dirty) state.draft = structuredClone(snapshot.config);
        emit();
    }
    async function refresh() {
        const request = ++generation;
        try { const snapshot = await invoke('replay_snapshot'); if (request === generation) accept(snapshot); }
        catch (error) { if (request === generation) fail(error); }
    }
    function status(payload) {
        latestStatus = payload;
        const current = state.snapshot;
        const revision = payload?.clipsRevision;
        if (current && Number.isSafeInteger(revision) && Number.isSafeInteger(current.clipsRevision)) {
            if (revision < current.clipsRevision) return;
            if (revision === current.clipsRevision) {
                ++generation;
                // Config and clips retain their identity; draft edits remain untouched.
                const next = { ...current };
                for (const key of ['phase', 'bufferedSeconds', 'bufferBytes', 'recording', 'recordingSeconds', 'exporting', 'encoder', 'pipeline', 'width', 'height', 'encodedFps', 'droppedFrames', 'duplicatedFrames', 'error', 'notice', 'engineAvailable', 'enginePath', 'recoveryFiles']) {
                    if (Object.hasOwn(payload, key)) next[key] = payload[key];
                }
                state.snapshot = next;
                emit();
                return;
            }
        }
        // A new catalogue needs one full read, even if several status events arrive.
        if (!statusRefresh) {
            const requested = latestStatus;
            statusRefresh = refresh().finally(() => {
                statusRefresh = null;
                if (latestStatus !== requested && latestStatus?.clipsRevision !== state.snapshot?.clipsRevision) status(latestStatus);
            });
        }
        return statusRefresh;
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
        restore(snapshot) { ++generation; state.dirty = false; state.error = ''; accept(snapshot); },
        state, refresh, status, loadSources, fail,
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
        async play(id) { try { return await invoke('replay_media', { id }); } catch (error) { fail(error); return null; } },
        async openExternal(id) { try { await invoke('replay_play', { id }); } catch (error) { fail(error); } },
        deleteClip(id) {
            return exclusive(async () => { const snapshot = await invoke('replay_delete', { id }); ++generation; accept(snapshot); });
        },
        renameClip(id, name) {
            return exclusive(async () => { const snapshot = await invoke('replay_rename', { id, name }); ++generation; accept(snapshot); });
        },
        mutate(command, args = {}) {
            return exclusive(async () => { const snapshot = await invoke(command, args); ++generation; accept(snapshot); });
        },
        deleteClips(ids) {
            return exclusive(async () => {
                for (const id of [...new Set(ids)]) { const snapshot = await invoke('replay_delete', { id }); ++generation; accept(snapshot); }
            });
        },
        async inspect(command, args = {}) { try { return await invoke(command, args); } catch (error) { fail(error); return null; } },
    };
}
