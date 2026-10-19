use super::{mp4::Fragment, process, Clip, Shared};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::Ordering,
        mpsc::{sync_channel, SyncSender},
        Arc,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};

fn id() -> String {
    format!(
        "{}-{:08x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        rand::random::<u32>()
    )
}

fn remux(
    input: &Path,
    engine: &Path,
    destination: &Path,
    kind: &str,
    seconds: f64,
) -> Result<Clip, String> {
    std::fs::create_dir_all(destination)
        .map_err(|e| format!("Dossier vidéo inaccessible : {e}"))?;
    let output = tempfile::Builder::new()
        .prefix(".nolys-export-")
        .suffix(".mp4")
        .tempfile_in(destination)
        .map_err(|e| e.to_string())?;
    let args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        input.to_str().ok_or("Chemin vidéo invalide.")?,
        "-map",
        "0",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        output.path().to_str().ok_or("Chemin vidéo invalide.")?,
    ];
    let result = process::output(engine, &args, 60)?;
    if !result.status.success() {
        return Err(format!(
            "L’assemblage MP4 a échoué. Les fragments ont été conservés pour récupération. {}",
            String::from_utf8_lossy(&result.stderr)
                .chars()
                .take(1200)
                .collect::<String>()
        ));
    }
    let bytes = output
        .as_file()
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    if bytes < 512 {
        return Err("L’export vidéo est vide. Les fragments ont été conservés.".into());
    }
    output.as_file().sync_all().map_err(|e| e.to_string())?;
    let id = id();
    let name = format!(
        "Nolys-{}-{id}.mp4",
        if kind == "replay" { "Replay" } else { "REC" }
    );
    let path = destination.join(&name);
    output
        .persist_noclobber(&path)
        .map_err(|e| format!("La vidéo ne peut pas être publiée : {e}"))?;
    Ok(Clip {
        id,
        name,
        path,
        kind: kind.into(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        seconds,
        bytes,
    })
}

fn recovery_file(shared: &Shared) -> Result<(File, PathBuf), String> {
    let folder = shared.root.join("replay-recovery");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("capture-{}.partial.mp4", id()));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    Ok((file, path))
}

fn publish(
    shared: &Shared,
    path: &Path,
    engine: &Path,
    destination: &Path,
    kind: &str,
    seconds: f64,
) {
    match remux(path, engine, destination, kind, seconds) {
        Ok(clip) => {
            shared.add_clip(clip);
            let _ = std::fs::remove_file(path);
        }
        Err(e) => {
            shared.error(e);
            shared.state.lock().recovery_files += 1;
        }
    }
}

pub fn replay(
    shared: Arc<Shared>,
    header: Arc<[u8]>,
    fragments: Vec<Fragment>,
    engine: PathBuf,
    destination: PathBuf,
) -> Result<JoinHandle<()>, String> {
    if fragments.is_empty() {
        return Err("Le tampon se remplit. Attendez quelques secondes.".into());
    }
    if shared.replay_export.swap(true, Ordering::AcqRel) {
        return Err("Un replay est déjà en cours de sauvegarde.".into());
    }
    shared.state.lock().exporting = true;
    Ok(std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let (mut file, path) = recovery_file(&shared)?;
            file.write_all(&header).map_err(|e| e.to_string())?;
            let seconds = fragments.last().unwrap().end - fragments.first().unwrap().start;
            for fragment in &fragments {
                file.write_all(&fragment.bytes).map_err(|e| e.to_string())?;
            }
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            drop(fragments);
            publish(&shared, &path, &engine, &destination, "replay", seconds);
            Ok(())
        })();
        if let Err(e) = result {
            shared.error(format!("Replay non sauvegardé : {e}"));
        }
        shared.replay_export.store(false, Ordering::Release);
        shared.state.lock().exporting = false;
    }))
}

pub struct Recording {
    sender: Option<SyncSender<Fragment>>,
    worker: Option<JoinHandle<()>>,
    pub first: Option<f64>,
    pub end: f64,
}
impl Recording {
    pub fn start(
        shared: Arc<Shared>,
        header: Arc<[u8]>,
        engine: PathBuf,
        destination: PathBuf,
    ) -> Result<Self, String> {
        let (mut file, path) = recovery_file(&shared)?;
        file.write_all(&header).map_err(|e| e.to_string())?;
        let (tx, rx) = sync_channel::<Fragment>(8);
        let worker = std::thread::spawn(move || {
            let mut first = None;
            let mut end = 0.0;
            let mut failure = None;
            for fragment in rx {
                first.get_or_insert(fragment.start);
                end = fragment.end;
                if let Err(e) = file.write_all(&fragment.bytes) {
                    failure = Some(format!(
                        "Écriture interrompue : {e}. Les fragments restent récupérables."
                    ));
                    break;
                }
            }
            if let Err(e) = file.sync_all() {
                failure = Some(format!("L’écriture vidéo n’a pas pu être terminée : {e}"));
            }
            drop(file);
            if let Some(e) = failure {
                shared.error(e);
                shared.state.lock().recovery_files += 1;
            } else if let Some(start) = first {
                publish(
                    &shared,
                    &path,
                    &engine,
                    &destination,
                    "recording",
                    (end - start).max(0.0),
                );
            } else {
                let _ = std::fs::remove_file(&path);
                shared.state.lock().notice =
                    Some("Enregistrement arrêté avant la première image clé.".into());
            }
        });
        Ok(Self {
            sender: Some(tx),
            worker: Some(worker),
            first: None,
            end: 0.0,
        })
    }
    pub fn push(&mut self, fragment: Fragment) -> Result<(), String> {
        if self.first.is_none() && !fragment.keyframe {
            return Ok(());
        }
        self.first.get_or_insert(fragment.start);
        self.end = fragment.end;
        self.sender.as_ref().ok_or("Enregistrement fermé.")?.try_send(fragment).map_err(|_|"Le disque ne suit plus l’enregistrement. La capture REC est arrêtée ; le replay reste actif.".into())
    }
    pub fn finish(mut self) -> JoinHandle<()> {
        self.sender.take();
        self.worker.take().expect("record worker exists")
    }
}
impl Drop for Recording {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}
