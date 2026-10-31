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
    island::apply_layout(&app);
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
    })
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
        next.x = (current.x + layout::BASE_WIDTH * (current.scale - next.scale) / 2.0).round();
    }
    if patch.y.is_none() && next.scale != current.scale {
        next.y = (current.y + layout::PILL_TOP_OFFSET * (current.scale - next.scale)).round();
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
