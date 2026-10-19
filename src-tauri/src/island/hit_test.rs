//! Clic « traversant » intelligent.
//!
//! La fenêtre de l'Island est transparente et plus grande que la pilule : elle
//! laisse passer les clics vers le bureau. Electron relayait les mouvements de
//! souris à la page ; ici un thread léger compare la position du curseur à la
//! zone de la pilule (envoyée par l'UI) et réactive la souris dès le survol.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::platform::window as win;
use crate::state::AppState;

/// Rectangle en pixels CSS, relatif à la page.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default)]
pub struct HitRegion {
    pub rects: Vec<CssRect>,
    /// `window.devicePixelRatio` (inclut le zoom de l'Island).
    pub pixel_ratio: f64,
}

const POLL_INTERVAL: Duration = Duration::from_millis(30);
const IDLE_INTERVAL: Duration = Duration::from_millis(80);

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("island-hit-test".into())
        .spawn(move || loop {
            let busy = tick(&app);
            std::thread::sleep(if busy { POLL_INTERVAL } else { IDLE_INTERVAL });
        })
        .expect("thread hit-test");
}

/// Renvoie `true` quand le curseur est au-dessus de la fenêtre (sondage rapproché).
///
/// Le survol marche dans les deux sens : la souris est capturée quand le curseur
/// entre dans la pilule, et relâchée dès qu'il en sort, même Island dépliée.
/// Sinon la fenêtre, plus grande que la pilule, avalait les clics autour d'elle.
fn tick(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let Some(window) = app.get_webview_window(super::LABEL) else { return false };
    let Ok(hwnd) = window.hwnd() else { return false };
    let click_through = state.click_through.load(Ordering::Relaxed);
    // tao réécrit parfois les styles de la fenêtre : on réaffirme l'état voulu (sans effet s'il est déjà bon).
    win::set_click_through(hwnd, click_through);
    // Mode placement : toute la fenêtre doit rester saisissable.
    if state.layout_edit_mode.load(Ordering::Relaxed) || !win::is_visible(hwnd) {
        return false;
    }
    let (Some((cx, cy)), Some(bounds)) = (win::cursor_position(), win::window_rect(hwnd)) else { return true };
    let inside_window = cx >= bounds.left && cx < bounds.right && cy >= bounds.top && cy < bounds.bottom;

    let hovered = inside_window && {
        let region = state.hit_region.lock();
        let ratio = if region.pixel_ratio > 0.0 { region.pixel_ratio } else { 1.0 };
        let (px, py) = ((cx - bounds.left) as f64 / ratio, (cy - bounds.top) as f64 / ratio);
        region.rects.iter().any(|r| px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height)
    };

    if hovered && click_through {
        super::set_click_through(app, false);
    } else if !hovered && !click_through && (!win::mouse_button_down()
        || app.state::<crate::files::Store>().dragging.load(Ordering::Acquire)
        || app.state::<crate::files::Store>().outgoing.load(Ordering::Acquire)) {
        // Bouton enfoncé : on attend la fin du glisser (barre de progression, curseurs) avant de relâcher.
        super::set_click_through(app, true);
    }
    inside_window
}
