//! Opérations Win32 sur les fenêtres de l'application (premier plan, curseur…).

use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible, SetWindowLongPtrW, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_RESTORE,
    SW_SHOWNOACTIVATE, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT, GW_HWNDPREV,
};

pub fn cursor_position() -> Option<(i32, i32)> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point).ok()? };
    Some((point.x, point.y))
}

/// Un bouton de la souris est-il enfoncé (glisser en cours) ?
pub fn mouse_button_down() -> bool {
    // Bit de poids fort : touche enfoncée au moment de l'appel.
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|key| unsafe { GetAsyncKeyState(key.0 as i32) } < 0)
}

pub fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).ok()? };
    Some(rect)
}

pub fn is_visible(hwnd: HWND) -> bool {
    unsafe { IsWindowVisible(hwnd).as_bool() }
}

pub fn is_minimized(hwnd: HWND) -> bool {
    unsafe { IsIconic(hwnd).as_bool() }
}

pub fn restore(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
    }
}

/// Affiche la fenêtre sans lui donner le focus (équivalent `showInactive`).
pub fn show_inactive(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

pub fn hide(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}

/// Clic traversant : la fenêtre laisse passer la souris vers ce qui est dessous.
///
/// Fait directement en Win32 plutôt que via Tauri : tao réapplique tout son état
/// interne (visibilité comprise) à chaque changement, ce qui masquait l'Island.
pub fn set_click_through(hwnd: HWND, enabled: bool) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let bits = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;
        let next = if enabled { style | bits } else { style & !bits };
        if next != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

pub fn is_topmost(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 }
}

/// Le style topmost ne garantit pas l'ordre entre deux fenêtres topmost.
pub fn foreground_is_above(hwnd: HWND) -> bool {
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() || foreground == hwnd {
            return false;
        }
        let mut current = hwnd;
        while let Ok(previous) = GetWindow(current, GW_HWNDPREV) {
            if previous.0.is_null() || previous == current {
                break;
            }
            if previous == foreground {
                return true;
            }
            current = previous;
        }
        false
    }
}

/// Replace la fenêtre tout en haut de la bande « topmost », sans voler le focus.
pub fn raise_topmost(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// Écran (HMONITOR) qui affiche la fenêtre.
pub fn monitor_of(hwnd: HWND) -> isize {
    unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST).0 as isize }
}
