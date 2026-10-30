//! Mises à jour automatiques via les releases GitHub (plugin updater de Tauri).
//!
//! Expose le même cycle d'états que l'ancien `electron-updater` pour que la
//! carte « Mises à jour » des réglages fonctionne sans changement.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::events;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub release_name: String,
    pub release_date: String,
    pub progress: u32,
    pub downloaded: bool,
    pub error: String,
    pub checked_at: Option<String>,
    pub can_check: bool,
    pub can_download: bool,
    pub can_install: bool,
    #[serde(skip)]
    pending: Option<Update>,
    #[serde(skip)]
    bytes: Option<Vec<u8>>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            current_version: String::new(),
            available_version: None,
            release_name: String::new(),
            release_date: String::new(),
            progress: 0,
            downloaded: false,
            error: String::new(),
            checked_at: None,
            can_check: false,
            can_download: false,
            can_install: false,
            pending: None,
            bytes: None,
        }
    }
}

impl UpdateStatus {
    fn begin_check(&mut self) -> bool {
        if matches!(
            self.state.as_str(),
            "checking" | "downloading" | "installing"
        ) {
            return false;
        }
        self.state = "checking".into();
        true
    }
    /// Public snapshots never clone the downloaded installer or updater handle.
    fn public_snapshot(&self) -> Self {
        Self {
            state: self.state.clone(),
            current_version: self.current_version.clone(),
            available_version: self.available_version.clone(),
            release_name: self.release_name.clone(),
            release_date: self.release_date.clone(),
            progress: self.progress,
            downloaded: self.downloaded,
            error: self.error.clone(),
            checked_at: self.checked_at.clone(),
            can_check: self.can_check,
            can_download: self.can_download,
            can_install: self.can_install,
            pending: None,
            bytes: None,
        }
    }
}

const IS_PACKAGED: bool = !cfg!(debug_assertions);

/// État public (avec les drapeaux `can*` recalculés).
pub fn status(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<AppState>();
    let mut status = state.update.lock().public_snapshot();
    let busy = matches!(
        status.state.as_str(),
        "checking" | "downloading" | "installing"
    );
    status.current_version = app.package_info().version.to_string();
    status.can_check = IS_PACKAGED && !busy;
    status.can_download = IS_PACKAGED && status.state == "available";
    status.can_install = IS_PACKAGED && status.state == "downloaded";
    status
}

fn set(
    app: &AppHandle,
    notify_island: bool,
    patch: impl FnOnce(&mut UpdateStatus),
) -> UpdateStatus {
    patch(&mut app.state::<AppState>().update.lock());
    let public = status(app);
    let _ = app.emit(events::UPDATE_STATUS_CHANGED, &public);
    if notify_island {
        let version = public
            .available_version
            .clone()
            .unwrap_or_else(|| "récente".into());
        // Deux messages : « disponible » tant qu'on ne l'a pas téléchargée, « prête » ensuite.
        let (title, message) = if public.state == "downloaded" {
            (
                "Mise à jour prête".to_string(),
                format!("Version {version} à installer dans les réglages"),
            )
        } else {
            (
                "Mise à jour disponible".to_string(),
                format!("Version {version} : télécharge-la dans les réglages"),
            )
        };
        let _ = app.emit_to(
            crate::island::LABEL,
            events::TRIGGER_NOTIF,
            serde_json::json!({ "title": title, "message": message, "icon": "ph-download-simple" }),
        );
    }
    public
}

fn fail(app: &AppHandle, message: String) -> UpdateStatus {
    crate::logger::log(&format!("[Updater] {message}"));
    set(app, false, |s| {
        s.state = "error".into();
        s.error = message;
        s.progress = 0;
    })
}

pub async fn check(app: AppHandle) -> UpdateStatus {
    if !IS_PACKAGED {
        return set(&app, false, |s| {
            s.state = "dev".into();
            s.error.clear();
            s.checked_at = Some(crate::logger::iso_now());
        });
    }
    if !app.state::<AppState>().update.lock().begin_check() {
        return status(&app);
    }
    if crate::platform::http::is_offline() {
        return fail(&app, "Le mode hors ligne bloque la recherche de mises à jour. Désactivez-le dans Confidentialité pour réessayer.".into());
    }

    set(&app, false, |s| {
        s.state = "checking".into();
        s.progress = 0;
        s.error.clear();
        s.checked_at = Some(crate::logger::iso_now());
    });

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => return fail(&app, error.to_string()),
    };
    match updater.check().await {
        Ok(Some(update)) => set(&app, true, |s| {
            s.state = "available".into();
            s.available_version = Some(update.version.clone());
            s.release_name = format!("Version {}", update.version);
            s.release_date = update.date.map(|d| d.to_string()).unwrap_or_default();
            s.progress = 0;
            s.downloaded = false;
            s.error.clear();
            s.pending = Some(update);
            s.bytes = None;
        }),
        Ok(None) => set(&app, false, |s| {
            s.state = "up-to-date".into();
            s.available_version = None;
            s.release_name.clear();
            s.release_date.clear();
            s.progress = 0;
            s.downloaded = false;
            s.error.clear();
            s.checked_at = Some(crate::logger::iso_now());
            s.pending = None;
            s.bytes = None;
        }),
        Err(error) => fail(&app, error.to_string()),
    }
}

pub async fn download(app: AppHandle) -> UpdateStatus {
    let pending = {
        let state = app.state::<AppState>();
        let mut status = state.update.lock();
        if !IS_PACKAGED || status.state != "available" {
            None
        } else {
            let pending = status.pending.clone();
            if pending.is_some() {
                status.state = "downloading".into();
            }
            pending
        }
    };
    let Some(update) = pending else {
        return status(&app);
    };
    if crate::platform::http::is_offline() {
        return set(&app, false, |status| {
            status.state = "available".into();
            status.error = "Le mode hors ligne bloque le téléchargement. Désactivez-le dans Confidentialité pour réessayer.".into();
        });
    }

    set(&app, false, |s| {
        s.state = "downloading".into();
        s.progress = 0;
        s.error.clear();
    });

    let progress_app = app.clone();
    let mut received = 0usize;
    let result = update
        .download(
            move |chunk, total| {
                received += chunk;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = ((received as f64 / total as f64) * 100.0)
                        .round()
                        .clamp(0.0, 100.0) as u32;
                    if percent != progress_app.state::<AppState>().update.lock().progress {
                        set(&progress_app, false, |s| s.progress = percent);
                    }
                }
            },
            || {},
        )
        .await;

    match result {
        Ok(bytes) => set(&app, true, |s| {
            s.state = "downloaded".into();
            s.progress = 100;
            s.downloaded = true;
            s.error.clear();
            s.bytes = Some(bytes);
        }),
        Err(error) => fail(&app, error.to_string()),
    }
}

pub async fn install(app: AppHandle) -> UpdateStatus {
    let ready = {
        let state = app.state::<AppState>();
        let mut status = state.update.lock();
        if !IS_PACKAGED || status.state != "downloaded" {
            None
        } else {
            let ready = status.pending.clone().zip(status.bytes.take());
            if ready.is_some() {
                status.state = "installing".into();
            }
            ready
        }
    };
    let Some((update, bytes)) = ready else {
        return status(&app);
    };

    let public = set(&app, false, |s| {
        s.state = "installing".into();
        s.error.clear();
    });

    let suspended = match prepare_shutdown(&app).await {
        Ok(suspended) => suspended,
        Err(error) => return restore_download(&app, bytes, error),
    };
    // The plugin exits Windows only after launching the installer. Keep ownership of
    // the download here so a launch failure remains retryable without another download.
    let installer = tauri::async_runtime::spawn_blocking(move || {
        let result = update.install(&bytes).map_err(|e| e.to_string());
        (bytes, result)
    })
    .await;
    match installer {
        Ok((bytes, Err(error))) => {
            resume_after_failed_install(&app, suspended);
            return restore_download(&app, bytes, error);
        }
        Err(error) => {
            resume_after_failed_install(&app, suspended);
            return fail(&app, format!("L’installateur s’est interrompu : {error}. Vérifiez à nouveau les mises à jour."));
        }
        Ok((_, Ok(()))) => {}
    }
    public
}

fn restore_download(app: &AppHandle, bytes: Vec<u8>, error: String) -> UpdateStatus {
    set(app, false, |status| {
        status.state = "downloaded".into();
        status.error = format!("Installation interrompue : {error}. Vous pouvez réessayer ; relancez vos captures si nécessaire.");
        status.bytes = Some(bytes);
    })
}

pub struct SuspendedServices {
    files_enabled: bool,
}
static SHUTDOWN_ACTIVE: AtomicBool = AtomicBool::new(false);
pub fn is_shutting_down() -> bool {
    SHUTDOWN_ACTIVE.load(Ordering::Acquire)
}

/// Shared by Quit and Install: block new jobs, finalize capture, drain files and
/// stop monitoring before restoring the desktop. Never launch an installer while
/// a file operation is still active after its bounded cancellation period.
pub async fn prepare_shutdown(app: &AppHandle) -> Result<SuspendedServices, String> {
    if SHUTDOWN_ACTIVE.swap(true, Ordering::AcqRel) {
        return Err("Un arrêt ou une installation est déjà en cours.".into());
    }
    app.state::<AppState>().wallpaper.suspend_updates();
    let suspended = SuspendedServices {
        files_enabled: app.state::<crate::files::Store>().begin_update(),
    };
    app.state::<crate::replay::Store>().request_stop();
    let handle = app.clone();
    let replay = tauri::async_runtime::spawn_blocking(move || {
        handle.state::<crate::replay::Store>().shutdown()
    });
    let microphone = tauri::async_runtime::spawn_blocking(crate::platform::mic_monitor::shutdown);
    crate::files::wait_for_shutdown(app).await;
    let replay_result = replay.await;
    let mic_result = microphone.await;
    if replay_result.is_err()
        || mic_result.is_err()
        || app.state::<crate::files::Store>().has_active_work()
    {
        resume_after_failed_install(app, suspended);
        return Err(
            "Un service n’a pas terminé son arrêt. Attendez la fin des traitements puis réessayez."
                .into(),
        );
    }
    let wallpaper = app.state::<AppState>().wallpaper.clone();
    if wallpaper.is_enabled() {
        if tauri::async_runtime::spawn_blocking(move || wallpaper.restore_original())
            .await
            .is_err()
        {
            resume_after_failed_install(app, suspended);
            return Err("La restauration du bureau n’a pas pu se terminer.".into());
        }
    }
    Ok(suspended)
}

fn resume_after_failed_install(app: &AppHandle, suspended: SuspendedServices) {
    app.state::<crate::files::Store>()
        .resume_after_update_failure(suspended.files_enabled);
    app.state::<crate::replay::Store>()
        .resume_after_update_failure();
    app.state::<AppState>().wallpaper.resume_updates();
    SHUTDOWN_ACTIVE.store(false, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_check_never_overrides_a_download_or_install_in_progress() {
        let mut status = UpdateStatus::default();
        assert!(status.begin_check());
        assert!(!status.begin_check());
        for state in ["downloading", "installing"] {
            status.state = state.into();
            assert!(!status.begin_check());
            assert_eq!(status.state, state);
        }
    }
    #[test]
    fn repeated_public_snapshots_exclude_installer_bytes() {
        let status = UpdateStatus {
            state: "downloaded".into(),
            downloaded: true,
            bytes: Some(vec![42; 1024 * 1024]),
            ..Default::default()
        };
        let pointer = status.bytes.as_ref().unwrap().as_ptr();
        for _ in 0..20 {
            let public = status.public_snapshot();
            assert!(public.bytes.is_none());
            assert!(public.pending.is_none());
            assert_eq!(public.state, "downloaded");
            assert!(public.downloaded);
            let json = serde_json::to_value(public).unwrap();
            assert!(json.get("bytes").is_none());
            assert!(json.get("pending").is_none());
        }
        assert_eq!(status.bytes.as_ref().unwrap().as_ptr(), pointer);
        assert_eq!(status.bytes.as_ref().unwrap().len(), 1024 * 1024);
    }
}
