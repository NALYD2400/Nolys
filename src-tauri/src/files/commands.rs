use super::{model::{Input, Options, Snapshot}, Store};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[tauri::command]
pub fn files_dev_log(window: WebviewWindow, message: String) {
    if cfg!(debug_assertions) && window.label() == crate::island::LABEL && std::env::var_os("NOLYS_DEV_DATA_DIR").is_some() {
        crate::logger::log(&format!("[Files Dev] {}", message.chars().take(2000).collect::<String>()));
    }
}

#[tauri::command]
pub fn files_dev_open(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !crate::isolated_dev() || window.label() != crate::island::LABEL { return Err("Commande de développement indisponible.".into()); }
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit_to(crate::island::LABEL, crate::events::SHORTCUT_OPEN_MODE, "files").map_err(|e| e.to_string())
}

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != crate::island::LABEL { Err("Cette fenêtre ne peut pas accéder aux fichiers.".into()) } else { Ok(()) }
}

#[tauri::command]
pub fn files_snapshot(app: AppHandle, window: WebviewWindow) -> Result<Snapshot, String> {
    authorize(&window)?;
    Ok(app.state::<Store>().snapshot())
}

#[tauri::command]
pub async fn files_pick(app: AppHandle, window: WebviewWindow) -> Result<Vec<Input>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let handle = app.clone();
        let paths = std::thread::spawn(move || {
            let mut dialog = rfd::FileDialog::new().set_title("Ajouter des fichiers à Nolys");
            if let Some(parent) = crate::island::window(&handle) { dialog = dialog.set_parent(&parent); }
            dialog.pick_files()
        }).join().map_err(|_| "Le sélecteur de fichiers s’est fermé de façon inattendue.")?;
        match paths { Some(paths) => app.state::<Store>().register(paths), None => Ok(vec![]) }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_start(app: AppHandle, window: WebviewWindow, request_id: String, ids: Vec<String>, action: String, options: Options) -> Result<String, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let id = app.state::<Store>().start(request_id, ids, action, options)?;
        app.state::<Store>().emit(&app);
        super::kick(app);
        Ok(id)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_cancel(app: AppHandle, window: WebviewWindow, job_id: String) -> Result<(), String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Store>().cancel(&job_id)?;
        app.state::<Store>().emit(&app);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_forget(app: AppHandle, window: WebviewWindow, job_id: String) -> Result<(), String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Store>().forget(&job_id)?;
        app.state::<Store>().emit(&app);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_reveal(app: AppHandle, window: WebviewWindow, id: Option<String>) -> Result<(), String> {
    authorize(&window)?;
    let path = match id {
        Some(id) => app.state::<Store>().paths(&[id])?.remove(0),
        None => {
            let folder = app.state::<Store>().destination.clone();
            std::fs::create_dir_all(&folder).map_err(|_| "Le dossier d’export ne peut pas être ouvert.")?;
            folder
        }
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || { let _ = sender.send(super::drag::reveal(&path)); }).map_err(|e| e.to_string())?;
    receiver.await.map_err(|_| "L’Explorateur Windows ne répond pas.".to_string())?
}

#[tauri::command]
pub async fn files_copy(app: AppHandle, window: WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    authorize(&window)?;
    if ids.is_empty() || ids.len() > 100 { return Err("Choisissez de 1 à 100 fichiers.".into()); }
    let paths = app.state::<Store>().paths(&ids)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(super::drag::copy(&paths));
    }).map_err(|e| e.to_string())?;
    receiver.await.map_err(|_| "Le presse-papiers Windows ne répond pas.".to_string())?
}

#[tauri::command]
pub fn files_drag_out(app: AppHandle, window: WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    authorize(&window)?;
    if ids.is_empty() || ids.len() > 100 { return Err("Choisissez de 1 à 100 fichiers.".into()); }
    let paths = app.state::<Store>().paths(&ids)?;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        use std::sync::atomic::Ordering;
        handle.state::<Store>().outgoing.store(true, Ordering::Release);
        let result = super::drag::start_drag(&paths);
        handle.state::<Store>().outgoing.store(false, Ordering::Release);
        if let Err(error) = result { let _ = handle.emit_to(crate::island::LABEL, "files-error", error); }
        let _ = handle.emit_to(crate::island::LABEL, "files-drag-ended", ());
    }).map_err(|e| e.to_string())
}
