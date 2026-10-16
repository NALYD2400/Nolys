//! Dossier de musique déplacé : retrouver les titres au lieu de les dupliquer.
//!
//! Un titre devenu introuvable garde son identité (playlists, favori, date d'ajout) :
//! - à l'import, le même fichier rencontré ailleurs prend sa place au lieu d'être ajouté ;
//! - un doublon déjà créé par un ancien import est fusionné dans l'original ;
//! - « Retrouver le fichier » sur un titre repère le déplacement de son dossier et
//!   retrouve d'un coup les autres titres de ce dossier.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::{Library, Track};

/// Écart toléré entre deux durées lues pour un même fichier (millisecondes).
const DURATION_TOLERANCE_MS: u64 = 1500;

fn file_name(path: &str) -> String {
    Path::new(path.trim_start_matches(r"\\?\"))
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn parent_name(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Même fichier audio rangé ailleurs : même nom de fichier et même durée.
fn same_audio(a: &Track, b: &Track) -> bool {
    file_name(&a.path) == file_name(&b.path)
        && (a.duration == 0 || b.duration == 0 || a.duration.abs_diff(b.duration) <= DURATION_TOLERANCE_MS)
}

/// L'original prend le chemin et les informations du fichier retrouvé, garde son identité.
fn adopt(original: &mut Track, found: &Track) {
    *original = Track {
        id: original.id.clone(),
        favorite: original.favorite || found.favorite,
        added_at: original.added_at.min(found.added_at),
        missing: false,
        ..found.clone()
    };
}

/// Remplace des identifiants dans les playlists (sans doublon, ordre conservé).
fn remap_playlists(library: &mut Library, renamed: &HashMap<String, String>) {
    for playlist in &mut library.playlists {
        let mut seen = HashSet::new();
        playlist.track_ids = playlist
            .track_ids
            .iter()
            .map(|id| renamed.get(id).cloned().unwrap_or_else(|| id.clone()))
            .filter(|id| seen.insert(id.clone()))
            .collect();
    }
}

/// Fusionne chaque titre introuvable avec un titre présent qui est le même fichier déplacé.
/// `exists` dit si un chemin est accessible. Renvoie le nombre de titres retrouvés.
pub fn merge_moved(library: &mut Library, exists: impl Fn(&str) -> bool) -> usize {
    let present: Vec<bool> = library.tracks.iter().map(|t| exists(&t.path)).collect();
    let mut taken = HashSet::new();
    let mut pairs = Vec::new();
    for (original, track) in library.tracks.iter().enumerate() {
        if present[original] {
            continue;
        }
        let candidates: Vec<usize> = library
            .tracks
            .iter()
            .enumerate()
            .filter(|(index, other)| present[*index] && !taken.contains(index) && same_audio(track, other))
            .map(|(index, _)| index)
            .collect();
        // Plusieurs copies : on préfère celle dont le dossier porte le même nom.
        let chosen = candidates
            .iter()
            .copied()
            .find(|&index| parent_name(&library.tracks[index].path) == parent_name(&track.path))
            .or_else(|| candidates.first().copied());
        if let Some(found) = chosen {
            taken.insert(found);
            pairs.push((original, found));
        }
    }
    if pairs.is_empty() {
        return 0;
    }
    let mut renamed = HashMap::new();
    for &(original, found) in &pairs {
        let copy = library.tracks[found].clone();
        renamed.insert(copy.id.clone(), library.tracks[original].id.clone());
        adopt(&mut library.tracks[original], &copy);
    }
    let removed: HashSet<usize> = pairs.iter().map(|&(_, found)| found).collect();
    let mut index = 0;
    library.tracks.retain(|_| {
        let keep = !removed.contains(&index);
        index += 1;
        keep
    });
    remap_playlists(library, &renamed);
    pairs.len()
}

/// Ancien et nouvel emplacement du dossier déplacé, déduits d'un fichier retrouvé à la main :
/// on retire la fin de chemin commune (« Album\titre.mp3 »).
pub fn moved_folder(old: &str, new: &str) -> Option<(PathBuf, PathBuf)> {
    let old: Vec<_> = Path::new(old.trim_start_matches(r"\\?\")).components().collect();
    let new_path = Path::new(new);
    let new: Vec<_> = new_path.components().collect();
    let mut common = 0;
    while common < old.len().min(new.len())
        && old[old.len() - 1 - common].as_os_str().to_string_lossy().to_lowercase()
            == new[new.len() - 1 - common].as_os_str().to_string_lossy().to_lowercase()
    {
        common += 1;
    }
    // Sans même nom de fichier, seul le dossier parent est supposé déplacé.
    let common = common.max(1);
    if common >= old.len() || common >= new.len() {
        return None;
    }
    let old_root: PathBuf = old[..old.len() - common].iter().collect();
    let new_root: PathBuf = new[..new.len() - common].iter().collect();
    (old_root != new_root).then_some((old_root, new_root))
}

/// Chemin qu'aurait un titre si son dossier avait suivi le même déplacement.
pub fn follow_move(path: &str, old_root: &Path, new_root: &Path) -> Option<PathBuf> {
    let path = Path::new(path.trim_start_matches(r"\\?\"));
    let rest = path.strip_prefix(old_root).ok()?;
    Some(new_root.join(rest))
}

/// « Retrouver le fichier » : le titre `id` prend `path`, puis les autres titres introuvables
/// de l'ancien dossier sont cherchés au même endroit. Un fichier déjà présent en double est
/// fusionné dans l'original. Renvoie le nombre d'autres titres retrouvés.
pub fn relink(
    library: &mut Library,
    id: &str,
    path: &Path,
    exists: impl Fn(&str) -> bool,
    read: impl Fn(&Path) -> Track,
) -> Result<usize, String> {
    let old_path = library.tracks.iter().find(|t| t.id == id).ok_or("Morceau introuvable.")?.path.clone();
    let mut targets = vec![(id.to_string(), path.to_path_buf())];
    if let Some((old_root, new_root)) = moved_folder(&old_path, &path.to_string_lossy()) {
        for track in &library.tracks {
            if track.id == id || exists(&track.path) {
                continue;
            }
            if let Some(candidate) = follow_move(&track.path, &old_root, &new_root) {
                if super::supported(&candidate) && exists(&candidate.to_string_lossy()) {
                    targets.push((track.id.clone(), candidate));
                }
            }
        }
    }
    let mut renamed = HashMap::new();
    let mut removed = HashSet::new();
    for (target, file) in &targets {
        let key = super::path_key(&file.to_string_lossy());
        let duplicate = library.tracks.iter().find(|t| &t.id != target && super::path_key(&t.path) == key).cloned();
        let replacement = match duplicate {
            Some(copy) => {
                removed.insert(copy.id.clone());
                renamed.insert(copy.id.clone(), target.clone());
                copy
            }
            None => read(file),
        };
        if let Some(original) = library.tracks.iter_mut().find(|t| &t.id == target) {
            adopt(original, &replacement);
        }
    }
    library.tracks.retain(|t| !removed.contains(&t.id));
    remap_playlists(library, &renamed);
    Ok(targets.len() - 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Playlist;

    fn track(id: &str, path: &str, duration: u64) -> Track {
        Track { id: id.into(), path: path.into(), title: id.into(), duration, added_at: 10, ..Track::default() }
    }

    #[test]
    fn moved_then_reimported_tracks_are_merged_into_originals() {
        let mut library = Library {
            tracks: vec![
                Track { favorite: true, ..track("old-a", r"\\?\C:\Bureau\Playlist\a.mp3", 120_000) },
                track("old-b", r"\\?\C:\Bureau\Playlist\b.mp3", 90_000),
                track("new-a", r"\\?\D:\Musique\Playlist\a.mp3", 120_400),
                track("new-b", r"\\?\D:\Musique\Playlist\b.mp3", 90_000),
                track("other", r"\\?\D:\Musique\c.mp3", 60_000),
            ],
            playlists: vec![Playlist { id: "p".into(), name: "P".into(), track_ids: vec!["old-a".into(), "new-b".into(), "old-b".into()] }],
        };
        let merged = merge_moved(&mut library, |path| path.starts_with(r"\\?\D:"));
        assert_eq!(merged, 2);
        let ids: Vec<_> = library.tracks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["old-a", "old-b", "other"]);
        assert_eq!(library.tracks[0].path, r"\\?\D:\Musique\Playlist\a.mp3");
        assert!(library.tracks[0].favorite);
        assert_eq!(library.playlists[0].track_ids, ["old-a", "old-b"]);
    }

    #[test]
    fn different_duration_or_name_is_not_the_same_file() {
        let mut library = Library {
            tracks: vec![track("old", r"C:\A\a.mp3", 120_000), track("new", r"D:\A\a.mp3", 200_000), track("x", r"D:\A\b.mp3", 120_000)],
            playlists: vec![],
        };
        assert_eq!(merge_moved(&mut library, |path| path.starts_with("D:")), 0);
        assert_eq!(library.tracks.len(), 3);
    }

    #[test]
    fn relinking_one_file_finds_its_folder_and_merges_duplicates() {
        let mut library = Library {
            tracks: vec![
                track("a", r"C:\Bureau\Playlist\a.mp3", 1),
                track("b", r"C:\Bureau\Playlist\b.mp3", 1),
                track("dup-b", r"D:\Musique\Playlist\b.mp3", 1),
                track("far", r"C:\Autre\c.mp3", 1),
            ],
            playlists: vec![Playlist { id: "p".into(), name: "P".into(), track_ids: vec!["dup-b".into(), "a".into()] }],
        };
        let exists = |path: &str| path.starts_with("D:");
        let found = relink(&mut library, "a", Path::new(r"D:\Musique\Playlist\a.mp3"), exists, |path| track("lu", &path.to_string_lossy(), 1)).unwrap();
        assert_eq!(found, 1);
        let ids: Vec<_> = library.tracks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["a", "b", "far"]);
        assert_eq!(library.tracks[0].path, r"D:\Musique\Playlist\a.mp3");
        assert_eq!(library.tracks[1].path, r"D:\Musique\Playlist\b.mp3");
        assert_eq!(library.tracks[2].path, r"C:\Autre\c.mp3");
        assert_eq!(library.playlists[0].track_ids, ["b", "a"]);
    }

    #[test]
    fn folder_move_is_deduced_from_one_file() {
        let (old, new) = moved_folder(r"\\?\C:\Users\d\Desktop\Playlist\Album\a.mp3", r"\\?\D:\Musique\Playlist\Album\a.mp3").unwrap();
        assert_eq!(old, PathBuf::from(r"C:\Users\d\Desktop"));
        assert_eq!(new, PathBuf::from(r"\\?\D:\Musique"));
        assert_eq!(follow_move(r"\\?\C:\Users\d\Desktop\Playlist\b.mp3", &old, &new), Some(PathBuf::from(r"\\?\D:\Musique\Playlist\b.mp3")));
        assert_eq!(follow_move(r"C:\Ailleurs\c.mp3", &old, &new), None);
    }
}
