//! Informations sur les processus et fenêtres (équivalent de `System.Diagnostics.Process`).

use std::collections::HashMap;
use std::path::Path;

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, IsZoomed, GWL_STYLE, GW_OWNER, WS_THICKFRAME,
};

/// Chemin complet de l'exécutable d'un processus.
pub fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }
}

/// Nom du processus sans extension (comme `Process.ProcessName`).
pub fn process_name(pid: u32) -> Option<String> {
    if let Some(path) = exe_path(pid) {
        return Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned());
    }
    snapshot_exe_name(pid).map(|name| name.trim_end_matches(".exe").trim_end_matches(".EXE").to_string())
}

/// Repli via un instantané ToolHelp (processus protégés).
fn snapshot_exe_name(pid: u32) -> Option<String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = None;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == pid {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    found = Some(String::from_utf16_lossy(&entry.szExeFile[..len]));
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        found
    }
}

pub fn window_text(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
    }
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid
}

/// Fenêtres principales visibles (sans propriétaire), dans l'ordre Z.
fn main_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<HWND>);
        let unowned = GetWindow(hwnd, GW_OWNER).map(|owner| owner.0.is_null()).unwrap_or(true);
        if unowned && IsWindowVisible(hwnd).as_bool() {
            list.push(hwnd);
        }
        BOOL(1)
    }

    let mut list: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

/// Titre de la fenêtre principale de chaque processus (comme `MainWindowTitle`).
pub fn main_window_titles() -> HashMap<u32, String> {
    let mut titles = HashMap::new();
    for hwnd in main_windows() {
        titles.entry(window_pid(hwnd)).or_insert_with(|| window_text(hwnd));
    }
    titles
}

/// Titres des fenêtres principales de tous les processus portant ce nom.
pub fn window_titles_for_process_name(name: &str) -> Vec<String> {
    let wanted = name.to_lowercase();
    let mut names: HashMap<u32, Option<String>> = HashMap::new();
    let mut titles = Vec::new();
    for (pid, title) in main_window_titles() {
        let process = names.entry(pid).or_insert_with(|| process_name(pid)).clone();
        if process.map(|p| p.to_lowercase() == wanted).unwrap_or(false) {
            titles.push(title);
        }
    }
    titles
}

/// Titres de toutes les fenêtres visibles nommées (pour la recherche de « miroir »).
pub fn visible_window_titles() -> Vec<(isize, String)> {
    main_windows()
        .into_iter()
        .filter_map(|hwnd| {
            let title = window_text(hwnd);
            (!title.trim().is_empty()).then_some((hwnd.0 as isize, title))
        })
        .collect()
}

pub struct ForegroundInfo {
    pub pid: u32,
    pub name: String,
    pub title: String,
    pub class_name: String,
    /// Écran (HMONITOR) qui contient la fenêtre.
    pub monitor: isize,
    pub is_fullscreen: bool,
}

/// Fenêtre au premier plan + détection plein écran (tolérance de 2 px).
pub fn foreground_window() -> Option<ForegroundInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let pid = window_pid(hwnd);
        let name = process_name(pid).unwrap_or_default();
        let title = main_window_titles().remove(&pid).unwrap_or_else(|| window_text(hwnd));

        let mut class_buffer = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buffer).max(0) as usize;
        let class_name = String::from_utf16_lossy(&class_buffer[..class_len]);

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut is_fullscreen = false;
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !monitor.is_invalid() && GetMonitorInfoW(monitor, &mut info).as_bool() {
                let m = info.rcMonitor;
                const TOLERANCE: i32 = 2;
                is_fullscreen = (rect.left - m.left).abs() <= TOLERANCE
                    && (rect.top - m.top).abs() <= TOLERANCE
                    && (rect.right - m.right).abs() <= TOLERANCE
                    && (rect.bottom - m.bottom).abs() <= TOLERANCE;
            }
        }
        // Une fenêtre agrandie à bord redimensionnable n'est pas un plein écran. Sur un écran
        // sans barre des tâches, les applis à barre de titre maison (ChatGPT, VS Code…)
        // couvrent alors l'écran pile, comme un plein écran : l'Island se masquait dès qu'on
        // en agrandissait une, ou qu'on la collait en haut de l'écran en la déplaçant.
        // Un vrai plein écran (vidéo, jeu, F11) n'est pas agrandi et n'a pas ce bord.
        if is_fullscreen && IsZoomed(hwnd).as_bool() {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            is_fullscreen = style & WS_THICKFRAME.0 == 0;
        }

        Some(ForegroundInfo { pid, name, title, class_name, monitor: monitor.0 as isize, is_fullscreen })
    }
}
