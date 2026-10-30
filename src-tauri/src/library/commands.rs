use super::{authorize, mutate, path_key, read_track, repair, CacheInfo, Library, Mutation, Store, CHANGED, EXTENSIONS, PROGRESS};
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
        store.import_cancel.store(false, Ordering::Release);
        store.import_committing.store(false, Ordering::Release);
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
                library: authorize(&handle, store.read()?)?,
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
        let (files, mut skipped) = super::scan::collect(paths, &store.import_cancel);
        let cancelled = || -> Result<ImportResult, String> {
            Ok(ImportResult { library: authorize(&handle, store.read()?)?, added: 0, duplicates: 0, relinked: 0, skipped, cancelled: true })
        };
        if store.import_cancel.load(Ordering::Acquire) { return cancelled(); }
        let known: HashSet<_> = previous.tracks.iter().map(|t| path_key(&t.path)).collect();
        let mut duplicates = 0;
        let mut tracks = Vec::new();
        // Covers stay in a temporary staging folder until the final commit.
        // Cancelling a long scan never leaves a partial collection or cache.
        let staged = tempfile::tempdir().map_err(|e| e.to_string())?;
        let existing_cache = store.cache_info()?;
        let mut staging_budget = existing_cache.budget_bytes.saturating_sub(existing_cache.bytes);
        let mut last = std::time::Instant::now();
        progress("read", 0, files.len());
        for (index, path) in files.iter().enumerate() {
            if store.import_cancel.load(Ordering::Acquire) {
                return Ok(ImportResult { library: authorize(&handle, store.read()?)?, added: 0, duplicates, relinked: 0, skipped, cancelled: true });
            }
            if known.contains(&path_key(&path.to_string_lossy())) {
                duplicates += 1;
            } else if std::fs::File::open(path).is_err() {
                skipped += 1;
            } else {
                let mut track = read_track(path, staged.path());
                if !track.cover.is_empty() {
                    let size = std::fs::metadata(&track.cover).map(|metadata| metadata.len()).unwrap_or(u64::MAX);
                    if size > staging_budget {
                        let _ = std::fs::remove_file(&track.cover); // This import's own staged thumbnail only.
                        track.cover.clear();
                    } else { staging_budget -= size; }
                }
                tracks.push(track);
            }
            if last.elapsed().as_millis() >= 80 {
                last = std::time::Instant::now();
                progress("read", index + 1, files.len());
            }
        }
        let _cover_write = store.cover_writes.lock();
        let cache = store.cache_info()?;
        let mut cover_budget = cache.budget_bytes.saturating_sub(cache.bytes);
        {
            let importing = store.importing.lock();
            if store.import_cancel.load(Ordering::Acquire) {
                drop(importing);
                return Ok(ImportResult { library: authorize(&handle, store.read()?)?, added: 0, duplicates, relinked: 0, skipped, cancelled: true });
            }
            // Cancellation and entering the final transaction are ordered under
            // the same lock. A late cancel reports that saving already started.
            store.import_committing.store(true, Ordering::Release);
        }
        progress("save", files.len(), files.len());
        let mut added = 0;
        let mut relinked = 0;
        let library = store.change(|library| {
            let mut known: HashSet<_> = library.tracks.iter().map(|t| path_key(&t.path)).collect();
            for mut track in tracks {
                if known.insert(path_key(&track.path)) {
                    if !track.cover.is_empty() {
                        track.cover = publish_cover(&track, &store.covers_dir(), &mut cover_budget).unwrap_or_default();
                    }
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
    {
        let store = app.state::<Store>();
        *store.importing.lock() = false;
        store.import_committing.store(false, Ordering::Release);
    }
    let _ = app.state::<Store>().clean_cache();
    result
}

#[tauri::command]
pub async fn library_mutate(app: AppHandle, mutation: Mutation) -> Result<Library, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let remove_covers = matches!(&mutation, Mutation::RemoveTrack { .. } | Mutation::RemoveTracks { .. });
        let library = app
            .state::<Store>()
            .change(|library| mutate(library, mutation))?;
        let _ = app.emit(CHANGED, ());
        if remove_covers { let _ = app.state::<Store>().clean_cache(); }
        authorize(&app, library)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn publish_cover(track: &super::Track, folder: &Path, budget: &mut u64) -> Result<String, String> {
    let source = Path::new(&track.cover);
    let size = source.metadata().map_err(|e| e.to_string())?.len();
    if size > *budget { return Ok(String::new()); }
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let metadata = std::fs::symlink_metadata(folder).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err("Dossier de pochettes non ordinaire.".into()); }
    #[cfg(windows)]
    { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return Err("Dossier de pochettes lié.".into()); } }
    let target = folder.join(format!("{}.jpg", track.id));
    let mut output = tempfile::NamedTempFile::new_in(folder).map_err(|e| e.to_string())?;
    let mut input = std::fs::File::open(source).map_err(|e| e.to_string())?;
    std::io::copy(&mut input, output.as_file_mut()).and_then(|_| output.as_file().sync_all()).map_err(|e| e.to_string())?;
    output.persist_noclobber(&target).map_err(|e| e.to_string())?;
    *budget -= size;
    Ok(target.to_string_lossy().into())
}

fn require_island(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == crate::island::LABEL { Ok(()) } else { Err("Cette fenêtre ne peut pas modifier la bibliothèque.".into()) }
}

#[tauri::command]
pub fn library_cancel_import(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_island(&window)?;
    let store = app.state::<Store>();
    let importing = store.importing.lock();
    if !*importing { return Err("Aucun import en cours.".into()); }
    if store.import_committing.load(Ordering::Acquire) { return Err("L’enregistrement final a commencé. L’import se termine.".into()); }
    store.import_cancel.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn library_cache_info(app: AppHandle, window: WebviewWindow) -> Result<CacheInfo, String> {
    require_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Store>().cache_info()).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_clean_cache(app: AppHandle, window: WebviewWindow) -> Result<CacheInfo, String> {
    require_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Store>().clean_cache()).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_repair(app: AppHandle, window: WebviewWindow) -> Result<Library, String> {
    require_island(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let library = app.state::<Store>().repair_library()?;
        let _ = app.emit(CHANGED, ());
        authorize(&app, library)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_reveal_store(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_island(&window)?;
    let path = app.state::<Store>().history_path();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || { let _ = sender.send(crate::files::drag::reveal(&path)); }).map_err(|e| e.to_string())?;
    receiver.await.map_err(|_| "L’Explorateur Windows ne répond pas.".to_string())?
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
        let staged = tempfile::tempdir().map_err(|e| e.to_string())?;
        let _cover_write = store.cover_writes.lock();
        let cache = store.cache_info()?;
        let mut budget = cache.budget_bytes.saturating_sub(cache.bytes);
        let library = store.change(|data| {
            repair::relink(data, &id, &path, |file| Path::new(file).is_file(), |file| {
                let mut track = read_track(file, staged.path());
                if !track.cover.is_empty() { track.cover = publish_cover(&track, &covers, &mut budget).unwrap_or_default(); }
                track
            }).map(|_| ())
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
