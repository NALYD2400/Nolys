//! Raccourcis clavier globaux : une combinaison par action (afficher / masquer l'Island,
//! mode placement, lecture, capture d'écran…). Ils sont enregistrés au démarrage puis
//! à chaque changement dans les Réglages (`src/shared/hotkeys.js`).

use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::commands::media::media_control;
use crate::state::AppState;
use crate::{events, island, platform};

/// Actions reconnues. Les identifiants sont ceux de `HOTKEY_ACTIONS` côté interface.
const ACTIONS: [&str; 12] = [
    "toggleVisibility",
    "layoutEdit",
    "openMusic",
    "openControl",
    "openMic",
    "mediaToggle",
    "mediaPrev",
    "mediaNext",
    "quickScreenshot",
    "openMixer",
    "openSettings",
    "openFiles",
];

/// Une action et sa combinaison (`Ctrl+Alt+K`…), telles qu'envoyées par les Réglages.
#[derive(Debug, Deserialize)]
pub struct Binding {
    pub action: String,
    pub accelerator: String,
}

/// Combinaison refusée : prise par Windows ou une autre application, ou invalide.
#[derive(Debug, Serialize)]
pub struct Conflict {
    pub action: String,
    pub accelerator: String,
    pub reason: String,
}

/// Convertit un accélérateur Electron (`CommandOrControl+Shift+K`) au format Tauri.
fn normalize(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| match part.trim().to_lowercase().as_str() {
            "commandorcontrol" | "cmdorctrl" | "cmdorcontrol" | "commandorctrl" => "CommandOrControl".to_string(),
            "control" | "ctrl" => "Control".to_string(),
            "option" | "altgr" => "Alt".to_string(),
            "super" | "meta" | "win" | "cmd" | "command" => "Super".to_string(),
            _ => part.trim().to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Exécute une action. Appelé depuis le gestionnaire du raccourci (appui seulement).
fn run(app: &AppHandle, action: &str) {
    match action {
        "toggleVisibility" => island::toggle_visibility(app, "shortcut-toggle"),
        "layoutEdit" => {
            let enabled = !app.state::<AppState>().layout_edit_mode.load(Ordering::SeqCst);
            island::set_layout_edit_mode(app, enabled);
        }
        "openMusic" => open_mode(app, "music"),
        "openControl" => open_mode(app, "control"),
        "openMic" => open_mode(app, "mic"),
        "openMixer" => open_mode(app, "mixer"),
        "openFiles" => open_mode(app, "files"),
        // Les Réglages s'ouvrent dans l'Island ; un second appui les referme.
        "openSettings" => island::open_settings(app, true),
        "mediaToggle" => media_control(app.clone(), "toggle".into()),
        "mediaPrev" => media_control(app.clone(), "prev".into()),
        "mediaNext" => media_control(app.clone(), "next".into()),
        "quickScreenshot" => {
            platform::system::shell_open("ms-screenclip:");
        }
        _ => {}
    }
}

/// Ouvre un mode dans l'Island (lecteur, centre de contrôle, retour micro), en l'affichant d'abord si elle est masquée.
fn open_mode(app: &AppHandle, mode: &str) {
    if mode == "files" {
        if let Some(window) = island::window(app) { let _ = window.set_focus(); }
    }
    if let Some(hwnd) = island::window(app).and_then(|window| window.hwnd().ok()) {
        if !platform::window::is_visible(hwnd) {
            island::toggle_visibility(app, "shortcut-open");
        }
    }
    let _ = app.emit_to(island::LABEL, events::SHORTCUT_OPEN_MODE, mode);
}

/// Remplace tous les raccourcis par `bindings` et renvoie ceux que Windows refuse.
/// Les anciens sont retirés d'abord : changer une combinaison ne laisse aucun doublon actif.
pub fn register_all(app: &AppHandle, bindings: &[Binding]) -> Vec<Conflict> {
    // L'instance de test peut coexister avec Nolys installé sans prendre ses raccourcis.
    if crate::isolated_dev() { return Vec::new(); }
    let shortcuts = app.global_shortcut();
    if let Err(error) = shortcuts.unregister_all() {
        crate::logger::log(&format!("[Shortcut] Failed to clear hotkeys: {error}"));
    }

    let mut conflicts = Vec::new();
    for binding in bindings {
        let accelerator = binding.accelerator.trim();
        if accelerator.is_empty() {
            continue;
        }
        if !ACTIONS.contains(&binding.action.as_str()) || accelerator.len() > 80 {
            conflicts.push(conflict(binding, "combinaison invalide"));
            continue;
        }

        let action = binding.action.clone();
        let result = normalize(accelerator)
            .parse::<Shortcut>()
            .map_err(|error| error.to_string())
            .and_then(|shortcut| {
                shortcuts
                    .on_shortcut(shortcut, move |app, _, event| {
                        if event.state() == ShortcutState::Pressed {
                            run(app, &action);
                        }
                    })
                    .map_err(|error| error.to_string())
            });
        match result {
            Ok(()) => crate::logger::log(&format!("[Shortcut] Registered {}: {accelerator}", binding.action)),
            Err(error) => {
                crate::logger::log(&format!("[Shortcut] Failed to register {} ({accelerator}): {error}", binding.action));
                conflicts.push(conflict(binding, "déjà utilisée par Windows, une autre application ou une autre action"));
            }
        }
    }
    conflicts
}

fn conflict(binding: &Binding, reason: &str) -> Conflict {
    Conflict {
        action: binding.action.clone(),
        accelerator: binding.accelerator.clone(),
        reason: reason.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_maps_electron_names() {
        assert_eq!(normalize("Ctrl+Alt+K"), "Control+Alt+K");
        assert_eq!(normalize("CommandOrControl+Shift+1"), "CommandOrControl+Shift+1");
        assert_eq!(normalize("Meta+F9"), "Super+F9");
    }

    #[test]
    fn default_accelerators_parse() {
        for accelerator in ["Alt+I", "Ctrl+Alt+M", "Ctrl+Alt+1", "Ctrl+Alt+4", "Ctrl+Alt+P", "Ctrl+Alt+K", "Ctrl+Alt+J", "Ctrl+Alt+L", "Ctrl+Alt+S", "F9"] {
            assert!(normalize(accelerator).parse::<Shortcut>().is_ok(), "{accelerator} doit être lisible");
        }
    }

    #[test]
    fn unknown_key_is_rejected() {
        assert!("Control+Alt+IntlBackslashNope".parse::<Shortcut>().is_err());
    }
}
