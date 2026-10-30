use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use super::{blocking, is_safe_text};
use crate::platform::radios::{self, Kind};
use crate::platform::system::{self, SystemStats, Telemetry};
use crate::platform::{icons, process, weather};

fn toggle_action(action: &str) -> Option<&'static str> {
    match action.trim().to_lowercase().as_str() {
        "on" => Some("on"),
        "off" => Some("off"),
        "status" => Some("status"),
        _ => None,
    }
}

#[tauri::command]
pub async fn wifi_control(action: String) -> String {
    let Some(action) = toggle_action(&action) else { return "error".into() };
    blocking(move || radios::control(Kind::WiFi, action), "error".into()).await
}

#[tauri::command]
pub async fn bluetooth_control(action: String) -> String {
    let Some(action) = toggle_action(&action) else { return "error".into() };
    blocking(move || radios::control(Kind::Bluetooth, action), "error".into()).await
}

#[tauri::command]
pub async fn dnd_control(action: String) -> String {
    let Some(action) = toggle_action(&action) else { return "error".into() };
    blocking(move || system::dnd_control(action), "error".into()).await
}

#[tauri::command]
pub async fn get_hardware_telemetry() -> Telemetry {
    blocking(system::telemetry, Telemetry::default()).await
}

/// Météo réelle de la ville choisie (widget Météo du centre de contrôle).
#[tauri::command]
pub async fn get_weather(city: String) -> Option<weather::Weather> {
    if !is_safe_text(&city) || city.len() > 100 {
        return None;
    }
    blocking(move || weather::current(&city), None).await
}

#[tauri::command]
pub async fn get_system_stats() -> SystemStats {
    blocking(system::system_stats, SystemStats::default()).await
}

#[tauri::command]
pub async fn get_active_window_info() -> Value {
    blocking(
        || match process::foreground_window() {
            Some(info) => json!({ "pid": info.pid, "name": info.name, "title": info.title, "isFullscreen": info.is_fullscreen }),
            None => json!({ "isFullscreen": false }),
        },
        json!({ "isFullscreen": false }),
    )
    .await
}

#[tauri::command]
pub async fn get_file_icon(file_path: String) -> String {
    if !is_safe_text(&file_path) {
        return String::new();
    }
    let path = file_path.trim().trim_matches('"').to_string();
    blocking(
        move || icons::resolve_file(&path).map(|resolved| icons::icon_data_url(&resolved.to_string_lossy())).unwrap_or_default(),
        String::new(),
    )
    .await
}

#[derive(Serialize)]
pub struct DesktopSource {
    id: String,
    name: String,
    thumbnail: String,
}

/// Fenêtres visibles (utilisé pour retrouver la fenêtre du lecteur à « projeter »).
#[tauri::command]
pub async fn get_desktop_sources() -> Vec<DesktopSource> {
    blocking(
        || {
            process::visible_window_titles()
                .into_iter()
                .map(|(hwnd, name)| DesktopSource { id: format!("window:{hwnd}:0"), name, thumbnail: String::new() })
                .collect()
        },
        Vec::new(),
    )
    .await
}

/// Lance un raccourci du centre de contrôle (chemin, URL autorisée ou outil Windows).
#[tauri::command]
pub async fn launch_shortcut(command: String) -> bool {
    let mut raw = command.trim().to_string();
    if !is_safe_text(&raw) {
        return false;
    }
    // Paint et l'Outil Capture ne sont plus dans System32 sous Windows 11 (applications
    // du Store) : les anciens raccourcis enregistrés passent par leurs protocoles.
    match raw.to_lowercase().as_str() {
        "mspaint.exe" => raw = "ms-paint:".into(),
        "snippingtool.exe" => raw = "ms-screenclip:".into(),
        _ => {}
    }

    let bytes = raw.as_bytes();
    let is_windows_path = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
    let protocol = raw
        .split_once(':')
        .map(|(scheme, _)| scheme.to_lowercase())
        .filter(|s| s.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)))
        .unwrap_or_default();
    // Protocoles ouverts par Windows (applications du Store, liens, applications courantes).
    const ALLOWED_PROTOCOLS: [&str; 14] = [
        "http", "https", "mailto", "ms-settings", "ms-screenclip", "ms-paint", "ms-calculator", "ms-clock",
        "ms-photos", "ms-windows-store", "spotify", "discord", "steam", "zoommtg",
    ];

    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let allowed_exe = match raw.to_lowercase().as_str() {
        "explorer.exe" => Some(Path::new(&system_root).join("explorer.exe")),
        "taskmgr.exe" | "calc.exe" | "cmd.exe" | "notepad.exe" => {
            Some(Path::new(&system_root).join("System32").join(raw.to_lowercase()))
        }
        _ => None,
    };

    if is_windows_path || ALLOWED_PROTOCOLS.contains(&protocol.as_str()) {
        blocking(move || system::shell_open(&raw), false).await
    } else if let Some(exe) = allowed_exe {
        std::process::Command::new(exe).spawn().is_ok()
    } else {
        crate::logger::log(&format!("Rejected unsupported shortcut command: {raw}"));
        false
    }
}

#[tauri::command]
pub fn get_auto_start(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_auto_start(app: AppHandle, enabled: bool) -> bool {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if let Err(error) = result {
        crate::logger::log(&format!("Error setting auto-start: {error}"));
    }
    launcher.is_enabled().unwrap_or(false)
}
