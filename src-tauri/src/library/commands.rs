use super::{authorize, collect, mutate, path_key, read_track, repair, Library, Mutation, Store, CHANGED, EXTENSIONS, PROGRESS};
use std::{collections::HashSet, path::Path, sync::atomic::Ordering};
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

/// Ouvre le sélecteur sur un thread neuf. Les threads du pool bloquant sont souvent déjà
/// initialisés en COM MTA (média, audio) : rfd y échoue (RPC_E_CHANGED_MODE) et renvoyait
/// `None`, pris pour une annulation — « Importer » ne faisait alors rien.
fn pick<T: Send + 'static>(job: impl FnOnce() -> Option<T> + Send + 'static) -> Result<Option<T>, String> {
    std::thread::spawn(job)
        .join()
        .map_err(|_| "Le sélecteur de fichiers s’est fermé de façon inattendue.".to_string())
}

#[tauri::command]
pub async fn library_get(app: AppHandle) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let mut library = store.read()?;
        // Doublons laissés par un dossier déplacé puis réimporté : réparés au chargement.
        let exists = |path: &str| Path::new(path).is_file();
        if repair::merge_moved(&mut library.clone(), exists) > 0 {
            library = store.change(|data| {
                repair::merge_moved(data, exists);
                Ok(())
            })?;
        }
        authorize(&app, library)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    library: Library,
    added: usize,
    duplicates: usize,
    /// Titres introuvables retrouvés dans les fichiers importés (dossier déplacé).
    relinked: usize,
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
            "files" => pick(move || dialog.pick_files())?,
            "folder" => pick(move || dialog.pick_folder().map(|p| vec![p]))?,
            _ => return Err("Type d’import inconnu.".into()),
        };
        let Some(paths) = paths else {
            return Ok(ImportResult {
                library: authorize(&handle, previous)?,
                added: 0,
                duplicates: 0,
                relinked: 0,
                skipped: 0,
                cancelled: true,
            });
        };
        // Barre de progression de la vue : parcours des dossiers, puis lecture des tags.
        let progress = |phase: &str, done: usize, total: usize| {
            let _ = handle.emit_to(crate::island::LABEL, PROGRESS, serde_json::json!({ "phase": phase, "done": done, "total": total }));
        };
        progress("scan", 0, 0);
        let (files, skipped) = collect(paths);
        let known: HashSet<_> = previous.tracks.iter().map(|t| path_key(&t.path)).collect();
        let mut duplicates = 0;
        let mut tracks = Vec::new();
        let mut last = std::time::Instant::now();
        progress("read", 0, files.len());
        for (index, path) in files.iter().enumerate() {
            if known.contains(&path_key(&path.to_string_lossy())) {
                duplicates += 1;
            } else {
                tracks.push(read_track(path, &store.covers_dir()));
            }
            if last.elapsed().as_millis() >= 80 {
                last = std::time::Instant::now();
                progress("read", index + 1, files.len());
            }
        }
        progress("save", files.len(), files.len());
        let mut added = 0;
        let mut relinked = 0;
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
            // Un fichier importé qui est un titre introuvable déplacé reprend sa place.
            relinked = repair::merge_moved(library, |path| Path::new(path).is_file());
            added -= relinked.min(added);
            Ok(())
        })?;
        let _ = handle.emit(CHANGED, ());
        Ok(ImportResult {
            library: authorize(&handle, library)?,
            added,
            duplicates,
            relinked,
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
        let dialog = audio_dialog(&app, "Retrouver ce morceau");
        let Some(path) = pick(move || dialog.pick_file())? else {
            return authorize(&app, library);
        };
        if !super::supported(&path) {
            return Err("Format audio non pris en charge.".into());
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let covers = store.covers_dir();
        let library = store.change(|data| {
            repair::relink(data, &id, &path, |file| Path::new(file).is_file(), |file| read_track(file, &covers)).map(|_| ())
        })?;
        let _ = app.emit(CHANGED, ());
        authorize(&app, library)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Le lecteur de l’Island signale qu’il prend (ou rend) la main sur les raccourcis média.
#[tauri::command]
pub fn library_player_active(app: AppHandle, window: WebviewWindow, active: bool) -> Result<(), String> {
    if window.label() != crate::island::LABEL {
        return Err("Le lecteur appartient à l’Island.".into());
    }
    app.state::<Store>().player_active.store(active, Ordering::SeqCst);
    Ok(())
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
