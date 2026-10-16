/**
 * Pont de communication interface <-> cœur Rust.
 *
 * Expose la même API `ipcRenderer.send / invoke / on` (et les mêmes noms de
 * canaux) que la version Electron, mais chaque canal est traduit vers une
 * commande Tauri typée. Les canaux inconnus sont refusés, comme avant.
 */

const tauri = window.__TAURI__;

/** Canaux « fire and forget » : canal -> (arguments) => [commande, paramètres]. */
const SEND_CHANNELS = {
    'spotify-control': (action) => ['media_control', { action: String(action ?? '') }],
    'wallpaper-sync-status': (status, style) => ['wallpaper_sync_status', { status: status ?? false, style: style ?? null }],
    'set-ignore-mouse': (ignore) => ['set_ignore_mouse', { ignore: Boolean(ignore) }],
    'config-changed': (config) => ['config_changed', { config: config ?? {} }],
    'layout-config-changed': (layout) => ['set_layout_config', { layout: layout ?? null }],
    'layout-reset': () => ['reset_layout'],
    'layout-drag-begin': () => ['layout_drag_begin'],
    'layout-drag-move': () => ['layout_drag_move'],
    'layout-drag-end': () => ['layout_drag_end'],
    'layout-nudge': (dx, dy) => ['layout_nudge', { dx: Math.round(Number(dx) || 0), dy: Math.round(Number(dy) || 0) }],
    'set-layout-edit-mode': (enabled) => ['set_layout_edit_mode', { enabled: Boolean(enabled) }],
    'close-settings': () => ['close_settings'],
    'trigger-notif': (data) => ['trigger_notification', { data: data ?? {} }],
    'cover-color-changed': (colors) => ['cover_color_changed', { colors: colors ?? {} }],
    'exit-app': () => ['exit_app'],
    'open-settings': () => ['open_settings'],
    'set-persistent-island': (enabled) => ['set_persistent_island', { enabled: enabled ?? false }],
    'set-game-detection': (enabled) => ['set_fullscreen_autohide', { enabled: Boolean(enabled) }],
    'set-target-display': (displayId) => ['set_target_display', { displayId: displayId ?? null }],
};

/** Canaux avec réponse : canal -> (arguments) => [commande, paramètres]. */
const INVOKE_CHANNELS = {
    'open-library': () => ['library_open'],
    'get-layout-state': () => ['get_layout_state'],
    'get-displays': () => ['get_displays'],
    'get-audio-meter': () => ['get_audio_meter'],
    'get-update-status': () => ['get_update_status'],
    'check-for-updates-manual': () => ['check_for_updates'],
    'download-update-manual': () => ['download_update'],
    'install-downloaded-update': () => ['install_update'],
    'get-auto-start': () => ['get_auto_start'],
    'set-auto-start': (enabled) => ['set_auto_start', { enabled: Boolean(enabled) }],
    'get-media-info': () => ['get_media_info'],
    'get-desktop-sources': () => ['get_desktop_sources'],
    'get-file-icon': (filePath) => ['get_file_icon', { filePath: String(filePath ?? '') }],
    'get-hardware-telemetry': () => ['get_hardware_telemetry'],
    'get-system-stats': () => ['get_system_stats'],
    'get-weather': (city) => ['get_weather', { city: String(city ?? '') }],
    'set-system-volume': (volume) => ['set_system_volume', { volume: volume ?? null }],
    'get-system-volume': () => ['get_system_volume'],
    'get-audio-sessions': () => ['get_audio_sessions'],
    'set-session-volume': (payload) => ['set_session_volume', { payload: payload ?? {} }],
    'set-session-muted': (payload) => ['set_session_muted', { payload: payload ?? {} }],
    'get-active-window-info': () => ['get_active_window_info'],
    'wifi-control': (action) => ['wifi_control', { action: String(action ?? '') }],
    'bluetooth-control': (action) => ['bluetooth_control', { action: String(action ?? '') }],
    'dnd-control': (action) => ['dnd_control', { action: String(action ?? '') }],
    'get-audio-devices': () => ['get_audio_devices'],
    'get-audio-input-devices': () => ['get_audio_input_devices'],
    'set-default-audio-device': (deviceId) => ['set_default_audio_device', { deviceId: String(deviceId ?? '') }],
    'get-mic-monitor': () => ['get_mic_monitor'],
    'set-mic-monitor': (config) => ['set_mic_monitor', { config: config ?? {} }],
    'launch-shortcut': (command) => ['launch_shortcut', { command: String(command ?? '') }],
    'register-shortcuts': (bindings) => ['register_shortcuts', { bindings: Array.isArray(bindings) ? bindings : [] }],
};

/** Événements émis par le cœur natif que l'interface peut écouter. */
const EVENT_CHANNELS = new Set([
    'config-changed', 'trigger-notif', 'layout-config-changed',
    'layout-edit-mode-changed', 'update-status-changed', 'cover-color-changed',
    'mic-monitor-changed', 'shortcut-open-mode', 'island-visibility-changed',
    // Canaux historiques sans émetteur natif, conservés pour compatibilité.
    'app-go-background', 'app-go-foreground', 'open-search',
]);

const currentWindow = tauri.webviewWindow.getCurrentWebviewWindow();

export const ipcRenderer = {
    send(channel, ...args) {
        if (!(channel in SEND_CHANNELS)) {
            console.warn(`[Security] IPC send blocked for channel: ${channel}`);
            return;
        }
        const route = SEND_CHANNELS[channel];
        if (!route) return;
        const [command, params] = route(...args);
        tauri.core.invoke(command, params).catch((error) => {
            console.warn(`[IPC] ${channel} failed:`, error);
        });
    },

    invoke(channel, ...args) {
        if (!(channel in INVOKE_CHANNELS)) {
            console.warn(`[Security] IPC invoke blocked for channel: ${channel}`);
            return Promise.reject(new Error(`Unauthorized IPC invoke channel: ${channel}`));
        }
        const route = INVOKE_CHANNELS[channel];
        if (!route) return Promise.resolve(null);
        const [command, params] = route(...args);
        return tauri.core.invoke(command, params);
    },

    /** `callback(event, payload)` comme avec Electron ; renvoie une fonction de désabonnement. */
    on(channel, callback) {
        if (!EVENT_CHANNELS.has(channel)) {
            console.warn(`[Security] IPC listener registration blocked for channel: ${channel}`);
            return () => {};
        }
        const pending = currentWindow.listen(channel, (event) => callback(event, event.payload));
        return () => {
            pending.then((unlisten) => unlisten());
        };
    },
};

/** Commandes natives propres à la version Tauri (sans équivalent Electron). */
export const native = {
    invoke: (command, params) => tauri.core.invoke(command, params),
    listen: (channel, callback) => currentWindow.listen(channel, event => callback(event.payload)),
    fileSrc: (path) => path ? tauri.core.convertFileSrc(path) : '',
    startDragging: () => currentWindow.startDragging(),
};
