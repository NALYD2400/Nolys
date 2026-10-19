import { native } from '../shared/ipc.js';

const listeners = new Set();
let pendingInit;
export const files = {
    inputs: [], jobs: [], sequence: -1, destination: '', error: '', notice: '',
    busy: false, outgoing: false, tab: 'convert', format: 'png', quality: 85, maxEdge: 1920, background: '',
};
export const notify = () => listeners.forEach(listener => listener(files));
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function message(error) { files.error = String(error?.message || error); notify(); }

function snapshot(value) {
    if (value.sequence < files.sequence) return;
    Object.assign(files, { jobs: value.jobs, sequence: value.sequence, destination: value.destination, error: value.error || files.error });
    notify();
}
export function initFiles() {
    return pendingInit ||= (async () => {
        await native.listen('files-changed', snapshot);
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
