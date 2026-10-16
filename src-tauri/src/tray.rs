//! Icône de la zone de notification et son menu.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::island;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let toggle = MenuItem::with_id(app, "toggle", "Afficher / Masquer l'Island", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Réglages", true, Some("CmdOrCtrl+,"))?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Lancer au démarrage", true, autostart_enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Nolys")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => island::toggle_visibility(app, "tray-show"),
            "settings" => island::open_settings(app, false),
            "autostart" => {
                let launcher = app.autolaunch();
                let enable = !launcher.is_enabled().unwrap_or(false);
                let result = if enable { launcher.enable() } else { launcher.disable() };
                if let Err(error) = result {
                    crate::logger::log(&format!("[Tray] Failed to set login settings: {error}"));
                }
                let _ = autostart.set_checked(launcher.is_enabled().unwrap_or(false));
                crate::logger::log(&format!("[Tray] Set openAtLogin to {enable}"));
            }
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                island::toggle_visibility(tray.app_handle(), "tray-doubleclick");
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
