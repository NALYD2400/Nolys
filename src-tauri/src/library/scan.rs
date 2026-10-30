//! Traversal accepts Cloud Files, but never follows name-surrogate links.
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};

pub fn cloud_tag(tag: u32) -> bool { tag & 0xffff_0fff == 0x9000_001a }

pub fn ordinary_or_cloud(path: &Path, metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return false; }
    #[cfg(windows)]
    {
        use std::{os::windows::{fs::{MetadataExt, OpenOptionsExt}, io::AsRawHandle}, mem::size_of};
        use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::{GetFileInformationByHandleEx, FileAttributeTagInfo, FILE_ATTRIBUTE_TAG_INFO}};
        if metadata.file_attributes() & 0x400 != 0 {
            // OPEN_REPARSE_POINT avoids following a symlink or junction. Opening
            // with access=0 reads the tag without requesting cloud file contents.
            let Ok(file) = fs::OpenOptions::new().access_mode(0).share_mode(7)
                .custom_flags(0x0020_0000 | 0x0200_0000).open(path) else { return false; };
            let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
            if unsafe { GetFileInformationByHandleEx(HANDLE(file.as_raw_handle()), FileAttributeTagInfo, &mut info as *mut _ as *mut _, size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32) }.is_err() { return false; }
            return cloud_tag(info.ReparseTag);
        }
    }
    #[cfg(not(windows))] let _ = path;
    true
}

pub fn collect(paths: Vec<PathBuf>, cancel: &AtomicBool) -> (Vec<PathBuf>, usize) {
    let mut pending = paths;
    let mut files = vec![];
    let mut seen = HashSet::new();
    let mut visited = HashSet::new();
    let mut skipped = 0;
    while let Some(path) = pending.pop() {
        if cancel.load(Ordering::Acquire) { break; }
        let Ok(metadata) = fs::symlink_metadata(&path) else { skipped += 1; continue; };
        if !ordinary_or_cloud(&path, &metadata) { skipped += 1; continue; }
        if metadata.is_dir() {
            let Ok(canonical) = path.canonicalize() else { skipped += 1; continue; };
            if !visited.insert(super::path_key(&canonical.to_string_lossy())) { continue; }
            match fs::read_dir(&path) {
                Ok(entries) => for entry in entries {
                    if cancel.load(Ordering::Acquire) { break; }
                    match entry { Ok(entry) => pending.push(entry.path()), Err(_) => skipped += 1 }
                },
                Err(_) => skipped += 1,
            }
        } else if metadata.is_file() && super::supported(&path) {
            match path.canonicalize() {
                Ok(path) if seen.insert(super::path_key(&path.to_string_lossy())) => files.push(path),
                Ok(_) => {},
                Err(_) => skipped += 1,
            }
        }
    }
    files.sort();
    (files, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_cloud_tag_family_is_allowed() {
        for variant in 0..=15 { assert!(cloud_tag(0x9000_001a | variant << 12)); }
        for tag in [0xa000_000c, 0xa000_0003, 0x8000_001b, 0x9000_0018, 0, 0x9001_001a] { assert!(!cloud_tag(tag)); }
    }
    #[test]
    fn cancellation_stops_before_traversing_any_source() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.mp3"), b"audio").unwrap();
        assert!(collect(vec![dir.path().into()], &AtomicBool::new(true)).0.is_empty());
    }
    #[cfg(windows)]
    #[test]
    fn a_directory_junction_is_counted_and_never_traversed() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let linked = dir.path().join("linked");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("hidden.mp3"), b"audio").unwrap();
        let output = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(&linked).arg(&source).output().unwrap();
        assert!(output.status.success(), "junction fixture could not be created");
        let (files, skipped) = collect(vec![linked.clone()], &AtomicBool::new(false));
        assert!(files.is_empty()); assert_eq!(skipped, 1);
        // Remove only the junction, never its target directory.
        fs::remove_dir(linked).unwrap();
        assert!(source.join("hidden.mp3").exists());
    }
}
