//! Replay service: bounded encoded RAM buffer, native WASAPI and GPU helper.
mod audio;
mod audio_container;
pub mod commands;
mod config;
mod engine;
mod export;
mod mp4;
mod plan;
mod process;
mod recycle;
mod rename;
mod ring;
mod sources;

pub use config::Config;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc,
    },
    thread::JoinHandle,
};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub kind: String,
    pub created_at: u64,
    pub seconds: f64,
    pub bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: String,
    pub config: Config,
    pub buffered_seconds: f64,
    pub buffer_bytes: usize,
    pub recording: bool,
    pub recording_seconds: f64,
    pub exporting: bool,
    pub encoder: String,
    pub pipeline: String,
    pub width: u32,
    pub height: u32,
    pub encoded_fps: f64,
    pub dropped_frames: u64,
    pub duplicated_frames: u64,
    pub error: Option<String>,
    pub notice: Option<String>,
    pub clips: Vec<Clip>,
    pub engine_available: bool,
    pub engine_path: String,
    pub recovery_files: usize,
}

pub(crate) struct Shared {
    pub state: Mutex<Snapshot>,
    pub stopping: AtomicBool,
    pub replay_export: AtomicBool,
    pub root: PathBuf,
    history_valid: bool,
    app: Mutex<Option<tauri::AppHandle>>,
}
impl Shared {
    pub fn error(&self, message: impl Into<String>) {
        self.state.lock().error = Some(message.into());
    }
    pub fn notify(&self) {
        if let Some(app) = self.app.lock().as_ref() {
            let s = self.state.lock();
            let _=app.emit_to(crate::island::LABEL,"replay-status",serde_json::json!({"phase":s.phase,"recording":s.recording,"recordingSeconds":s.recording_seconds,"bufferedSeconds":s.buffered_seconds,"exporting":s.exporting,"error":s.error,"notice":s.notice}));
        }
    }
    pub fn add_clip(&self, clip: Clip) {
        let mut state = self.state.lock();
        state.notice = Some(format!("{} enregistré", clip.name));
        state.clips.insert(0, clip);
        state.clips.truncate(200);
        if self.history_valid {
            if let Err(e) = write_json(&self.root.join("replay-clips.json"), &state.clips) {
                state.error = Some(format!(
                    "Vidéo sauvegardée, mais historique non enregistré : {e}"
                ));
            }
        }
    }
}

pub(crate) enum Action {
    Save,
    RecordStart,
    RecordStop,
}
struct Worker {
    sender: SyncSender<Action>,
    thread: JoinHandle<()>,
}
pub struct Store {
    shared: Arc<Shared>,
    worker: Mutex<Option<Worker>>,
    resources: PathBuf,
    closing: AtomicBool,
    clip_mutation: Mutex<()>,
}

impl Store {
    pub fn new(root: PathBuf, destination: PathBuf, resources: PathBuf) -> Self {
        let config_path = root.join("replay-config.json");
        let (mut config,config_error)=match std::fs::read(&config_path){
            Ok(b)=>match serde_json::from_slice::<Config>(&b){Ok(c) if c.validate().is_ok()=>(c,None),_ =>(Config::default(),Some("Les réglages Replay sont illisibles ; ils ont été conservés. Enregistrez de nouveaux réglages pour les remplacer.".into()))},
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(Config::default(),None),
            Err(e)=>(Config::default(),Some(format!("Les réglages Replay ne peuvent pas être lus : {e}"))),
        };
        if config.destination.is_empty() {
            config.destination = destination.to_string_lossy().into();
        }
        let engine = process::resolve(&config.engine_path, &resources).ok();
        let (clips, history_valid) = match std::fs::read(root.join("replay-clips.json")) {
            Ok(b) => match serde_json::from_slice::<Vec<Clip>>(&b) {
                Ok(mut clips) => {
                    clips.truncate(200);
                    (clips, true)
                }
                Err(_) => (vec![], false),
            },
            Err(e) => (vec![], e.kind() == std::io::ErrorKind::NotFound),
        };
        let recovery_files = std::fs::read_dir(root.join("replay-recovery"))
            .map(|r| {
                r.filter_map(Result::ok)
                    .filter(|e| e.path().extension().is_some_and(|e| e == "mp4"))
                    .count()
            })
            .unwrap_or(0);
        let state=Snapshot{phase:"idle".into(),config,buffered_seconds:0.0,buffer_bytes:0,recording:false,recording_seconds:0.0,exporting:false,encoder:String::new(),pipeline:String::new(),width:0,height:0,encoded_fps:0.0,dropped_frames:0,duplicated_frames:0,error:config_error.or_else(||if history_valid{None}else{Some("L’historique Replay est illisible. Le fichier est conservé ; les vidéos restent dans leur dossier.".into())}),notice:None,clips,engine_available:engine.is_some(),engine_path:engine.map(|p|p.to_string_lossy().into()).unwrap_or_default(),recovery_files};
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(state),
                stopping: AtomicBool::new(false),
                replay_export: AtomicBool::new(false),
                root,
                history_valid,
                app: Mutex::new(None),
            }),
            worker: Mutex::new(None),
            resources,
            closing: AtomicBool::new(false),
            clip_mutation: Mutex::new(()),
        }
    }
    pub fn attach(&self, app: tauri::AppHandle) {
        *self.shared.app.lock() = Some(app);
    }
    fn reap(worker: &mut Option<Worker>) {
        if worker.as_ref().is_some_and(|w| w.thread.is_finished()) {
            if let Some(w) = worker.take() {
                let _ = w.thread.join();
            }
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.shared.state.lock().clone()
    }
    pub fn configure(&self, config: Config) -> Result<Snapshot, String> {
        config.validate()?;
        let mut worker = self.worker.lock();
        Self::reap(&mut worker);
        if worker.is_some() || self.closing.load(Ordering::Acquire) {
            return Err("Arrêtez la capture avant de modifier ses réglages.".into());
        }
        if !Path::new(&config.destination).is_absolute() {
            return Err("Choisissez un dossier de sauvegarde absolu.".into());
        }
        write_json(&self.shared.root.join("replay-config.json"), &config)?;
        let engine = process::resolve(&config.engine_path, &self.resources).ok();
        let mut state = self.shared.state.lock();
        state.config = config;
        state.engine_available = engine.is_some();
        state.engine_path = engine
            .map(|p| p.to_string_lossy().into())
            .unwrap_or_default();
        state.error = None;
        Ok(state.clone())
    }
    pub fn start(&self, record: bool) -> Result<(), String> {
        let mut worker = self.worker.lock();
        Self::reap(&mut worker);
        if self.closing.load(Ordering::Acquire) {
            return Err("Nolys est en cours de fermeture.".into());
        }
        if let Some(w) = worker.as_ref() {
            return if record {
                w.sender
                    .try_send(Action::RecordStart)
                    .map_err(|_| "Une commande est déjà en attente.".into())
            } else {
                Err("Le replay est déjà actif.".into())
            };
        }
        let config = self.shared.state.lock().config.clone();
        config.validate()?;
        let sources = sources::list();
        let source = if config.source_id.is_empty() {
            sources.into_iter().find(|s| s.kind == "monitor")
        } else {
            sources.into_iter().find(|s| s.id == config.source_id)
        }
        .ok_or("La source n’est plus disponible. Choisissez un écran ou une fenêtre visible.")?;
        let engine = process::resolve(&config.engine_path, &self.resources)?;
        self.shared.stopping.store(false, Ordering::Release);
        {
            let mut s = self.shared.state.lock();
            s.phase = "starting".into();
            s.error = None;
            s.notice = None;
            s.buffered_seconds = 0.0;
            s.buffer_bytes = 0;
            s.recording = false;
            s.recording_seconds = 0.0;
        }
        let (shared, (sender, receiver)) = (self.shared.clone(), sync_channel(8));
        let thread = std::thread::spawn(move || {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine::run(&config, &source, &engine, &shared, receiver, record)
            }));
            let mut s = shared.state.lock();
            s.recording = false;
            s.buffer_bytes = 0;
            s.buffered_seconds = 0.0;
            match outcome {
                Ok(Ok(())) => s.phase = "idle".into(),
                Ok(Err(e)) => {
                    s.phase = "error".into();
                    s.error = Some(e)
                }
                Err(_) => {
                    s.phase = "error".into();
                    s.error = Some(
                        "Le moteur Replay s’est interrompu. Vous pouvez relancer la capture."
                            .into(),
                    );
                }
            }
            drop(s);
            shared.notify();
        });
        *worker = Some(Worker { sender, thread });
        Ok(())
    }
    pub fn submit(&self, action: Action) -> Result<(), String> {
        let mut worker = self.worker.lock();
        Self::reap(&mut worker);
        if self.shared.stopping.load(Ordering::Acquire) {
            return Err("La capture est en cours d’arrêt.".into());
        }
        worker
            .as_ref()
            .ok_or("Activez le replay avant de sauvegarder un clip.")?
            .sender
            .try_send(action)
            .map_err(|_| "Une commande est déjà en attente.".into())
    }
    pub fn request_stop(&self) {
        self.shared.stopping.store(true, Ordering::Release);
        let mut state = self.shared.state.lock();
        if state.phase == "starting" || state.phase == "buffering" {
            state.phase = "stopping".into();
        }
    }
    pub fn stop(&self) {
        self.request_stop();
        // Keep the lifecycle lock until the old pipeline is gone; no overlapping start.
        let mut worker = self.worker.lock();
        if let Some(w) = worker.take() {
            let _ = w.thread.join();
        }
    }
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::Release);
        self.stop();
    }
    pub fn report(&self, message: String) {
        self.shared.error(message);
        self.shared.notify();
    }
    pub fn folder(&self) -> PathBuf {
        PathBuf::from(&self.shared.state.lock().config.destination)
    }
    pub fn clip_path(&self, id: &str) -> Result<PathBuf, String> {
        self.shared
            .state
            .lock()
            .clips
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.path.clone())
            .filter(|p| p.is_file())
            .ok_or("Cette vidéo n’est plus dans son dossier d’origine.".into())
    }
    pub fn recovery(&self) -> PathBuf {
        self.shared.root.join("replay-recovery")
    }
    pub fn delete_clip(&self, id: &str, recycle: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
        let _operation = self.clip_mutation.lock();
        let clip = self.shared.state.lock().clips.iter().find(|c| c.id == id).cloned()
            .ok_or("Ce clip n’est plus dans la liste.")?;
        if clip.path.try_exists().map_err(|e| e.to_string())? {
            recycle(&clip.path)?;
        }
        let mut state = self.shared.state.lock();
        state.clips.retain(|c| c.id != id);
        state.notice = None;
        if self.shared.history_valid {
            if let Err(e) = write_json(&self.shared.root.join("replay-clips.json"), &state.clips) {
                state.error = Some(format!("Clip retiré, mais historique non enregistré : {e}"));
            }
        }
        Ok(())
    }
    pub fn rename_clip(&self, id: &str, name: &str) -> Result<(), String> {
        let _operation = self.clip_mutation.lock();
        if !self.shared.history_valid { return Err("L’historique des clips doit être récupéré avant de les renommer.".into()); }
        let mut state = self.shared.state.lock();
        let index = state.clips.iter().position(|clip| clip.id == id).ok_or("Ce clip n’est plus dans la liste.")?;
        let source = state.clips[index].path.clone();
        if !source.is_file() { return Err("Cette vidéo n’est plus dans son dossier d’origine.".into()); }
        let destination = rename::destination(&source, name)?;
        if source == destination { return Ok(()); }
        rename::move_file(&source, &destination)?;
        let mut clips = state.clips.clone();
        clips[index].name = destination.file_name().unwrap().to_string_lossy().into_owned();
        clips[index].path = destination.clone();
        if let Err(error) = write_json(&self.shared.root.join("replay-clips.json"), &clips) {
            if rename::move_file(&destination, &source).is_err() {
                state.clips = clips;
                state.error = Some("Le fichier a été renommé, mais son historique n’a pas pu être enregistré.".into());
            }
            return Err(format!("Le renommage n’a pas pu être enregistré : {error}"));
        }
        state.clips = clips; state.notice = None;
        Ok(())
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Dossier invalide.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
impl Drop for Store {
    fn drop(&mut self) {
        self.shared.stopping.store(true, Ordering::Release);
        if let Some(worker) = self.worker.get_mut().take() {
            let _ = worker.thread.join();
        }
    }
}

#[cfg(test)]
mod clip_tests {
    use super::*;
    fn fixture(root: &Path) -> Store {
        let store = Store::new(root.to_owned(), root.join("Videos"), PathBuf::new());
        for id in ["one", "two"] {
            let path = root.join(format!("Nolys-Replay-{id}.mp4"));
            std::fs::write(&path, b"owned test clip").unwrap();
            store.shared.add_clip(Clip { id: id.into(), name: path.file_name().unwrap().to_string_lossy().into(), path,
                kind: "replay".into(), created_at: 0, seconds: 5.0, bytes: 15 });
        }
        store
    }
    #[test]
    fn renaming_preserves_bytes_id_and_history_after_restart() {
        let root = tempfile::tempdir().unwrap(); let store = fixture(root.path());
        let before = store.snapshot().clips.iter().find(|c| c.id == "one").unwrap().clone();
        store.rename_clip("one", "Mon meilleur moment été.mp4").unwrap();
        let path = store.clip_path("one").unwrap();
        assert_eq!(path.file_name().unwrap(), "Mon meilleur moment été.mp4");
        assert_eq!(std::fs::read(&path).unwrap(), b"owned test clip");
        assert!(!before.path.exists()); assert!(store.clip_path("two").is_ok());
        let restored = Store::new(root.path().to_owned(), root.path().join("Videos"), PathBuf::new());
        let clip = restored.snapshot().clips.into_iter().find(|c| c.id == "one").unwrap();
        assert_eq!(clip.path, path); assert_eq!(clip.seconds, before.seconds); assert_eq!(clip.created_at, before.created_at);
    }
    #[test]
    fn renaming_rejects_invalid_names_and_never_replaces_a_file() {
        let root = tempfile::tempdir().unwrap(); let store = fixture(root.path());
        let original = store.clip_path("one").unwrap();
        for name in ["", " ", "..", "../escape", "a/b", "a\\b", "a:b", "CON", "nul.mp4", "LPT1.foo", "COM¹", "name.", "a\0b"] {
            assert!(store.rename_clip("one", name).is_err(), "accepted invalid name: {name}");
        }
        assert!(store.rename_clip("one", &"x".repeat(121)).is_err());
        assert!(store.rename_clip("missing", "New name").is_err());
        let collision = root.path().join("Existing.mp4"); std::fs::write(&collision, b"keep existing").unwrap();
        assert!(store.rename_clip("one", "Existing").is_err());
        assert_eq!(std::fs::read(&collision).unwrap(), b"keep existing");
        assert_eq!(store.clip_path("one").unwrap(), original);
        assert_eq!(std::fs::read(original).unwrap(), b"owned test clip");
    }
    #[test]
    fn renaming_rolls_back_if_history_cannot_be_saved() {
        let root = tempfile::tempdir().unwrap(); let store = fixture(root.path());
        let original = store.clip_path("one").unwrap();
        let history = root.path().join("replay-clips.json");
        std::fs::rename(&history, root.path().join("owned-history-backup.json")).unwrap();
        std::fs::create_dir(&history).unwrap();
        assert!(store.rename_clip("one", "New name").is_err());
        assert_eq!(store.clip_path("one").unwrap(), original);
        assert!(!root.path().join("New name.mp4").exists());
        assert_eq!(std::fs::read(original).unwrap(), b"owned test clip");
    }
    #[test]
    fn failed_recycling_keeps_the_clip_and_history() {
        let root = tempfile::tempdir().unwrap(); let store = fixture(root.path());
        assert!(store.delete_clip("one", |_| Err("locked".into())).is_err());
        assert!(store.clip_path("one").is_ok());
        let history: Vec<Clip> = serde_json::from_slice(&std::fs::read(root.path().join("replay-clips.json")).unwrap()).unwrap();
        assert_eq!(history.len(), 2);
        assert!(store.delete_clip("unknown", |_| panic!("must not recycle unknown IDs")).is_err());
    }
    #[test]
    fn successful_recycling_updates_history_without_touching_other_clips() {
        let root = tempfile::tempdir().unwrap(); let store = fixture(root.path());
        let recovered = root.path().join("recoverable-test-copy.mp4");
        store.delete_clip("one", |path| std::fs::rename(path, &recovered).map_err(|e| e.to_string())).unwrap();
        assert!(store.clip_path("one").is_err()); assert!(store.clip_path("two").is_ok());
        assert_eq!(std::fs::read(&recovered).unwrap(), b"owned test clip");
        let restored = Store::new(root.path().to_owned(), root.path().join("Videos"), PathBuf::new());
        assert_eq!(restored.snapshot().clips.len(), 1); assert_eq!(restored.snapshot().clips[0].id, "two");
    }
}
