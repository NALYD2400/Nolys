//! Only generated, unreferenced cover thumbnails can be removed.
use super::{path_key, Store};
use serde::Serialize;
use std::{collections::HashSet, fs, path::Path};

const BUDGET: u64 = 128 * 1024 * 1024;
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bytes: u64,
    pub files: usize,
    pub orphan_bytes: u64,
    pub orphans: usize,
    pub removed: usize,
    pub reclaimed_bytes: u64,
    pub budget_bytes: u64,
    pub over_budget: bool,
}

fn generated(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "jpg") && path.file_stem().and_then(|s| s.to_str()).is_some_and(|stem| stem.len() == 32 && stem.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn ordinary(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return false; }
    #[cfg(windows)]
    { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return false; } }
    true
}

pub fn inspect(store: &Store, clean: bool) -> Result<CacheInfo, String> {
    let importing = store.importing.lock();
    if clean && *importing { return Err("Attendez la fin de l’import avant de nettoyer les pochettes.".into()); }
    let stored = store.data.lock();
    let library = stored.as_ref().map_err(Clone::clone)?;
    let references: HashSet<_> = library.tracks.iter().map(|track| path_key(&track.cover)).collect();
    let folder = store.covers_dir();
    let mut info = CacheInfo { budget_bytes: BUDGET, ..Default::default() };
    let metadata = match fs::symlink_metadata(&folder) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(info),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_dir() || !ordinary(&metadata) { return Err("Le dossier des pochettes n’est pas un dossier local ordinaire.".into()); }
    for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !generated(&path) || !metadata.is_file() || !ordinary(&metadata) { continue; }
        let orphan = !references.contains(&path_key(&path.to_string_lossy()));
        if clean && orphan {
            fs::remove_file(&path).map_err(|error| format!("Une pochette temporaire n’a pas pu être retirée : {error}"))?;
            info.removed += 1;
            info.reclaimed_bytes += metadata.len();
        } else {
            info.files += 1;
            info.bytes += metadata.len();
            if orphan { info.orphans += 1; info.orphan_bytes += metadata.len(); }
        }
    }
    info.over_budget = info.bytes > BUDGET;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_keeps_referenced_covers_and_unrelated_files() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into());
        let folder = store.covers_dir(); fs::create_dir(&folder).unwrap();
        let live = folder.join(format!("{}.jpg", "a".repeat(32)));
        let orphan = folder.join(format!("{}.jpg", "b".repeat(32)));
        let personal = folder.join("personal.jpg");
        for file in [&live, &orphan, &personal] { fs::write(file, b"image").unwrap(); }
        store.change(|library| { library.tracks.push(super::super::Track { cover: live.to_string_lossy().into(), ..Default::default() }); Ok(()) }).unwrap();
        let before = store.cache_info().unwrap(); assert_eq!(before.orphans, 1); assert_eq!(before.files, 2);
        let after = store.clean_cache().unwrap(); assert_eq!(after.removed, 1); assert_eq!(after.files, 1);
        assert!(live.exists()); assert!(personal.exists()); assert!(!orphan.exists());
        *store.importing.lock() = true;
        assert!(store.clean_cache().is_err());
    }
}
