import { native } from '../shared/ipc.js';

const listeners = new Set();
let pendingInit;
export const files = {
    inputs: [], jobs: [], sequence: -1, destination: '', error: '', notice: '',
    busy: false, outgoing: false, tab: 'convert', format: 'png', quality: 85, maxEdge: 1920, background: '',
    preferences: { format: 'png', quality: 85, maxEdge: 1920, background: null, historyLimit: 200 }, repairable: false, historyPage: 1,
};
export const notify = () => listeners.forEach(listener => listener(files));
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function message(error) { files.error = String(error?.message || error); notify(); }

function snapshot(value) {
    if (!value) return;
    if (value.sequence < files.sequence) return;
    const first = files.sequence < 0;
    Object.assign(files, { jobs: value.jobs, sequence: value.sequence, destination: value.destination, error: value.error || '', repairable: Boolean(value.repairable) });
    if (Array.isArray(value.inputs)) files.inputs = value.inputs;
    if (value.preferences) {
        files.preferences = value.preferences;
        if (first) Object.assign(files, { format: value.preferences.format, quality: value.preferences.quality, maxEdge: value.preferences.maxEdge, background: value.preferences.background || '' });
    }
    notify();
}
export function initFiles() {
    return pendingInit ||= (async () => {
        await native.listen('files-changed', snapshot);
        await native.listen('files-job-changed', value => {
            if (!value?.job || value.sequence < files.sequence) return;
            const index = files.jobs.findIndex(job => job.id === value.job.id);
            if (index < 0) files.jobs.push(value.job); else files.jobs[index] = value.job;
            files.sequence = value.sequence;
            if (value.error) files.error = value.error;
            notify();
        });
        await native.listen('files-error', message);
        await native.listen('files-drag-ended', () => { files.outgoing = false; notify(); });
        snapshot(await native.invoke('files_snapshot'));
    })().catch(error => { pendingInit = null; message(error); });
}
export function select(inputs) {
    files.inputs = inputs;
    files.error = ''; files.notice = '';
    files.tab = inputs.length && inputs.every(input => !input.directory && ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(input.extension)) ? 'convert' : 'actions';
    notify();
}
export async function remove(ids) {
    if (files.busy) return;
    files.busy = true; notify();
    try { select(await native.invoke('files_remove_inputs', { ids })); }
    catch (error) { message(error); }
    finally { files.busy = false; notify(); }
}
export async function retry(jobId) {
    if (files.busy) return;
    files.busy = true; files.error = ''; notify();
    try { await native.invoke('files_retry', { jobId, requestId: crypto.randomUUID() }); files.notice = 'Seuls les fichiers en échec ont été remis en attente.'; files.historyPage = 1; }
    catch (error) { message(error); }
    finally { files.busy = false; notify(); }
}
export async function configure(command, parameters = {}) {
    if (files.busy) return;
    files.busy = true; files.error = ''; files.notice = ''; notify();
    try {
        snapshot(await native.invoke(command, parameters));
        if (command === 'files_repair_history') files.notice = 'Historique reconstruit. Une copie de l’original a été conservée dans son dossier.';
        if (command === 'files_preferences') files.notice = 'Préférences enregistrées.';
    } catch (error) { message(error); }
    finally { files.busy = false; notify(); }
}
export async function pick() {
    if (files.busy) return;
    files.busy = true; files.error = ''; notify();
    try { const inputs = await native.invoke('files_pick'); if (inputs.length) select(inputs); }
    catch (error) { message(error); }
    finally { files.busy = false; notify(); }
}
export async function start(action, overrides = {}) {
    if (files.busy || !files.inputs.length) return;
    files.busy = true; files.error = ''; files.notice = ''; notify();
    try {
        const requestId = crypto.randomUUID();
        await native.invoke('files_start', {
            requestId, ids: files.inputs.map(input => input.id), action,
            options: { format: files.format, quality: files.quality, maxEdge: action === 'resize' ? files.maxEdge : 0, background: files.background || null, ...overrides },
        });
        files.tab = 'history';
        files.historyPage = 1;
        files.notice = 'Traitement ajouté à l’activité.';
    } catch (error) { message(error); }
    finally { files.busy = false; notify(); }
}
export async function act(command, parameters = {}) {
    try { await native.invoke(command, parameters); }
    catch (error) { message(error); }
}
export async function copy(ids) {
    files.notice = ''; files.error = '';
    try { await native.invoke('files_copy', { ids }); files.notice = 'Fichiers copiés.'; notify(); }
    catch (error) { message(error); }
}
export function dragOut(ids) {
    if (files.outgoing) return;
    files.outgoing = true; notify();
    native.invoke('files_drag_out', { ids }).catch(error => { files.outgoing = false; message(error); });
}
