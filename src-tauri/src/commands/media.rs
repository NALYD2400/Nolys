use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::blocking;
use crate::media::{self, cover_lookup, MediaInfo, Poll};
use crate::platform::smtc::{self, Command};
use crate::state::AppState;

/// Délai maximal accordé au lecteur (au-delà : considéré comme sans média).
const POLL_TIMEOUT: Duration = Duration::from_millis(600);

#[tauri::command]
pub async fn get_media_info(app: AppHandle) -> MediaInfo {
    let poll = tokio::time::timeout(POLL_TIMEOUT, tauri::async_runtime::spawn_blocking(media::poll_player)).await;
    let poll = match poll {
        Ok(Ok(poll)) => poll,
        _ => Poll { media: None, source: "" },
    };

    let state = app.state::<AppState>();
    let no_media = poll.media.is_none();
    let outcome = state.media.lock().apply(poll);
    if no_media {
        log_diagnostics_throttled();
    }

    if let Some(cover) = outcome.wallpaper_cover {
        state.wallpaper.update(cover);
    }
    if let Some((title, artist, key)) = outcome.cover_lookup {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let found = blocking(move || cover_lookup::fetch(&title, &artist), String::new()).await;
            let state = handle.state::<AppState>();
            let applied = state.media.lock().apply_found_cover(&key, found.clone());
            if applied {
                state.wallpaper.update(found);
            }
        });
    }
    outcome.media
}

/// Diagnostic SMTC dans le journal, au plus toutes les 20 s quand rien n'est détecté.
fn log_diagnostics_throttled() {
    static LAST: parking_lot::Mutex<Option<std::time::Instant>> = parking_lot::Mutex::new(None);
    let mut last = LAST.lock();
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(20)) {
        return;
    }
    *last = Some(std::time::Instant::now());
    let (ready, failures, error) = smtc::diagnostics();
    crate::logger::log(&format!("[Core diagnostics:no_media] smtcReady={ready} smtcFailures={failures} lastSmtcError=\"{error}\""));
}

fn parse_command(action: &str) -> Option<(Command, &'static str)> {
    let clean = action.trim().to_lowercase();
    let command = match clean.as_str() {
        "toggle" => (Command::Toggle, "toggle"),
        "play" => (Command::Play, "play"),
        "pause" => (Command::Pause, "pause"),
        "next" => (Command::Next, "next"),
        "prev" => (Command::Prev, "prev"),
        other => {
            let ms = other.strip_prefix("seek ")?.trim();
            if ms.is_empty() || ms.len() > 10 || !ms.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            (Command::Seek(ms.parse().ok()?), "seek")
        }
    };
    Some(command)
}

#[tauri::command]
pub fn media_control(app: AppHandle, action: String) {
    // Raccourcis clavier pendant la lecture d’un fichier local : c’est l’Island qui joue.
    if app.state::<crate::library::Store>().player_active.load(std::sync::atomic::Ordering::SeqCst) {
        use tauri::Emitter;
        let _ = app.emit_to(crate::island::LABEL, crate::library::CONTROL, action);
        return;
    }
    let Some((command, name)) = parse_command(&action) else { return };
    app.state::<AppState>().media.lock().note_command(name);
    tauri::async_runtime::spawn_blocking(move || smtc::send(command));
}
