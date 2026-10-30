//! Explicit, non-recursive discovery. Videos are never moved or removed by indexing.
use super::{write_json, Clip, Store};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::UNIX_EPOCH,
};

fn key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_owned())
        .to_string_lossy()
        .to_lowercase()
}
fn video(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("mp4"))
        && !path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with('.')
}
impl Store {
    pub fn reindex(&self) -> Result<(), String> {
        let _operation = self.clip_mutation.lock();
        let entries = std::fs::read_dir(self.folder())
            .map_err(|e| format!("Dossier vidéo inaccessible : {e}"))?;
        let mut discovered = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            // Do not follow directory links, symlinks or recurse into personal folders.
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = entry.path();
            if !video(&path) {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = if name.starts_with("Nolys-Replay-") {
                "replay"
            } else if name.starts_with("Nolys-REC-") {
                "recording"
            } else {
                "imported"
            };
            discovered.push(Clip {
                id: format!("indexed-{:016x}", rand::random::<u64>()),
                name,
                path,
                kind: kind.into(),
                created_at: metadata
                    .created()
                    .or_else(|_| metadata.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs()),
                seconds: 0.0,
                bytes: metadata.len(),
            });
        }
        let mut state = self.shared.state.lock();
        let mut clips = state.clips.clone();
        let mut paths: HashSet<_> = clips.iter().map(|c| key(&c.path)).collect();
        let mut added = 0;
        for clip in discovered {
            if paths.insert(key(&clip.path)) {
                clips.push(clip);
                added += 1;
            }
        }
        clips.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        // A damaged manifest is copied verbatim before an explicit rebuild can replace it.
        if !self.shared.history_valid.load(Ordering::Acquire) {
            let original = self.shared.root.join("replay-clips.json");
            if original.exists() {
                let backup = self.shared.root.join(format!(
                    "replay-clips-preserved-{:016x}.json",
                    rand::random::<u64>()
                ));
                let mut output = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(backup)
                    .map_err(|e| e.to_string())?;
                std::io::copy(
                    &mut std::fs::File::open(&original).map_err(|e| e.to_string())?,
                    &mut output,
                )
                .map_err(|e| e.to_string())?;
                output.sync_all().map_err(|e| e.to_string())?;
            }
        }
        write_json(&self.shared.root.join("replay-clips.json"), &clips)?;
        self.shared.history_valid.store(true, Ordering::Release);
        state.clips = clips;
        state.error = None;
        state.notice = Some(format!(
            "{added} vidéo(s) ajoutée(s). Les vidéos déjà indexées ont été conservées."
        ));
        Ok(())
    }
    pub fn relocate(&self, id: &str, path: PathBuf) -> Result<(), String> {
        let _operation = self.clip_mutation.lock();
        if !self.shared.history_valid.load(Ordering::Acquire) {
            return Err("Réindexez d’abord le dossier pour réparer l’historique.".into());
        }
        if !path.is_absolute() || !video(&path) {
            return Err("Choisissez un fichier MP4 existant.".into());
        }
        let mut state = self.shared.state.lock();
        let index = state
            .clips
            .iter()
            .position(|c| c.id == id)
            .ok_or("Clip inconnu.")?;
        if state.clips[index].path.is_file() {
            return Err("Ce clip existe encore à son emplacement d’origine.".into());
        }
        if state
            .clips
            .iter()
            .enumerate()
            .any(|(i, c)| i != index && key(&c.path) == key(&path))
        {
            return Err("Cette vidéo est déjà indexée.".into());
        }
        let mut clips = state.clips.clone();
        clips[index].bytes = path.metadata().map_err(|e| e.to_string())?.len();
        clips[index].name = path.file_name().unwrap().to_string_lossy().into();
        clips[index].path = path;
        write_json(&self.shared.root.join("replay-clips.json"), &clips)?;
        state.clips = clips;
        state.notice = Some("Emplacement du clip retrouvé.".into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexing_keeps_more_than_200_clips_and_never_duplicates_or_removes_missing_entries() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..205 {
            std::fs::write(root.path().join(format!("clip-{i}.mp4")), b"fixture").unwrap();
        }
        let store = Store::new(root.path().into(), root.path().into(), PathBuf::new());
        store.reindex().unwrap();
        store.reindex().unwrap();
        assert_eq!(store.snapshot().clips.len(), 205);
        let old = store.snapshot().clips[0].clone();
        let moved = root.path().join("moved.mp4");
        std::fs::rename(&old.path, &moved).unwrap();
        store.relocate(&old.id, moved.clone()).unwrap();
        let restarted = Store::new(root.path().into(), root.path().into(), PathBuf::new());
        assert_eq!(restarted.snapshot().clips.len(), 205);
        assert_eq!(restarted.clip_path(&old.id).unwrap(), moved);
    }
    #[test]
    fn explicit_rebuild_preserves_damaged_manifest() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("replay-clips.json"), b"{damaged").unwrap();
        let store = Store::new(root.path().into(), root.path().into(), PathBuf::new());
        store.reindex().unwrap();
        assert!(std::fs::read_dir(root.path()).unwrap().flatten().any(|e| e
            .file_name()
            .to_string_lossy()
            .starts_with("replay-clips-preserved-")
            && std::fs::read(e.path()).unwrap() == b"{damaged"));
    }
}
