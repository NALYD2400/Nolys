use super::{
    authorize, collect, mutate, path_key, read_track, Library, Mutation, Playback, Store, CHANGED,
    CONTROL, EXTENSIONS, PLAYBACK,
};
use std::{collections::HashSet, path::Path};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

fn audio_dialog(app: &AppHandle, title: &str) -> rfd::FileDialog {
    let mut dialog = rfd::FileDialog::new()
        .set_title(title)
        .add_filter("Musique", EXTENSIONS);
    if let Some(window) = app.get_webview_window(crate::island::LABEL) {
        dialog = dialog.set_parent(&window);
    }
    dialog
}

#[tauri::command]
pub async fn library_open(app: AppHandle) -> Result<(), String> {
    super::open(&app).map_err(|error| {
        crate::logger::log(&format!("[Library] Failed to open window: {error}"));
        format!("Impossible d’ouvrir la bibliothèque. Relance Nolys puis réessaie. Détail : {error}")
    })
}

#[tauri::command]
pub async fn library_workspace(app: AppHandle, expanded: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let window = crate::island::window(&app).ok_or("Island introuvable.")?;
    app.state::<crate::state::AppState>().library_expanded.store(expanded, Ordering::SeqCst);
    crate::island::apply_layout(&app);
    if expanded {
        window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn library_get(app: AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || authorize(&app, app.state::<Store>().read()?))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    library: Library,
    added: usize,
    duplicates: usize,
    skipped: usize,
    cancelled: bool,
}

#[tauri::command]
pub async fn library_import(app: AppHandle, kind: String) -> Result<ImportResult, String> {
    {
        let store = app.state::<Store>();
        let mut importing = store.importing.lock();
        if *importing {
            return Err("Un import est déjà en cours.".into());
        }
        *importing = true;
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let store = handle.state::<Store>();
        let previous = store.read()?;
        let dialog = audio_dialog(&handle, "Ajouter de la musique à Nolys");
        let paths = match kind.as_str() {
            "files" => dialog.pick_files(),
            "folder" => dialog.pick_folder().map(|p| vec![p]),
            _ => return Err("Type d’import inconnu.".into()),
        };
        let Some(paths) = paths else {
            return Ok(ImportResult {
                library: authorize(&handle, previous)?,
                added: 0,
                duplicates: 0,
                skipped: 0,
                cancelled: true,
            });
        };
        let (files, skipped) = collect(paths);
        let known: HashSet<_> = previous.tracks.iter().map(|t| path_key(&t.path)).collect();
        let mut duplicates = 0;
        let tracks: Vec<_> = files
            .iter()
            .filter_map(|path| {
                if known.contains(&path_key(&path.to_string_lossy())) {
                    duplicates += 1;
                    None
                } else {
                    Some(read_track(path, &store.covers_dir()))
                }
            })
            .collect();
        let mut added = 0;
        let library = store.change(|library| {
            let mut known: HashSet<_> = library.tracks.iter().map(|t| path_key(&t.path)).collect();
            for track in tracks {
                if known.insert(path_key(&track.path)) {
                    library.tracks.push(track);
                    added += 1;
                } else {
                    duplicates += 1;
                }
            }
            Ok(())
        })?;
        let _ = handle.emit(CHANGED, ());
        Ok(ImportResult {
            library: authorize(&handle, library)?,
            added,
            duplicates,
            skipped,
            cancelled: false,
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    *app.state::<Store>().importing.lock() = false;
    result
}

#[tauri::command]
pub async fn library_mutate(app: AppHandle, mutation: Mutation) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = app
            .state::<Store>()
            .change(|library| mutate(library, mutation))?;
        let _ = app.emit(CHANGED, ());
        authorize(&app, library)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_relink(app: AppHandle, id: String) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let library = store.read()?;
        if !library.tracks.iter().any(|t| t.id == id) {
            return Err("Morceau introuvable.".into());
        }
        let Some(path) = audio_dialog(&app, "Retrouver ce morceau").pick_file() else {
            return authorize(&app, library);
        };
        if !super::supported(&path) {
            return Err("Format audio non pris en charge.".into());
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let replacement = read_track(&path, &store.covers_dir());
        let library = store.change(|data| {
            if data
                .tracks
                .iter()
                .any(|t| t.id != id && path_key(&t.path) == path_key(&replacement.path))
            {
                return Err("Ce fichier est déjà dans la bibliothèque.".into());
            }
            let track = data
                .tracks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("Morceau introuvable.")?;
            *track = super::Track {
                id: track.id.clone(),
                favorite: track.favorite,
                added_at: track.added_at,
                ..replacement
            };
            Ok(())
        })?;
        let _ = app.emit(CHANGED, ());
        authorize(&app, library)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_get_playback(app: AppHandle) -> Playback {
    app.state::<Store>().playback.lock().clone()
}

#[tauri::command]
pub fn library_control(app: AppHandle, action: serde_json::Value) -> Result<(), String> {
    app.emit_to(crate::island::LABEL, CONTROL, action)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_set_playback(
    app: AppHandle,
    window: WebviewWindow,
    mut playback: Playback,
) -> Result<(), String> {
    if window.label() != crate::island::LABEL {
        return Err("Le lecteur appartient à l’Island.".into());
    }
    for value in [
        &mut playback.progress,
        &mut playback.duration,
        &mut playback.volume,
    ] {
        if !value.is_finite() {
            *value = 0.0;
        }
    }
    playback.volume = playback.volume.clamp(0.0, 1.0);
    playback.progress = playback.progress.max(0.0);
    playback.duration = playback.duration.max(0.0);
    *app.state::<Store>().playback.lock() = playback.clone();
    app.emit(PLAYBACK, &playback)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn library_check_track(app: AppHandle, id: String) -> Result<(), String> {
    let library = app.state::<Store>().read()?;
    let track = library
        .tracks
        .iter()
        .find(|t| t.id == id)
        .ok_or("Morceau introuvable.")?;
    if !Path::new(&track.path).is_file() {
        return Err("Ce fichier a été déplacé ou supprimé. Utilise « Retrouver le fichier » dans la bibliothèque.".into());
    }
    Ok(())
}
