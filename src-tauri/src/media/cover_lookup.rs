//! Recherche de pochette de secours (Deezer puis iTunes) quand le lecteur n'en fournit pas.

use std::collections::{HashMap, VecDeque};

use parking_lot::Mutex;

use crate::platform::http;

const CACHE_LIMIT: usize = 200;

struct Cache {
    entries: HashMap<String, String>,
    order: VecDeque<String>,
    last_searched: String,
}

static CACHE: std::sync::LazyLock<Mutex<Cache>> = std::sync::LazyLock::new(|| {
    Mutex::new(Cache { entries: HashMap::new(), order: VecDeque::new(), last_searched: String::new() })
});

pub fn cache_key(title: &str, artist: &str) -> String {
    format!("{artist} - {title}").to_lowercase()
}

/// `Some(url)` si la pochette est déjà connue (une chaîne vide = « recherchée, rien trouvé »).
pub fn cached(key: &str) -> Option<String> {
    CACHE.lock().entries.get(key).cloned()
}

fn remember(key: &str, value: &str) {
    let mut cache = CACHE.lock();
    if !cache.entries.contains_key(key) {
        if cache.entries.len() >= CACHE_LIMIT {
            if let Some(oldest) = cache.order.pop_front() {
                cache.entries.remove(&oldest);
            }
        }
        cache.order.push_back(key.to_string());
    }
    cache.entries.insert(key.to_string(), value.to_string());
}

fn encode_query(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Recherche bloquante (à appeler hors du thread principal).
pub fn fetch(title: &str, artist: &str) -> String {
    let key = cache_key(title, artist);
    if let Some(hit) = cached(&key) {
        return hit;
    }
    {
        let mut cache = CACHE.lock();
        if cache.last_searched == key {
            return String::new(); // évite les recherches en double
        }
        cache.last_searched = key.clone();
    }

    let query = encode_query(&format!("{artist} {title}"));

    if let Some(json) = http::get_json(&format!("https://api.deezer.com/search?q={query}&limit=1")) {
        let album = &json["data"][0]["album"];
        if let Some(url) = album["cover_xl"].as_str().or_else(|| album["cover_big"].as_str()).filter(|u| !u.is_empty()) {
            remember(&key, url);
            crate::logger::log("[Cover Fallback] Found cover on Deezer");
            return url.into();
        }
    }

    if let Some(json) = http::get_json(&format!("https://itunes.apple.com/search?term={query}&limit=1&media=music")) {
        let result = &json["results"][0];
        if let Some(url) = result["artworkUrl100"].as_str().or_else(|| result["artworkUrl60"].as_str()) {
            let high_res = url.replace("100x100bb", "3000x3000bb").replace("60x60bb", "3000x3000bb");
            remember(&key, &high_res);
            crate::logger::log("[Cover Fallback] Found cover on iTunes");
            return high_res;
        }
    }

    remember(&key, "");
    String::new()
}
