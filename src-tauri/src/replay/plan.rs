use super::{config::Config, process, sources::Source};
use std::path::Path;

#[derive(Clone, Debug)]
pub struct Plan {
    pub encoder: String,
    pub filter: String,
    pub source: String,
    pub mode: String,
    pub width: u32,
    pub height: u32,
    pub init: Vec<String>,
}

fn desktop(source: &Source, config: &Config) -> Result<(String, Vec<String>), String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| e.to_string())?;
        for i in 0..32 {
            let Ok(adapter) = factory.EnumAdapters1(i) else {
                break;
            };
            for j in 0..32 {
                let Ok(output) = adapter.EnumOutputs(j) else {
                    break;
                };
                if let Ok(desc) = output.GetDesc() {
                    if desc.Monitor.0 as usize == source.handle {
                        return Ok((
                            format!(
                                "ddagrab=output_idx={j}:framerate={}:draw_mouse={}:dup_frames=1",
                                config.fps,
                                u8::from(config.cursor)
                            ),
                            vec![
                                "-init_hw_device".into(),
                                format!("d3d11va=nolys:{i}"),
                                "-filter_hw_device".into(),
                                "nolys".into(),
                            ],
                        ));
                    }
                }
            }
        }
    }
    Err("Cet écran ne peut pas être associé à une sortie de duplication DXGI. Essayez Windows Graphics Capture.".into())
}

pub fn dimensions(source: &Source, height: u32) -> (u32, u32) {
    let factor = if height == 0 {
        1.0
    } else {
        (height as f64 / source.height.max(1) as f64).min(1.0)
    };
    (
        ((source.width as f64 * factor) as u32 / 2 * 2).max(2),
        ((source.height as f64 * factor) as u32 / 2 * 2).max(2),
    )
}

pub fn candidates(config: &Config, source: &Source, engine: &Path) -> Result<Vec<Plan>, String> {
    if config.capture == "desktop" && source.kind != "monitor" {
        return Err("La duplication du bureau nécessite un écran. Choisissez Windows Graphics Capture pour une fenêtre.".into());
    }
    let filters = process::output(engine, &["-hide_banner", "-filters"], 5)?;
    let filter_list = String::from_utf8_lossy(&filters.stdout);
    let encoders = process::output(engine, &["-hide_banner", "-encoders"], 5)?;
    let encoder_list = String::from_utf8_lossy(&encoders.stdout);
    let (width, height) = dimensions(source, config.height);
    let mut captures = Vec::new();
    if source.kind == "monitor" && config.capture != "wgc" && filter_list.contains("ddagrab") {
        match desktop(source, config) {
            Ok(c) => captures.push(c),
            Err(e) if config.capture == "desktop" => return Err(e),
            Err(_) => {}
        }
    }
    if config.capture != "desktop" && filter_list.contains("gfxcapture") {
        captures.push((format!("gfxcapture={}={}:max_framerate={}:capture_cursor={}:width={}:height={}:resize_mode=scale_aspect", if source.kind == "monitor" { "hmonitor" } else { "hwnd" },source.handle,config.fps,u8::from(config.cursor),source.width/2*2,source.height/2*2),vec![]));
    }
    if captures.is_empty() {
        return Err("Ce moteur n’inclut pas la méthode de capture choisie. Sélectionnez une version de FFmpeg avec ddagrab et gfxcapture.".into());
    }
    let families: Vec<&str> = match config.encoder.as_str() {
        "auto" => vec!["amd", "nvidia", "intel"],
        other => vec![other],
    };
    let mut plans = Vec::new();
    for (source_filter, init) in captures {
        for family in &families {
            let family = *family;
            let name = match (family, config.codec.as_str()) {
                ("amd", "hevc") => "hevc_amf",
                ("amd", _) => "h264_amf",
                ("nvidia", "hevc") => "hevc_nvenc",
                ("nvidia", _) => "h264_nvenc",
                ("intel", "hevc") => "hevc_qsv",
                ("intel", _) => "h264_qsv",
                ("software", "hevc") => "libx265",
                _ => "libx264",
            };
            if !encoder_list.contains(name) {
                continue;
            }
            if family != "software"
                && width == source.width
                && height == source.height
                && family != "intel"
            {
                plans.push(Plan {
                    encoder: name.into(),
                    filter: String::new(),
                    source: source_filter.clone(),
                    mode: "GPU direct".into(),
                    width,
                    height,
                    init: init.clone(),
                });
            }
            if family == "amd" && filter_list.contains("vpp_amf") {
                plans.push(Plan { encoder:name.into(),filter:format!("vpp_amf=w={width}:h={height}:format=nv12:color_profile=bt709:color_range=studio"),source:source_filter.clone(),mode:"GPU · conversion AMD".into(),width,height,init:init.clone() });
            }
            let scaling = if width != source.width || height != source.height {
                format!(",scale={width}:{height}:flags=fast_bilinear")
            } else {
                String::new()
            };
            let format = if family == "amd" && scaling.is_empty() {
                ""
            } else {
                ",format=nv12"
            };
            plans.push(Plan {
                encoder: name.into(),
                filter: format!("hwdownload,format=bgra{scaling}{format}"),
                source: source_filter.clone(),
                mode: if family == "software" {
                    "CPU · encodage logiciel".into()
                } else {
                    "GPU · transfert de compatibilité".into()
                },
                width,
                height,
                init: init.clone(),
            });
        }
    }
    if plans.is_empty() {
        return Err("L’encodeur demandé n’est pas inclus dans ce moteur.".into());
    }
    Ok(plans)
}

pub fn video_args(config: &Config, plan: &Plan) -> Vec<String> {
    let mut args = plan.init.clone();
    args.extend(
        ["-f", "lavfi", "-i", &plan.source, "-map", "0:v:0"]
            .into_iter()
            .map(String::from),
    );
    args.extend(encoding_args(config, plan));
    args
}

pub fn encoding_args(config: &Config, plan: &Plan) -> Vec<String> {
    let mut args = Vec::new();
    if !plan.filter.is_empty() {
        args.extend(["-vf".into(), plan.filter.clone()]);
    }
    args.extend([
        "-c:v".into(),
        plan.encoder.clone(),
        "-b:v".into(),
        format!("{}M", config.bitrate_mbps),
        "-maxrate".into(),
        format!("{}M", config.bitrate_mbps),
        "-bufsize".into(),
        format!("{}M", config.bitrate_mbps * 2),
        "-g".into(),
        (config.fps * 2).to_string(),
        "-bf".into(),
        "0".into(),
        "-force_key_frames".into(),
        "expr:gte(t,n_forced*2)".into(),
        "-r".into(),
        config.fps.to_string(),
        "-fps_mode".into(),
        "cfr".into(),
    ]);
    if plan.encoder.ends_with("amf") {
        args.extend([
            "-usage".into(),
            "lowlatency".into(),
            "-quality".into(),
            config.preset.clone(),
            // On the tested AMD driver, -g alone leaves a single IDR at startup.
            // Forced I frames must be independently decodable replay boundaries.
            "-forced_idr".into(),
            "1".into(),
        ]);
    } else if plan.encoder.ends_with("nvenc") {
        args.extend([
            "-preset".into(),
            match config.preset.as_str() {
                "quality" => "p6",
                "balanced" => "p4",
                _ => "p1",
            }
            .into(),
            "-tune".into(),
            "ll".into(),
        ]);
    } else if plan.encoder.ends_with("qsv") {
        args.extend([
            "-preset".into(),
            match config.preset.as_str() {
                "quality" => "slow",
                "balanced" => "medium",
                _ => "veryfast",
            }
            .into(),
        ]);
    } else {
        args.extend([
            "-preset".into(),
            match config.preset.as_str() {
                "quality" => "medium",
                "balanced" => "veryfast",
                _ => "ultrafast",
            }
            .into(),
            "-threads".into(),
            "4".into(),
        ]);
    }
    if config.codec == "hevc" {
        args.extend(["-tag:v".into(), "hvc1".into()]);
    }
    args
}

pub fn select(
    config: &Config,
    source: &Source,
    engine: &Path,
    stopping: &std::sync::atomic::AtomicBool,
) -> Result<Plan, String> {
    let mut last = String::new();
    for plan in candidates(config, source, engine)? {
        if stopping.load(std::sync::atomic::Ordering::Acquire) {
            return Err("Démarrage annulé.".into());
        }
        let mut args = vec!["-hide_banner".into(), "-loglevel".into(), "error".into()];
        args.extend(video_args(config, &plan));
        args.extend([
            "-frames:v".into(),
            "3".into(),
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ]);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        match process::output(engine, &refs, 5) {
            Ok(out) if out.status.success() => return Ok(plan),
            Ok(out) => {
                last = String::from_utf8_lossy(&out.stderr)
                    .chars()
                    .take(1400)
                    .collect()
            }
            Err(e) => last = e,
        }
    }
    Err(format!("Impossible d’initialiser l’encodeur demandé. Aucun basculement CPU automatique. Essayez un autre encodeur ou une résolution inférieure. {last}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_aspect_ratio_without_upscaling() {
        let source = Source {
            id: String::new(),
            kind: "monitor".into(),
            label: String::new(),
            width: 3440,
            height: 1440,
            handle: 0,
        };
        assert_eq!(dimensions(&source, 1080), (2580, 1080));
        assert_eq!(dimensions(&source, 2160), (3440, 1440));
    }

    #[test]
    fn amd_requests_periodic_independently_decodable_frames() {
        for encoder in ["h264_amf", "hevc_amf"] {
            let plan = Plan {
                encoder: encoder.into(),
                filter: String::new(),
                source: String::new(),
                mode: String::new(),
                width: 1920,
                height: 1080,
                init: Vec::new(),
            };
            let args = encoding_args(&Config::default(), &plan);
            assert!(args
                .windows(2)
                .any(|p| p == ["-force_key_frames", "expr:gte(t,n_forced*2)"]));
            assert!(args.windows(2).any(|p| p == ["-forced_idr", "1"]));
        }
    }
}
