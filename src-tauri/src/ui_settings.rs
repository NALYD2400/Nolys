//! Réglages de l'interface (clés `liquid_*` du `localStorage`) rangés dans un fichier.
//!
//! Le `localStorage` de WebView2 est séparé par origine : `npm run dev` (localhost:1420)
//! et l'appli installée (tauri.localhost) avaient chacun leurs réglages. Le fichier
//! `ui-settings.json` du dossier de données devient la référence commune ; l'interface
//! le reçoit avant son premier script (voir `init_script` et `src/shared/settings-store.js`)
//! et y renvoie chaque modification.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::logger::log;

const FILE: &str = "ui-settings.json";
/// Origine de l'appli installée : ses réglages priment lors de la première reprise.
const INSTALLED_ORIGIN: &str = "http://tauri.localhost";
/// Une valeur au-delà est refusée (historique, couleurs… restent bien en dessous).
const MAX_VALUE_LEN: usize = 4 * 1024 * 1024;

/// Clés gérées : celles des réglages, et la configuration complète envoyée à l'Island.
pub fn is_synced_key(key: &str) -> bool {
    key.starts_with("liquid_") || key == "island_standalone_config"
}

#[derive(Default, Serialize, Deserialize)]
struct Document {
    version: u32,
    values: BTreeMap<String, String>,
}

pub struct Store {
    path: PathBuf,
    /// `None` tant qu'aucun fichier n'existe : l'interface y versera alors son `localStorage`.
    values: Mutex<Option<BTreeMap<String, String>>>,
}

impl Store {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join(FILE);
        let values = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Document>(&bytes) {
                Ok(document) => Some(filter(document.values)),
                Err(error) => {
                    // Fichier abîmé : on le met de côté et l'interface renverra ses valeurs.
                    log(&format!("[Settings] Unreadable {FILE}, set aside: {error}"));
                    let _ = std::fs::rename(&path, path.with_extension("json.bak"));
                    None
                }
            },
            Err(_) => None,
        };
        Self { path, values: Mutex::new(values) }
    }

    pub fn is_initialized(&self) -> bool {
        self.values.lock().is_some()
    }

    /// Premier remplissage, s'il n'y a encore rien. Renvoie `false` si le fichier existait déjà.
    pub fn seed(&self, values: BTreeMap<String, String>) -> Result<bool, String> {
        let mut current = self.values.lock();
        if current.is_some() {
            return Ok(false);
        }
        let values = filter(values);
        self.save(&values)?;
        *current = Some(values);
        Ok(true)
    }

    /// Applique des modifications (`None` = clé supprimée) et réécrit le fichier.
    pub fn apply(&self, changes: BTreeMap<String, Option<String>>) -> Result<(), String> {
        let mut current = self.values.lock();
        let mut values = current.clone().unwrap_or_default();
        for (key, value) in changes {
            if !is_synced_key(&key) {
                continue;
            }
            match value {
                Some(value) if value.len() <= MAX_VALUE_LEN => {
                    values.insert(key, value);
                }
                Some(_) => log(&format!("[Settings] Value too large for {key}, ignored")),
                None => {
                    values.remove(&key);
                }
            }
        }
        self.save(&values)?;
        *current = Some(values);
        Ok(())
    }

    /// Script injecté avant la page : l'instantané lu de façon synchrone par l'interface.
    pub fn init_script(&self) -> String {
        let current = self.values.lock();
        let snapshot = serde_json::json!({ "initialized": current.is_some(), "values": current.clone().unwrap_or_default() });
        format!("window.__NOLYS_UI_SETTINGS__ = {snapshot};")
    }

    /// Écriture atomique : fichier temporaire puis remplacement.
    fn save(&self, values: &BTreeMap<String, String>) -> Result<(), String> {
        let document = Document { version: 1, values: values.clone() };
        let json = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &self.path).map_err(|e| e.to_string())
    }
}

fn filter(values: BTreeMap<String, String>) -> BTreeMap<String, String> {
    values.into_iter().filter(|(key, value)| is_synced_key(key) && value.len() <= MAX_VALUE_LEN).collect()
}

/// Au premier lancement, reprend les réglages de l'appli installée (origine `tauri.localhost`),
/// même si c'est `npm run dev` qui démarre en premier. Sans eux, l'interface versera son propre
/// `localStorage` (voir `ui_settings_seed`).
pub fn import_installed_settings(app: &AppHandle, store: &Store, data_dir: &Path) {
    if store.is_initialized() {
        return;
    }
    let Ok(local) = app.path().app_local_data_dir() else { return };
    let source = local.join("EBWebView").join("Default").join("Local Storage").join("leveldb");
    if !source.is_dir() {
        return;
    }
    let entries = match crate::migration::read_local_storage(&source, data_dir, INSTALLED_ORIGIN) {
        Ok(entries) => filter(entries),
        Err(error) => {
            log(&format!("[Settings] Could not read the installed app settings: {error}"));
            return;
        }
    };
    if entries.is_empty() {
        return;
    }
    let count = entries.len();
    match store.seed(entries) {
        Ok(_) => log(&format!("[Settings] Imported {count} settings from the installed app")),
        Err(error) => log(&format!("[Settings] Could not write {FILE}: {error}")),
    }
}

#[tauri::command]
pub async fn ui_settings_write(app: AppHandle, changes: BTreeMap<String, Option<String>>) -> Result<(), String> {
    crate::commands::blocking(move || app.state::<Store>().apply(changes), Err("interrompu".into())).await
}

#[tauri::command]
pub async fn ui_settings_seed(app: AppHandle, values: BTreeMap<String, String>) -> Result<bool, String> {
    crate::commands::blocking(move || app.state::<Store>().seed(values), Err("interrompu".into())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::load(dir.path());
        (dir, store)
    }

    #[test]
    fn only_interface_keys_are_kept() {
        assert!(is_synced_key("liquid_motion_level"));
        assert!(is_synced_key("island_standalone_config"));
        assert!(!is_synced_key("debug"));
        assert!(!is_synced_key("__nolys"));
    }

    #[test]
    fn seed_happens_once_and_survives_reload() {
        let (dir, store) = store();
        assert!(!store.is_initialized());
        let values = BTreeMap::from([("liquid_motion_level".into(), "vivid".into()), ("other".into(), "x".into())]);
        assert!(store.seed(values).unwrap());
        assert!(!store.seed(BTreeMap::from([("liquid_motion_level".into(), "sober".into())])).unwrap());

        let reloaded = Store::load(dir.path());
        assert!(reloaded.is_initialized());
        let script = reloaded.init_script();
        assert!(script.contains("\"liquid_motion_level\":\"vivid\""));
        assert!(!script.contains("other"));
    }

    #[test]
    fn apply_sets_and_removes_keys() {
        let (dir, store) = store();
        store.apply(BTreeMap::from([("liquid_a".into(), Some("1".into())), ("liquid_b".into(), Some("2".into()))])).unwrap();
        store.apply(BTreeMap::from([("liquid_a".into(), None), ("ignored".into(), Some("3".into()))])).unwrap();
        let values = Store::load(dir.path()).values.into_inner().unwrap();
        assert_eq!(values, BTreeMap::from([("liquid_b".into(), "2".into())]));
    }

    #[test]
    fn corrupted_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), b"{oops").unwrap();
        let store = Store::load(dir.path());
        assert!(!store.is_initialized());
        assert!(dir.path().join("ui-settings.json.bak").exists());
        assert!(store.init_script().contains("\"initialized\":false"));
    }
}
