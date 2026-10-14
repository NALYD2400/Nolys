//! État partagé de l'application (géré par Tauri via `app.manage`).

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::island::hit_test::HitRegion;
use crate::island::layout::Layout;
use crate::media::MediaTracker;
use crate::updater::UpdateStatus;
use crate::wallpaper::WallpaperSync;

pub struct AppState {
    pub data_dir: PathBuf,
    pub media: Mutex<MediaTracker>,
    pub wallpaper: Arc<WallpaperSync>,
    pub layout: Mutex<Layout>,
    pub hit_region: Mutex<HitRegion>,
    pub update: Mutex<UpdateStatus>,

    /// L'Island reste au premier plan (option « persistante »).
    pub persistent: AtomicBool,
    /// Masquée volontairement (raccourci clavier / icône de notification).
    pub hidden_by_user: AtomicBool,
    /// Option « Masquer en plein écran » (jeux, vidéos).
    pub hide_in_fullscreen: AtomicBool,
    /// Masquée automatiquement car une application plein écran est au premier plan.
    pub hidden_by_fullscreen: AtomicBool,
    /// Mode « déplacer l'Island » ouvert depuis les réglages.
    pub layout_edit_mode: AtomicBool,
    /// La fenêtre laisse passer les clics (aucun survol de la pilule).
    pub click_through: AtomicBool,
    /// Ignore les événements `Moved` provoqués par nos propres repositionnements.
    pub suppress_move_sync: AtomicBool,
}

impl AppState {
    pub fn new(data_dir: PathBuf, layout: Layout) -> Self {
        Self {
            wallpaper: WallpaperSync::new(data_dir.clone()),
            data_dir,
            media: Mutex::new(MediaTracker::new()),
            layout: Mutex::new(layout),
            hit_region: Mutex::new(HitRegion::default()),
            update: Mutex::new(UpdateStatus::default()),
            persistent: AtomicBool::new(true),
            hidden_by_user: AtomicBool::new(false),
            hide_in_fullscreen: AtomicBool::new(true),
            hidden_by_fullscreen: AtomicBool::new(false),
            layout_edit_mode: AtomicBool::new(false),
            click_through: AtomicBool::new(true),
            suppress_move_sync: AtomicBool::new(false),
        }
    }
}
