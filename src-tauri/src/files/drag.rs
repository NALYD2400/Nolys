//! Native OLE file transfer. No HTML file URLs and no arbitrary shell commands.
use std::{cell::{Cell, RefCell}, ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf, sync::atomic::Ordering};
use tauri::{AppHandle, Emitter, Manager};
use windows::{core::{implement, BOOL, HSTRING, Interface, Ref}, Win32::{
    Foundation::{HWND, LPARAM, POINTL, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, S_OK},
    System::{Com::{IDataObject, FORMATETC, DVASPECT_CONTENT, TYMED_HGLOBAL, CoTaskMemFree, STGMEDIUM},
        Ole::{IDropTarget, IDropTarget_Impl, IDropSource, IDropSource_Impl, RegisterDragDrop, RevokeDragDrop, ReleaseStgMedium, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, DoDragDrop, OleSetClipboard, OleFlushClipboard, OleInitialize, OleUninitialize},
        SystemServices::{MODIFIERKEYS_FLAGS, MK_LBUTTON}},
    UI::{Shell::{DragQueryFileW, HDROP, SHCreateShellItemArrayFromIDLists, BHID_DataObject, SHParseDisplayName, SHOpenFolderAndSelectItems, ShellExecuteW, Common::ITEMIDLIST}, WindowsAndMessaging::{EnumChildWindows, SW_SHOWNORMAL}},
}};
use super::Store;

thread_local! { static TARGETS: RefCell<Vec<(isize, IDropTarget)>> = const { RefCell::new(Vec::new()) }; }
thread_local! { static OLE_READY: Cell<bool> = const { Cell::new(false) }; }

pub fn install(app: &AppHandle) -> Result<(), String> {
    let window = crate::island::window(app).ok_or("La fenêtre Island n’est pas disponible.")?;
    let handle = app.clone();
    window.with_webview(move |webview| {
        let initialized = OLE_READY.with(|ready| {
            if ready.get() { return true; }
            let ok = unsafe { OleInitialize(None) }.is_ok();
            ready.set(ok);
            ok
        });
        if !initialized {
            let _ = handle.emit_to(crate::island::LABEL, "files-error", "Le transfert de fichiers Windows n’a pas pu être initialisé. Le sélecteur reste disponible.");
            return;
        }
        // As in Wry's own adapter, stop WebView2's default file navigation before
        // installing OLE targets. Repeat after navigation: child HWNDs can change.
        if let Ok(controller) = webview.controller().cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller4>() {
            if unsafe { controller.SetAllowExternalDrop(false) }.is_err() {
                crate::logger::log("[Files] WebView2 external drop configuration failed");
            }
        }
        let Some(window) = crate::island::window(&handle) else { return };
        let Ok(hwnd) = window.hwnd() else { return };
        let mut windows = vec![hwnd];
        unsafe extern "system" fn collect(hwnd: HWND, param: LPARAM) -> BOOL {
            unsafe { (&mut *(param.0 as *mut Vec<HWND>)).push(hwnd); }
            true.into()
        }
        unsafe { let _ = EnumChildWindows(Some(hwnd), Some(collect), LPARAM(&mut windows as *mut _ as isize)); }
        TARGETS.with(|targets| {
            let mut targets = targets.borrow_mut();
            for (hwnd, _) in targets.drain(..) { unsafe { let _ = RevokeDragDrop(HWND(hwnd as _)); } }
            for hwnd in windows {
                let target: IDropTarget = Target { app: handle.clone(), valid: Cell::new(false), session: RefCell::new(String::new()) }.into();
                unsafe {
                    let _ = RevokeDragDrop(hwnd);
                    if RegisterDragDrop(hwnd, &target).is_ok() { targets.push((hwnd.0 as isize, target)); }
                }
            }
            crate::logger::log(&format!("[Files] {} native drop targets registered", targets.len()));
        });
    }).map_err(|e| e.to_string())
}

pub fn uninstall() {
    TARGETS.with(|targets| { for (hwnd, _) in targets.borrow_mut().drain(..) { unsafe { let _ = RevokeDragDrop(HWND(hwnd as _)); } } });
    OLE_READY.with(|ready| { if ready.replace(false) { unsafe { OleUninitialize(); } } });
}

fn inside(app: &AppHandle, point: &POINTL) -> bool {
    let state = app.state::<crate::state::AppState>();
    let files = app.state::<Store>();
    if !files.enabled.load(Ordering::Acquire) || files.outgoing.load(Ordering::Acquire) || state.layout_edit_mode.load(Ordering::Acquire) { return false; }
    let Some(window) = crate::island::window(app) else { return false };
    let Ok(hwnd) = window.hwnd() else { return false };
    if !crate::platform::window::is_visible(hwnd) { return false; }
    let Some(bounds) = crate::platform::window::window_rect(hwnd) else { return false };
    let region = state.hit_region.lock();
    let ratio = region.pixel_ratio.max(0.1);
    let (x, y) = ((point.x - bounds.left) as f64 / ratio, (point.y - bounds.top) as f64 / ratio);
    region.rects.first().is_some_and(|r| {
        if x < r.x || x >= r.x + r.width || y < r.y || y >= r.y + r.height { return false; }
        let radius = (r.height / 2.0).min(32.0).min(r.width / 2.0);
        let nearest_x = x.clamp(r.x + radius, r.x + r.width - radius);
        let nearest_y = y.clamp(r.y + radius, r.y + r.height - radius);
        (x - nearest_x).powi(2) + (y - nearest_y).powi(2) <= radius.powi(2)
    })
}

fn location(app: &AppHandle, point: &POINTL) -> serde_json::Value {
    let state = app.state::<crate::state::AppState>();
    let bounds = crate::island::window(app).and_then(|w| w.hwnd().ok()).and_then(crate::platform::window::window_rect);
    let ratio = state.hit_region.lock().pixel_ratio.max(0.1);
    let (x, y) = bounds.map(|b| ((point.x - b.left) as f64 / ratio, (point.y - b.top) as f64 / ratio)).unwrap_or_default();
    serde_json::json!({"x":x, "y":y})
}

fn format() -> FORMATETC { FORMATETC { cfFormat: CF_HDROP.0, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 } }

struct Medium(STGMEDIUM);
impl Drop for Medium { fn drop(&mut self) { unsafe { ReleaseStgMedium(&mut self.0); } } }

fn paths(object: &IDataObject) -> Result<Vec<PathBuf>, String> {
    let medium = Medium(unsafe { object.GetData(&format()) }.map_err(|_| "Enregistrez d’abord ce fichier sur votre ordinateur, puis déposez-le dans Nolys.")?);
    let hdrop = HDROP(unsafe { medium.0.u.hGlobal.0 });
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, None) };
    if count == 0 || count > 100 { return Err("Déposez entre 1 et 100 fichiers à la fois.".into()); }
    let mut result = Vec::new();
    for i in 0..count {
        let length = unsafe { DragQueryFileW(hdrop, i, None) } as usize;
        if length == 0 || length > 32767 { return Err("Le chemin d’un fichier n’est pas valide.".into()); }
        let mut name = vec![0u16; length + 1];
        unsafe { DragQueryFileW(hdrop, i, Some(&mut name)); }
        result.push(PathBuf::from(OsString::from_wide(&name[..length])));
    }
    Ok(result)
}

#[implement(IDropTarget)]
struct Target { app: AppHandle, valid: Cell<bool>, session: RefCell<String> }

impl Target {
    fn event(&self, kind: &str, point: Option<&POINTL>) {
        if cfg!(debug_assertions) && std::env::var_os("NOLYS_DEV_DATA_DIR").is_some() && ["enter", "drop", "leave"].contains(&kind) {
            crate::logger::log(&format!("[Files Dev] native {kind}, position={}", point.map(|p| location(&self.app, p)).unwrap_or_default()));
        }
        let _ = self.app.emit_to(crate::island::LABEL, "files-drag", serde_json::json!({"type":kind, "session":self.session.borrow().clone(), "position":point.map(|p| location(&self.app,p))}));
    }
    fn reset(&self) {
        self.valid.set(false);
        self.app.state::<Store>().dragging.store(false, Ordering::Release);
        self.event("leave", None);
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(&self, object: Ref<'_, IDataObject>, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        let allows_copy = unsafe { (*effect).0 & DROPEFFECT_COPY.0 != 0 };
        let valid = allows_copy && object.as_ref().is_some_and(|o| unsafe { o.QueryGetData(&format()).is_ok() }) && !self.app.state::<Store>().outgoing.load(Ordering::Acquire);
        self.valid.set(valid);
        *self.session.borrow_mut() = super::model::id();
        self.app.state::<Store>().dragging.store(valid, Ordering::Release);
        let accepted = valid && inside(&self.app, point);
        unsafe { *effect = if accepted { DROPEFFECT_COPY } else { DROPEFFECT_NONE }; }
        if accepted { self.event("enter", Some(point)); }
        Ok(())
    }
    fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        let accepted = self.valid.get() && inside(&self.app, point);
        unsafe { *effect = if accepted { DROPEFFECT_COPY } else { DROPEFFECT_NONE }; }
        if accepted { self.event("over", Some(point)); }
        else if self.valid.get() {
            self.event("outside", Some(point));
            crate::island::set_click_through(&self.app, true);
        }
        Ok(())
    }
    fn DragLeave(&self) -> windows::core::Result<()> { self.reset(); Ok(()) }
    fn Drop(&self, object: Ref<'_, IDataObject>, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        let accepted = self.valid.get() && inside(&self.app, point);
        unsafe { *effect = if accepted { DROPEFFECT_COPY } else { DROPEFFECT_NONE }; }
        if accepted {
            let result = object.as_ref().ok_or("Ce dépôt ne contient pas de fichiers.".to_string()).and_then(paths);
            let app = self.app.clone();
            let position = location(&app, point);
            self.event("drop", Some(point));
            tauri::async_runtime::spawn_blocking(move || {
                match result.and_then(|paths| app.state::<Store>().register(paths)) {
                    Ok(inputs) => { let _ = app.emit_to(crate::island::LABEL, super::SELECTION, serde_json::json!({"inputs":inputs,"position":position})); }
                    Err(error) => { let _ = app.emit_to(crate::island::LABEL, "files-error", error); }
                }
            });
        }
        self.valid.set(false);
        self.app.state::<Store>().dragging.store(false, Ordering::Release);
        Ok(())
    }
}

fn data_object(paths: &[PathBuf]) -> Result<IDataObject, String> {
    let mut pidls: Vec<*mut ITEMIDLIST> = Vec::new();
    let result = (|| {
        for path in paths {
            let mut pidl = std::ptr::null_mut();
            unsafe { SHParseDisplayName(&HSTRING::from(path.as_os_str()), None, &mut pidl, 0, None) }.map_err(|_| "Windows ne peut pas transférer ce fichier.")?;
            pidls.push(pidl);
        }
        let ids: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| *p as *const _).collect();
        let items = unsafe { SHCreateShellItemArrayFromIDLists(&ids) }.map_err(|e| e.to_string())?;
        let object: IDataObject = unsafe { items.BindToHandler(None, &BHID_DataObject) }.map_err(|e| e.to_string())?;
        unsafe { object.QueryGetData(&format()) }.ok().map_err(|_| "Windows ne peut pas exposer ces fichiers au transfert natif.")?;
        Ok(object)
    })();
    for pidl in pidls { unsafe { CoTaskMemFree(Some(pidl as _)); } }
    result
}

pub fn copy(paths: &[PathBuf]) -> Result<(), String> {
    let object = data_object(paths)?;
    unsafe { OleSetClipboard(&object).and_then(|_| OleFlushClipboard()) }.map_err(|_| "Le presse-papiers Windows est occupé. Réessayez.".to_string())
}

pub fn reveal(path: &std::path::Path) -> Result<(), String> {
    let text = HSTRING::from(path.as_os_str());
    if path.is_dir() {
        let result = unsafe { ShellExecuteW(None, windows::core::w!("open"), &text, None, None, SW_SHOWNORMAL) };
        return if result.0 as isize > 32 { Ok(()) } else { Err("Le dossier ne peut pas être ouvert dans l’Explorateur.".into()) };
    }
    let mut pidl = std::ptr::null_mut();
    unsafe { SHParseDisplayName(&text, None, &mut pidl, 0, None) }.map_err(|_| "Windows ne retrouve plus ce fichier.")?;
    let result = unsafe { SHOpenFolderAndSelectItems(pidl, None, 0) }.map_err(|_| "Windows n’a pas pu sélectionner le résultat dans son dossier.".to_string());
    unsafe { CoTaskMemFree(Some(pidl as _)); }
    result
}

#[implement(IDropSource)]
struct Source { first_query: Cell<bool>, last_effect: Cell<u32> }
fn trace(message: &str) {
    if cfg!(debug_assertions) && std::env::var_os("NOLYS_DEV_DATA_DIR").is_some() {
        crate::logger::log(&format!("[Files Dev] {message}"));
    }
}
#[allow(non_snake_case)]
impl IDropSource_Impl for Source_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> windows::core::HRESULT {
        if self.first_query.replace(false) { trace(&format!("outgoing first query keys={} escape={}", keys.0, escape.as_bool())); }
        if escape.as_bool() { DRAGDROP_S_CANCEL } else if keys.0 & MK_LBUTTON.0 == 0 { DRAGDROP_S_DROP } else { S_OK }
    }
    fn GiveFeedback(&self, effect: DROPEFFECT) -> windows::core::HRESULT {
        if self.last_effect.replace(effect.0) != effect.0 { trace(&format!("outgoing feedback effect={}", effect.0)); }
        windows::Win32::Foundation::DRAGDROP_S_USEDEFAULTCURSORS
    }
}

pub fn start_drag(paths: &[PathBuf]) -> Result<(), String> {
    let object = data_object(paths)?;
    let source: IDropSource = Source { first_query: Cell::new(true), last_effect: Cell::new(u32::MAX) }.into();
    let mut effect = DROPEFFECT_NONE;
    trace(&format!("outgoing begin mouse_down={}", crate::platform::window::mouse_button_down()));
    let result = unsafe { DoDragDrop(&object, &source, DROPEFFECT_COPY, &mut effect) };
    trace(&format!("outgoing ended status={result:?} effect={}", effect.0));
    result.ok().map_err(|_| "Le glisser du fichier n’a pas pu démarrer.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_transfer_exposes_real_paths_from_different_folders() {
        std::thread::spawn(|| {
            unsafe { OleInitialize(None).unwrap(); }
            let directory = tempfile::tempdir().unwrap();
            let first = directory.path().join("été premier.txt");
            let second_dir = directory.path().join("autre dossier");
            std::fs::create_dir(&second_dir).unwrap();
            let second = second_dir.join("second.txt");
            std::fs::write(&first, b"first").unwrap();
            std::fs::write(&second, b"second").unwrap();
            {
                let object = data_object(&[first.clone(), second.clone()]).unwrap();
                let received = paths(&object).unwrap();
                assert_eq!(received.len(), 2);
                let actual: Vec<_> = received.iter().map(|p| std::fs::canonicalize(p).unwrap()).collect();
                assert_eq!(actual, vec![std::fs::canonicalize(first).unwrap(), std::fs::canonicalize(second).unwrap()]);
            }
            unsafe { OleUninitialize(); }
        }).join().unwrap();
    }
}
