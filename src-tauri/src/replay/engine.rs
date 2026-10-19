use super::{
    audio::Feed,
    config::Config,
    export::{self, Recording},
    mp4::{self, Part},
    plan,
    process::{self, OwnedChild},
    ring::Ring,
    sources::Source,
    Action, Shared,
};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    sync::{
        atomic::Ordering,
        mpsc::{sync_channel, Receiver, RecvTimeoutError},
        Arc,
    },
    time::{Duration, Instant},
};

fn capture_args(config: &Config, plan: &plan::Plan, feeds: &[Feed], origin: f64) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "info".into(),
        "-nostats".into(),
        "-copyts".into(),
        "-progress".into(),
        "pipe:2".into(),
    ];
    args.extend(plan.init.clone());
    args.extend(
        [
            "-thread_queue_size",
            "64",
            "-use_wallclock_as_timestamps",
            "1",
            "-analyzeduration",
            "1",
            "-probesize",
            "32",
            "-f",
            "lavfi",
            "-i",
            &plan.source,
        ]
        .into_iter()
        .map(String::from),
    );
    for feed in feeds {
        args.extend(
            [
                "-thread_queue_size",
                "64",
                "-analyzeduration",
                "1",
                "-probesize",
                "32",
                "-f",
                "matroska",
                "-i",
                &feed.path,
            ]
            .into_iter()
            .map(String::from),
        );
    }
    args.extend(["-map".into(), "0:v:0".into()]);
    if !feeds.is_empty() {
        let volumes: Vec<f64> = if config.system_audio && config.microphone {
            vec![
                config.system_volume as f64 / 100.0,
                config.mic_volume as f64 / 100.0,
            ]
        } else {
            vec![
                if config.system_audio {
                    config.system_volume
                } else {
                    config.mic_volume
                } as f64
                    / 100.0,
            ]
        };
        let mut filter = String::new();
        for (i, volume) in volumes.iter().enumerate() {
            if i > 0 {
                filter.push(';');
            }
            filter.push_str(&format!("[{}:a]asetpts=PTS-{origin:.6}/TB,volume={volume},aresample=async=1000:first_pts=0,alimiter=limit=0.95:latency=1[a{i}]",i+1));
        }
        if feeds.len() > 1 && !config.separate_audio {
            filter.push_str(";[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:latency=1[mix]");
        }
        args.extend(["-filter_complex".into(), filter]);
        if feeds.len() > 1 && !config.separate_audio {
            args.extend(["-map".into(), "[mix]".into()]);
        } else {
            for i in 0..feeds.len() {
                args.extend(["-map".into(), format!("[a{i}]")]);
            }
        }
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            format!("{}k", config.audio_kbps),
            "-ar".into(),
            "48000".into(),
        ]);
    }
    let mut encoding = plan::encoding_args(config, plan);
    if let Some(i) = encoding.iter().position(|s| s == "-vf") {
        encoding[i + 1].push_str(&format!(",setpts=PTS-{origin:.6}/TB"));
    } else {
        encoding.extend(["-vf".into(), format!("setpts=PTS-{origin:.6}/TB")]);
    }
    args.extend(encoding);
    args.extend(
        [
            "-video_track_timescale",
            "90000",
            "-movflags",
            "+empty_moov+frag_keyframe+default_base_moof",
            "-frag_duration",
            "250000",
            "-max_interleave_delta",
            "500000",
            "-flush_packets",
            "1",
            "-f",
            "mp4",
            "pipe:1",
        ]
        .into_iter()
        .map(String::from),
    );
    args
}

pub fn run(
    config: &Config,
    source: &Source,
    engine: &Path,
    shared: &Arc<Shared>,
    commands: Receiver<Action>,
    mut pending_record: bool,
) -> Result<(), String> {
    let plan = plan::select(config, source, engine, &shared.stopping)?;
    if shared.stopping.load(Ordering::Acquire) {
        return Ok(());
    }
    {
        let mut s = shared.state.lock();
        s.encoder = plan.encoder.clone();
        s.pipeline = format!(
            "{} · {}",
            if plan.source.starts_with("ddagrab") {
                "DXGI"
            } else {
                "WGC"
            },
            plan.mode
        );
        s.width = plan.width;
        s.height = plan.height;
    }
    let mut feeds = Vec::new();
    if config.system_audio {
        feeds.push(Feed::start(true, config.output_device.clone())?);
    }
    if config.microphone {
        feeds.push(Feed::start(false, config.input_device.clone())?);
    }
    let origin = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs_f64();
    let args = capture_args(config, &plan, &feeds, origin);
    let mut child = OwnedChild::new(
        process::command(engine)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Le moteur vidéo n’a pas démarré : {e}"))?,
    )?;
    let stdout = child.0.stdout.take().ok_or("Flux vidéo indisponible.")?;
    let stderr = child.0.stderr.take().ok_or("Journal vidéo indisponible.")?;
    let log = Arc::new(parking_lot::Mutex::new(
        std::collections::VecDeque::<String>::new(),
    ));
    let log_copy = log.clone();
    let metrics = shared.clone();
    let logger = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some((key, value)) = line.split_once('=') {
                match key {
                    "fps" => {
                        if let Ok(value) = value.parse::<f64>() {
                            if value.is_finite() {
                                metrics.state.lock().encoded_fps = value;
                            }
                        }
                        continue;
                    }
                    "drop_frames" => {
                        metrics.state.lock().dropped_frames = value.parse().unwrap_or(0);
                        continue;
                    }
                    "dup_frames" => {
                        metrics.state.lock().duplicated_frames = value.parse().unwrap_or(0);
                        continue;
                    }
                    "frame" | "bitrate" | "total_size" | "out_time_us" | "out_time_ms"
                    | "out_time" | "speed" | "progress" => continue,
                    _ if key.starts_with("stream_") => continue,
                    _ => {}
                }
            }
            let mut l = log_copy.lock();
            if l.len() >= 80 {
                l.pop_front();
            }
            l.push_back(line.chars().take(500).collect());
        }
    });
    let (tx, rx) = sync_channel::<Result<Part, String>>(8);
    let reader = std::thread::spawn(move || {
        if let Err(e) = mp4::read_stream(stdout, |part| tx.send(Ok(part)).is_ok()) {
            let _ = tx.send(Err(e.to_string()));
        }
    });
    let destination = std::path::PathBuf::from(&config.destination);
    let mut ring = Ring::new(config.seconds, config.memory_mb);
    let mut header: Option<Arc<[u8]>> = None;
    let mut recording: Option<Recording> = None;
    let mut jobs = Vec::<std::thread::JoinHandle<()>>::new();
    let mut last_data = Instant::now();
    let mut stopping_at = None;
    let mut failure = None;
    let mut last_notice = Instant::now();
    loop {
        if shared.stopping.load(Ordering::Acquire) && stopping_at.is_none() {
            if let Some(mut input) = child.0.stdin.take() {
                let _ = input.write_all(b"q\n");
            }
            stopping_at = Some(Instant::now());
        }
        while let Ok(action) = commands.try_recv() {
            if stopping_at.is_some() {
                continue;
            }
            match action {
                Action::Save => {
                    if let Some(header) = &header {
                        match export::replay(
                            shared.clone(),
                            header.clone(),
                            ring.snapshot(),
                            engine.to_path_buf(),
                            destination.clone(),
                        ) {
                            Ok(job) => jobs.push(job),
                            Err(e) => shared.error(e),
                        }
                    } else {
                        shared.error("Le tampon se prépare. Attendez les premières images.");
                    }
                }
                Action::RecordStart => {
                    if recording.is_none() {
                        pending_record = true;
                    }
                }
                Action::RecordStop => {
                    pending_record = false;
                    if let Some(rec) = recording.take() {
                        jobs.push(rec.finish());
                        shared.state.lock().recording = false;
                    }
                }
            }
        }
        if pending_record && recording.is_none() && stopping_at.is_none() {
            if jobs.len() >= 2 {
                shared.error(
                    "Deux vidéos sont encore en finalisation. Attendez avant de lancer REC.",
                );
                pending_record = false;
            } else if let Some(h) = &header {
                match Recording::start(
                    shared.clone(),
                    h.clone(),
                    engine.to_path_buf(),
                    destination.clone(),
                ) {
                    Ok(rec) => {
                        recording = Some(rec);
                        shared.state.lock().recording = true;
                    }
                    Err(e) => shared.error(e),
                }
                pending_record = false;
            }
        }
        match rx.recv_timeout(Duration::from_millis(25)) {
            Ok(Ok(Part::Header(h))) => {
                header = Some(h);
                last_data = Instant::now();
            }
            Ok(Ok(Part::Fragment(part))) => {
                last_data = Instant::now();
                if let Some(rec) = recording.as_mut() {
                    if let Err(e) = rec.push(part.clone()) {
                        shared.error(e);
                        if let Some(rec) = recording.take() {
                            jobs.push(rec.finish());
                        }
                        shared.state.lock().recording = false;
                    } else {
                        shared.state.lock().recording_seconds =
                            rec.first.map_or(0.0, |first| (rec.end - first).max(0.0));
                    }
                }
                ring.push(part);
                let mut s = shared.state.lock();
                if stopping_at.is_none() {
                    s.phase = "buffering".into();
                }
                s.buffered_seconds = ring.duration();
                s.buffer_bytes = ring.bytes();
            }
            Ok(Err(e)) => {
                failure = Some(e);
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if stopping_at.is_none() {
            if let Some(e) = feeds.iter().find_map(Feed::error) {
                failure = Some(e);
                break;
            }
        }
        if stopping_at.is_some_and(|t: Instant| t.elapsed() > Duration::from_secs(8)) {
            let _ = child.0.kill();
            failure=Some("Le moteur a dépassé son délai d’arrêt. Les fragments terminés restent récupérables.".into());
            break;
        }
        if stopping_at.is_none() && last_data.elapsed() > Duration::from_secs(15) {
            failure=Some("La source ne fournit plus d’images. Vérifiez qu’elle est visible et disponible, puis relancez la capture.".into());
            break;
        }
        jobs.retain_mut(|job| !job.is_finished());
        if last_notice.elapsed() >= Duration::from_secs(1) {
            shared.notify();
            last_notice = Instant::now();
        }
    }
    let stopping = stopping_at.is_some();
    if !stopping || failure.is_some() {
        let _ = child.0.kill();
    }
    drop(rx); // Release a reader blocked on the bounded queue before joining.
    let status = child.0.wait().map_err(|e| e.to_string());
    let _ = reader.join();
    let _ = logger.join();
    drop(feeds);
    if let Some(rec) = recording.take() {
        jobs.push(rec.finish());
    }
    shared.state.lock().recording = false;
    for job in jobs {
        let _ = job.join();
    }
    if let Some(error) = failure {
        return Err(format!(
            "{error} {}",
            log.lock()
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(1800)
                .collect::<String>()
        ));
    }
    if !stopping || !status.is_ok_and(|s| s.success()) {
        return Err(format!(
            "Capture interrompue. {}",
            log.lock()
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(1800)
                .collect::<String>()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Explicit opt-in: this test captures the desktop and (optionally) system sound.
    #[test]
    #[ignore = "captures the real Windows desktop; run explicitly"]
    fn native_replay_and_recording() {
        let root = tempfile::tempdir().unwrap();
        let out = root.path().join("Videos");
        let store = super::super::Store::new(
            root.path().to_owned(),
            out.clone(),
            std::path::PathBuf::new(),
        );
        let mut config = store.snapshot().config;
        config.seconds = std::env::var("NOLYS_REPLAY_TEST_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let replay_seconds = config.seconds as f64;
        config.fps = std::env::var("NOLYS_REPLAY_TEST_FPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        config.system_audio = std::env::var_os("NOLYS_REPLAY_TEST_AUDIO").is_some();
        config.microphone = std::env::var_os("NOLYS_REPLAY_TEST_MIC").is_some();
        config.separate_audio = std::env::var_os("NOLYS_REPLAY_TEST_MIX").is_none();
        if let Ok(codec) = std::env::var("NOLYS_REPLAY_TEST_CODEC") {
            config.codec = codec;
        }
        if let Ok(title) = std::env::var("NOLYS_REPLAY_TEST_WINDOW") {
            config.source_id = super::super::sources::list()
                .into_iter()
                .find(|s| s.kind == "window" && s.label == title)
                .expect("native test window missing")
                .id;
            config.capture = "wgc".into();
        }
        store.configure(config).unwrap();
        store.start(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while store.snapshot().phase != "buffering" && Instant::now() < deadline {
            assert_ne!(
                store.snapshot().phase,
                "error",
                "{:?}",
                store.snapshot().error
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(
            store.snapshot().phase,
            "buffering",
            "{:?}",
            store.snapshot().error
        );
        // Run past the replay limit; REC must keep growing while the ring rolls over.
        let deadline = Instant::now() + Duration::from_secs(replay_seconds as u64 + 4);
        while Instant::now() < deadline {
            let s = store.snapshot();
            assert_eq!(s.phase, "buffering", "{:?}", s.error);
            assert!(
                s.buffered_seconds <= replay_seconds,
                "{} > {replay_seconds}",
                s.buffered_seconds
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(store.snapshot().buffered_seconds >= replay_seconds - 2.5);
        assert!(store.snapshot().recording_seconds > replay_seconds);
        store.submit(Action::Save).unwrap();
        store.submit(Action::RecordStop).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        store.stop();
        let state = store.snapshot();
        assert!(state.error.is_none(), "{:?}", state.error);
        assert_eq!(state.clips.len(), 2);
        let engine = process::resolve("", &std::path::PathBuf::new()).unwrap();
        for clip in state.clips {
            let output = process::output(
                &engine,
                &[
                    "-v",
                    "error",
                    "-i",
                    clip.path.to_str().unwrap(),
                    "-map",
                    "0",
                    "-f",
                    "null",
                    "-",
                ],
                30,
            )
            .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                output.stderr.is_empty(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(clip.seconds >= 3.0);
            if clip.kind == "replay" {
                assert!(clip.seconds <= replay_seconds);
            } else {
                assert!(clip.seconds > replay_seconds);
            }
            let frame = process::output(
                &engine,
                &[
                    "-v",
                    "error",
                    "-i",
                    clip.path.to_str().unwrap(),
                    "-map",
                    "0:v:0",
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=32:32",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "pipe:1",
                ],
                10,
            )
            .unwrap();
            assert!(frame.status.success());
            assert_eq!(frame.stdout.len(), 3072);
            assert!(
                frame.stdout.iter().any(|p| *p > 32),
                "capture was entirely black"
            );
            let info = process::output(
                &engine,
                &["-hide_banner", "-i", clip.path.to_str().unwrap()],
                10,
            )
            .unwrap();
            if clip.kind == "replay" {
                let info_text = String::from_utf8_lossy(&info.stderr);
                let time = info_text
                    .split("Duration: ")
                    .nth(1)
                    .unwrap()
                    .split(',')
                    .next()
                    .unwrap();
                let fields: Vec<f64> = time.split(':').map(|s| s.parse().unwrap()).collect();
                let actual = fields[0] * 3600.0 + fields[1] * 60.0 + fields[2];
                // AAC packet padding may extend the container by a few milliseconds.
                assert!(
                    actual <= replay_seconds + 0.05,
                    "export duration {actual} > {replay_seconds}"
                );
                eprintln!("Replay limit={replay_seconds}s, MP4={actual}s; REC exceeded replay limit and decoded successfully.");
            }
            let mut expected_audio =
                usize::from(std::env::var_os("NOLYS_REPLAY_TEST_AUDIO").is_some())
                    + usize::from(std::env::var_os("NOLYS_REPLAY_TEST_MIC").is_some());
            if std::env::var_os("NOLYS_REPLAY_TEST_MIX").is_some() {
                expected_audio = expected_audio.min(1);
            }
            assert_eq!(
                String::from_utf8_lossy(&info.stderr)
                    .matches("Audio: aac")
                    .count(),
                expected_audio
            );
        }
    }
}
