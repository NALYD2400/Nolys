//! Contrôles média système (SMTC : `GlobalSystemMediaTransportControlsSessionManager`).

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use parking_lot::Mutex;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::DataReader;

use super::com;

/// Réponse brute du lecteur, identique au format du cœur C# d'origine.
#[derive(Debug, Clone, Default)]
pub struct RawMedia {
    pub title: String,
    pub artist: String,
    pub cover: String,
    pub app_id: String,
    pub is_playing: bool,
    pub progress: i64,
    pub duration: i64,
}

struct ManagerState {
    manager: Option<SessionManager>,
    last_attempt: Option<Instant>,
    failures: u32,
    last_error: String,
}

struct CoverCache {
    title: String,
    artist: String,
    cover: String,
}

static MANAGER: Mutex<ManagerState> =
    Mutex::new(ManagerState { manager: None, last_attempt: None, failures: 0, last_error: String::new() });
static COVER: Mutex<CoverCache> = Mutex::new(CoverCache { title: String::new(), artist: String::new(), cover: String::new() });

/// Récupère (ou crée) le gestionnaire SMTC ; nouvelle tentative au plus toutes les 5 s.
fn manager(force_retry: bool) -> Option<SessionManager> {
    com::ensure_mta();
    let mut state = MANAGER.lock();
    if let Some(manager) = &state.manager {
        return Some(manager.clone());
    }
    if !force_retry && state.last_attempt.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
        return None;
    }
    state.last_attempt = Some(Instant::now());
    match SessionManager::RequestAsync().and_then(|op| op.join()) {
        Ok(manager) => {
            state.last_error.clear();
            state.manager = Some(manager.clone());
            Some(manager)
        }
        Err(error) => {
            state.failures += 1;
            state.last_error = error.message().to_string();
            crate::logger::log(&format!("[Core stderr] Failed to initialize SMTC: {}", state.last_error));
            None
        }
    }
}

pub fn init() {
    let _ = manager(true);
}

type Notify = Arc<dyn Fn() + Send + Sync>;

/// Abonnements aux sessions ouvertes : refaits à chaque changement de la liste.
static SESSION_WATCHES: Mutex<Vec<(Session, i64, i64)>> = Mutex::new(Vec::new());

/// Prévient `notify` dès qu'un lecteur change de morceau, de pochette ou d'état (lecture,
/// pause), ou qu'une session apparaît ou disparaît. L'Island relit alors l'état tout de suite
/// au lieu de l'interroger sans cesse. Les rappels arrivent sur un fil du système.
pub fn watch(notify: impl Fn() + Send + Sync + 'static) {
    let Some(manager) = manager(true) else { return };
    let notify: Notify = Arc::new(notify);
    let on_current = notify.clone();
    let _ = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        on_current();
        Ok(())
    }));
    let on_sessions = notify.clone();
    let _ = manager.SessionsChanged(&TypedEventHandler::new(move |sender: windows::core::Ref<SessionManager>, _| {
        if let Some(manager) = sender.as_ref() {
            watch_sessions(manager, &on_sessions);
        }
        on_sessions();
        Ok(())
    }));
    watch_sessions(&manager, &notify);
}

fn watch_sessions(manager: &SessionManager, notify: &Notify) {
    let mut watches = SESSION_WATCHES.lock();
    for (session, media, playback) in watches.drain(..) {
        let _ = session.RemoveMediaPropertiesChanged(media);
        let _ = session.RemovePlaybackInfoChanged(playback);
    }
    for session in manager.GetSessions().map(|list| list.into_iter().collect::<Vec<_>>()).unwrap_or_default() {
        let on_media = notify.clone();
        let on_playback = notify.clone();
        let media = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
            on_media();
            Ok(())
        }));
        let playback = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
            on_playback();
            Ok(())
        }));
        if let (Ok(media), Ok(playback)) = (media, playback) {
            watches.push((session, media, playback));
        }
    }
}

pub fn diagnostics() -> (bool, u32, String) {
    let state = MANAGER.lock();
    (state.manager.is_some(), state.failures, state.last_error.clone())
}

fn is_playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == PlaybackStatus::Playing)
        .unwrap_or(false)
}

/// Session courante ; à défaut, la première session en lecture, sinon la première tout court.
fn pick_session(manager: &SessionManager) -> Option<Session> {
    let current = manager.GetCurrentSession().ok();
    if current.as_ref().is_some_and(is_playing) {
        return current;
    }
    let sessions: Vec<Session> = manager.GetSessions().map(|list| list.into_iter().collect()).unwrap_or_default();
    sessions.iter().find(|s| is_playing(s)).cloned().or(current).or_else(|| sessions.into_iter().next())
}

fn read_thumbnail(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> String {
    let read = || -> windows::core::Result<String> {
        let stream = props.Thumbnail()?.OpenReadAsync()?.join()?;
        let size = stream.Size()? as u32;
        if size == 0 {
            return Ok(String::new());
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    };
    read().unwrap_or_default()
}

/// Interroge le lecteur actif. `None` = pas de session SMTC exploitable.
pub fn poll() -> Option<RawMedia> {
    let manager = manager(false)?;
    let session = pick_session(&manager)?;

    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok();
    let playback = session.GetPlaybackInfo().ok();
    let timeline = session.GetTimelineProperties().ok();
    let playing = playback.as_ref().and_then(|p| p.PlaybackStatus().ok()) == Some(PlaybackStatus::Playing);

    let title = props.as_ref().and_then(|p| p.Title().ok()).map(|s| s.to_string_lossy()).unwrap_or_else(|| "Sans titre".into());
    let artist = props.as_ref().and_then(|p| p.Artist().ok()).map(|s| s.to_string_lossy()).unwrap_or_else(|| "Artiste inconnu".into());
    let app_id = session.SourceAppUserModelId().map(|s| s.to_string_lossy()).unwrap_or_default();

    // La pochette n'est relue que lorsque le morceau change.
    let mut cover = String::new();
    if let Some(props) = &props {
        let mut cache = COVER.lock();
        if cache.title == title && cache.artist == artist {
            cover = cache.cover.clone();
        } else {
            cover = read_thumbnail(props);
            *cache = CoverCache { title: title.clone(), artist: artist.clone(), cover: cover.clone() };
        }
    }

    // Les durées SMTC sont en unités de 100 ns ; LastUpdatedTime est un DateTime UWP.
    let (mut progress, mut duration) = (0f64, 0f64);
    if let Some(timeline) = &timeline {
        let position = timeline.Position().map(|t| t.Duration as f64 / 10_000.0).unwrap_or(0.0);
        duration = timeline.EndTime().map(|t| t.Duration as f64 / 10_000.0).unwrap_or(0.0);
        progress = position;
        if playing {
            if let (Ok(updated), Some(playback)) = (timeline.LastUpdatedTime(), &playback) {
                let elapsed = now_universal_ms() - updated.UniversalTime as f64 / 10_000.0;
                let rate = playback.PlaybackRate().and_then(|r| r.Value()).unwrap_or(1.0);
                if elapsed > 0.0 {
                    progress = position + elapsed * rate;
                }
            }
        }
    }
    progress = progress.min(duration).max(0.0);

    Some(RawMedia {
        title: if title.is_empty() { "Sans titre".into() } else { title },
        artist: if artist.is_empty() { "Artiste inconnu".into() } else { artist },
        cover,
        app_id,
        is_playing: playing,
        progress: progress as i64,
        duration: duration as i64,
    })
}

/// Millisecondes depuis l'époque Windows (1601-01-01), comme `DateTime.UniversalTime`.
fn now_universal_ms() -> f64 {
    const EPOCH_DIFF_MS: f64 = 11_644_473_600_000.0;
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0) + EPOCH_DIFF_MS
}

#[derive(Debug, Clone, Copy)]
pub enum Command {
    Toggle,
    Play,
    Pause,
    Next,
    Prev,
    Seek(i64),
}

pub fn send(command: Command) -> bool {
    let Some(manager) = manager(false) else { return false };
    let Ok(session) = manager.GetCurrentSession() else { return false };
    let result = match command {
        Command::Toggle => session.TryTogglePlayPauseAsync(),
        Command::Play => session.TryPlayAsync(),
        Command::Pause => session.TryPauseAsync(),
        Command::Next => session.TrySkipNextAsync(),
        Command::Prev => session.TrySkipPreviousAsync(),
        Command::Seek(ms) => session.TryChangePlaybackPositionAsync(ms * 10_000),
    };
    result.and_then(|op| op.join()).unwrap_or(false)
}
