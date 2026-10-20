//! Petites intégrations système : Ne pas déranger, télémétrie réseau,
//! charge CPU / RAM / disque, fond d'écran, ouverture de raccourcis.

use std::time::Instant;

use parking_lot::Mutex;
use rand::Rng;
use serde::Serialize;
use windows::core::{BOOL, HSTRING, PCWSTR};
use windows::Win32::Foundation::{FILETIME, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SystemParametersInfoW, SM_CXSCREEN, SM_CYSCREEN, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE,
    SPI_SETDESKWALLPAPER, SW_SHOWNORMAL,
};

use super::registry;

// ---------------------------------------------------------------- Ne pas déranger

const NOTIFICATIONS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
const TOASTS_VALUE: &str = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";

pub fn dnd_control(action: &str) -> String {
    match action {
        "status" => match registry::read_dword(NOTIFICATIONS_KEY, TOASTS_VALUE) {
            Some(0) => "on".into(),
            _ => "off".into(),
        },
        "on" | "off" => {
            let toasts_enabled = if action == "on" { 0 } else { 1 };
            if registry::write_dword(NOTIFICATIONS_KEY, TOASTS_VALUE, toasts_enabled) { "ok".into() } else { "failed".into() }
        }
        _ => "error".into(),
    }
}

// ---------------------------------------------------------------- Télémétrie

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    pub cpu_temp: f64,
    pub gpu_temp: f64,
    pub net_down: f64,
    pub net_up: f64,
    pub disk_read: f64,
    pub disk_write: f64,
}

/// `IF_TYPE_SOFTWARE_LOOPBACK` (ipifcons.h).
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

struct TelemetryState {
    last_bytes: Option<(u64, u64, Instant)>,
    cpu_temp: f64,
    gpu_temp: f64,
}

static TELEMETRY: Mutex<TelemetryState> = Mutex::new(TelemetryState { last_bytes: None, cpu_temp: 42.0, gpu_temp: 45.0 });

fn network_bytes() -> (u64, u64) {
    let (mut received, mut sent) = (0u64, 0u64);
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return (0, 0);
        }
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        for row in rows {
            // Bit 1 = FilterInterface : les couches de filtre NDIS dupliqueraient les octets.
            let is_filter = row.InterfaceAndOperStatusFlags._bitfield & 0b10 != 0;
            if row.OperStatus == IfOperStatusUp && row.Type != IF_TYPE_SOFTWARE_LOOPBACK && !is_filter {
                received += row.InOctets;
                sent += row.OutOctets;
            }
        }
        FreeMibTable(table as *const _);
    }
    (received, sent)
}

/// Débit réseau réel ; températures et disque restent simulés comme dans la version d'origine.
pub fn telemetry() -> Telemetry {
    let (received, sent) = network_bytes();
    let now = Instant::now();
    let mut state = TELEMETRY.lock();

    let (mut down_kb, mut up_kb) = (0.0, 0.0);
    if let Some((last_received, last_sent, at)) = state.last_bytes {
        let seconds = now.duration_since(at).as_secs_f64();
        if seconds > 0.0 {
            down_kb = (received.saturating_sub(last_received) as f64 / 1024.0) / seconds;
            up_kb = (sent.saturating_sub(last_sent) as f64 / 1024.0) / seconds;
        }
    }
    state.last_bytes = Some((received, sent, now));

    let mut rng = rand::rng();
    let disk_read = rng.random::<f64>() * 3.5;
    let mut disk_write = rng.random::<f64>() * 1.2;
    if down_kb > 100.0 {
        disk_write += (down_kb / 1024.0) * 1.1;
    }
    state.cpu_temp = (state.cpu_temp + (rng.random::<f64>() - 0.5) * 1.8).clamp(37.0, 72.0);
    state.gpu_temp = (state.gpu_temp + (rng.random::<f64>() - 0.5) * 1.4).clamp(40.0, 76.0);

    let round1 = |v: f64| (v * 10.0).round() / 10.0;
    Telemetry {
        cpu_temp: round1(state.cpu_temp),
        gpu_temp: round1(state.gpu_temp),
        net_down: round1(down_kb),
        net_up: round1(up_kb),
        disk_read: round1(disk_read),
        disk_write: round1(disk_write),
    }
}

// ---------------------------------------------------------------- CPU / RAM / disque

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu: u32,
    pub ram: u32,
    pub disk_free: u64,
    pub disk_total: u64,
}

static CPU_SAMPLE: Mutex<Option<(u64, u64)>> = Mutex::new(None);

fn filetime(ft: FILETIME) -> u64 {
    (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)
}

/// (temps d'inactivité, temps total) cumulés depuis le démarrage.
fn cpu_times() -> Option<(u64, u64)> {
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).ok()? };
    // Le temps noyau inclut déjà le temps d'inactivité.
    Some((filetime(idle), filetime(kernel) + filetime(user)))
}

fn cpu_percent() -> u32 {
    let Some(now) = cpu_times() else { return 0 };
    let previous = CPU_SAMPLE.lock().replace(now);
    let previous = match previous {
        Some(previous) => previous,
        None => {
            // Premier appel : courte mesure pour avoir une valeur immédiatement.
            std::thread::sleep(std::time::Duration::from_millis(120));
            let Some(later) = cpu_times() else { return 0 };
            *CPU_SAMPLE.lock() = Some(later);
            return usage(now, later);
        }
    };
    usage(previous, now)
}

fn usage((idle_a, total_a): (u64, u64), (idle_b, total_b): (u64, u64)) -> u32 {
    let total = total_b.saturating_sub(total_a);
    if total == 0 {
        return 0;
    }
    let busy = total.saturating_sub(idle_b.saturating_sub(idle_a));
    ((busy as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as u32
}

pub fn system_stats() -> SystemStats {
    let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    let ram = unsafe { GlobalMemoryStatusEx(&mut memory) }.map(|_| memory.dwMemoryLoad).unwrap_or(45);

    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let (mut free, mut total) = (0u64, 0u64);
    unsafe {
        let _ = GetDiskFreeSpaceExW(&HSTRING::from(format!("{system_drive}\\")), Some(&mut free), Some(&mut total), None);
    }

    SystemStats { cpu: cpu_percent(), ram, disk_free: free, disk_total: total }
}

// ---------------------------------------------------------------- Fond d'écran

pub fn current_wallpaper() -> String {
    registry::read_string(r"Control Panel\Desktop", "Wallpaper").unwrap_or_default()
}

/// Historique des fonds d'écran Windows (`BackgroundHistoryPath0..4`).
pub fn wallpaper_history() -> Vec<String> {
    (0..5)
        .filter_map(|i| {
            registry::read_string(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers",
                &format!("BackgroundHistoryPath{i}"),
            )
        })
        .collect()
}

pub fn set_wallpaper(path: &str) {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_ptr() as *mut _),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        );
    }
}

/// Plus grand écran branché (en pixels) : le fond est rendu à sa taille, puis Windows le recadre
/// pour les autres. Rendu à la taille de l'écran principal, il était agrandi (flou) sur un grand écran.
pub fn largest_screen_size() -> (u32, u32) {
    unsafe extern "system" fn collect(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let sizes = &mut *(data.0 as *mut Vec<(u32, u32)>);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            let r = info.rcMonitor;
            sizes.push(((r.right - r.left).max(0) as u32, (r.bottom - r.top).max(0) as u32));
        }
        BOOL(1)
    }
    let mut sizes: Vec<(u32, u32)> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut sizes as *mut _ as isize));
    }
    sizes.into_iter().filter(|(w, h)| *w > 0 && *h > 0).max_by_key(|(w, h)| u64::from(*w) * u64::from(*h)).unwrap_or_else(primary_screen_size)
}

pub fn primary_screen_size() -> (u32, u32) {
    let (w, h) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
    (if w > 0 { w as u32 } else { 1920 }, if h > 0 { h as u32 } else { 1080 })
}

// ---------------------------------------------------------------- Shell

/// Ouvre un fichier, dossier ou URL avec l'application associée.
pub fn shell_open(target: &str) -> bool {
    let target = HSTRING::from(target);
    let result = unsafe { ShellExecuteW(None, &HSTRING::from("open"), &target, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    result.0 as isize > 32
}
