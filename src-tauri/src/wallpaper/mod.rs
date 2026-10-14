//! Synchronisation du fond d'écran Windows avec la pochette en cours.

mod render;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use parking_lot::Mutex;
use serde::Deserialize;

use crate::logger::log;
use crate::platform::{http, system};

#[derive(Debug, Clone)]
pub struct Settings {
    pub enabled: bool,
    pub style: String,
    pub intensity: String,
    pub darken: i64,
    pub delay_ms: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self { enabled: false, style: "blur".into(), intensity: "moderate".into(), darken: 20, delay_ms: 800 }
    }
}

/// Champs « fond d'écran » d'un `config-changed` / `wallpaper-sync-status`.
#[derive(Debug, Default, Deserialize)]
pub struct SettingsPatch {
    pub enabled: Option<bool>,
    pub style: Option<String>,
    pub intensity: Option<String>,
    pub darken: Option<serde_json::Value>,
    pub delay: Option<serde_json::Value>,
}

fn as_i64(value: &serde_json::Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_f64().map(|f| f as i64)).or_else(|| value.as_str()?.trim().parse().ok())
}

struct State {
    settings: Settings,
    original: String,
    last_cover: String,
    pending_cover: Option<String>,
    file_index: u8,
}

pub struct WallpaperSync {
    data_dir: PathBuf,
    state: Mutex<State>,
    generation: AtomicU64,
    /// Sérialise les écritures disque / appels SPI.
    apply_lock: Mutex<()>,
}

const TEMP_MARKERS: [&str; 5] =
    ["current_wallpaper", "processed_wallpaper", "liquid-dynamic-island", "liquid dynamic island", "com.nalyd.liquid-dynamic-island"];

impl WallpaperSync {
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            data_dir,
            state: Mutex::new(State {
                settings: Settings::default(),
                original: String::new(),
                last_cover: String::new(),
                pending_cover: None,
                file_index: 1,
            }),
            generation: AtomicU64::new(0),
            apply_lock: Mutex::new(()),
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.state.lock().settings.enabled
    }

    fn is_temp_wallpaper(&self, path: &str) -> bool {
        if path.is_empty() {
            return true;
        }
        let normalized = path.to_lowercase().replace('/', "\\");
        let data_dir = self.data_dir.to_string_lossy().to_lowercase();
        normalized.contains(&data_dir) || TEMP_MARKERS.iter().any(|m| normalized.contains(m))
    }

    fn backup_path(&self) -> PathBuf {
        self.data_dir.join("original_wallpaper_path.txt")
    }

    /// Mémorise le fond d'écran « réel » de l'utilisateur pour pouvoir le restaurer.
    pub fn store_original(&self) {
        let current = system::current_wallpaper();
        log(&format!("[Wallpaper Sync] Fetched wallpaper from registry: {current}"));

        if !current.is_empty() && Path::new(&current).exists() && !self.is_temp_wallpaper(&current) {
            let _ = std::fs::write(self.backup_path(), &current);
            log(&format!("[Wallpaper Sync] Valid original wallpaper stored and backed up: {current}"));
            self.state.lock().original = current;
            return;
        }

        if let Ok(backed_up) = std::fs::read_to_string(self.backup_path()) {
            let backed_up = backed_up.trim().to_string();
            if !backed_up.is_empty() && Path::new(&backed_up).exists() {
                log(&format!("[Wallpaper Sync] Restored original wallpaper path from backup file: {backed_up}"));
                self.state.lock().original = backed_up;
            } else {
                log(&format!("[Wallpaper Sync] Backup file path does not exist on disk: {backed_up}"));
            }
            return;
        }

        log("[Wallpaper Sync] No backup file found. Querying Windows wallpaper history...");
        match system::wallpaper_history().into_iter().find(|p| Path::new(p).exists() && !self.is_temp_wallpaper(p)) {
            Some(found) => {
                let _ = std::fs::write(self.backup_path(), &found);
                log(&format!("[Wallpaper Sync] Recovered original wallpaper from Windows history: {found}"));
                self.state.lock().original = found;
            }
            None => log("[Wallpaper Sync] No real wallpaper found in registry history."),
        }
    }

    /// Annule toute pochette encore en attente et renvoie la génération à passer à
    /// `restore_if_current`. À appeler tout de suite, avant de lancer la restauration en tâche de fond.
    pub fn cancel_pending(&self) -> u64 {
        let mut state = self.state.lock();
        state.pending_cover = None;
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn restore_original(&self) {
        let generation = self.cancel_pending();
        self.restore_if_current(generation);
    }

    /// Remet le fond d'origine, sauf si une pochette a été redemandée depuis `generation`
    /// (synchro coupée puis réactivée aussitôt) : la restauration, arrivée en retard,
    /// effaçait sinon la pochette tout juste réappliquée.
    pub fn restore_if_current(&self, generation: u64) {
        let original = self.state.lock().original.clone();
        let _guard = self.apply_lock.lock();
        if self.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        if !original.is_empty() && Path::new(&original).exists() {
            system::set_wallpaper(&original);
            log("[Wallpaper Sync] Restored original wallpaper");
        } else {
            log("[Wallpaper Sync] Original wallpaper path missing or invalid, skipping restore command");
        }
        self.state.lock().last_cover.clear();
    }

    /// Met à jour les réglages. Renvoie (activé avant, activé après, style modifié).
    pub fn apply_settings(&self, patch: SettingsPatch) -> (bool, bool, bool) {
        let mut state = self.state.lock();
        let before = state.settings.clone();
        let s = &mut state.settings;
        if let Some(style) = patch.style {
            s.style = style;
        }
        if let Some(intensity) = patch.intensity {
            s.intensity = intensity;
        }
        if let Some(darken) = patch.darken.as_ref().and_then(as_i64) {
            s.darken = darken;
        }
        if let Some(delay) = patch.delay.as_ref().and_then(as_i64) {
            s.delay_ms = delay;
        }
        if let Some(enabled) = patch.enabled {
            s.enabled = enabled;
        }
        let style_changed =
            before.style != s.style || before.intensity != s.intensity || before.darken != s.darken || before.delay_ms != s.delay_ms;
        (before.enabled, s.enabled, style_changed)
    }

    /// Force la prochaine mise à jour même si la pochette n'a pas changé.
    pub fn invalidate(&self) {
        let mut state = self.state.lock();
        state.last_cover.clear();
        state.pending_cover = None;
    }

    /// Demande l'application d'une pochette (avec anti-rebond). Pochette vide = restaurer.
    pub fn update(self: &Arc<Self>, cover: String) {
        let delay = {
            let mut state = self.state.lock();
            if !state.settings.enabled {
                return;
            }
            if cover.is_empty() {
                if state.last_cover.is_empty() {
                    return;
                }
                state.pending_cover = None;
                let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
                drop(state);
                let this = Arc::clone(self);
                tauri::async_runtime::spawn_blocking(move || this.restore_if_current(generation));
                return;
            }
            if cover == state.last_cover || state.pending_cover.as_deref() == Some(cover.as_str()) {
                return;
            }
            state.pending_cover = Some(cover.clone());
            state.settings.delay_ms.max(0) as u64
        };

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            if this.generation.load(Ordering::SeqCst) != generation {
                return; // une pochette plus récente a pris le relais
            }
            let _ = tauri::async_runtime::spawn_blocking(move || this.execute(&cover, generation)).await;
        });
    }

    fn execute(&self, cover: &str, generation: u64) {
        let _guard = self.apply_lock.lock();
        // Option coupée ou pochette remplacée pendant l'attente : on n'applique rien.
        let still_wanted = || self.state.lock().settings.enabled && self.generation.load(Ordering::SeqCst) == generation;
        if !still_wanted() {
            self.state.lock().pending_cover = None;
            return;
        }
        let (path, settings) = {
            let mut state = self.state.lock();
            state.file_index = if state.file_index == 1 { 2 } else { 1 };
            (self.data_dir.join(format!("current_wallpaper_{}.jpg", state.file_index)), state.settings.clone())
        };

        let bytes = if let Some(rest) = cover.strip_prefix("data:image/") {
            rest.split_once(";base64,").and_then(|(_, data)| base64::engine::general_purpose::STANDARD.decode(data).ok())
        } else if cover.starts_with("http://") || cover.starts_with("https://") {
            http::get_bytes(cover)
        } else {
            None
        };

        let Some(bytes) = bytes else {
            self.state.lock().pending_cover = None;
            return;
        };
        if let Err(error) = std::fs::write(&path, bytes) {
            log(&format!("[Wallpaper Sync] Failed to update wallpaper: {error}"));
            self.state.lock().pending_cover = None;
            return;
        }

        // Le rendu flou prend du temps : on revérifie juste avant de toucher au bureau.
        if !still_wanted() {
            self.state.lock().pending_cover = None;
            return;
        }
        if settings.style == "sharp" {
            system::set_wallpaper(&path.to_string_lossy());
            log(&format!("[Wallpaper Sync] Applied sharp wallpaper: {}", path.display()));
        } else {
            let style = if settings.style == "cinematic" { "cinematic" } else { "blur" };
            let passes = match settings.intensity.as_str() {
                "light" => 3,
                "strong" => 8,
                _ => 5,
            };
            let darken = settings.darken.clamp(0, 50) as u32;
            render::apply_blurred(&path, style, passes, darken);
            log(&format!(
                "[Wallpaper Sync] Applied blurred/cinematic wallpaper: {} style={style} passes={passes} darken={darken}",
                path.display()
            ));
        }

        let mut state = self.state.lock();
        state.last_cover = cover.to_string();
        state.pending_cover = None;
    }
}
