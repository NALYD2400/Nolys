use std::path::{Path, PathBuf};

pub fn destination(source: &Path, name: &str) -> Result<PathBuf, String> {
    let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    let name = name.trim();
    let suffix = format!(".{extension}");
    let stem = if name.to_lowercase().ends_with(&suffix.to_lowercase()) { &name[..name.len() - suffix.len()] } else { name };
    if stem.is_empty() || stem.ends_with(['.', ' ']) || stem.encode_utf16().count() > 120
        || stem.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) {
        return Err("Choisissez un nom de 1 à 120 caractères, sans \\ / : * ? \" < > | ni point final.".into());
    }
    let base = stem.split('.').next().unwrap_or_default().trim_end().to_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&base.as_str())
        || ["COM", "LPT"].iter().any(|prefix| base.strip_prefix(*prefix).is_some_and(|n| ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&n))) {
        return Err("Ce nom est réservé par Windows. Choisissez un autre nom.".into());
    }
    Ok(source.with_file_name(format!("{stem}{suffix}")))
}

// MoveFileW fails if the destination exists; no replacement flag and no copying video data.
pub fn move_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::MoveFileW};
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe { MoveFileW(PCWSTR(source.as_ptr()), PCWSTR(destination.as_ptr())) }
        .map_err(|_| "Le clip ne peut pas être renommé : ce nom existe déjà, le fichier est utilisé ou le dossier est inaccessible.".into())
}
