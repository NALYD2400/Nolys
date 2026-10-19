//! User-requested deletion uses the Windows recycle operation, never remove_file.
use std::path::Path;

pub fn recycle(path: &Path, owner: usize) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Seuls les fichiers vidéo du clip peuvent être supprimés.".into());
    }
    let path = path.to_owned();
    // Shell file operations require an STA, while Tokio workers can already be MTA.
    std::thread::spawn(move || unsafe {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::{Foundation::HWND, System::Com::*, UI::Shell::*},
        };
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let operation: IFileOperation =
            CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        operation
            .SetOwnerWindow(HWND(owner as *mut _))
            .map_err(|e| e.to_string())?;
        // Windows keeps its warning if the volume or file cannot be recycled.
        operation
            .SetOperationFlags(
                FOFX_RECYCLEONDELETE
                    | FOF_ALLOWUNDO
                    | FOFX_ADDUNDORECORD
                    | FOF_NOCONFIRMATION
                    | FOF_WANTNUKEWARNING
                    | FOF_SILENT
                    | FOF_NOERRORUI
                    | FOFX_EARLYFAILURE,
            )
            .map_err(|e| e.to_string())?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let item: IShellItem =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).map_err(|e| e.to_string())?;
        operation
            .DeleteItem(&item, None)
            .map_err(|e| e.to_string())?;
        operation
            .PerformOperations()
            .map_err(|e| format!("Le clip n’a pas pu être mis à la corbeille : {e}"))?;
        if operation
            .GetAnyOperationsAborted()
            .map_err(|e| e.to_string())?
            .as_bool()
            || path.exists()
        {
            return Err("Suppression annulée : le clip a été conservé.".into());
        }
        Ok(())
    })
    .join()
    .map_err(|_| "La corbeille Windows n’a pas répondu.".to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "recycles an explicitly supplied owned fixture; restore it using the test runner"]
    fn native_recycle_owned_fixture() {
        let path = std::path::PathBuf::from(std::env::var_os("NOLYS_RECYCLE_FIXTURE").expect("owned fixture required"));
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("Nolys-Recycle-Fixture-"));
        assert!(path.is_file());
        super::recycle(&path, 0).unwrap();
        assert!(!path.exists());
    }
}
