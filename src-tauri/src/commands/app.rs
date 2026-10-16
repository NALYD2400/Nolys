//! Commandes liées aux fenêtres, aux réglages et aux relais entre fenêtres.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::island::{self, hit_test::{CssRect, HitRegion}};
use crate::state::AppState;
use crate::wallpaper::SettingsPatch;
use crate::{events, shortcut};

#[tauri::command]
pub fn set_ignore_mouse(app: AppHandle, ignore: bool) {
    island::set_click_through(&app, ignore);
}

/// Zones survolables de l'Island (pilule, menus) envoyées par l'interface.
#[tauri::command]
pub fn set_hit_region(app: AppHandle, rects: Vec<CssRect>, pixel_ratio: f64) {
    *app.state::<AppState>().hit_region.lock() = HitRegion { rects, pixel_ratio };
}

/// Masquer l'Island quand une application plein écran est au premier plan.
#[tauri::command]
pub fn set_fullscreen_autohide(app: AppHandle, enabled: bool) {
    island::set_fullscreen_autohide(&app, enabled);
}

#[tauri::command]
pub fn set_persistent_island(app: AppHandle, enabled: Value) {
    island::set_persistent(&app, truthy(&enabled));
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    crate::quit(&app);
}

/// Enregistre les raccourcis globaux (action -> combinaison) et renvoie ceux que Windows refuse.
#[tauri::command]
pub fn register_shortcuts(app: AppHandle, bindings: Vec<shortcut::Binding>) -> Vec<shortcut::Conflict> {
    // Borne large : une liste normale compte moins de dix actions.
    let bindings: Vec<shortcut::Binding> = bindings.into_iter().take(32).collect();
    shortcut::register_all(&app, &bindings)
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(b) => *b,
        Value::String(s) => s == "true",
        Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        _ => false,
    }
}

fn patch_from_config(config: &Value) -> SettingsPatch {
    SettingsPatch {
        enabled: config.get("isWallpaperSync").map(truthy),
        style: config.get("wallpaperSyncStyle").and_then(Value::as_str).map(str::to_string),
        intensity: config.get("wallpaperBlurIntensity").and_then(Value::as_str).map(str::to_string),
        darken: config.get("wallpaperDarken").cloned(),
        delay: config.get("wallpaperDelay").cloned(),
    }
}

/// Réglages modifiés : met à jour la synchro du fond d'écran puis relaie à l'Island.
#[tauri::command]
pub fn config_changed(app: AppHandle, config: Value) {
    if let Some(enabled) = config.pointer("/modules/gameDetection") {
        island::set_fullscreen_autohide(&app, truthy(enabled));
    }
    if config.is_object() {
        let state = app.state::<AppState>();
        let patch = patch_from_config(&config);
        let sync_in_patch = patch.enabled.is_some();
        let (was_enabled, enabled, style_changed) = state.wallpaper.apply_settings(patch);
        let enabled_changed = was_enabled != enabled;

        if sync_in_patch && (enabled_changed || style_changed) {
            let wallpaper = state.wallpaper.clone();
            let cover = state.media.lock().current().active_cover().to_string();
            if !enabled {
                if enabled_changed {
                    // Annulation immédiate : une pochette en attente ne revient pas après la coupure.
                    let generation = wallpaper.cancel_pending();
                    tauri::async_runtime::spawn_blocking(move || wallpaper.restore_if_current(generation));
                }
            } else if !cover.is_empty() {
                if enabled_changed {
                    let background = wallpaper.clone();
                    tauri::async_runtime::spawn_blocking(move || background.store_original());
                }
                wallpaper.invalidate();
                wallpaper.update(cover);
            }
        }
    }
    let _ = app.emit_to(island::LABEL, events::CONFIG_CHANGED, &config);
}

/// État initial de la synchro du fond d'écran, envoyé par l'Island au démarrage.
#[tauri::command]
pub fn wallpaper_sync_status(app: AppHandle, status: Value, style: Option<String>) {
    let state = app.state::<AppState>();
    let patch = if status.is_object() {
        SettingsPatch {
            enabled: Some(status.get("enabled").map(truthy).unwrap_or(false)),
            style: status.get("style").and_then(Value::as_str).map(str::to_string),
            intensity: status.get("intensity").and_then(Value::as_str).map(str::to_string),
            darken: status.get("darken").cloned(),
            delay: status.get("delay").cloned(),
        }
    } else {
        SettingsPatch { enabled: Some(truthy(&status)), style, ..Default::default() }
    };
    let (_, enabled, _) = state.wallpaper.apply_settings(patch);
    let cover = state.media.lock().current().active_cover().to_string();
    if enabled && !cover.is_empty() {
        state.wallpaper.update(cover);
    }
}

#[tauri::command]
pub fn trigger_notification(app: AppHandle, data: Value) {
    let _ = app.emit_to(island::LABEL, events::TRIGGER_NOTIF, data);
}

/// Export des réglages : fenêtre « Enregistrer sous » de Windows, puis écriture du fichier.
/// Renvoie `false` si l'utilisateur annule. Le dialogue tourne sur un thread neuf (COM, voir
/// `library::commands::pick`) et appartient à l'Island, qui reste ouverte pendant ce temps.
#[tauri::command]
pub async fn save_settings_file(app: AppHandle, contents: String, file_name: String) -> Result<bool, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("Exporter les réglages de Nolys")
        .set_file_name(file_name)
        .add_filter("Réglages Nolys", &["json"]);
    if let Some(window) = island::window(&app) {
        dialog = dialog.set_parent(&window);
    }
    let path = tauri::async_runtime::spawn_blocking(move || std::thread::spawn(move || dialog.save_file()).join())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "La fenêtre d'enregistrement s'est fermée de façon inattendue.".to_string())?;
    let Some(path) = path else { return Ok(false) };
    std::fs::write(&path, contents).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(true)
}
