fn main() {
    // Share the default Common Controls v6 manifest with every executable,
    // including library tests using rfd. Tauri still owns the icon/version RC.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("Tauri build failed");
    println!("cargo:rerun-if-changed=common-controls.rc");
    println!("cargo:rerun-if-changed=common-controls.manifest");
    embed_resource::compile_for_everything("common-controls.rc", embed_resource::NONE)
        .manifest_required()
        .expect("Common Controls manifest could not be compiled");
}
