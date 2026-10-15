//! Noms des événements envoyés aux fenêtres (mêmes canaux que la version Electron).

pub const CONFIG_CHANGED: &str = "config-changed";
pub const TRIGGER_NOTIF: &str = "trigger-notif";
pub const LAYOUT_CONFIG_CHANGED: &str = "layout-config-changed";
pub const LAYOUT_EDIT_MODE_CHANGED: &str = "layout-edit-mode-changed";
pub const UPDATE_STATUS_CHANGED: &str = "update-status-changed";
pub const COVER_COLOR_CHANGED: &str = "cover-color-changed";
pub const MIC_MONITOR_CHANGED: &str = "mic-monitor-changed";
pub const SHORTCUT_OPEN_MODE: &str = "shortcut-open-mode";
pub const ISLAND_VISIBILITY_CHANGED: &str = "island-visibility-changed";
