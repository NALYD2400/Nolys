//! Fenêtre de l'Island : création, position, premier plan, clic traversant.

pub mod displays;
pub mod drag;
pub mod hit_test;
pub mod layout;

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::events;
use crate::platform::{process, window as win};
use crate::state::AppState;
use layout::{Layout, BASE_HEIGHT, BASE_WIDTH};

pub const LABEL: &str = "island";

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// `legacy_settings` : script optionnel qui réinjecte les réglages de la version Electron.
pub fn create(app: &AppHandle, legacy_settings: Option<String>) -> tauri::Result<WebviewWindow> {
    let layout = app.state::<AppState>().layout.lock().clone();
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("island/index.html".into()));
    if let Some(script) = legacy_settings {
        builder = builder.initialization_script(script);
    }
    let window = builder
        .additional_browser_args("--autoplay-policy=no-user-gesture-required")
        .title("Nolys")
        .inner_size(BASE_WIDTH * layout.scale, BASE_HEIGHT * layout.scale)
        .position(layout.x, layout.y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Visible dès la création (sans prendre le focus) : tao doit savoir la fenêtre
        // affichée, sinon il la masque au moindre changement d'état.
        .focused(false)
        .visible(true)
        .build()?;

    apply_layout(app);
    enforce_topmost(app, "startup");

    let handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) => on_moved(&handle),
        tauri::WindowEvent::Focused(false) => schedule_enforce(&handle, "blur", 140),
        _ => {}
    });
    Ok(window)
}

/// Applique taille, zoom et position de la configuration courante.
pub fn apply_layout(app: &AppHandle) {
    let state = app.state::<AppState>();
    let layout = {
        let mut current = state.layout.lock();
        *current = layout::clamp(app, &current);
        current.clone()
    };
    if let Some(window) = window(app) {
        state.suppress_move_sync.store(true, Ordering::SeqCst);
        let monitor_scale = layout::target_monitor(app, &layout.display_id).map(|m| m.scale_factor()).unwrap_or(1.0);
        let _ = window.set_zoom(layout.scale);
        let _ = window.set_size(LogicalSize::new((BASE_WIDTH * layout.scale).round(), (BASE_HEIGHT * layout.scale).round()));
        // Position convertie avec l'échelle de l'écran cible (fiable en multi-écran à DPI mixte).
        let _ = window.set_position(tauri::PhysicalPosition::new(
            (layout.x * monitor_scale).round() as i32,
            (layout.y * monitor_scale).round() as i32,
        ));
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            handle.state::<AppState>().suppress_move_sync.store(false, Ordering::SeqCst);
        });
    }
    sync_native_state(app);
    broadcast_layout(app);
}

/// Change et enregistre la configuration, puis l'applique.
pub fn update_layout(app: &AppHandle, next: Layout) {
    let state = app.state::<AppState>();
    let clamped = layout::clamp(app, &next);
    *state.layout.lock() = clamped.clone();
    layout::save(&state.data_dir, &clamped);
    apply_layout(app);
}

fn on_moved(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.suppress_move_sync.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = window(app) else { return };
    let Ok(position) = window.outer_position() else { return };
    let current = state.layout.lock().clone();
    // L'écran sous la fenêtre devient l'écran cible (déplacement d'un écran à l'autre).
    let monitor = window.current_monitor().ok().flatten();
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let moved = Layout {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        display_id: monitor.as_ref().map(layout::monitor_id).unwrap_or(current.display_id.clone()),
        ..current
    };
    let clamped = layout::clamp(app, &moved);
    *state.layout.lock() = clamped.clone();
    layout::save(&state.data_dir, &clamped);
    broadcast_layout(app);
    schedule_center_snap(app);
}

/// Écart (pixels logiques) en dessous duquel l'Island lâchée se cale au centre de l'écran.
const CENTER_SNAP_DISTANCE: f64 = 28.0;

/// Aimantation : quand le déplacement s'arrête près du centre horizontal, on centre.
/// Chaque mouvement relance l'attente, donc rien ne bouge pendant le glisser.
fn schedule_center_snap(app: &AppHandle) {
    use std::sync::atomic::AtomicU64;
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(350)).await;
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let state = handle.state::<AppState>();
        let current = state.layout.lock().clone();
        let centered = layout::centered_on(&handle, &current);
        let distance = (centered.x - current.x).abs();
        if distance > 0.5 && distance <= CENTER_SNAP_DISTANCE {
            update_layout(&handle, Layout { x: centered.x, ..current });
        }
    });
}

pub fn broadcast_layout(app: &AppHandle) {
    let state = app.state::<AppState>();
    let layout = state.layout.lock().clone();
    let edit_mode = state.layout_edit_mode.load(Ordering::SeqCst);
    let _ = app.emit(events::LAYOUT_CONFIG_CHANGED, &layout);
    let _ = app.emit(events::LAYOUT_EDIT_MODE_CHANGED, edit_mode);
}

/// Active ou coupe le clic traversant.
pub fn set_click_through(app: &AppHandle, ignore: bool) {
    let state = app.state::<AppState>();
    if ignore && state.layout_edit_mode.load(Ordering::SeqCst) {
        return;
    }
    state.click_through.store(ignore, Ordering::SeqCst);
    if let Some(hwnd) = window(app).and_then(|w| w.hwnd().ok()) {
        win::set_click_through(hwnd, ignore);
    }
}

/// Réapplique ce que tao ignore (clic traversant, masquage volontaire) après un
/// appel Tauri qui modifie l'état de la fenêtre (premier plan, taille…).
fn sync_native_state(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(hwnd) = window(app).and_then(|w| w.hwnd().ok()) else { return };
    win::set_click_through(hwnd, state.click_through.load(Ordering::SeqCst));
    if state.hidden_by_user.load(Ordering::SeqCst) || state.hidden_by_fullscreen.load(Ordering::SeqCst) {
        win::hide(hwnd);
    }
    notify_visibility(app);
}

/// Prévient l'Island quand sa fenêtre est masquée ou réaffichée. La fenêtre est masquée en
/// Win32 : WebView2 ne le sait pas et continuait d'animer (halo, titre, visualiseur) une page
/// que personne ne voit. L'Island met alors ses animations en pause et les reprend au retour.
fn notify_visibility(app: &AppHandle) {
    let Some(hwnd) = window(app).and_then(|w| w.hwnd().ok()) else { return };
    let visible = win::is_visible(hwnd);
    if app.state::<AppState>().window_visible.swap(visible, Ordering::SeqCst) != visible {
        let _ = app.emit(events::ISLAND_VISIBILITY_CHANGED, visible);
    }
}

/// Réaffirme le premier plan si un plein écran ou l'explorateur l'a fait perdre.
pub fn enforce_topmost(app: &AppHandle, reason: &str) {
    let state = app.state::<AppState>();
    if !state.persistent.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = window(app) else { return };
    let Ok(hwnd) = window.hwnd() else { return };

    let mut changed = false;
    if win::is_minimized(hwnd) {
        win::restore(hwnd);
        changed = true;
    }
    let hidden_on_purpose = state.hidden_by_user.load(Ordering::SeqCst) || state.hidden_by_fullscreen.load(Ordering::SeqCst);
    if !win::is_visible(hwnd) && !hidden_on_purpose {
        win::show_inactive(hwnd);
        changed = true;
    }
    if !win::is_topmost(hwnd) {
        changed = true;
    }
    if changed || matches!(reason, "startup" | "show" | "unexpected-hide") {
        win::raise_topmost(hwnd);
    }
    notify_visibility(app);
}

fn schedule_enforce(app: &AppHandle, reason: &'static str, delay_ms: u64) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        enforce_topmost(&handle, reason);
    });
}

/// Surveille toutes les 1,5 s le premier plan (option « Island persistante »)
/// et la configuration des écrans (branchement, résolution, mise à l'échelle).
pub fn start_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut displays = displays::signature(&app);
        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let current = displays::signature(&app);
            if current != displays {
                displays = current;
                on_displays_changed(&app);
            }
            update_fullscreen_autohide(&app);
            notify_visibility(&app);
            let state = app.state::<AppState>();
            let paused = !state.persistent.load(Ordering::SeqCst)
                || state.layout_edit_mode.load(Ordering::SeqCst)
                || state.hidden_by_user.load(Ordering::SeqCst)
                || state.hidden_by_fullscreen.load(Ordering::SeqCst);
            if !paused {
                enforce_topmost(&app, "watchdog");
            }
        }
    });
}

/// Masque l'Island tant qu'une application plein écran (jeu, vidéo) occupe son écran.
fn update_fullscreen_autohide(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(window) = window(app) else { return };
    let Ok(hwnd) = window.hwnd() else { return };

    let should_hide = state.hide_in_fullscreen.load(Ordering::SeqCst)
        && !state.layout_edit_mode.load(Ordering::SeqCst)
        && process::foreground_window().is_some_and(|front| {
            let is_desktop = matches!(front.class_name.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd");
            front.is_fullscreen && !is_desktop && front.pid != std::process::id() && front.monitor == win::monitor_of(hwnd)
        });
    if state.hidden_by_fullscreen.swap(should_hide, Ordering::SeqCst) == should_hide {
        return;
    }
    crate::logger::log(if should_hide { "[Fullscreen] Island masquée (application plein écran)" } else { "[Fullscreen] Island réaffichée" });
    if should_hide {
        win::hide(hwnd);
    } else if !state.hidden_by_user.load(Ordering::SeqCst) {
        win::show_inactive(hwnd);
        enforce_topmost(app, "fullscreen-exit");
    }
    notify_visibility(app);
}

pub fn set_fullscreen_autohide(app: &AppHandle, enabled: bool) {
    app.state::<AppState>().hide_in_fullscreen.store(enabled, Ordering::SeqCst);
    update_fullscreen_autohide(app);
}

pub fn set_persistent(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    state.persistent.store(enabled, Ordering::SeqCst);
    let Some(window) = window(app) else { return };
    if enabled {
        state.hidden_by_user.store(false, Ordering::SeqCst);
        let _ = window.set_always_on_top(true);
        sync_native_state(app);
        enforce_topmost(app, "ipc-setting");
    } else {
        let _ = window.set_always_on_top(false);
        sync_native_state(app);
    }
}

/// Affiche / masque l'Island (raccourci clavier, icône de notification).
pub fn toggle_visibility(app: &AppHandle, reason: &str) {
    let state = app.state::<AppState>();
    let Some(window) = window(app) else { return };
    let Ok(hwnd) = window.hwnd() else { return };
    if win::is_visible(hwnd) {
        state.hidden_by_user.store(true, Ordering::SeqCst);
        win::hide(hwnd);
    } else {
        state.hidden_by_user.store(false, Ordering::SeqCst);
        win::show_inactive(hwnd);
        enforce_topmost(app, reason);
    }
    notify_visibility(app);
}

pub fn set_layout_edit_mode(app: &AppHandle, enabled: bool) {
    let state = app.state::<AppState>();
    state.layout_edit_mode.store(enabled, Ordering::SeqCst);
    state.click_through.store(!enabled, Ordering::SeqCst);
    if let Some(window) = window(app) {
        if enabled {
            state.hidden_by_user.store(false, Ordering::SeqCst);
            let _ = window.set_always_on_top(true);
            if let Ok(hwnd) = window.hwnd() {
                win::show_inactive(hwnd);
                win::raise_topmost(hwnd);
            }
            let _ = window.set_focus();
        }
        sync_native_state(app);
    }
    broadcast_layout(app);
}

/// Réagit aux changements d'écrans (branchement, résolution, mise à l'échelle).
pub fn on_displays_changed(app: &AppHandle) {
    apply_layout(app);
    enforce_topmost(app, "screen-change");
}
