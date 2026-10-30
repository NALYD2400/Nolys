import { native } from '../shared/ipc.js';
import { createReplayStore } from './model.js';
export const replay = createReplayStore((command, args) => native.invoke(command, args));
let initialized;
export function initReplay() {
    return initialized ??= Promise.all([
        native.listen('replay-status', () => replay.refresh()),
        native.listen('replay-preferences-restored', snapshot => replay.restore(snapshot)),
    ]).then(() => replay.refresh()).catch(replay.fail);
}
