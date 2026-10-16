//! Nolys — point d'entrée de l'application Tauri.

mod commands;
mod events;
mod island;
mod logger;
mod library;
mod media;
mod migration;
mod platform;
mod settings_window;
mod shortcut;
mod state;
mod tray;
mod updater;
mod wallpaper;

use std::time::Duration;

use tauri::{AppHandle, Manager};

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        // Une seule instance : relancer l'appli ré-affiche simplement l'Island.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(hwnd) = island::window(app).and_then(|window| window.hwnd().ok()) {
                if !platform::window::is_visible(hwnd) {
                    island::toggle_visibility(app, "second-instance");
                }
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::commands::library_open,
            library::commands::library_workspace,
            library::commands::library_get,
            library::commands::library_import,
            library::commands::library_mutate,
            library::commands::library_relink,
            library::commands::library_get_playback,
            library::commands::library_control,
            library::commands::library_set_playback,
            library::commands::library_check_track,
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
            commands::app::open_settings,
            commands::app::close_settings,
            commands::app::exit_app,
            commands::app::register_shortcuts,
            commands::app::config_changed,
            commands::app::wallpaper_sync_status,
            commands::app::trigger_notification,
            commands::app::cover_color_changed,
            commands::updates::get_update_status,
            commands::updates::check_for_updates,
            commands::updates::download_update,
            commands::updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Nolys");
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    logger::init(data_dir.clone());
    app.manage(library::Store::new(data_dir.clone()));
    logger::log(&format!("[App] Starting Nolys {}", app.package_info().version));
    migration::import_legacy_files(&data_dir);
    platform::mic_monitor::init(&data_dir);
    let legacy_settings = migration::legacy_settings_script(&data_dir);

    let layout = island::layout::load(app, &data_dir);
    app.manage(AppState::new(data_dir, layout));

    // Le gestionnaire SMTC met parfois plusieurs centaines de ms à répondre.
    std::thread::spawn(platform::smtc::init);

    island::create(app, legacy_settings)?;
    tray::create(app)?;
    island::hit_test::start(app.clone());
    island::start_watchdog(app.clone());

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(2500)).await;
        let wallpaper = handle.state::<AppState>().wallpaper.clone();
        tauri::async_runtime::spawn_blocking(move || wallpaper.store_original());
        updater::check(handle).await;
    });
    Ok(())
}

/// Quitte proprement : restaure le fond d'écran d'origine si la synchro était active.
pub fn quit(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(platform::mic_monitor::shutdown).await;
        let wallpaper = handle.state::<AppState>().wallpaper.clone();
        if wallpaper.is_enabled() {
            let _ = tauri::async_runtime::spawn_blocking(move || wallpaper.restore_original()).await;
        }
        handle.exit(0);
    });
}
