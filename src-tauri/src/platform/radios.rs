//! Wi-Fi et Bluetooth via `Windows.Devices.Radios`.
//! Les réponses textuelles (`on`, `off`, `ok`, `denied`…) sont celles attendues par l'UI.

use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

use super::com;
use std::time::{Duration, Instant};

fn find_radio(kind: RadioKind) -> Result<Option<Radio>, &'static str> {
    com::ensure_mta();
    let radios = Radio::GetRadiosAsync().and_then(|op| op.join()).map_err(|_| "unknown")?;
    Ok(radios.into_iter().find(|radio| radio.Kind().map(|k| k == kind).unwrap_or(false)))
}

pub fn status(kind: RadioKind) -> String {
    match find_radio(kind) {
        Ok(Some(radio)) => match radio.State() {
            Ok(state) => state_name(state).into(),
            Err(_) => "unknown".into(),
        },
        Ok(None) => "not_found".into(),
        // Comme l'original : un refus d'accès en lecture se traduit par « unknown ».
        Err(_) => "unknown".into(),
    }
}

pub fn set_enabled(kind: RadioKind, enabled: bool) -> String {
    com::ensure_mta();
    // Reading radio state needs no access request; only changes ask Windows.
    match Radio::RequestAccessAsync().and_then(|op| op.join()) {
        Ok(RadioAccessStatus::Allowed) => {},
        Ok(_) => return "denied".into(),
        Err(_) => return "unknown".into(),
    }
    match find_radio(kind) {
        Ok(Some(radio)) => {
            let target = if enabled { RadioState::On } else { RadioState::Off };
            match radio.SetStateAsync(target).and_then(|op| op.join()) {
                Ok(RadioAccessStatus::Allowed) => {
                    // Allowed acknowledges the request, not the final hardware state.
                    let until = Instant::now() + Duration::from_millis(1500);
                    loop {
                        match radio.State() {
                            Ok(state) if state == target => return "ok".into(),
                            Ok(RadioState::Disabled) => return "disabled".into(),
                            Err(_) => return "unknown".into(),
                            _ if Instant::now() >= until => return "failed".into(),
                            _ => std::thread::sleep(Duration::from_millis(50)),
                        }
                    }
                },
                Ok(_) => "failed".into(),
                Err(error) => format!("error: {}", error.message()),
            }
        }
        Ok(None) => "not_found".into(),
        Err(reason) => reason.into(),
    }
}

/// Exécute une action `on` / `off` / `status` sur la radio demandée.
pub fn control(kind: RadioKind, action: &str) -> String {
    match action {
        "status" => status(kind),
        "on" => set_enabled(kind, true),
        "off" => set_enabled(kind, false),
        _ => "error".into(),
    }
}

pub use windows::Devices::Radios::RadioKind as Kind;

fn state_name(state: RadioState) -> &'static str {
    match state {
        RadioState::On => "on",
        RadioState::Off => "off",
        RadioState::Disabled => "disabled",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hardware_blocked_and_unknown_radios_are_not_reported_as_off() {
        assert_eq!(state_name(RadioState::On), "on");
        assert_eq!(state_name(RadioState::Off), "off");
        assert_eq!(state_name(RadioState::Disabled), "disabled");
        assert_eq!(state_name(RadioState::Unknown), "unknown");
    }
}
