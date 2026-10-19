//! File selections, durable jobs and non-destructive local exports.
pub mod commands;
pub mod drag;
mod images;
mod model;

use model::*;
use parking_lot::Mutex;
use std::{collections::{HashMap, HashSet, VecDeque}, fs, io::Write, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, Ordering}}};
use tauri::{AppHandle, Emitter, Manager};

pub const CHANGED: &str = "files-changed";
pub const SELECTION: &str = "files-selection";
const MAX_INPUTS: usize = 100;

pub struct Store {
    inner: Mutex<Inner>,
    root: PathBuf,
    destination: PathBuf,
    working: AtomicBool,
    closing: AtomicBool,
    pub dragging: AtomicBool,
    pub outgoing: AtomicBool,
    pub enabled: AtomicBool,
}

struct Inner {
    inputs: HashMap<String, Input>,
    jobs: Vec<Job>,
    pending: VecDeque<String>,
    cancellations: HashMap<String, Arc<AtomicBool>>,
    sequence: u64,
    error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Manifest { version: u32, jobs: Vec<Job> }

impl Store {
    pub fn new(root: PathBuf, destination: PathBuf) -> Self {
        let mut error = None;
        let mut jobs = match fs::read(root.join("files-jobs.json")) {
            Ok(bytes) => match serde_json::from_slice::<Manifest>(&bytes) {
                Ok(manifest) if manifest.version == 1 => manifest.jobs,
                _ => { error = Some("L’historique des fichiers est illisible. Il a été conservé ; aucun nouveau traitement ne l’écrasera.".into()); vec![] }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(_) => { error = Some("L’historique des fichiers ne peut pas être lu.".into()); vec![] }
        };
        for job in &mut jobs {
            if ["queued", "running", "cancelling"].contains(&job.status.as_str()) { job.status = "interrupted".into(); }
        }
        Self { inner: Mutex::new(Inner { inputs: HashMap::new(), jobs, pending: VecDeque::new(), cancellations: HashMap::new(), sequence: 0, error }), root, destination, working: AtomicBool::new(false), closing: AtomicBool::new(false), dragging: AtomicBool::new(false), outgoing: AtomicBool::new(false), enabled: AtomicBool::new(true) }
    }

    fn persist(&self, inner: &Inner) -> Result<(), String> {
        if let Some(error) = &inner.error { return Err(error.clone()); }
        let bytes = serde_json::to_vec(&Manifest { version: 1, jobs: inner.jobs.clone() }).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.root).map_err(|_| "Les données de Nolys ne peuvent pas être enregistrées.")?;
        let mut temp = tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(self.root.join("files-jobs.json")).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        let inner = self.inner.lock();
        Snapshot { sequence: inner.sequence, jobs: inner.jobs.iter().map(JobView::from).collect(), destination: self.destination.to_string_lossy().into(), error: inner.error.clone() }
    }

    pub fn emit(&self, app: &AppHandle) {
        let _ = app.emit_to(crate::island::LABEL, CHANGED, self.snapshot());
    }

    pub fn register(&self, paths: Vec<PathBuf>) -> Result<Vec<Input>, String> {
        if paths.len() > MAX_INPUTS { return Err(format!("Déposez au maximum {MAX_INPUTS} fichiers à la fois. Aucun fichier n’a été ajouté.")); }
        let mut seen = HashSet::new();
        let mut inputs = Vec::new();
        for path in paths {
            let path = fs::canonicalize(path).map_err(|_| "Un fichier a été déplacé ou ne peut pas être lu. Déposez-le à nouveau.")?;
            if !seen.insert(path.to_string_lossy().to_lowercase()) { continue; }
            let meta = fs::metadata(&path).map_err(|_| "Impossible de lire les informations du fichier.")?;
            if !meta.is_file() && !meta.is_dir() { return Err("Cet objet n’est pas un fichier ou un dossier ordinaire.".into()); }
            let extension = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            let kind = if meta.is_dir() { "folder" } else if ["jpg", "jpeg", "png", "webp", "bmp", "gif", "heic", "avif", "tif", "tiff", "svg"].contains(&extension.as_str()) { "image" } else if extension == "pdf" { "pdf" } else if ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"].contains(&extension.as_str()) { "audio" } else if ["mp4", "mov", "mkv", "webm", "avi"].contains(&extension.as_str()) { "video" } else { "file" };
            inputs.push(Input { id: id(), name: path.file_name().unwrap_or_default().to_string_lossy().into(), size: meta.len(), directory: meta.is_dir(), kind: kind.into(), extension, modified: modified(&meta), path });
        }
        let mut inner = self.inner.lock();
        if self.closing.load(Ordering::Acquire) { return Err("Nolys est en cours de fermeture.".into()); }
        // Replacing the selection releases its old handles, but queued jobs still
        // own their sources. Otherwise normal use eventually exhausted this registry.
        let protected: HashSet<_> = inner.jobs.iter()
            .filter(|job| inner.cancellations.contains_key(&job.id))
            .flat_map(|job| job.items.iter().map(|item| item.input_id.clone())).collect();
        if protected.len() + inputs.len() > 2000 { return Err("Trop de fichiers attendent un traitement. Attendez la fin d’une opération avant d’en ajouter.".into()); }
        inner.inputs.retain(|id, _| protected.contains(id));
        for input in &inputs { inner.inputs.insert(input.id.clone(), input.clone()); }
        Ok(inputs)
    }

    pub fn paths(&self, ids: &[String]) -> Result<Vec<PathBuf>, String> {
        let inner = self.inner.lock();
        ids.iter().map(|id| {
            inner.inputs.get(id).map(|i| i.path.clone()).or_else(|| inner.jobs.iter().flat_map(|j| &j.outputs).find(|o| &o.id == id).map(|o| o.path.clone()))
                .filter(|p| p.exists()).ok_or_else(|| "Ce fichier a été déplacé ou n’est plus disponible.".into())
        }).collect()
    }

    pub fn start(&self, request_id: String, ids: Vec<String>, action: String, options: Options) -> Result<String, String> {
        options.validate(&action)?;
        if ids.is_empty() || ids.len() > MAX_INPUTS || request_id.is_empty() || request_id.len() > 100 { return Err("La sélection ou la demande n’est pas valide.".into()); }
        let mut inner = self.inner.lock();
        if self.closing.load(Ordering::Acquire) { return Err("Nolys est en cours de fermeture.".into()); }
        if let Some(job) = inner.jobs.iter().find(|j| j.request_id == request_id) { return Ok(job.id.clone()); }
        if inner.pending.len() >= 20 { return Err("La file contient déjà 20 opérations. Attendez la fin d’un traitement.".into()); }
        if let Some(error) = &inner.error { return Err(error.clone()); }
        let mut unique = HashSet::new();
        let mut items = Vec::new();
        for input_id in ids {
            if !unique.insert(input_id.clone()) { continue; }
            let input = inner.inputs.get(&input_id).ok_or("La sélection a expiré. Ajoutez à nouveau les fichiers.")?;
            if input.directory { return Err("Choisissez des fichiers. Les opérations sur dossiers seront proposées séparément.".into()); }
            if action != "copy" && !["jpg", "jpeg", "png", "webp", "bmp"].contains(&input.extension.as_str()) {
                return Err(format!("{} n’est pas compatible avec cette opération. Sélectionnez uniquement les fichiers concernés.", input.name));
            }
            items.push(ItemResult { input_id, name: input.name.clone(), size_before: input.size, status: "queued".into(), error: None, output_id: None, size_after: None });
        }
        let job_id = id();
        inner.jobs.push(Job { id: job_id.clone(), request_id, action, options, status: "queued".into(), created_at: now(), completed: 0, total: items.len(), items, outputs: vec![] });
        if let Err(error) = self.persist(&inner) { inner.jobs.pop(); return Err(error); }
        inner.cancellations.insert(job_id.clone(), Arc::new(AtomicBool::new(false)));
        inner.pending.push_back(job_id.clone());
        inner.sequence += 1;
        Ok(job_id)
    }

    pub fn cancel(&self, job_id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock();
        let token = inner.cancellations.get(job_id).cloned().ok_or("Ce traitement est déjà terminé.")?;
        token.store(true, Ordering::Release);
        if let Some(job) = inner.jobs.iter_mut().find(|j| j.id == job_id) { job.status = "cancelling".into(); }
        inner.sequence += 1;
        self.persist(&inner)
    }

    pub fn forget(&self, job_id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock();
        if inner.cancellations.contains_key(job_id) { return Err("Attendez la fin du traitement avant de retirer son historique.".into()); }
        let before = inner.jobs.clone();
        inner.jobs.retain(|j| j.id != job_id);
        if let Err(error) = self.persist(&inner) { inner.jobs = before; return Err(error); }
        inner.sequence += 1;
        Ok(())
    }

    pub fn cancel_all(&self) {
        let inner = self.inner.lock();
        self.closing.store(true, Ordering::Release);
        self.enabled.store(false, Ordering::Release);
        for token in inner.cancellations.values() { token.store(true, Ordering::Release); }
    }
}

pub async fn wait_for_shutdown(app: &AppHandle) {
    let store = app.state::<Store>();
    let drain = async {
        loop {
            let (done, needs_worker) = {
                let inner = store.inner.lock();
                let working = store.working.load(Ordering::Acquire);
                (inner.pending.is_empty() && !working, !inner.pending.is_empty() && !working)
            };
            if done { break; }
            // An enqueue can precede its kick when Quit arrives; drain it too.
            if needs_worker { kick(app.clone()); }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    };
    if tokio::time::timeout(std::time::Duration::from_secs(3), drain).await.is_err() {
        crate::logger::log("[Files] Shutdown deadline reached; unfinished jobs will be marked interrupted on restart");
    }
}

fn modified(meta: &fs::Metadata) -> u64 { meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos().min(u64::MAX as u128) as u64).unwrap_or(0) }

pub fn kick(app: AppHandle) {
    if app.state::<Store>().working.swap(true, Ordering::AcqRel) { return; }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        drain_queue(&store, |job_id| run(&app, job_id), || store.emit(&app));
    });
}

fn drain_queue(store: &Store, mut process: impl FnMut(&str), mut notify: impl FnMut()) {
    loop {
        let next = {
            let mut inner = store.inner.lock();
            let next = inner.pending.pop_front();
            // Same lock as enqueue: no job can be stranded between empty and release.
            if next.is_none() { store.working.store(false, Ordering::Release); }
            next
        };
        let Some(job_id) = next else { break };
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| process(&job_id))).is_err() {
            let mut inner = store.inner.lock();
            if let Some(job) = inner.jobs.iter_mut().find(|job| job.id == job_id) {
                for item in &mut job.items {
                    if ["queued", "running"].contains(&item.status.as_str()) {
                        item.status = "failed".into();
                        item.error = Some("Le moteur a rencontré une erreur. Ajoutez à nouveau les fichiers concernés pour réessayer.".into());
                    }
                }
                job.completed = job.total;
                job.status = if job.outputs.len() == job.total { "done" } else if job.outputs.is_empty() { "failed" } else { "partial" }.into();
            }
            inner.cancellations.remove(&job_id);
            inner.sequence += 1;
            if let Err(error) = store.persist(&inner) { inner.error = Some(error); }
            drop(inner);
            crate::logger::log("[Files] A worker operation failed unexpectedly; the queue remains available");
            notify();
        }
    }
}

fn run(app: &AppHandle, job_id: &str) {
    let store = app.state::<Store>();
    let (job, inputs, cancel) = {
        let mut inner = store.inner.lock();
        let Some(index) = inner.jobs.iter().position(|j| j.id == job_id) else { return };
        inner.jobs[index].status = "running".into();
        let job = inner.jobs[index].clone();
        let inputs: Vec<_> = job.items.iter().map(|i| inner.inputs.get(&i.input_id).cloned()).collect();
        let Some(cancel) = inner.cancellations.get(job_id).cloned() else { return };
        inner.sequence += 1;
        (job, inputs, cancel)
    };
    store.emit(app);
    let folder = store.destination.join(format!("{}-{}", job.created_at, &job.id[..8]));
    for (index, input) in inputs.into_iter().enumerate() {
        let result = if cancel.load(Ordering::Acquire) { Err("Opération annulée.".into()) }
            else { input.as_ref().ok_or_else(|| "La sélection n’est plus disponible.".to_string()).and_then(|input| prepare(input, &job, &folder, &cancel)) };
        let mut inner = store.inner.lock();
        let Some(current) = inner.jobs.iter_mut().find(|j| j.id == job_id) else { return };
        let item = &mut current.items[index];
        // Cancel and publication are ordered under this lock; published files always survive.
        match result.and_then(|(temp, name)| {
            if cancel.load(Ordering::Acquire) { return Err("Opération annulée.".into()); }
            publish(temp, &folder, &name)
        }) {
            Ok(output) => {
                item.status = "done".into(); item.output_id = Some(output.id.clone()); item.size_after = Some(output.size);
                current.outputs.push(output);
            }
            Err(error) => {
                item.status = if cancel.load(Ordering::Acquire) { "cancelled" } else { "failed" }.into();
                item.error = Some(error);
            }
        }
        current.completed += 1;
        inner.sequence += 1;
        if let Err(error) = store.persist(&inner) { inner.error = Some(format!("Les résultats restent dans le dossier d’export, mais leur historique n’a pas été enregistré : {error}")); }
        drop(inner);
        store.emit(app);
    }
    let mut inner = store.inner.lock();
    if let Some(current) = inner.jobs.iter_mut().find(|j| j.id == job_id) {
        let all = current.outputs.len() == current.total;
        current.status = if all { "done" } else if !current.outputs.is_empty() { "partial" } else if cancel.load(Ordering::Acquire) { "cancelled" } else { "failed" }.into();
    }
    inner.cancellations.remove(job_id);
    inner.sequence += 1;
    if let Err(error) = store.persist(&inner) { inner.error = Some(error); }
    drop(inner);
    store.emit(app);
}

fn prepare(input: &Input, job: &Job, folder: &Path, cancel: &AtomicBool) -> Result<(tempfile::NamedTempFile, String), String> {
    let meta = fs::metadata(&input.path).map_err(|_| "Le fichier a été déplacé ou n’est plus accessible.")?;
    if !meta.is_file() || meta.len() != input.size || modified(&meta) != input.modified { return Err("Le fichier a changé depuis son dépôt. Ajoutez-le à nouveau.".into()); }
    fs::create_dir_all(folder).map_err(|_| "Le dossier d’export ne peut pas être créé. Vérifiez son accès et l’espace disponible.")?;
    let mut temp = tempfile::Builder::new().prefix(".nolys-").tempfile_in(folder).map_err(|_| "Impossible de préparer le fichier de sortie.")?;
    if job.action == "copy" { images::copy(&input.path, temp.as_file_mut(), cancel)?; }
    else { images::encode(&input.path, temp.as_file_mut(), &job.options, cancel)?; }
    let after = fs::metadata(&input.path).map_err(|_| "La source a disparu pendant le traitement. Le résultat n’a pas été publié.")?;
    if after.len() != input.size || modified(&after) != input.modified { return Err("La source a changé pendant le traitement. Ajoutez-la à nouveau.".into()); }
    temp.as_file().sync_all().map_err(|_| "Le résultat n’a pas pu être enregistré complètement.")?;
    let stem = input.path.file_stem().unwrap_or_default().to_string_lossy();
    let suffix = match job.action.as_str() { "compress" => "-compressee".to_string(), "resize" => format!("-{}", job.options.max_edge), _ => String::new() };
    let name = if job.action == "copy" { input.name.clone() } else { format!("{stem}{suffix}.{}", job.options.format) };
    Ok((temp, name))
}

fn publish(mut temp: tempfile::NamedTempFile, folder: &Path, name: &str) -> Result<Output, String> {
    let path = Path::new(name);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let extension = path.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    for index in 1..=10000 {
        let name = if index == 1 { name.to_string() } else { format!("{stem} ({index}){extension}") };
        let destination = folder.join(&name);
        match temp.persist_noclobber(&destination) {
            Ok(file) => return Ok(Output { id: id(), name, size: file.metadata().map_err(|e| e.to_string())?.len(), path: destination }),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => temp = error.file,
            Err(_) => return Err("Le résultat n’a pas pu être publié dans le dossier choisi.".into()),
        }
    }
    Err("Trop de fichiers portent déjà ce nom dans le dossier.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publication_preserves_existing_file() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("photo.png"), b"original").unwrap();
        let mut temp = tempfile::NamedTempFile::new_in(folder.path()).unwrap();
        temp.write_all(b"result").unwrap();
        let output = publish(temp, folder.path(), "photo.png").unwrap();
        assert_eq!(output.name, "photo (2).png");
        assert_eq!(fs::read(folder.path().join("photo.png")).unwrap(), b"original");
        assert_eq!(fs::read(output.path).unwrap(), b"result");
    }
    #[test]
    fn idempotent_request_and_cancel_do_not_create_two_jobs() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("input.txt"), b"unchanged").unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![folder.path().join("input.txt")]).unwrap();
        let first = store.start("one".into(), vec![input[0].id.clone()], "copy".into(), Options::default()).unwrap();
        let second = store.start("one".into(), vec![input[0].id.clone()], "copy".into(), Options::default()).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.snapshot().jobs.len(), 1);
        store.cancel(&first).unwrap();
        assert_eq!(fs::read(folder.path().join("input.txt")).unwrap(), b"unchanged");
    }
    #[test]
    fn corrupt_manifest_is_not_overwritten() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("files-jobs.json"), b"corrupted").unwrap();
        let store = Store::new(folder.path().into(), folder.path().join("exports"));
        assert!(store.snapshot().error.is_some());
        assert!(store.persist(&store.inner.lock()).is_err());
        assert_eq!(fs::read(folder.path().join("files-jobs.json")).unwrap(), b"corrupted");
    }
    #[test]
    fn image_export_preserves_source_and_reduces_dimensions() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("été image.png");
        image::RgbaImage::from_pixel(80, 40, image::Rgba([20, 120, 200, 80])).save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![source.clone()]).unwrap().remove(0);
        let options = Options { format: "webp".into(), max_edge: 40, ..Default::default() };
        let job_id = store.start("resize".into(), vec![input.id.clone()], "resize".into(), options).unwrap();
        let job = store.inner.lock().jobs.iter().find(|j| j.id == job_id).unwrap().clone();
        let output_dir = folder.path().join("result");
        let (temp, name) = prepare(&input, &job, &output_dir, &AtomicBool::new(false)).unwrap();
        let output = publish(temp, &output_dir, &name).unwrap();
        let decoded = image::open(output.path).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (40, 20));
        assert!(decoded.color().has_alpha());
        assert_eq!(fs::read(source).unwrap(), original);
    }
    #[test]
    fn transparent_image_requires_an_explicit_jpeg_background() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("alpha.png");
        image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 0, 0, 0])).save(&source).unwrap();
        let mut target = tempfile::NamedTempFile::new_in(folder.path()).unwrap();
        let mut options = Options { format: "jpg".into(), quality: 90, ..Default::default() };
        assert!(images::encode(&source, target.as_file_mut(), &options, &AtomicBool::new(false)).unwrap_err().contains("transparence"));
        options.background = Some("#ffffff".into());
        images::encode(&source, target.as_file_mut(), &options, &AtomicBool::new(false)).unwrap();
        let output = image::load_from_memory(&fs::read(target.path()).unwrap()).unwrap().to_rgb8();
        assert!(output.get_pixel(0, 0).0.iter().all(|v| *v > 245));
    }
    #[test]
    fn cancelled_encoding_publishes_nothing() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("test.png");
        image::RgbImage::new(8, 8).save(&source).unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![source]).unwrap().remove(0);
        let job_id = store.start("cancel".into(), vec![input.id.clone()], "convert".into(), Options { format: "png".into(), ..Default::default() }).unwrap();
        let job = store.inner.lock().jobs.iter().find(|j| j.id == job_id).unwrap().clone();
        let output_dir = folder.path().join("result");
        assert!(prepare(&input, &job, &output_dir, &AtomicBool::new(true)).is_err());
        assert_eq!(fs::read_dir(output_dir).unwrap().count(), 0);
    }
    #[test]
    fn changed_input_is_rejected_without_overwriting_anything() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("test.txt");
        fs::write(&source, b"old").unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![source.clone()]).unwrap().remove(0);
        let job_id = store.start("changed".into(), vec![input.id.clone()], "copy".into(), Options::default()).unwrap();
        let job = store.inner.lock().jobs.iter().find(|j| j.id == job_id).unwrap().clone();
        fs::write(&source, b"new content").unwrap();
        assert!(prepare(&input, &job, &folder.path().join("result"), &AtomicBool::new(false)).is_err());
        assert_eq!(fs::read(source).unwrap(), b"new content");
    }
    #[test]
    fn many_replaced_selections_keep_queued_sources_without_exhausting_the_registry() {
        let folder = tempfile::tempdir().unwrap();
        let paths: Vec<_> = (0..100).map(|i| {
            let path = folder.path().join(format!("file-{i}.txt"));
            fs::write(&path, b"untouched").unwrap();
            path
        }).collect();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let first = store.register(paths.clone()).unwrap();
        let source = first[0].id.clone();
        store.start("queued".into(), vec![source.clone()], "copy".into(), Options::default()).unwrap();
        for _ in 0..25 { assert_eq!(store.register(paths.clone()).unwrap().len(), 100); }
        assert_eq!(store.paths(&[source]).unwrap(), vec![fs::canonicalize(&paths[0]).unwrap()]);
        assert!(store.paths(&[first[1].id.clone()]).is_err());
        assert_eq!(fs::read(&paths[0]).unwrap(), b"untouched");
    }
    #[test]
    fn a_panicking_operation_does_not_strand_the_next_job() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("input.txt");
        fs::write(&source, b"untouched").unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![source.clone()]).unwrap().remove(0);
        let first = store.start("first".into(), vec![input.id.clone()], "copy".into(), Options::default()).unwrap();
        let second = store.start("second".into(), vec![input.id], "copy".into(), Options::default()).unwrap();
        store.working.store(true, Ordering::Release);
        let mut reached = Vec::new();
        drain_queue(&store, |id| {
            if id == first { panic!("simulated codec failure"); }
            reached.push(id.to_string());
        }, || {});
        assert_eq!(reached, vec![second]);
        assert!(!store.working.load(Ordering::Acquire));
        let snapshot = store.snapshot();
        let failed = snapshot.jobs.iter().find(|job| job.id == first).unwrap();
        assert_eq!(failed.status, "failed");
        assert!(failed.items[0].error.is_some());
        assert!(!store.inner.lock().cancellations.contains_key(&first));
        assert_eq!(fs::read(source).unwrap(), b"untouched");
    }
    #[test]
    fn shutdown_cancels_queued_work_and_refuses_new_requests() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("input.txt");
        fs::write(&source, b"untouched").unwrap();
        let store = Store::new(folder.path().join("state"), folder.path().join("exports"));
        let input = store.register(vec![source.clone()]).unwrap().remove(0);
        let job = store.start("queued".into(), vec![input.id.clone()], "copy".into(), Options::default()).unwrap();
        store.cancel_all();
        assert!(store.inner.lock().cancellations[&job].load(Ordering::Acquire));
        assert!(store.start("too-late".into(), vec![input.id], "copy".into(), Options::default()).is_err());
        assert!(store.register(vec![source.clone()]).is_err());
        assert_eq!(store.snapshot().jobs.len(), 1);
        assert_eq!(fs::read(source).unwrap(), b"untouched");
    }
}
