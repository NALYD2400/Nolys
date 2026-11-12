//! Le curseur déplace l'ancrage de la pilule dans une surface native stable.
//! Relâcher enregistre cet ancrage ; la fenêtre n'est pas recadrée après coup.
use std::sync::{atomic::Ordering, Mutex};
use tauri::{AppHandle, Manager};
use super::layout::{self, Layout};
use crate::platform::window as win;
use crate::state::AppState;

#[derive(Clone, Copy)]
struct Grab {
    cursor: (i32, i32),
    /// Centre horizontal et haut de la pilule, en pixels physiques.
    anchor: (f64, f64),
}
impl Grab {
    fn at(self, cursor: (i32, i32)) -> (f64, f64) {
        (self.anchor.0 + f64::from(cursor.0 - self.cursor.0),
         self.anchor.1 + f64::from(cursor.1 - self.cursor.1))
    }
}
static GRAB: Mutex<Option<Grab>> = Mutex::new(None);

fn anchor(app: &AppHandle, current: &Layout) -> (f64, f64) {
    let dpi = layout::target_monitor(app, &current.display_id).map(|m| m.scale_factor()).unwrap_or(1.0);
    ((current.x + layout::BASE_WIDTH * current.scale / 2.0) * dpi,
     (current.y + layout::PILL_TOP_OFFSET * current.scale) * dpi)
}

pub fn begin(app: &AppHandle) {
    if !app.state::<AppState>().layout_edit_mode.load(Ordering::SeqCst) { return; }
    let Some(cursor) = win::cursor_position() else { return };
    let current = app.state::<AppState>().layout.lock().clone();
    let reference = anchor(app, &current);
    if let Ok(mut grab) = GRAB.lock() { *grab = Some(Grab { cursor, anchor: reference }); }
}

pub fn update(app: &AppHandle) {
    if !app.state::<AppState>().layout_edit_mode.load(Ordering::SeqCst) { return; }
    let Some(grab) = GRAB.lock().ok().and_then(|g| *g) else { return };
    let Some(cursor) = win::cursor_position() else { return };
    place(app, grab.at(cursor));
}

pub fn nudge(app: &AppHandle, dx: i32, dy: i32) {
    if !app.state::<AppState>().layout_edit_mode.load(Ordering::SeqCst) { return; }
    let current = app.state::<AppState>().layout.lock().clone();
    let reference = anchor(app, &current);
    place(app, (reference.0 + f64::from(dx), reference.1 + f64::from(dy)));
    persist(app);
}

fn place(app: &AppHandle, (x, y): (f64, f64)) {
    let state = app.state::<AppState>();
    let current = state.layout.lock().clone();
    let monitor = app.available_monitors().ok().and_then(|list| list.into_iter().find(|m| {
        let p = m.position(); let s = m.size();
        x >= f64::from(p.x) && x < f64::from(p.x) + f64::from(s.width)
            && y >= f64::from(p.y) && y < f64::from(p.y) + f64::from(s.height)
    })).or_else(|| layout::target_monitor(app, &current.display_id));
    let dpi = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let raw = Layout {
        x: x / dpi - layout::BASE_WIDTH * current.scale / 2.0,
        y: y / dpi - layout::PILL_TOP_OFFSET * current.scale,
        display_id: monitor.as_ref().map(layout::monitor_id).unwrap_or(current.display_id.clone()),
        ..current
    };
    *state.layout.lock() = layout::clamp(app, &raw);
    super::apply_drag_layout(app);
}

fn persist(app: &AppHandle) {
    let state = app.state::<AppState>();
    let layout = state.layout.lock().clone();
    layout::save(&state.data_dir, &layout);
    super::broadcast_layout(app);
}

pub fn end(app: &AppHandle) {
    // Le dernier pointermove peut encore attendre son image côté JavaScript.
    update(app);
    let was_dragging = GRAB.lock().map(|mut grab| grab.take().is_some()).unwrap_or(false);
    if !was_dragging { return; }
    app.state::<AppState>().suppress_move_sync.store(false, Ordering::SeqCst);
    persist(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_delta_is_absolute_and_does_not_accumulate_between_frames() {
        let grab = Grab { cursor: (400, 300), anchor: (900.5, 200.0) };
        assert_eq!(grab.at((420, 900)), (920.5, 800.0));
        assert_eq!(grab.at((420, 900)), (920.5, 800.0));
        assert_eq!(grab.at((410, 100)), (910.5, 0.0));
        assert_eq!(grab.at((405, 1000)), (905.5, 900.0));
    }
}
