//! Audio Windows (WASAPI) : volume maître, sessions par application,
//! crête du signal pour le visualiseur et périphériques d'entrée/sortie.

use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use windows::core::{Interface, GUID, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, AudioSessionStateActive, EDataFlow, ERole,
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};

use super::{com, icons, process};

#[derive(Debug, Clone, Serialize)]
pub struct AudioSession {
    pub pid: u32,
    pub name: String,
    pub title: String,
    pub icon: String,
    pub volume: f32,
    pub muted: bool,
    pub state: i32,
    pub active: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AudioPeak {
    pub peak: f32,
    pub left: f32,
    pub right: f32,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    com::ensure_mta();
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn default_endpoint(flow: EDataFlow, role: ERole) -> Option<IMMDevice> {
    unsafe { enumerator().ok()?.GetDefaultAudioEndpoint(flow, role).ok() }
}

/// Sortie par défaut (rôle Console, puis Multimédia en repli).
fn default_output() -> Option<IMMDevice> {
    default_endpoint(eRender, eConsole).or_else(|| default_endpoint(eRender, eMultimedia))
}

fn activate<T: Interface>(device: &IMMDevice) -> Option<T> {
    unsafe { device.Activate::<T>(CLSCTX_ALL, None).ok() }
}

fn device_id(device: &IMMDevice) -> Option<String> {
    unsafe {
        let raw = device.GetId().ok()?;
        let id = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0 as *const _));
        id
    }
}

// ---------------------------------------------------------------- Volume maître

pub fn master_volume() -> f32 {
    default_output()
        .and_then(|device| activate::<IAudioEndpointVolume>(&device))
        .and_then(|volume| unsafe { volume.GetMasterVolumeLevelScalar().ok() })
        .map(|level| level * 100.0)
        .unwrap_or(70.0)
}

pub fn set_master_volume(percent: f32) {
    if let Some(volume) = default_output().and_then(|device| activate::<IAudioEndpointVolume>(&device)) {
        unsafe {
            let _ = volume.SetMasterVolumeLevelScalar((percent / 100.0).clamp(0.0, 1.0), &GUID::zeroed());
        }
    }
}

// ---------------------------------------------------------------- Crête (visualiseur)

/// Durée de vie du compteur mis en cache avant de relire le périphérique par défaut.
const METER_REFRESH: Duration = Duration::from_secs(2);

type PeakReply = mpsc::Sender<AudioPeak>;
static METER_THREAD: OnceLock<Mutex<mpsc::Sender<PeakReply>>> = OnceLock::new();

/// Niveau de crête de la sortie par défaut (appelé ~12 fois par seconde par le visualiseur).
///
/// Les objets COM du compteur restent ouverts sur un thread dédié au lieu
/// d'être recréés à chaque appel ; ils sont rafraîchis toutes les 2 s pour
/// suivre un changement de périphérique.
pub fn peak() -> AudioPeak {
    let sender = METER_THREAD.get_or_init(|| Mutex::new(spawn_meter_thread())).lock().clone();
    let (reply, response) = mpsc::channel();
    if sender.send(reply).is_err() {
        return AudioPeak::default();
    }
    response.recv_timeout(Duration::from_millis(500)).unwrap_or_default()
}

fn spawn_meter_thread() -> mpsc::Sender<PeakReply> {
    let (sender, requests) = mpsc::channel::<PeakReply>();
    std::thread::Builder::new()
        .name("audio-meter".into())
        .spawn(move || {
            com::ensure_mta();
            let mut cached: Option<(IAudioMeterInformation, Instant)> = None;
            let mut session_meters: Option<(Vec<IAudioMeterInformation>, Instant)> = None;
            for reply in requests {
                // Retour micro actif : il passe par la même sortie. On additionne alors les
                // compteurs des autres applications pour que le visualiseur ignore la voix.
                if super::mic_monitor::is_running() {
                    if session_meters.as_ref().is_none_or(|(_, at)| at.elapsed() > METER_REFRESH) {
                        session_meters = Some((foreign_session_meters(), Instant::now()));
                    }
                    let value = session_meters.as_ref().map(|(meters, _)| combine_peaks(meters)).unwrap_or_default();
                    let _ = reply.send(value);
                    continue;
                }
                session_meters = None;

                if cached.as_ref().is_none_or(|(_, at)| at.elapsed() > METER_REFRESH) {
                    cached = default_meter().map(|meter| (meter, Instant::now()));
                }
                let mut value = cached.as_ref().and_then(|(meter, _)| read_peak(meter));
                if value.is_none() {
                    // Périphérique débranché ou changé : on rouvre immédiatement.
                    cached = default_meter().map(|meter| (meter, Instant::now()));
                    value = cached.as_ref().and_then(|(meter, _)| read_peak(meter));
                }
                let _ = reply.send(value.unwrap_or_default());
            }
        })
        .expect("thread audio-meter");
    sender
}

/// Compteur de la sortie par défaut (rôle Console, puis Multimédia).
fn default_meter() -> Option<IAudioMeterInformation> {
    [eConsole, eMultimedia]
        .into_iter()
        .find_map(|role| default_endpoint(eRender, role).and_then(|device| activate::<IAudioMeterInformation>(&device)))
}

/// Compteurs de chaque session audio de la sortie par défaut, sauf celles de Nolys.
fn foreign_session_meters() -> Vec<IAudioMeterInformation> {
    let own_pid = std::process::id();
    let mut meters = Vec::new();
    for role in [eConsole, eMultimedia] {
        for_each_session(role, |control, _| {
            if unsafe { control.GetProcessId() }.ok() != Some(own_pid) {
                if let Ok(meter) = control.cast::<IAudioMeterInformation>() {
                    meters.push(meter);
                }
            }
            true
        });
        if !meters.is_empty() {
            break;
        }
    }
    meters
}

fn combine_peaks(meters: &[IAudioMeterInformation]) -> AudioPeak {
    meters.iter().filter_map(read_peak).fold(AudioPeak::default(), |acc, p| AudioPeak {
        peak: acc.peak.max(p.peak),
        left: acc.left.max(p.left),
        right: acc.right.max(p.right),
        channels: acc.channels.max(p.channels),
    })
}

fn read_peak(meter: &IAudioMeterInformation) -> Option<AudioPeak> {
    unsafe {
        let mut peak = meter.GetPeakValue().ok()?;
        let channels = meter.GetMeteringChannelCount().unwrap_or(0);
        let (mut left, mut right) = (peak, peak);
        if channels > 0 {
            let mut values = vec![0f32; channels as usize];
            if meter.GetChannelsPeakValues(&mut values).is_ok() {
                left = values[0];
                right = *values.get(1).unwrap_or(&values[0]);
                peak = values.iter().copied().fold(peak, f32::max);
            }
        }
        Some(AudioPeak {
            peak: peak.clamp(0.0, 1.0),
            left: left.clamp(0.0, 1.0),
            right: right.clamp(0.0, 1.0),
            channels,
        })
    }
}

// ---------------------------------------------------------------- Sessions par application

/// Parcourt les sessions audio de la sortie par défaut.
fn for_each_session(role: ERole, mut visit: impl FnMut(&IAudioSessionControl2, &ISimpleAudioVolume) -> bool) {
    let Some(device) = default_endpoint(eRender, role) else { return };
    let Some(manager) = activate::<IAudioSessionManager2>(&device) else { return };
    unsafe {
        let Ok(sessions) = manager.GetSessionEnumerator() else { return };
        let count = sessions.GetCount().unwrap_or(0);
        for index in 0..count {
            let Ok(control) = sessions.GetSession(index) else { continue };
            let (Ok(control2), Ok(volume)) = (control.cast::<IAudioSessionControl2>(), control.cast::<ISimpleAudioVolume>())
            else {
                continue;
            };
            if !visit(&control2, &volume) {
                break;
            }
        }
    }
}

pub fn sessions() -> Vec<AudioSession> {
    let mut result = Vec::new();
    scan_sessions(eConsole, &mut result);
    if result.is_empty() {
        scan_sessions(eMultimedia, &mut result);
    }
    result
}

fn scan_sessions(role: ERole, result: &mut Vec<AudioSession>) {
    let titles = process::main_window_titles();
    for_each_session(role, |control, volume| unsafe {
        let state = control.GetState().map(|s| s.0).unwrap_or(0);
        let Ok(pid) = control.GetProcessId() else { return true };
        if pid == 0 || result.iter().any(|existing| existing.pid == pid) {
            return true;
        }
        let name = process::process_name(pid).unwrap_or_else(|| "Unknown".into());
        let icon = process::exe_path(pid).map(|path| icons::icon_data_url(&path)).unwrap_or_default();
        result.push(AudioSession {
            pid,
            name,
            title: titles.get(&pid).cloned().unwrap_or_default(),
            icon,
            volume: volume.GetMasterVolume().unwrap_or(0.0) * 100.0,
            muted: volume.GetMute().map(|m| m.as_bool()).unwrap_or(false),
            state,
            active: state == AudioSessionStateActive.0,
        });
        true
    });
}

pub fn set_session_volume(target_pid: u32, percent: f32) {
    with_session(target_pid, |volume| unsafe {
        let _ = volume.SetMasterVolume((percent / 100.0).clamp(0.0, 1.0), &GUID::zeroed());
        let _ = volume.SetMute(percent <= 0.0, &GUID::zeroed());
    });
}

pub fn set_session_muted(target_pid: u32, muted: bool) {
    with_session(target_pid, |volume| unsafe {
        let _ = volume.SetMute(muted, &GUID::zeroed());
    });
}

fn with_session(target_pid: u32, apply: impl Fn(&ISimpleAudioVolume)) {
    let mut done = false;
    for role in [eConsole, eMultimedia] {
        for_each_session(role, |control, volume| {
            if unsafe { control.GetProcessId() }.ok() == Some(target_pid) {
                apply(volume);
                done = true;
                return false;
            }
            true
        });
        if done {
            break;
        }
    }
}

// ---------------------------------------------------------------- Périphériques

pub fn devices(flow: EDataFlow) -> Vec<AudioDevice> {
    let mut result = Vec::new();
    let Ok(enumerator) = enumerator() else { return result };
    unsafe {
        let default_id = enumerator.GetDefaultAudioEndpoint(flow, eConsole).ok().and_then(|d| device_id(&d)).unwrap_or_default();
        let Ok(collection) = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) else { return result };
        for index in 0..collection.GetCount().unwrap_or(0) {
            let Ok(device) = collection.Item(index) else { continue };
            let Some(id) = device_id(&device) else { continue };
            let name = device
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .map(|value| value.to_string())
                .ok()
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "Inconnu".into());
            result.push(AudioDevice { is_default: id == default_id, id, name });
        }
    }
    result
}

pub fn output_devices() -> Vec<AudioDevice> {
    devices(eRender)
}

pub fn input_devices() -> Vec<AudioDevice> {
    devices(eCapture)
}

/// Interface COM non documentée utilisée par Windows pour changer le périphérique par défaut.
#[allow(non_snake_case)]
mod policy_config {
    use windows::core::{interface, IUnknown, IUnknown_Vtbl, HRESULT, PCWSTR};
    use windows::Win32::Media::Audio::ERole;

    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    pub unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self) -> HRESULT;
        fn GetDeviceFormat(&self) -> HRESULT;
        fn ResetDeviceFormat(&self) -> HRESULT;
        fn SetDeviceFormat(&self) -> HRESULT;
        fn GetProcessingPeriod(&self) -> HRESULT;
        fn SetProcessingPeriod(&self) -> HRESULT;
        fn GetShareMode(&self) -> HRESULT;
        fn SetShareMode(&self) -> HRESULT;
        fn GetPropertyValue(&self) -> HRESULT;
        fn SetPropertyValue(&self) -> HRESULT;
        fn SetDefaultEndpoint(&self, device_id: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, device_id: PCWSTR, visible: i32) -> HRESULT;
    }

    pub fn set_default_endpoint(policy: &IPolicyConfig, device_id: PCWSTR, role: ERole) {
        unsafe {
            let _ = policy.SetDefaultEndpoint(device_id, role);
        }
    }
}
use policy_config::IPolicyConfig;

const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// Définit le périphérique par défaut pour les rôles Console, Multimédia et Communications.
pub fn set_default_device(device_id: &str) -> bool {
    if device_id.trim().is_empty() {
        return false;
    }
    com::ensure_mta();
    unsafe {
        let Ok(policy) = CoCreateInstance::<_, IPolicyConfig>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL) else {
            return false;
        };
        let wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
        let id = PCWSTR(wide.as_ptr());
        for role in [eConsole, eMultimedia, eCommunications] {
            policy_config::set_default_endpoint(&policy, id, role);
        }
        true
    }
}

