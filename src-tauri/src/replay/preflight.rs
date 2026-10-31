//! User-triggered, one-shot checks. No persistent capture and no global audio changes.
use super::{plan, process, sources, Config, Store};
use base64::Engine;
use serde::Serialize;
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Media::Audio::{
            Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
            *,
        },
        System::Com::{CoCreateInstance, CLSCTX_ALL},
    },
};

#[derive(Serialize)]
pub struct AudioCheck {
    pub system: Option<EndpointCheck>,
    pub microphone: Option<EndpointCheck>,
}
#[derive(Serialize)]
pub struct EndpointCheck {
    pub available: bool,
    pub peak: Option<f32>,
    pub muted: Option<bool>,
    pub error: Option<String>,
}

fn endpoint(system: bool, id: &str) -> EndpointCheck {
    crate::platform::com::ensure_mta();
    let result = (|| unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = if id.is_empty() {
            enumerator.GetDefaultAudioEndpoint(if system { eRender } else { eCapture }, eConsole)?
        } else {
            let id = HSTRING::from(id);
            enumerator.GetDevice(PCWSTR(id.as_ptr()))?
        };
        if device.GetState()? != DEVICE_STATE_ACTIVE {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80070490u32 as i32,
            )));
        }
        let meter = device
            .Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
            .ok();
        let volume = device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .ok();
        Ok((
            meter
                .and_then(|m| m.GetPeakValue().ok())
                .filter(|n| n.is_finite())
                .map(|n| n.clamp(0.0, 1.0)),
            volume.and_then(|v| v.GetMute().ok()).map(|v| v.as_bool()),
        ))
    })();
    match result {
        Ok((peak, muted)) => EndpointCheck {
            available: true,
            peak,
            muted,
            error: None,
        },
        Err(error) => EndpointCheck {
            available: false,
            peak: None,
            muted: None,
            error: Some(error.to_string()),
        },
    }
}
pub fn audio(config: &Config) -> Result<AudioCheck, String> {
    config.validate()?;
    Ok(AudioCheck {
        system: config
            .system_audio
            .then(|| endpoint(true, &config.output_device)),
        microphone: config
            .microphone
            .then(|| endpoint(false, &config.input_device)),
    })
}
impl Store {
    pub fn preview(&self, config: Config) -> Result<String, String> {
        config.validate()?;
        let mut worker = self.worker.lock();
        Self::reap(&mut worker);
        if worker.is_some() {
            return Err("Arrêtez la capture avant de demander un aperçu.".into());
        }
        let source = sources::list()
            .into_iter()
            .find(|s| {
                if config.source_id.is_empty() {
                    s.kind == "monitor"
                } else {
                    s.id == config.source_id
                }
            })
            .ok_or("Source indisponible.")?;
        let engine = process::resolve(&config.engine_path, &self.resources)?;
        let mut last = "Aperçu indisponible pour cette source.".to_string();
        let mut seen = std::collections::HashSet::new();
        for plan in plan::candidates(&config, &source, &engine)? {
            if !seen.insert(plan.source.clone()) {
                continue;
            }
            let mut args = vec!["-v".to_string(), "error".into(), "-nostdin".into()];
            args.extend(plan.init);
            args.extend([
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!(
                    "{},hwdownload,format=bgra,scale=480:270:force_original_aspect_ratio=decrease",
                    plan.source
                ),
                "-frames:v".into(),
                "1".into(),
                "-an".into(),
                "-c:v".into(),
                "mjpeg".into(),
                "-threads".into(),
                "1".into(),
                "-f".into(),
                "image2pipe".into(),
                "pipe:1".into(),
            ]);
            let refs: Vec<_> = args.iter().map(String::as_str).collect();
            match process::output(&engine, &refs, 5) {
                Ok(out)
                    if out.status.success()
                        && out.stdout.starts_with(&[0xff, 0xd8])
                        && out.stdout.ends_with(&[0xff, 0xd9])
                        && out.stdout.len() <= 512 * 1024 =>
                {
                    return Ok(format!(
                        "data:image/jpeg;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(out.stdout)
                    ))
                }
                Ok(_) => last = "L’aperçu de la source n’a pas pu être décodé.".into(),
                Err(error) => last = error,
            }
        }
        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a Windows capture source and bundled FFmpeg; opt in with NOLYS_PREVIEW_TEST_SOURCE"]
    fn chosen_source_preview_is_a_bounded_still_without_changing_capture_state() {
        let source = std::env::var("NOLYS_PREVIEW_TEST_SOURCE").expect("Choose primary or an explicit source ID");
        let directory = tempfile::tempdir().unwrap();
        let store = Store::new(directory.path().into(), directory.path().into(), std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let before = serde_json::to_value(store.snapshot()).unwrap();
        let config = Config { source_id: if source == "primary" { String::new() } else { source }, system_audio: false, microphone: false, ..Config::default() };
        let data = store.preview(config).expect("The chosen source must produce a still image");
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.strip_prefix("data:image/jpeg;base64,").unwrap()).unwrap();
        let image = image::load_from_memory(&bytes).unwrap();
        assert!(image.width() > 0 && image.width() <= 480);
        assert!(image.height() > 0 && image.height() <= 270);
        assert!(bytes.len() <= 512 * 1024);
        assert_eq!(serde_json::to_value(store.snapshot()).unwrap(), before);
        eprintln!("Native still decoded: {} × {}; capture state unchanged.", image.width(), image.height());
    }
}
