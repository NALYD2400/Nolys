//! Bibliothèque personnelle : références aux originaux, tags, playlists et sauvegarde atomique.
pub mod commands;
pub mod repair;

use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const CHANGED: &str = "local-library-changed";
/// Avancement d’un import (phase, fichiers lus, total).
pub const PROGRESS: &str = "local-library-import";
/// Commande média (raccourcis clavier) destinée au lecteur local de l’Island.
pub const CONTROL: &str = "local-library-media";
pub const EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus"];

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u64,
    pub cover: String,
    pub favorite: bool,
    pub added_at: u64,
    #[serde(default)]
    pub missing: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub tracks: Vec<Track>,
    pub playlists: Vec<Playlist>,
}

pub struct Store {
    root: PathBuf,
    data: Mutex<Result<Library, String>>,
    /// La lecture locale a la main : les raccourcis média lui sont envoyés.
    pub player_active: AtomicBool,
    pub importing: Mutex<bool>,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        let path = root.join("music-library.json");
        let data = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "La bibliothèque est illisible. Le fichier music-library.json a été conservé ; aucune donnée ne sera écrasée.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Library::default()),
            Err(error) => Err(format!("Impossible d’ouvrir la bibliothèque : {error}")),
        };
        Self {
            root,
            data: Mutex::new(data),
            player_active: AtomicBool::new(false),
            importing: Mutex::new(false),
        }
    }

    pub fn read(&self) -> Result<Library, String> {
        self.data.lock().as_ref().cloned().map_err(Clone::clone)
    }

    pub fn change(
        &self,
        change: impl FnOnce(&mut Library) -> Result<(), String>,
    ) -> Result<Library, String> {
        let mut stored = self.data.lock();
        let mut next = stored.as_ref().cloned().map_err(Clone::clone)?;
        change(&mut next)?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &next).map_err(|e| e.to_string())?;
        file.flush()
            .and_then(|_| file.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        file.persist(self.root.join("music-library.json"))
            .map_err(|e| format!("Sauvegarde impossible : {e}"))?;
        *stored = Ok(next.clone());
        Ok(next)
    }

    pub fn covers_dir(&self) -> PathBuf {
        self.root.join("music-covers")
    }
}

pub fn new_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

pub fn path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

pub fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| EXTENSIONS.contains(&s.to_ascii_lowercase().as_str()))
}

pub fn authorize(app: &AppHandle, mut library: Library) -> Result<Library, String> {
    for track in &mut library.tracks {
        track.missing = !Path::new(&track.path).is_file();
        if !track.missing {
            app.asset_protocol_scope()
                .allow_file(&track.path)
                .map_err(|e| e.to_string())?;
        }
        if !track.cover.is_empty() && Path::new(&track.cover).is_file() {
            app.asset_protocol_scope()
                .allow_file(&track.cover)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(library)
}

/// Les liens symboliques ne sont pas suivis : pas de boucle, ni de parcours hors du dossier choisi.
pub fn collect(paths: Vec<PathBuf>) -> (Vec<PathBuf>, usize) {
    let mut pending = paths;
    let mut files = vec![];
    let mut seen = HashSet::new();
    let mut skipped = 0;
    while let Some(path) = pending.pop() {
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            skipped += 1;
            continue;
        };
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            match fs::read_dir(&path) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => pending.push(entry.path()),
                            Err(_) => skipped += 1,
                        }
                    }
                }
                Err(_) => skipped += 1,
            }
        } else if metadata.is_file() && supported(&path) {
            match path.canonicalize() {
                Ok(path) if seen.insert(path_key(&path.to_string_lossy())) => files.push(path),
                Ok(_) => {}
                Err(_) => skipped += 1,
            }
        }
    }
    files.sort();
    (files, skipped)
}

pub fn read_track(path: &Path, covers: &Path) -> Track {
    let mut track = Track {
        id: new_id(),
        path: path.to_string_lossy().into_owned(),
        title: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        artist: "Artiste inconnu".into(),
        added_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        ..Track::default()
    };
    if let Ok(tagged) = lofty::read_from_path(path) {
        track.duration = tagged.properties().duration().as_millis() as u64;
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if let Some(title) = tag.title().filter(|s| !s.trim().is_empty()) {
                track.title = title.into_owned();
            }
            if let Some(artist) = tag.artist().filter(|s| !s.trim().is_empty()) {
                track.artist = artist.into_owned();
            }
            if let Some(album) = tag.album() {
                track.album = album.into_owned();
            }
            if let Some(picture) = tag.pictures().first() {
                // Une miniature suffit : les originaux et leurs tags ne sont jamais modifiés.
                if picture.data().len() <= 20 * 1024 * 1024 {
                    let reader = image::ImageReader::new(std::io::Cursor::new(picture.data()))
                        .with_guessed_format();
                    if let Ok(mut reader) = reader {
                        let mut limits = image::Limits::default();
                        limits.max_image_width = Some(8192);
                        limits.max_image_height = Some(8192);
                        limits.max_alloc = Some(64 * 1024 * 1024);
                        reader.limits(limits);
                        if let Ok(image) = reader.decode() {
                            let cover = covers.join(format!("{}.jpg", track.id));
                            if fs::create_dir_all(covers).is_ok()
                                && image.thumbnail(400, 400).to_rgb8().save(&cover).is_ok()
                            {
                                track.cover = cover.to_string_lossy().into_owned();
                            }
                        }
                    }
                }
            }
        }
    }
    track
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Mutation {
    CreatePlaylist {
        name: String,
    },
    RenamePlaylist {
        id: String,
        name: String,
    },
    DeletePlaylist {
        id: String,
    },
    SetPlaylistTracks {
        id: String,
        #[serde(rename = "trackIds")]
        track_ids: Vec<String>,
    },
    Favorite {
        id: String,
        value: bool,
    },
    RemoveTrack {
        id: String,
    },
    RemoveTracks {
        ids: Vec<String>,
    },
}

fn playlist_name(name: String) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Le nom doit contenir entre 1 et 80 caractères.".into());
    }
    Ok(name.to_owned())
}

pub fn mutate(library: &mut Library, mutation: Mutation) -> Result<(), String> {
    match mutation {
        Mutation::CreatePlaylist { name } => library.playlists.push(Playlist {
            id: new_id(),
            name: playlist_name(name)?,
            track_ids: vec![],
        }),
        Mutation::RenamePlaylist { id, name } => {
            let playlist = library
                .playlists
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("Playlist introuvable.")?;
            playlist.name = playlist_name(name)?;
        }
        Mutation::DeletePlaylist { id } => library.playlists.retain(|p| p.id != id),
        Mutation::SetPlaylistTracks { id, track_ids } => {
            let known: HashSet<_> = library.tracks.iter().map(|t| t.id.as_str()).collect();
            if track_ids.iter().any(|id| !known.contains(id.as_str())) {
                return Err("Un morceau n’existe plus dans la bibliothèque.".into());
            }
            let playlist = library
                .playlists
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("Playlist introuvable.")?;
            let mut seen = HashSet::new();
            playlist.track_ids = track_ids
                .into_iter()
                .filter(|id| seen.insert(id.clone()))
                .collect();
        }
        Mutation::Favorite { id, value } => {
            library
                .tracks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("Morceau introuvable.")?
                .favorite = value
        }
        Mutation::RemoveTrack { id } => {
            remove_tracks(library, HashSet::from([id]));
        }
        Mutation::RemoveTracks { ids } => {
            remove_tracks(library, ids.into_iter().collect());
        }
    }
    Ok(())
}

fn remove_tracks(library: &mut Library, ids: HashSet<String>) {
    library.tracks.retain(|track| !ids.contains(&track.id));
    for playlist in &mut library.playlists {
        playlist.track_ids.retain(|track| !ids.contains(track));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Library {
        Library {
            tracks: vec![
                Track {
                    id: "a".into(),
                    path: "original.mp3".into(),
                    ..Track::default()
                },
                Track {
                    id: "b".into(),
                    ..Track::default()
                },
            ],
            playlists: vec![Playlist {
                id: "p".into(),
                name: "Ma playlist".into(),
                track_ids: vec!["a".into(), "b".into()],
            }],
        }
    }
    #[test]
    fn removing_track_cleans_playlists_without_touching_files() {
        let mut data = fixture();
        mutate(&mut data, Mutation::RemoveTrack { id: "a".into() }).unwrap();
        assert_eq!(data.playlists[0].track_ids, ["b"]);
        assert_eq!(data.tracks.len(), 1);
    }

    #[test]
    fn batch_removal_is_one_persisted_transaction() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned());
        store
            .change(|data| {
                *data = fixture();
                Ok(())
            })
            .unwrap();
        store
            .change(|data| {
                mutate(
                    data,
                    Mutation::RemoveTracks {
                        ids: vec!["a".into(), "b".into()],
                    },
                )
            })
            .unwrap();
        let saved = Store::new(dir.path().to_owned()).read().unwrap();
        assert!(saved.tracks.is_empty());
        assert!(saved.playlists[0].track_ids.is_empty());
    }
    #[test]
    fn playlist_order_is_preserved_and_duplicates_removed() {
        let mut data = fixture();
        mutate(
            &mut data,
            Mutation::SetPlaylistTracks {
                id: "p".into(),
                track_ids: vec!["b".into(), "a".into(), "b".into()],
            },
        )
        .unwrap();
        assert_eq!(data.playlists[0].track_ids, ["b", "a"]);
        assert!(mutate(
            &mut data,
            Mutation::SetPlaylistTracks {
                id: "p".into(),
                track_ids: vec!["unknown".into()]
            }
        )
        .is_err());
    }
    #[test]
    fn save_roundtrip_and_corrupt_store_preserves_original() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned());
        store
            .change(|data| {
                *data = fixture();
                Ok(())
            })
            .unwrap();
        assert_eq!(
            Store::new(dir.path().to_owned())
                .read()
                .unwrap()
                .tracks
                .len(),
            2
        );
        fs::write(dir.path().join("music-library.json"), b"broken").unwrap();
        let corrupt = Store::new(dir.path().to_owned());
        assert!(corrupt.change(|_| Ok(())).is_err());
        assert_eq!(
            fs::read(dir.path().join("music-library.json")).unwrap(),
            b"broken"
        );
    }

    #[test]
    fn scan_is_recursive_filters_formats_and_deduplicates_paths() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("album");
        fs::create_dir(&nested).unwrap();
        let audio = nested.join("titre.MP3");
        fs::write(&audio, b"fixture").unwrap();
        fs::write(nested.join("notes.txt"), b"text").unwrap();
        let (files, skipped) = collect(vec![dir.path().to_owned(), audio]);
        assert_eq!(files.len(), 1);
        assert_eq!(skipped, 0);
    }

    #[test]
    fn wav_duration_is_read_and_original_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Mon morceau.wav");
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36_u32 + 16000).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&8000_u32.to_le_bytes());
        wav.extend_from_slice(&16000_u32.to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&16000_u32.to_le_bytes());
        wav.resize(16044, 0);
        fs::write(&path, &wav).unwrap();
        let track = read_track(&path, &dir.path().join("covers"));
        assert_eq!(track.duration, 1000);
        assert_eq!(track.title, "Mon morceau");
        assert_eq!(fs::read(&path).unwrap(), wav);
    }
}
