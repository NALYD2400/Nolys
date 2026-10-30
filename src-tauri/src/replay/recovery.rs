//! Recover only complete fragments, leaving the interrupted source untouched.
use super::{mp4, process, Store};
use serde::Serialize;
use std::{io::Write, sync::atomic::Ordering};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFile {
    pub id: String,
    pub bytes: u64,
}

impl Store {
    pub fn recovery_list(&self) -> Result<Vec<RecoveryFile>, String> {
        if !self.recovery().exists() {
            return Ok(vec![]);
        }
        let mut files = Vec::new();
        for entry in std::fs::read_dir(self.recovery()).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().map_err(|e| e.to_string())?.is_file()
                && name.starts_with("capture-")
                && name.ends_with(".partial.mp4")
            {
                files.push(RecoveryFile {
                    id: name,
                    bytes: entry.metadata().map_err(|e| e.to_string())?.len(),
                });
            }
        }
        files.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(files)
    }
    pub fn recover(&self, id: &str) -> Result<(), String> {
        let _operation = self.clip_mutation.lock();
        let mut worker = self.worker.lock();
        Self::reap(&mut worker);
        if worker.is_some() {
            return Err("Arrêtez la capture avant de récupérer ses fragments.".into());
        }
        if !self.shared.history_valid.load(Ordering::Acquire) {
            return Err("Réindexez d’abord le dossier pour réparer l’historique.".into());
        }
        // The ID must match a current internal directory entry, never an arbitrary path.
        if !self.recovery_list()?.iter().any(|f| f.id == id) {
            return Err("Fragment inconnu.".into());
        }
        let input = std::fs::File::open(self.recovery().join(id)).map_err(|e| e.to_string())?;
        let mut complete =
            tempfile::NamedTempFile::new_in(self.recovery()).map_err(|e| e.to_string())?;
        let (mut start, mut end, mut failure) = (None, 0.0_f64, None);
        // A truncated final box is expected after interruption. Keep only complete pairs.
        let _ = mp4::read_stream(input, |part| {
            let bytes = match part {
                mp4::Part::Header(bytes) => bytes,
                mp4::Part::Fragment(fragment) => {
                    if start.is_none() && !fragment.keyframe {
                        return true;
                    }
                    start.get_or_insert(fragment.start);
                    end = fragment.end;
                    fragment.bytes
                }
            };
            match complete.write_all(&bytes) {
                Ok(()) => true,
                Err(e) => {
                    failure = Some(e.to_string());
                    false
                }
            }
        });
        if let Some(error) = failure {
            return Err(error);
        }
        let start = start
            .ok_or("Aucune image clé complète récupérable. Les fragments restent conservés.")?;
        complete.flush().map_err(|e| e.to_string())?;
        let engine = process::resolve(&self.snapshot().config.engine_path, &self.resources)?;
        let clip = super::export::remux(
            complete.path(),
            &engine,
            &self.folder(),
            "recording",
            (end - start).max(0.0),
        )?;
        self.shared.add_clip(clip);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_rejects_external_paths_and_preserves_unusable_fragments() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into(), root.path().into(), Default::default());
        std::fs::create_dir(store.recovery()).unwrap();
        let path = store.recovery().join("capture-test.partial.mp4");
        std::fs::write(&path, b"broken").unwrap();
        assert!(store.recover("../outside.mp4").is_err());
        assert!(store.recover("capture-test.partial.mp4").is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"broken");
        assert_eq!(store.recovery_list().unwrap().len(), 1);
    }
    #[test]
    #[ignore = "requires bundled FFmpeg; synthetic video only"]
    fn complete_and_truncated_synthetic_recordings_recover_without_touching_sources() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(
            root.path().into(),
            root.path().join("Videos"),
            Default::default(),
        );
        std::fs::create_dir(store.recovery()).unwrap();
        let engine = process::resolve("", std::path::Path::new("")).unwrap();
        store.shared.state.lock().config.engine_path = engine.to_string_lossy().into();
        let original = store.recovery().join("capture-complete.partial.mp4");
        let result = process::output(
            &engine,
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:size=160x120:rate=10:duration=3",
                "-c:v",
                "libx264",
                "-g",
                "10",
                "-movflags",
                "+frag_keyframe+empty_moov+default_base_moof",
                &original.to_string_lossy(),
            ],
            10,
        )
        .unwrap();
        assert!(result.status.success());
        let bytes = std::fs::read(&original).unwrap();
        let truncated = store.recovery().join("capture-truncated.partial.mp4");
        std::fs::write(&truncated, &bytes[..bytes.len() - 100]).unwrap();
        store.recover("capture-complete.partial.mp4").unwrap();
        store.recover("capture-truncated.partial.mp4").unwrap();
        assert_eq!(store.snapshot().clips.len(), 2);
        assert_eq!(std::fs::read(original).unwrap(), bytes);
        assert_eq!(
            std::fs::read(truncated).unwrap(),
            &bytes[..bytes.len() - 100]
        );
        for clip in store.snapshot().clips {
            assert!(clip.seconds > 0.0);
            assert!(process::output(
                &engine,
                &[
                    "-v",
                    "error",
                    "-i",
                    &clip.path.to_string_lossy(),
                    "-f",
                    "null",
                    "-"
                ],
                10
            )
            .unwrap()
            .status
            .success());
        }
    }
}
