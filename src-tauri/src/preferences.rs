//! Sauvegardes des préférences : validation avant écriture et retour arrière sur erreur.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use crate::{files, island::{self, layout}, platform::mic_monitor, replay, state::AppState};

static RESTORE: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bundle {
    version: u32,
    layout: layout::Layout,
    microphone: mic_monitor::MonitorConfig,
    replay: replay::Config,
    files: files::Configuration,
}
impl Bundle {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 || !self.layout.x.is_finite() || !self.layout.y.is_finite()
            || !(0.65..=1.5).contains(&self.layout.scale) || self.layout.display_id.len() > 512 {
            return Err("Position ou version de sauvegarde invalide.".into());
        }
        self.microphone.validate()?;
        self.replay.validate()?;
        self.files.options.validate()?;
        if !std::path::Path::new(&self.replay.destination).is_absolute() || !self.files.destination.is_absolute() {
            return Err("La sauvegarde contient un dossier de destination invalide.".into());
        }
        Ok(())
    }
}
fn snapshot(app: &AppHandle) -> Bundle {
    Bundle { version: 1, layout: app.state::<AppState>().layout.lock().clone(),
        microphone: mic_monitor::status().config, replay: app.state::<replay::Store>().snapshot().config,
        files: app.state::<files::Store>().preferences() }
}
#[tauri::command]
pub fn preferences_bundle(app: AppHandle) -> Bundle { snapshot(&app) }

#[tauri::command]
pub async fn preferences_restore(app: AppHandle, bundle: Bundle) -> Result<(), String> {
    crate::commands::blocking(move || restore(&app, bundle), Err("Restauration interrompue.".into())).await
}
fn restore(app: &AppHandle, mut bundle: Bundle) -> Result<(), String> {
    let _guard = RESTORE.lock();
    bundle.validate()?;
    // Le fichier importé ne peut ni activer le micro ni lancer une capture.
    bundle.microphone.enabled = false;
    let state = app.state::<AppState>();
    let files = app.state::<files::Store>();
    let replay = app.state::<replay::Store>();
    if files.snapshot().jobs.iter().any(|j| ["queued", "running", "cancelling"].contains(&j.status.as_str())) {
        return Err("Attendez la fin des traitements de fichiers avant d’importer.".into());
    }
    let capture = replay.snapshot();
    if capture.phase != "idle" || capture.exporting || capture.recording {
        return Err("Arrêtez la capture et attendez la fin des exports avant d’importer.".into());
    }
    let before = snapshot(app);
    // Le journal de récupération est écrit avant toute mutation et ne contient que des préférences.
    let recovery = state.data_dir.join("preferences-before-import.json");
    use std::io::Write;
    let mut temporary = tempfile::NamedTempFile::new_in(&state.data_dir).map_err(|e| e.to_string())?;
    temporary.write_all(&serde_json::to_vec_pretty(&before).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&recovery).map_err(|e| e.to_string())?;
    let next_layout = layout::clamp(app, &bundle.layout);
    let (mut files_changed, mut replay_changed, mut layout_changed) = (false, false, false);
    let result = (|| {
        files.set_preferences(bundle.files)?;
        files_changed = true;
        replay.configure(bundle.replay)?;
        replay_changed = true;
        layout::save_checked(&state.data_dir, &next_layout)?;
        layout_changed = true;
        mic_monitor::restore_preferences(bundle.microphone)?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let mut rollback = Vec::new();
        if files_changed { if let Err(e) = files.set_preferences(before.files) { rollback.push(e); } }
        if replay_changed { if let Err(e) = replay.configure(before.replay) { rollback.push(e); } }
        if layout_changed { if let Err(e) = layout::save_checked(&state.data_dir, &before.layout) { rollback.push(e); } }
        if rollback.is_empty() { return Err(error); }
        return Err(format!("{error} Récupération incomplète : {}. La copie précédente est conservée.", rollback.join(" ; ")));
    }
    *state.layout.lock() = next_layout;
    island::apply_layout(app);
    files.emit(app);
    let _ = app.emit_to(island::LABEL, "replay-preferences-restored", replay.snapshot());
    let _ = app.emit_to(island::LABEL, "mic-monitor-changed", mic_monitor::status());
    Ok(())
}

#[tauri::command]
pub async fn reset_microphone_preferences(app: AppHandle) -> Result<(), String> {
    crate::commands::blocking(move || {
        mic_monitor::restore_preferences(mic_monitor::MonitorConfig::default())?;
        let _ = app.emit_to(island::LABEL, "mic-monitor-changed", mic_monitor::status());
        Ok(())
    }, Err("Réinitialisation interrompue.".into())).await
}

fn diagnostic(app: &AppHandle) -> Value {
    let files = app.state::<files::Store>().snapshot();
    let replay = app.state::<replay::Store>().snapshot();
    let mic = mic_monitor::status();
    let library = app.state::<crate::library::Store>();
    json!({ "version": app.package_info().version.to_string(), "platform": std::env::consts::OS,
        "development": cfg!(debug_assertions), "offline": crate::platform::http::is_offline(),
        "files": {"jobs": files.jobs.len(), "repairNeeded": files.repairable,
            "exportBytes": files.jobs.iter().flat_map(|j| j.outputs.iter()).map(|o| o.size).sum::<u64>()},
        "replay": {"phase": replay.phase, "engineAvailable": replay.engine_available, "clips": replay.clips.len(),
            "indexedBytes": replay.clips.iter().map(|c| c.bytes).sum::<u64>(), "recoveryFiles": replay.recovery_files,
            "cache": app.state::<replay::Store>().cache_usage(false).ok()},
        "library": {"tracks": library.read().ok().map(|l| l.tracks.len()), "cache": library.cache_info().ok()},
        "microphone": {"running":mic.running, "sampleRate":mic.sample_rate, "latencyMs":mic.latency_ms,
            "inputFallback":mic.input_fallback, "outputFallback":mic.output_fallback},
        "settingsStored": app.state::<crate::ui_settings::Store>().is_initialized()
    })
}
#[tauri::command]
pub async fn maintenance_info(app: AppHandle) -> Value {
    crate::commands::blocking(move || diagnostic(&app), json!({"error":"Diagnostic indisponible"})).await
}
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle) -> Result<bool, String> {
    let info = maintenance_info(app.clone()).await;
    crate::commands::app::save_settings_file(app, serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?, "nolys-diagnostic.json".into()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_rejects_unknown_versions_and_paths_before_any_write() {
        let mut bundle = Bundle { version: 1, layout: layout::Layout {x:0., y:0., scale:1., display_id:"primary".into()},
            microphone: mic_monitor::MonitorConfig::default(), replay: replay::Config::default(),
            files: files::Configuration { options: files::Preferences::default(), destination: std::env::temp_dir() } };
        bundle.replay.destination = std::env::temp_dir().to_string_lossy().into();
        assert!(bundle.validate().is_ok());
        bundle.microphone.volume = 201;
        assert!(bundle.validate().is_err());
        bundle.microphone.volume = 60;
        bundle.layout.scale = f64::NAN;
        assert!(bundle.validate().is_err());
        bundle.layout.scale = 1.; bundle.version = 9;
        assert!(bundle.validate().is_err());
    }
}
