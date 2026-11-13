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

/// Cible acceptée pour un raccourci. Un chemin Windows n'est lancé que s'il
/// désigne, sans arguments, un dossier ou un fichier `.exe`, `.lnk` ou `.url` présent sur le disque.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ShortcutTarget {
    Protocol(String),
    SystemExe(std::path::PathBuf),
    ExistingPath(std::path::PathBuf),
}

/// Résout un raccourci sans l'ouvrir. `None` : protocole hors liste, script, chemin absent ou commande avec arguments.
pub(crate) fn resolve_shortcut(command: &str) -> Option<ShortcutTarget> {
    let mut raw = command.trim().to_string();
    // « Copier en tant que chemin » entoure tout le chemin de guillemets.
    if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        raw = raw[1..raw.len() - 1].trim().to_string();
    }
    if !is_safe_text(&raw) {
        return None;
    }
    // Paint et l'Outil Capture ne sont plus dans System32 sous Windows 11.
    match raw.to_lowercase().as_str() {
        "mspaint.exe" => raw = "ms-paint:".into(),
        "snippingtool.exe" => raw = "ms-screenclip:".into(),
        _ => {}
    }

    if let Some(exe) = named_system_exe(&raw) {
        return Some(ShortcutTarget::SystemExe(exe));
    }
    if let Some(path) = existing_user_path(&raw) {
        return Some(ShortcutTarget::ExistingPath(path));
    }
    allowed_protocol(&raw).map(ShortcutTarget::Protocol)
}

fn named_system_exe(raw: &str) -> Option<std::path::PathBuf> {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let name = match raw.to_lowercase().as_str() {
        "explorer.exe" => return Some(Path::new(&system_root).join("explorer.exe")),
        "taskmgr.exe" | "calc.exe" | "cmd.exe" | "notepad.exe" => raw.to_lowercase(),
        _ => return None,
    };
    Some(Path::new(&system_root).join("System32").join(name))
}

fn allowed_protocol(raw: &str) -> Option<String> {
    const ALLOWED_PROTOCOLS: [&str; 14] = [
        "http", "https", "mailto", "ms-settings", "ms-screenclip", "ms-paint", "ms-calculator", "ms-clock",
        "ms-photos", "ms-windows-store", "spotify", "discord", "steam", "zoommtg",
    ];
    let (scheme, _) = raw.split_once(':')?;
    let scheme = scheme.to_lowercase();
    let plausible = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
    (plausible && ALLOWED_PROTOCOLS.contains(&scheme.as_str())).then_some(raw.to_string())
}

/// Chemin absolu réel, sans second « : » (flux alternatif) ni métacaractère.
/// Un fichier n'est accepté que pour une application, un raccourci ou un lien.
fn existing_user_path(raw: &str) -> Option<std::path::PathBuf> {
    let bytes = raw.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || !matches!(bytes[2], b'\\' | b'/') {
        return None;
    }
    if raw[2..].contains(':') || raw.contains(['*', '?', '"', '<', '>', '|']) {
        return None;
    }
    let path = Path::new(raw);
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_dir() {
        return Some(path.to_path_buf());
    }
    if !meta.is_file() {
        return None;
    }
    const OPENABLE: &[&str] = &["exe", "lnk", "url"];
    let ext = path.extension().and_then(|value| value.to_str())?.to_ascii_lowercase();
    OPENABLE.contains(&ext.as_str()).then(|| path.to_path_buf())
}

/// Lance un raccourci du centre de contrôle (chemin existant, URL autorisée ou outil Windows).
#[tauri::command]
pub async fn launch_shortcut(command: String) -> bool {
    let Some(target) = resolve_shortcut(&command) else {
        crate::logger::log(&format!("Rejected unsupported shortcut command: {}", command.trim()));
        return false;
    };
    match target {
        ShortcutTarget::SystemExe(exe) => std::process::Command::new(exe).spawn().is_ok(),
        ShortcutTarget::Protocol(url) => blocking(move || system::shell_open(&url), false).await,
        ShortcutTarget::ExistingPath(path) => {
            let text = path.display().to_string();
            blocking(move || system::shell_open(&text), false).await
        }
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

#[cfg(test)]
mod shortcut_tests {
    use super::{resolve_shortcut, ShortcutTarget};

    #[test]
    fn named_tools_and_allowed_links_stay_openable() {
        assert!(matches!(resolve_shortcut("notepad.exe"), Some(ShortcutTarget::SystemExe(_))));
        assert!(matches!(resolve_shortcut("mspaint.exe"), Some(ShortcutTarget::Protocol(value)) if value == "ms-paint:"));
        assert!(matches!(resolve_shortcut("https://nolys.example/aide"), Some(ShortcutTarget::Protocol(_))));
        assert!(resolve_shortcut("javascript:alert(1)").is_none());
        assert!(resolve_shortcut("cmd.exe /c whoami").is_none());
    }

    #[test]
    fn a_windows_path_must_exist_and_cannot_carry_arguments_or_a_script() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("Nolys Player.exe");
        let script = root.path().join("run.bat");
        let folder = root.path().join("Musique");
        std::fs::write(&app, b"MZ").unwrap();
        std::fs::write(&script, b"@echo off").unwrap();
        std::fs::create_dir(&folder).unwrap();

        assert!(matches!(resolve_shortcut(&app.display().to_string()), Some(ShortcutTarget::ExistingPath(_))));
        assert!(matches!(resolve_shortcut(&format!("\"{}\"", app.display())), Some(ShortcutTarget::ExistingPath(_))));
        assert!(matches!(resolve_shortcut(&folder.display().to_string()), Some(ShortcutTarget::ExistingPath(_))));
        assert!(resolve_shortcut(&format!("\"{}\" /c whoami", app.display())).is_none());
        assert!(resolve_shortcut(&script.display().to_string()).is_none());
        assert!(resolve_shortcut(&format!("{} /c whoami", app.display())).is_none());
        assert!(resolve_shortcut(&format!("{}:stream", app.display())).is_none());
        assert!(resolve_shortcut(r"C:\absent\nolys.exe").is_none());
    }
}
