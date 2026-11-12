use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::island::{self, displays, layout};
use crate::state::AppState;

#[tauri::command]
pub fn set_island_extent(app: AppHandle, bounds: Option<island::hit_test::CssRect>) -> Result<(), String> {
    if let Some(rect) = bounds {
        if [rect.x, rect.y, rect.width, rect.height].iter().any(|v| !v.is_finite())
            || rect.width < 1.0 || rect.height < 1.0 || rect.width > layout::BASE_WIDTH || rect.height > layout::BASE_HEIGHT
            || rect.x < 0.0 || rect.y < 0.0 || rect.x + rect.width > layout::BASE_WIDTH + 1.0 || rect.y + rect.height > layout::BASE_HEIGHT + 1.0 {
            return Err("Dimensions de capsule invalides.".into());
        }
    }
    *app.state::<AppState>().expanded_bounds.lock() = bounds;
    if !app.state::<AppState>().layout_edit_mode.load(Ordering::SeqCst) {
        island::apply_layout(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn get_layout_state(app: AppHandle) -> Value {
    let state = app.state::<AppState>();
    let current = state.layout.lock().clone();
    let area = layout::target_monitor(&app, &current.display_id).map(|m| layout::work_area(&m));
    json!({
        "layout": current,
        "editMode": state.layout_edit_mode.load(Ordering::SeqCst),
        "display": area,
        "viewport": *state.window_viewport.lock(),
    })
}

/// Zone utile de l'écran exprimée dans les coordonnées CSS de la WebView.
#[tauri::command]
pub fn context_menu_viewport(app: AppHandle, size: Option<(f64, f64)>) -> Result<Option<Value>, String> {
    if size.is_some_and(|(w, h)| !w.is_finite() || !h.is_finite() || w < 1.0 || h < 1.0 || w > 4096.0 || h > 4096.0) {
        return Err("Dimensions de menu invalides.".into());
    }
    let state = app.state::<AppState>();
    // Le menu ne modifie jamais taille, zoom ou position de la fenêtre.
    if size.is_none() { return Ok(None); }
    let window = island::window(&app).ok_or("Fenêtre absente")?;
    let saved = state.layout.lock().clone();
    let monitor = layout::target_monitor(&app, &saved.display_id).ok_or("Écran absent")?;
    let dpi = monitor.scale_factor();
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let area = layout::work_area(&monitor);
    let zoom = (*state.window_zoom.lock()).unwrap_or(saved.scale);
    Ok(Some(json!({ "x": (area.x - origin.x as f64 / dpi) / zoom,
        "y": (area.y - origin.y as f64 / dpi) / zoom,
        "width": area.width / zoom, "height": area.height / zoom })))
}

#[tauri::command]
pub fn get_displays(app: AppHandle) -> Vec<displays::DisplayInfo> {
    displays::list(&app)
}

#[tauri::command]
pub fn set_layout_config(app: AppHandle, layout: Option<layout::LayoutPatch>) {
    let current = app.state::<AppState>().layout.lock().clone();
    let patch = layout.unwrap_or_default();
    let mut next = layout::merge(&current, &patch);
    // Changer la taille sans position explicite : on garde le centre de l'Island en place
    // (sinon la fenêtre grandit depuis son coin gauche et l'Island glisse vers la droite).
    if patch.x.is_none() && next.scale != current.scale {
        next.x = current.x + layout::BASE_WIDTH * (current.scale - next.scale) / 2.0;
    }
    if patch.y.is_none() && next.scale != current.scale {
        next.y = current.y + layout::PILL_TOP_OFFSET * (current.scale - next.scale);
    }
    island::update_layout(&app, next);
}

#[tauri::command]
pub fn reset_layout(app: AppHandle) {
    // « Recentrer » : en haut au centre de l'écran actuel, en gardant la taille choisie.
    let current = app.state::<AppState>().layout.lock().clone();
    island::update_layout(&app, layout::centered_on(&app, &current));
}

/// Glisser de l'Island en mode placement : le curseur est suivi côté Rust (voir island/drag.rs).
#[tauri::command]
pub fn layout_drag_begin(app: AppHandle) {
    island::drag::begin(&app);
}

#[tauri::command]
pub fn layout_drag_move(app: AppHandle) {
    island::drag::update(&app);
}

/// Flèches du clavier en mode placement : déplacement au pixel, sans limite de curseur.
#[tauri::command]
pub fn layout_nudge(app: AppHandle, dx: i32, dy: i32) {
    island::drag::nudge(&app, dx.clamp(-200, 200), dy.clamp(-200, 200));
}

#[tauri::command]
pub fn layout_drag_end(app: AppHandle) {
    island::drag::end(&app);
}

#[tauri::command]
pub fn set_layout_edit_mode(app: AppHandle, enabled: bool) {
    island::set_layout_edit_mode(&app, enabled);
}

/// Déplace l'Island sur un autre écran, centrée en haut.
#[tauri::command]
pub fn set_target_display(app: AppHandle, display_id: Value) {
    let id = match display_id {
        Value::String(s) => s,
        Value::Number(n) => n.to_string(),
        _ => return,
    };
    let current = app.state::<AppState>().layout.lock().clone();
    let target = layout::Layout { display_id: id, ..current };
    island::update_layout(&app, layout::centered_on(&app, &target));
}
