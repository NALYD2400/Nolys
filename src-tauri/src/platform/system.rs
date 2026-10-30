//! Petites intégrations système : Ne pas déranger, télémétrie réseau,
//! charge CPU / RAM / disque, fond d'écran, ouverture de raccourcis.

use std::time::Instant;

use parking_lot::Mutex;
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

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    pub cpu_temp: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub net_down: Option<f64>,
    pub net_up: Option<f64>,
    pub disk_read: Option<f64>,
    pub disk_write: Option<f64>,
}

/// `IF_TYPE_SOFTWARE_LOOPBACK` (ipifcons.h).
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

struct TelemetryState {
    last_bytes: Option<(u64, u64, Instant)>,
}

static TELEMETRY: Mutex<TelemetryState> = Mutex::new(TelemetryState { last_bytes: None });

fn network_bytes() -> Option<(u64, u64)> {
    let (mut received, mut sent) = (0u64, 0u64);
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
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
    Some((received, sent))
}

/// Débit réel ; les capteurs non implémentés sont explicitement indisponibles.
pub fn telemetry() -> Telemetry {
    let sample = network_bytes();
    let now = Instant::now();
    let mut state = TELEMETRY.lock();
    let Some((received, sent)) = sample else {
        state.last_bytes = None;
        return Telemetry::default();
    };
    let (mut down_kb, mut up_kb) = (None, None);
    if let Some((last_received, last_sent, at)) = state.last_bytes {
        let seconds = now.duration_since(at).as_secs_f64();
        if seconds > 0.0 {
            if received >= last_received && sent >= last_sent {
                down_kb = Some((received - last_received) as f64 / 1024.0 / seconds);
                up_kb = Some((sent - last_sent) as f64 / 1024.0 / seconds);
            }
        }
    }
    state.last_bytes = Some((received, sent, now));

    let round1 = |v: f64| (v * 10.0).round() / 10.0;
    Telemetry {
        net_down: down_kb.map(round1),
        net_up: up_kb.map(round1),
        ..Telemetry::default()
    }
}

// ---------------------------------------------------------------- CPU / RAM / disque

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu: Option<u32>,
    pub ram: Option<u32>,
    pub disk_free: Option<u64>,
    pub disk_total: Option<u64>,
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

fn cpu_percent() -> Option<u32> {
    let now = cpu_times()?;
    let previous = CPU_SAMPLE.lock().replace(now);
    let previous = match previous {
        Some(previous) => previous,
        None => {
            // Premier appel : courte mesure pour avoir une valeur immédiatement.
            std::thread::sleep(std::time::Duration::from_millis(120));
            let later = cpu_times()?;
            *CPU_SAMPLE.lock() = Some(later);
            return usage(now, later);
        }
    };
    usage(previous, now)
}

fn usage((idle_a, total_a): (u64, u64), (idle_b, total_b): (u64, u64)) -> Option<u32> {
    let total = total_b.checked_sub(total_a)?;
    if total == 0 { return None; }
    let idle = idle_b.checked_sub(idle_a)?;
    if idle > total { return None; }
    Some((((total - idle) as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as u32)
}

pub fn system_stats() -> SystemStats {
    let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    let ram = unsafe { GlobalMemoryStatusEx(&mut memory) }.ok().map(|_| memory.dwMemoryLoad);

    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let (mut free, mut total) = (0u64, 0u64);
    let disk_valid = unsafe {
        GetDiskFreeSpaceExW(&HSTRING::from(format!("{system_drive}\\")), Some(&mut free), Some(&mut total), None).is_ok()
    } && total > 0 && free <= total;
    SystemStats { cpu: cpu_percent(), ram, disk_free: disk_valid.then_some(free), disk_total: disk_valid.then_some(total) }
}

#[cfg(test)]
mod measurement_tests {
    use super::*;

    #[test]
    fn absent_samples_serialize_as_null_instead_of_fake_values() {
        let stats = serde_json::to_value(SystemStats::default()).unwrap();
        assert!(stats["cpu"].is_null());
        assert!(stats["ram"].is_null());
        assert!(stats["diskTotal"].is_null());
        let telemetry = serde_json::to_value(Telemetry::default()).unwrap();
        for key in ["cpuTemp", "gpuTemp", "diskRead", "diskWrite", "netDown", "netUp"] {
            assert!(telemetry[key].is_null(), "{key}");
        }
    }

    #[test]
    fn cpu_zero_is_a_real_sample_and_broken_or_identical_counters_are_absent() {
        assert_eq!(usage((10, 100), (20, 110)), Some(0));
        assert_eq!(usage((10, 100), (10, 110)), Some(100));
        assert_eq!(usage((10, 100), (10, 100)), None);
        assert_eq!(usage((10, 100), (9, 110)), None);
        assert_eq!(usage((10, 100), (30, 110)), None);
    }
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
