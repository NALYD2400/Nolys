use super::{sources, Action, Config, Snapshot, Store};
use tauri::{AppHandle, Manager, WebviewWindow};

fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == crate::island::LABEL {
        Ok(())
    } else {
        Err("Cette fenêtre ne peut pas piloter la capture.".into())
    }
}

#[tauri::command]
pub fn replay_snapshot(app: AppHandle, window: WebviewWindow) -> Result<Snapshot, String> {
    authorize(&window)?;
    Ok(app.state::<Store>().snapshot())
}
#[tauri::command]
pub async fn replay_sources(window: WebviewWindow) -> Result<Vec<sources::Source>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(sources::list)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn replay_configure(
    app: AppHandle,
    window: WebviewWindow,
    config: Config,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<Store>().configure(config))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn replay_action(
    app: AppHandle,
    window: WebviewWindow,
    action: String,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        perform(&app, &action)?;
        Ok(app.state::<Store>().snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn perform(app: &AppHandle, action: &str) -> Result<(), String> {
    let store = app.state::<Store>();
    match action {
        "dismiss" => {
            let mut state = store.shared.state.lock();
            state.error = None;
            state.notice = None;
        }
        "start" => store.start(false)?,
        "record" => store.start(true)?,
        "save" => store.submit(Action::Save)?,
        "record-stop" => store.submit(Action::RecordStop)?,
        "stop" => store.stop(),
        "toggle-record" => {
            if store.snapshot().recording {
                store.submit(Action::RecordStop)?;
            } else {
                store.start(true)?;
            }
        }
        "toggle-replay" => {
            if matches!(
                store.snapshot().phase.as_str(),
                "starting" | "buffering" | "stopping"
            ) {
                store.stop();
            } else {
                store.start(false)?;
            }
        }
        _ => return Err("Commande Replay inconnue.".into()),
    }
    store.shared.notify();
    Ok(())
}
#[tauri::command]
pub async fn replay_pick(window: WebviewWindow, kind: String) -> Result<Option<String>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new().set_parent(&window);
        let path = match kind.as_str() {
            "engine" => dialog
                .set_title("Choisir le moteur FFmpeg")
                .add_filter("FFmpeg", &["exe"])
                .pick_file(),
            "folder" => dialog
                .set_title("Dossier des replays et enregistrements")
                .pick_folder(),
            _ => return Err("Sélecteur inconnu.".into()),
        };
        Ok(path.map(|p| p.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn replay_reveal(
    app: AppHandle,
    window: WebviewWindow,
    id: Option<String>,
    recovery: Option<bool>,
) -> Result<(), String> {
    authorize(&window)?;
    let path = if recovery == Some(true) {
        app.state::<Store>().recovery()
    } else if let Some(id) = id {
        app.state::<Store>().clip_path(&id)?
    } else {
        app.state::<Store>().folder()
    };
    if !path.is_file() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::files::drag::reveal(&path));
    })
    .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "L’Explorateur ne répond pas.".to_string())?
}
#[tauri::command]
pub fn replay_play(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    authorize(&window)?;
    let path = app.state::<Store>().clip_path(&id)?;
    crate::platform::system::shell_open(&path.to_string_lossy());
    Ok(())
}

#[tauri::command]
pub fn replay_media(app: AppHandle, window: WebviewWindow, id: String) -> Result<String, String> {
    authorize(&window)?;
    let path = app.state::<Store>().clip_path(&id)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn replay_rename(app: AppHandle, window: WebviewWindow, id: String, name: String) -> Result<Snapshot, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let result = store.rename_clip(&id, &name);
        store.shared.notify();
        result?;
        Ok(store.snapshot())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn replay_delete(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Snapshot, String> {
    authorize(&window)?;
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        store.delete_clip(&id, |path| super::recycle::recycle(path, owner))?;
        store.shared.notify();
        Ok(store.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}
