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
    suspended: bool,
}

pub struct WallpaperSync {
    data_dir: PathBuf,
    state: Mutex<State>,
    generation: AtomicU64,
    /// Sérialise les écritures disque / appels SPI.
    apply_lock: Mutex<()>,
    /// Rendering may be expensive; restoration never waits for this lock.
    render_lock: Mutex<()>,
}

/// Dernier recours : le fond fourni avec Windows, plutôt qu'une pochette laissée sur le bureau.
fn default_wallpaper() -> Option<String> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    ["img0.jpg", "img19.jpg"]
        .iter()
        .map(|name| Path::new(&root).join("Web").join("Wallpaper").join("Windows").join(name))
        .find(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
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
                suspended: false,
            }),
            generation: AtomicU64::new(0),
            apply_lock: Mutex::new(()),
            render_lock: Mutex::new(()),
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.state.lock().settings.enabled
    }

    /// Shutdown/installation must also reject media events that arrive after
    /// the current desktop has been restored.
    pub fn suspend_updates(&self) {
        let mut state = self.state.lock();
        state.suspended = true; state.pending_cover = None;
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
    pub fn resume_updates(&self) {
        let mut state = self.state.lock();
        state.suspended = false; state.last_cover.clear();
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
        match self.find_original() {
            Some(found) => self.state.lock().original = found,
            None => log("[Wallpaper Sync] No real wallpaper found (backup, Windows history)."),
        }
    }

    /// Fond d'origine introuvable dans le registre (le bureau montre une pochette) : copie de
    /// sauvegarde, sinon historique de Windows. Une sauvegarde qui pointe vers un fichier
    /// supprimé ne bloque plus la recherche (le bureau restait sinon coincé sur une pochette).
    fn find_original(&self) -> Option<String> {
        if let Ok(backed_up) = std::fs::read_to_string(self.backup_path()) {
            let backed_up = backed_up.trim().to_string();
            if !backed_up.is_empty() && Path::new(&backed_up).exists() && !self.is_temp_wallpaper(&backed_up) {
                log(&format!("[Wallpaper Sync] Restored original wallpaper path from backup file: {backed_up}"));
                return Some(backed_up);
            }
            log(&format!("[Wallpaper Sync] Backup file path does not exist on disk: {backed_up}"));
        }
        let found = system::wallpaper_history().into_iter().find(|p| Path::new(p).exists() && !self.is_temp_wallpaper(p))?;
        let _ = std::fs::write(self.backup_path(), &found);
        log(&format!("[Wallpaper Sync] Recovered original wallpaper from Windows history: {found}"));
        Some(found)
    }

    /// Démarrage, synchro coupée : si le bureau montre encore une pochette (application
    /// fermée de force, ancienne version), on remet le vrai fond.
    pub fn restore_orphan(&self) {
        let current = system::current_wallpaper();
        if current.is_empty() || !self.is_temp_wallpaper(&current) {
            return;
        }
        log(&format!("[Wallpaper Sync] Desktop still shows a cover while sync is off: {current}"));
        if self.state.lock().original.is_empty() {
            if let Some(found) = self.find_original() {
                self.state.lock().original = found;
            }
        }
        self.restore_original();
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
        let original = if !original.is_empty() && Path::new(&original).exists() { Some(original) } else { self.find_original() };
        match original.or_else(default_wallpaper) {
            Some(path) => {
                system::set_wallpaper(&path);
                log(&format!("[Wallpaper Sync] Restored original wallpaper: {path}"));
            }
            None => log("[Wallpaper Sync] No wallpaper to restore (original, history and Windows default missing)"),
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
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Demande l'application d'une pochette (avec anti-rebond). Pochette vide = restaurer.
    pub fn update(self: &Arc<Self>, cover: String) {
        if cover.len() > http::MAX_IMAGE_BYTES * 4 / 3 + 256 { return; }
        let (delay, generation) = {
            let mut state = self.state.lock();
            if !state.settings.enabled || state.suspended {
                return;
            }
            if cover.is_empty() {
                if state.last_cover.is_empty() && state.pending_cover.is_none() {
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
            (state.settings.delay_ms.clamp(0, 30_000) as u64, self.generation.fetch_add(1, Ordering::SeqCst) + 1)
        };

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
        let cancelled = || {
            let state = self.state.lock();
            !state.settings.enabled || state.suspended || self.generation.load(Ordering::SeqCst) != generation
        };
        if cancelled() { return; }
        let settings = self.state.lock().settings.clone();
        let bytes = if let Some(rest) = cover.strip_prefix("data:image/") {
            rest.split_once(";base64,").and_then(|(_, data)| base64::engine::general_purpose::STANDARD.decode(data).ok())
        } else if cover.starts_with("http://") || cover.starts_with("https://") {
            http::get_bytes_cancellable(cover, &cancelled)
        } else {
            None
        };

        let Some(bytes) = bytes else {
            self.clear_pending(generation);
            return;
        };
        if bytes.len() > http::MAX_IMAGE_BYTES || cancelled() { self.clear_pending(generation); return; }
        if std::fs::create_dir_all(&self.data_dir).is_err() { self.clear_pending(generation); return; }
        let Ok(staged) = tempfile::Builder::new().prefix("wallpaper-stage-").tempdir_in(&self.data_dir) else { self.clear_pending(generation); return; };
        let rendered = staged.path().join("wallpaper.jpg");
        {
            let _render = self.render_lock.lock();
            if cancelled() { return; }
            let passes = match settings.intensity.as_str() { "light" => 3, "strong" => 8, _ => 5 };
            if let Err(error) = render::prepare(&bytes, &rendered, &settings.style, passes, settings.darken.clamp(0, 50) as u32, system::largest_screen_size(), &cancelled) {
                if !cancelled() { log(&format!("[Wallpaper Sync] Cover render failed: {error}")); }
                self.clear_pending(generation);
                return;
            }
        }
        // Network and image processing have finished. Only the short atomic
        // publication and SPI call share the restoration lock.
        let _apply = self.apply_lock.lock();
        let mut state = self.state.lock();
        if !state.settings.enabled || state.suspended || self.generation.load(Ordering::SeqCst) != generation { return; }
        let next_index = if state.file_index == 1 { 2 } else { 1 };
        let path = self.data_dir.join(format!("current_wallpaper_{next_index}.jpg"));
        let publish = || -> Result<(), String> {
            let mut temporary = tempfile::NamedTempFile::new_in(&self.data_dir).map_err(|e| e.to_string())?;
            let mut image = std::fs::File::open(&rendered).map_err(|e| e.to_string())?;
            std::io::copy(&mut image, temporary.as_file_mut()).and_then(|_| temporary.as_file().sync_all()).map_err(|e| e.to_string())?;
            temporary.persist(&path).map_err(|e| e.to_string())?;
            system::set_wallpaper(&path.to_string_lossy());
            Ok(())
        };
        if let Err(error) = publish() {
            log(&format!("[Wallpaper Sync] Wallpaper publication failed: {error}"));
            state.pending_cover = None;
            return;
        }
        state.file_index = next_index;
        state.last_cover = cover.to_string();
        state.pending_cover = None;
    }

    fn clear_pending(&self, generation: u64) {
        let mut state = self.state.lock();
        if self.generation.load(Ordering::SeqCst) == generation { state.pending_cover = None; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_superseded_worker_cannot_clear_the_new_pending_cover() {
        let dir = tempfile::tempdir().unwrap(); let sync = WallpaperSync::new(dir.path().into());
        sync.state.lock().pending_cover = Some("new cover".into());
        sync.generation.store(2, Ordering::SeqCst);
        sync.clear_pending(1);
        assert_eq!(sync.state.lock().pending_cover.as_deref(), Some("new cover"));
        sync.clear_pending(2); assert!(sync.state.lock().pending_cover.is_none());
    }
    #[test]
    fn cancelling_a_pending_render_invalidates_its_generation_without_waiting_for_rendering() {
        let dir = tempfile::tempdir().unwrap(); let sync = WallpaperSync::new(dir.path().into());
        sync.state.lock().pending_cover = Some("cover".into());
        let _render = sync.render_lock.lock();
        assert_eq!(sync.cancel_pending(), 1);
        assert!(sync.state.lock().pending_cover.is_none());
        assert!(sync.apply_lock.try_lock().is_some());
    }
    #[test]
    fn shutdown_suspension_rejects_new_media_events_until_an_explicit_resume() {
        let dir = tempfile::tempdir().unwrap(); let sync = WallpaperSync::new(dir.path().into());
        sync.state.lock().settings.enabled = true;
        sync.suspend_updates();
        let generation = sync.generation.load(Ordering::SeqCst);
        sync.update("data:image/png;base64,ignored".into());
        assert_eq!(sync.generation.load(Ordering::SeqCst), generation);
        assert!(sync.state.lock().pending_cover.is_none());
        sync.resume_updates(); assert!(!sync.state.lock().suspended); assert!(sync.is_enabled());
    }
}
