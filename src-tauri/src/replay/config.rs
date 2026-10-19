use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub source_id: String,
    pub capture: String,
    pub encoder: String,
    pub codec: String,
    pub preset: String,
    pub height: u32,
    pub fps: u32,
    pub bitrate_mbps: u32,
    pub seconds: u32,
    pub memory_mb: u32,
    pub cursor: bool,
    pub system_audio: bool,
    pub microphone: bool,
    pub output_device: String,
    pub input_device: String,
    pub system_volume: u32,
    pub mic_volume: u32,
    pub audio_kbps: u32,
    pub separate_audio: bool,
    pub destination: String,
    pub engine_path: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            source_id: String::new(),
            capture: "auto".into(),
            encoder: "auto".into(),
            codec: "h264".into(),
            preset: "speed".into(),
            height: 1080,
            fps: 60,
            bitrate_mbps: 16,
            seconds: 60,
            memory_mb: 256,
            cursor: true,
            system_audio: true,
            microphone: false,
            output_device: String::new(),
            input_device: String::new(),
            system_volume: 100,
            mic_volume: 100,
            audio_kbps: 192,
            separate_audio: false,
            destination: String::new(),
            engine_path: String::new(),
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.capture.as_str(), "auto" | "wgc" | "desktop")
            || !matches!(
                self.encoder.as_str(),
                "auto" | "amd" | "nvidia" | "intel" | "software"
            )
            || !matches!(self.codec.as_str(), "h264" | "hevc")
            || !matches!(self.preset.as_str(), "speed" | "balanced" | "quality")
        {
            return Err("Mode de capture ou d’encodage inconnu.".into());
        }
        if ![0, 720, 1080, 1440, 2160].contains(&self.height)
            || ![15, 24, 30, 60, 90, 120, 144, 165, 240].contains(&self.fps)
            || !(2..=150).contains(&self.bitrate_mbps)
            || !(5..=600).contains(&self.seconds)
            || !(64..=2048).contains(&self.memory_mb)
            || !(64..=320).contains(&self.audio_kbps)
            || self.system_volume > 200
            || self.mic_volume > 200
        {
            return Err(
                "Réglage hors limites : vérifiez la qualité, les FPS, la durée et la mémoire."
                    .into(),
            );
        }
        if [
            &self.source_id,
            &self.output_device,
            &self.input_device,
            &self.destination,
            &self.engine_path,
        ]
        .iter()
        .any(|s| s.len() > 32760 || s.contains('\0'))
        {
            return Err("Chemin ou périphérique invalide.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_settings_instead_of_silently_changing_quality() {
        let mut c = Config::default();
        assert!(c.validate().is_ok());
        c.fps = 999;
        assert!(c.validate().is_err());
        c.fps = 60;
        c.memory_mb = u32::MAX;
        assert!(c.validate().is_err());
    }
}
