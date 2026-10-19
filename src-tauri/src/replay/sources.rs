use serde::Serialize;
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible,
        },
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip)]
    pub handle: usize,
}

pub fn list() -> Vec<Source> {
    let mut sources = Vec::<Source>::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(monitor),
            LPARAM(&mut sources as *mut _ as isize),
        );
        // Default source is the Windows primary monitor, independent of enum order.
        sources.sort_by_key(|s| !s.label.contains(" · principal"));
        let _ = EnumWindows(Some(window), LPARAM(&mut sources as *mut _ as isize));
    }
    sources
}

unsafe extern "system" fn monitor(handle: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let sources = &mut *(data.0 as *mut Vec<Source>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(handle, &mut info as *mut _ as *mut _).as_bool() {
        let rect = info.monitorInfo.rcMonitor;
        let name = String::from_utf16_lossy(
            &info.szDevice[..info
                .szDevice
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(info.szDevice.len())],
        );
        let (width, height) = (
            (rect.right - rect.left).max(0) as u32,
            (rect.bottom - rect.top).max(0) as u32,
        );
        let primary = if info.monitorInfo.dwFlags & 1 != 0 {
            " · principal"
        } else {
            ""
        };
        sources.push(Source {
            id: format!("monitor:{}", handle.0 as usize),
            kind: "monitor".into(),
            label: format!(
                "Écran {}{primary} · {} × {} · {}",
                sources.len() + 1,
                width,
                height,
                name.trim_start_matches("\\\\.\\")
            ),
            width,
            height,
            handle: handle.0 as usize,
        });
    }
    BOOL(1)
}

unsafe extern "system" fn window(hwnd: HWND, data: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == std::process::id() {
        return BOOL(1);
    }
    let mut title = [0u16; 1024];
    let n = GetWindowTextW(hwnd, &mut title);
    if n <= 0 {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return BOOL(1);
    }
    let (width, height) = (
        (rect.right - rect.left).max(0) as u32,
        (rect.bottom - rect.top).max(0) as u32,
    );
    if width < 64 || height < 64 {
        return BOOL(1);
    }
    let sources = &mut *(data.0 as *mut Vec<Source>);
    if sources.len() < 2048 {
        sources.push(Source {
            id: format!("window:{}:{pid}", hwnd.0 as usize),
            kind: "window".into(),
            label: String::from_utf16_lossy(&title[..n as usize]),
            width,
            height,
            handle: hwnd.0 as usize,
        });
    }
    BOOL(1)
}
