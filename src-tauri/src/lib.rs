//! Nolys — point d'entrée de l'application Tauri.

mod commands;
mod preferences;
mod events;
mod files;
mod replay;
mod island;
mod logger;
mod library;
mod media;
mod migration;
mod platform;
mod shortcut;
mod state;
mod tray;
mod ui_settings;
mod updater;
mod wallpaper;

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use state::AppState;

pub(crate) fn isolated_dev() -> bool {
    cfg!(debug_assertions) && std::env::var_os("NOLYS_DEV_DATA_DIR").is_some()
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    if !isolated_dev() {
        // Une seule instance : relancer l'appli ré-affiche simplement l'Island.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(hwnd) = island::window(app).and_then(|window| window.hwnd().ok()) {
                if !platform::window::is_visible(hwnd) {
                    island::toggle_visibility(app, "second-instance");
                }
            }
        }));
    }
    builder.plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            replay::commands::replay_snapshot,
            replay::commands::replay_sources,
            replay::commands::replay_configure,
            replay::commands::replay_action,
            replay::commands::replay_pick,
            replay::commands::replay_reveal,
            replay::commands::replay_play,
            replay::commands::replay_media,
            replay::commands::replay_thumbnail,
            replay::commands::replay_delete,
            replay::commands::replay_rename,
            replay::commands::replay_reindex,
            replay::commands::replay_relocate,
            replay::commands::replay_recovery_list,
            replay::commands::replay_recover,
            replay::commands::replay_cache,
            replay::commands::replay_preflight,
            files::commands::files_dev_log,
            files::commands::files_dev_open,
            files::commands::files_snapshot,
            files::commands::files_pick,
            files::commands::files_start,
            files::commands::files_cancel,
            files::commands::files_forget,
            files::commands::files_reveal,
            files::commands::files_preview,
            files::commands::files_copy,
            files::commands::files_drag_out,
            files::commands::files_remove_inputs,
            files::commands::files_retry,
            files::commands::files_preferences,
            files::commands::files_pick_destination,
            files::commands::files_repair_history,
            files::commands::files_reveal_history,
            library::commands::library_get,
            library::commands::library_import,
            library::commands::library_mutate,
            library::commands::library_relink,
            library::commands::library_player_active,
            library::commands::library_check_track,
            library::commands::library_cancel_import,
            library::commands::library_cache_info,
            library::commands::library_clean_cache,
            library::commands::library_repair,
            library::commands::library_reveal_store,
            commands::media::get_media_info,
            commands::media::media_control,
            commands::audio::get_audio_meter,
            commands::audio::get_system_volume,
            commands::audio::set_system_volume,
            commands::audio::get_audio_sessions,
            commands::audio::set_session_volume,
            commands::audio::set_session_muted,
            commands::audio::get_audio_devices,
            commands::audio::get_audio_input_devices,
            commands::audio::set_default_audio_device,
            commands::audio::get_mic_monitor,
            commands::audio::set_mic_monitor,
            commands::system::wifi_control,
            commands::system::bluetooth_control,
            commands::system::dnd_control,
            commands::system::get_hardware_telemetry,
            commands::system::get_system_stats,
            commands::system::get_weather,
            commands::system::get_active_window_info,
            commands::system::get_file_icon,
            commands::system::get_desktop_sources,
            commands::system::launch_shortcut,
            commands::system::get_auto_start,
            commands::system::set_auto_start,
            commands::layout::get_layout_state,
            commands::layout::set_island_extent,
            commands::layout::context_menu_viewport,
            commands::layout::get_displays,
            commands::layout::set_layout_config,
            commands::layout::reset_layout,
            commands::layout::set_layout_edit_mode,
            commands::layout::layout_drag_begin,
            commands::layout::layout_drag_move,
            commands::layout::layout_drag_end,
            commands::layout::layout_nudge,
            commands::layout::set_target_display,
            commands::app::set_ignore_mouse,
            commands::app::set_hit_region,
            commands::app::set_persistent_island,
            commands::app::set_fullscreen_autohide,
            commands::app::exit_app,
            commands::app::register_shortcuts,
            commands::app::config_changed,
            commands::app::wallpaper_sync_status,
            commands::app::trigger_notification,
            commands::app::save_settings_file,
            preferences::preferences_bundle,
            preferences::preferences_restore,
            preferences::reset_microphone_preferences,
            preferences::maintenance_info,
            preferences::export_diagnostics,
            ui_settings::ui_settings_write,
            ui_settings::ui_settings_seed,
            commands::updates::get_update_status,
            commands::updates::check_for_updates,
            commands::updates::download_update,
            commands::updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Nolys");
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dev_data = if cfg!(debug_assertions) { std::env::var_os("NOLYS_DEV_DATA_DIR").map(std::path::PathBuf::from) } else { None };
    let isolated = dev_data.is_some();
    let data_dir = dev_data.unwrap_or(app.path().app_data_dir()?);
    std::fs::create_dir_all(&data_dir)?;
    logger::init(data_dir.clone());
    app.manage(library::Store::new(data_dir.clone()));
    let exports = if isolated { data_dir.join("Exports") } else { app.path().document_dir()?.join("Nolys").join("Exports") };
    app.manage(files::Store::new(data_dir.clone(), exports));
    let videos = if isolated { data_dir.join("Videos") } else { app.path().video_dir().unwrap_or(app.path().document_dir()?).join("Nolys") };
    app.manage(replay::Store::new(data_dir.clone(), videos, app.path().resource_dir()?));
    app.state::<replay::Store>().attach(app.clone());
    logger::log(&format!("[App] Starting Nolys {}", app.package_info().version));
    if !isolated { migration::import_legacy_files(&data_dir); }
    platform::mic_monitor::init(&data_dir);
    let legacy_settings = if isolated { None } else { migration::legacy_settings_script(&data_dir) };
    let ui_settings = ui_settings::Store::load(&data_dir);
    if !isolated { ui_settings::import_installed_settings(app, &ui_settings, &data_dir); }
    platform::http::set_offline(ui_settings.get("liquid_offline_mode").as_deref() == Some("true"));
    app.manage(ui_settings);

    let layout = island::layout::load(app, &data_dir);
    app.manage(AppState::new(data_dir, layout));

    // Le gestionnaire SMTC met parfois plusieurs centaines de ms à répondre. Ses événements
    // préviennent ensuite l'Island à chaque changement de lecteur (au lieu d'un sondage serré).
    let media_events = app.clone();
    std::thread::spawn(move || {
        platform::smtc::init();
        platform::smtc::watch(move || {
            let _ = media_events.emit_to(island::LABEL, events::MEDIA_CHANGED, ());
        });
    });

    island::create(app, legacy_settings)?;
    files::drag::install(app)?;
    tray::create(app)?;
    island::hit_test::start(app.clone());
    island::start_watchdog(app.clone());

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(2500)).await;
        let wallpaper = handle.state::<AppState>().wallpaper.clone();
        tauri::async_runtime::spawn_blocking(move || wallpaper.store_original());
        if !isolated { updater::check(handle).await; }
    });
    Ok(())
}

/// Quitte proprement : restaure le fond d'écran d'origine si la synchro était active.
pub fn quit(app: &AppHandle) {
    static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if QUITTING.swap(true, std::sync::atomic::Ordering::SeqCst) { return; }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match updater::prepare_shutdown(&handle).await {
            Ok(_) => handle.exit(0),
            Err(error) => {
                logger::log(&format!("[App] Shutdown interrupted: {error}"));
                let _ = handle.emit_to(island::LABEL, events::TRIGGER_NOTIF, serde_json::json!({
                    "title":"Fermeture interrompue", "message":error, "icon":"ph-warning-circle"
                }));
                QUITTING.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        }
    });
}
