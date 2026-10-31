use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::{blocking, clamp_int, is_safe_text};
use crate::events;
use crate::platform::audio::{self, AudioDevice, AudioPeak, AudioSession};
use crate::platform::mic_monitor::{self, MonitorConfig, MonitorStatus};

#[tauri::command]
pub async fn get_audio_meter() -> AudioPeak {
    blocking(audio::peak, AudioPeak::default()).await
}

#[tauri::command]
pub async fn get_system_volume() -> Option<f32> {
    blocking(audio::master_volume, None).await
}

#[tauri::command]
pub async fn set_system_volume(volume: Value) -> Result<bool, String> {
    let Some(volume) = clamp_int(&volume, 0, 100) else { return Err("Volume invalide.".into()) };
    if blocking(move || audio::set_master_volume(volume as f32), false).await { Ok(true) }
    else { Err("La sortie audio est indisponible ou le volume a été refusé par Windows.".into()) }
}

#[tauri::command]
pub async fn get_audio_sessions() -> Vec<AudioSession> {
    blocking(audio::sessions, Vec::new()).await
}

#[derive(Deserialize)]
pub struct SessionVolume {
    pid: Value,
    volume: Value,
}

#[derive(Deserialize)]
pub struct SessionMute {
    pid: Value,
    #[serde(default)]
    muted: Value,
}

#[tauri::command]
pub async fn set_session_volume(payload: SessionVolume) -> Result<bool, String> {
    let (Some(pid), Some(volume)) = (clamp_int(&payload.pid, 1, i32::MAX as i64), clamp_int(&payload.volume, 0, 100)) else {
        return Err("Session ou volume invalide.".into());
    };
    if blocking(move || audio::set_session_volume(pid as u32, volume as f32), false).await { Ok(true) }
    else { Err("Cette session audio est indisponible ou le volume a été refusé par Windows.".into()) }
}

#[tauri::command]
pub async fn set_session_muted(payload: SessionMute) -> Result<bool, String> {
    let Some(pid) = clamp_int(&payload.pid, 1, i32::MAX as i64) else { return Err("Session audio invalide.".into()) };
    let muted = match payload.muted {
        Value::Bool(b) => b,
        Value::Null => false,
        Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        Value::String(s) => !s.is_empty(),
        _ => true,
    };
    if blocking(move || audio::set_session_muted(pid as u32, muted), false).await { Ok(true) }
    else { Err("Cette session audio est indisponible ou Windows a refusé la commande.".into()) }
}

#[tauri::command]
pub async fn get_audio_devices() -> Vec<AudioDevice> {
    blocking(audio::output_devices, Vec::new()).await
}

#[tauri::command]
pub async fn get_audio_input_devices() -> Vec<AudioDevice> {
    blocking(audio::input_devices, Vec::new()).await
}

#[tauri::command]
pub async fn set_default_audio_device(device_id: String) -> bool {
    if !is_safe_text(&device_id) {
        return false;
    }
    blocking(move || audio::set_default_device(&device_id), false).await
}

/// État du retour micro (réglages, niveaux, périphériques ouverts).
#[tauri::command]
pub async fn get_mic_monitor() -> MonitorStatus {
    blocking(mic_monitor::status, MonitorStatus::default()).await
}

/// Nouveaux réglages du retour micro, relayés aux deux fenêtres pour rester synchrones.
#[tauri::command]
pub async fn set_mic_monitor(app: AppHandle, config: MonitorConfig) -> MonitorStatus {
    let status = blocking(move || mic_monitor::set_config(config), MonitorStatus::default()).await;
    let _ = app.emit(events::MIC_MONITOR_CHANGED, &status);
    status
}
