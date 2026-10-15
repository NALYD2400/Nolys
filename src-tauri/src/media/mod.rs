//! Suivi du média en cours de lecture.
//!
//! Reprend la logique de `get-media-info` de l'ancien `main.js` : gardes
//! anti-clignotement pendant play/pause/suivant, pochettes des navigateurs,
//! recherche de pochette de secours et synchronisation du fond d'écran.

pub mod cover_lookup;
pub mod detection;

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::platform::{process, smtc};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub cover: String,
    pub transient_cover: String,
    pub app_id: String,
    pub is_playing: bool,
    pub progress: i64,
    pub duration: i64,
    pub source: String,
    pub track_key: String,
    pub window_title: String,
}

impl MediaInfo {
    pub fn none(source: &str) -> Self {
        Self {
            title: "Aucune lecture".into(),
            artist: "Système".into(),
            cover: String::new(),
            transient_cover: String::new(),
            app_id: String::new(),
            is_playing: false,
            progress: 0,
            duration: 0,
            source: source.into(),
            track_key: String::new(),
            window_title: String::new(),
        }
    }

    fn has_media(&self) -> bool {
        !self.track_key.is_empty() && self.title != "Aucune lecture"
    }

    /// Pochette à utiliser pour le fond d'écran.
    pub fn active_cover(&self) -> &str {
        if self.cover.is_empty() { &self.transient_cover } else { &self.cover }
    }
}

/// Résultat brut d'une interrogation du lecteur.
pub struct Poll {
    pub media: Option<smtc::RawMedia>,
    pub source: &'static str,
}

/// Interroge SMTC puis, à défaut, les sessions audio (bloquant).
pub fn poll_player() -> Poll {
    match smtc::poll() {
        Some(raw) => Poll { media: Some(detection::enrich(raw)), source: "smtc" },
        None => Poll { media: detection::wasapi_fallback(), source: "wasapi" },
    }
}

struct AdvanceGuard {
    until: Option<Instant>,
    previous_cover: String,
    previous_track_key: String,
}

struct ForegroundCache {
    at: Option<Instant>,
    title: String,
    process: String,
}

pub struct MediaTracker {
    current: MediaInfo,
    advance_guard: AdvanceGuard,
    playback_guard_until: Option<Instant>,
    expected_playing: Option<bool>,
    foreground: ForegroundCache,
    last_log_signature: String,
}

pub fn track_key(title: &str, artist: &str) -> String {
    format!("{title}::{artist}").to_lowercase()
}

fn is_browser_app(app_id: &str) -> bool {
    let id = app_id.to_lowercase();
    ["chrome", "msedge", "edge", "firefox", "brave", "opera", "arc"].iter().any(|b| id.contains(b))
}

fn is_likely_browser_icon_cover(cover: &str) -> bool {
    if cover.is_empty() {
        return false;
    }
    let clean = cover.to_lowercase();
    if clean.contains("google-chrome") || clean.contains("microsoft-edge") || clean.contains("firefox") {
        return true;
    }
    clean.starts_with("data:image/") && clean.len() < 14_000
}

fn describe_cover(cover: &str) -> String {
    if cover.is_empty() {
        return "none".into();
    }
    let clean = cover.to_lowercase();
    if clean.starts_with("data:image/") {
        return format!("data:{}", cover.len());
    }
    for (needle, label) in [("google-chrome", "chrome-icon"), ("microsoft-edge", "edge-icon"), ("firefox", "firefox-icon")] {
        if clean.contains(needle) {
            return label.into();
        }
    }
    let limit = if clean.starts_with("http") { 90 } else { 40 };
    clean.chars().take(limit).collect()
}

fn active(until: Option<Instant>) -> bool {
    until.is_some_and(|t| t > Instant::now())
}

/// Ce que l'appelant doit faire après une mise à jour.
pub struct Outcome {
    pub media: MediaInfo,
    /// Pochette à passer à la synchro du fond d'écran (`Some("")` = restaurer).
    pub wallpaper_cover: Option<String>,
    /// Recherche de pochette de secours à lancer (titre, artiste, clé de piste).
    pub cover_lookup: Option<(String, String, String)>,
}

impl MediaTracker {
    pub fn new() -> Self {
        Self {
            current: MediaInfo::none(""),
            advance_guard: AdvanceGuard { until: None, previous_cover: String::new(), previous_track_key: String::new() },
            playback_guard_until: None,
            expected_playing: None,
            foreground: ForegroundCache { at: None, title: String::new(), process: String::new() },
            last_log_signature: String::new(),
        }
    }

    pub fn current(&self) -> &MediaInfo {
        &self.current
    }

    /// Note une commande utilisateur pour éviter les états intermédiaires visibles.
    pub fn note_command(&mut self, action: &str) {
        match action {
            "next" | "prev" => {
                self.advance_guard = AdvanceGuard {
                    until: Some(Instant::now() + Duration::from_millis(2500)),
                    previous_cover: self.current.active_cover().to_string(),
                    previous_track_key: track_key(&self.current.title, &self.current.artist),
                };
            }
            "play" | "pause" | "toggle" => {
                self.playback_guard_until = Some(Instant::now() + Duration::from_millis(6500));
                self.expected_playing = match action {
                    "play" => Some(true),
                    "pause" => Some(false),
                    _ => Some(!self.current.is_playing),
                };
            }
            _ => {}
        }
    }

    fn foreground_window(&mut self) -> (String, String) {
        if self.foreground.at.is_some_and(|at| at.elapsed() < Duration::from_millis(1200)) {
            return (self.foreground.title.clone(), self.foreground.process.clone());
        }
        let (title, process) = process::foreground_window().map(|f| (f.title, f.name)).unwrap_or_default();
        self.foreground = ForegroundCache { at: Some(Instant::now()), title: title.clone(), process: process.clone() };
        (title, process)
    }

    /// Applique le résultat d'une interrogation du lecteur.
    pub fn apply(&mut self, poll: Poll) -> Outcome {
        let Some(mut data) = poll.media else { return self.apply_no_media(poll.source) };

        let title = data.title.clone();
        let artist = data.artist.clone();
        let key = track_key(&title, &artist);
        let mut cover = std::mem::take(&mut data.cover);
        let mut transient_cover = String::new();
        let mut window_title = String::new();
        let browser_media = is_browser_app(&data.app_id);
        let browser_icon_cover = browser_media && is_likely_browser_icon_cover(&cover);
        let weak_wasapi = poll.source == "wasapi" && data.duration <= 0;
        let has_real_current = self.current.has_media() && self.current.duration > 0;
        let playback_guard = active(self.playback_guard_until);

        if weak_wasapi && has_real_current && playback_guard {
            let mut media = self.current.clone();
            media.is_playing = self.expected_playing.unwrap_or(media.is_playing);
            if media.source.is_empty() {
                media.source = "smtc".into();
            }
            return Outcome { media, wallpaper_cover: None, cover_lookup: None };
        }

        if has_real_current && playback_guard && data.duration <= 0 {
            data.duration = self.current.duration;
            data.progress = self.current.progress;
        }

        if browser_media && (cover.is_empty() || browser_icon_cover) {
            let (fg_title, fg_process) = self.foreground_window();
            let fg_process = fg_process.to_lowercase();
            if fg_process.is_empty() || is_browser_app(&fg_process) {
                window_title = fg_title;
            }
        }

        // Évite le clignotement de l'icône d'appli pendant les transitions SMTC -> WASAPI.
        if poll.source == "wasapi" && !self.current.cover.is_empty() {
            let new_app = data.app_id.to_lowercase().replace(".exe", "");
            let old_app = self.current.app_id.to_lowercase().replace(".exe", "");
            let spotify = new_app.contains("spotify") && old_app.contains("spotify");
            let same_app = spotify || new_app == old_app || new_app.contains(&old_app) || old_app.contains(&new_app);
            let (t, ct) = (title.to_lowercase(), self.current.title.to_lowercase());
            if same_app || t.contains(&ct) || ct.contains(&t) {
                cover = self.current.cover.clone();
            }
        }

        if browser_icon_cover {
            if !self.current.active_cover().is_empty() {
                transient_cover = self.current.active_cover().to_string();
            }
            cover.clear();
        }

        let guard = &self.advance_guard;
        if active(guard.until)
            && key != guard.previous_track_key
            && !guard.previous_cover.is_empty()
            && (cover.is_empty() || cover == guard.previous_cover)
        {
            transient_cover = guard.previous_cover.clone();
            cover.clear();
        }

        let mut cover_lookup = None;
        if cover.is_empty() && title != "Sans titre" && artist != "Artiste inconnu" {
            match cover_lookup::cached(&cover_lookup::cache_key(&title, &artist)) {
                Some(hit) => {
                    // La recherche est terminée : l'ancienne pochette ne doit plus rester,
                    // même si rien n'a été trouvé (sinon celle du morceau précédent reste).
                    transient_cover.clear();
                    cover = hit;
                }
                None => cover_lookup = Some((title.clone(), artist.clone(), key.clone())),
            }
        }

        self.current = MediaInfo {
            transient_cover: if cover.is_empty() { transient_cover } else { String::new() },
            cover,
            title,
            artist,
            app_id: data.app_id,
            is_playing: data.is_playing,
            progress: data.progress,
            duration: data.duration,
            source: poll.source.into(),
            track_key: key,
            window_title,
        };
        self.log_snapshot();

        Outcome {
            media: self.current.clone(),
            wallpaper_cover: Some(self.current.active_cover().to_string()),
            cover_lookup,
        }
    }

    fn apply_no_media(&mut self, source: &str) -> Outcome {
        if self.current.has_media() && (active(self.advance_guard.until) || active(self.playback_guard_until)) {
            let mut media = self.current.clone();
            if media.transient_cover.is_empty() {
                media.transient_cover = media.cover.clone();
            }
            if media.source.is_empty() {
                media.source = source.into();
            }
            return Outcome { media, wallpaper_cover: None, cover_lookup: None };
        }
        self.current = MediaInfo::none(source);
        Outcome { media: self.current.clone(), wallpaper_cover: Some(String::new()), cover_lookup: None }
    }

    /// Une pochette de secours est arrivée : on l'applique si la piste n'a pas changé.
    pub fn apply_found_cover(&mut self, requested_key: &str, cover: String) -> bool {
        if cover.is_empty() || track_key(&self.current.title, &self.current.artist) != requested_key {
            return false;
        }
        self.current.cover = cover;
        self.current.transient_cover.clear();
        true
    }

    fn log_snapshot(&mut self) {
        let m = &self.current;
        let signature = [
            m.title.as_str(),
            &m.artist,
            &m.app_id,
            &m.source,
            &describe_cover(&m.cover),
            &describe_cover(&m.transient_cover),
            &m.window_title,
        ]
        .join("|");
        if signature == self.last_log_signature {
            return;
        }
        self.last_log_signature = signature;
        crate::logger::log(&format!(
            "[Media] source={} app={} title=\"{}\" artist=\"{}\" cover={} transient={} window=\"{}\"",
            m.source,
            if m.app_id.is_empty() { "n/a" } else { &m.app_id },
            m.title,
            m.artist,
            describe_cover(&m.cover),
            describe_cover(&m.transient_cover),
            m.window_title
        ));
    }
}
