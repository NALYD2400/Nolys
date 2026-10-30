//! Small, disposable previews. Only a clip already in the history can be decoded.
use super::{process, Store};
use parking_lot::Mutex;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
};

// Avoid competing decoders when a long clip list comes into view.
static DECODER: Mutex<()> = Mutex::new(());
pub const CACHE_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_FILES: usize = 512;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub bytes: u64,
    pub files: usize,
    pub limit_bytes: u64,
}

fn generated(path: &std::path::Path) -> bool {
    path.extension().is_some_and(|e| e == "jpg")
        && path.file_stem().is_some_and(|s| {
            let s = s.to_string_lossy();
            s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit())
        })
}
fn prune(directory: &std::path::Path, clear: bool) -> Result<CacheUsage, String> {
    let mut files = Vec::new();
    if directory.exists() {
        for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_file() && generated(&entry.path()) {
                let m = entry.metadata().map_err(|e| e.to_string())?;
                files.push((entry.path(), m.len(), m.modified().ok()));
            }
        }
    }
    files.sort_by_key(|f| f.2);
    let mut bytes: u64 = files.iter().map(|f| f.1).sum();
    let mut count = files.len();
    for (path, len, _) in files {
        if !clear && bytes <= CACHE_BYTES && count <= CACHE_FILES {
            break;
        }
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        bytes -= len;
        count -= 1;
    }
    Ok(CacheUsage {
        bytes,
        files: count,
        limit_bytes: CACHE_BYTES,
    })
}

impl Store {
    pub fn cache_usage(&self, clear: bool) -> Result<CacheUsage, String> {
        let _decoder = DECODER.lock();
        prune(&self.shared.root.join("replay-thumbnails"), clear)
    }
    pub fn thumbnail(&self, id: &str) -> Result<PathBuf, String> {
        let _decoder = DECODER.lock();
        let source = self.clip_path(id)?;
        let metadata = source.metadata().map_err(|e| e.to_string())?;
        let mut hash = DefaultHasher::new();
        // Renames and externally replaced files must not reuse an obsolete image.
        source.hash(&mut hash);
        metadata.len().hash(&mut hash);
        metadata.modified().ok().hash(&mut hash);
        let directory = self.shared.root.join("replay-thumbnails");
        prune(&directory, false)?;
        let target = directory.join(format!("{:016x}.jpg", hash.finish()));
        if target.is_file() && target.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(target);
        }
        let configured = self.shared.state.lock().config.engine_path.clone();
        let engine = process::resolve(&configured, &self.resources)?;
        // The first decoded image also works for clips shorter than one second.
        let output = process::output(&engine, &[
            "-v", "error", "-nostdin", "-threads", "1", "-i", &source.to_string_lossy(),
            "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn",
            "-vf", "scale=320:180:force_original_aspect_ratio=decrease,setsar=1,pad=320:180:(ow-iw)/2:(oh-ih)/2",
            "-threads", "1", "-c:v", "mjpeg", "-q:v", "4", "-f", "image2pipe", "pipe:1",
        ], 8)?;
        if !output.status.success()
            || output.stdout.len() > 512 * 1024
            || !output.stdout.starts_with(&[0xff, 0xd8])
            || !output.stdout.ends_with(&[0xff, 0xd9])
        {
            return Err("Aperçu vidéo indisponible.".into());
        }
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        // Publish only a complete JPEG, including after an interrupted previous run.
        let mut pending = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut pending, &output.stdout).map_err(|e| e.to_string())?;
        pending.persist(&target).map_err(|e| e.to_string())?;
        prune(&directory, false)?;
        Ok(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::Clip;
    #[test]
    fn quota_only_removes_generated_regular_jpegs() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..515 {
            std::fs::write(root.path().join(format!("{i:016x}.jpg")), b"generated").unwrap();
        }
        std::fs::write(root.path().join("personal.jpg"), b"keep").unwrap();
        assert_eq!(prune(root.path(), false).unwrap().files, 512);
        assert_eq!(prune(root.path(), true).unwrap().files, 0);
        assert_eq!(
            std::fs::read(root.path().join("personal.jpg")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn unknown_clip_cannot_request_a_thumbnail() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into(), root.path().into(), root.path().into());
        assert!(store.thumbnail("../../video.mp4").is_err());
        assert!(!root.path().join("replay-thumbnails").exists());
    }

    #[test]
    #[ignore = "requires the bundled FFmpeg; uses only a synthetic temporary video"]
    fn synthetic_thumbnail_is_decodable_cached_and_invalidated() {
        let root = tempfile::tempdir().unwrap();
        let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/replay/ffmpeg.exe");
        let source = root.path().join("test.mp4");
        let output = process::output(
            &engine,
            &[
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:size=160x120:rate=10:duration=0.3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &source.to_string_lossy(),
            ],
            10,
        )
        .unwrap();
        assert!(output.status.success());
        let original = std::fs::read(&source).unwrap();
        let store = Store::new(root.path().into(), root.path().into(), root.path().into());
        store.shared.state.lock().config.engine_path = engine.to_string_lossy().into();
        store.shared.state.lock().clips.push(Clip {
            id: "test".into(),
            name: "test.mp4".into(),
            path: source.clone(),
            kind: "replay".into(),
            created_at: 0,
            seconds: 0.3,
            bytes: original.len() as u64,
        });
        let first = store.thumbnail("test").unwrap();
        let image = image::open(&first).unwrap();
        assert_eq!((image.width(), image.height()), (320, 180));
        let modified = first.metadata().unwrap().modified().unwrap();
        assert_eq!(store.thumbnail("test").unwrap(), first);
        assert_eq!(first.metadata().unwrap().modified().unwrap(), modified);
        assert_eq!(std::fs::read(&source).unwrap(), original);
        let renamed = root.path().join("renamed.mp4");
        std::fs::rename(&source, &renamed).unwrap();
        store.shared.state.lock().clips[0].path = renamed;
        assert_ne!(store.thumbnail("test").unwrap(), first);
    }
}
