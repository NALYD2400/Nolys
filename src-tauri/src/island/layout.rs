//! Position, échelle et écran cible de l'Island (`liquid-island-layout.json`).
//!
//! Les coordonnées sont en pixels logiques de l'écran cible, comme les DIP
//! d'Electron : une configuration existante reste donc valable.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Monitor};

/// Taille de base de la fenêtre transparente (avant mise à l'échelle). 720 de large : les
/// Réglages (680 px) y tiennent avec la place du halo. La fenêtre laisse passer les clics hors
/// de la pilule (hit_test), sa largeur ne gêne donc pas le bureau.
pub const BASE_WIDTH: f64 = 720.0;
pub const BASE_HEIGHT: f64 = 600.0;
/// Largeur des versions précédentes : leurs positions enregistrées sont celles d'une fenêtre
/// de 620 px (voir `adapt_to_width`).
const LEGACY_WIDTH: f64 = 620.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub display_id: String,
}

/// Configuration partielle reçue de l'UI (tous les champs sont optionnels).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPatch {
    pub x: Option<serde_json::Value>,
    pub y: Option<serde_json::Value>,
    pub scale: Option<serde_json::Value>,
    pub display_id: Option<serde_json::Value>,
}

fn number(value: &Option<serde_json::Value>) -> Option<f64> {
    let value = value.as_ref()?;
    value.as_f64().or_else(|| value.as_str()?.trim().parse().ok()).filter(|n: &f64| n.is_finite())
}

fn text(value: &Option<serde_json::Value>) -> Option<String> {
    match value.as_ref()? {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn clamp_scale(scale: f64) -> f64 {
    if scale.is_finite() { scale.clamp(0.65, 1.5) } else { 1.0 }
}

/// Zone de travail d'un écran, en pixels logiques.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn monitor_id(monitor: &Monitor) -> String {
    monitor.name().cloned().unwrap_or_else(|| "primary".into())
}

pub fn work_area(monitor: &Monitor) -> WorkArea {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    WorkArea {
        x: area.position.x as f64 / scale,
        y: area.position.y as f64 / scale,
        width: area.size.width as f64 / scale,
        height: area.size.height as f64 / scale,
    }
}

/// Écran ciblé par la configuration, sinon l'écran principal.
pub fn target_monitor(app: &AppHandle, display_id: &str) -> Option<Monitor> {
    if display_id != "primary" {
        if let Ok(monitors) = app.available_monitors() {
            if let Some(found) = monitors.into_iter().find(|m| monitor_id(m) == display_id) {
                return Some(found);
            }
        }
    }
    app.primary_monitor().ok().flatten()
}

fn fallback_area() -> WorkArea {
    WorkArea { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 }
}

/// Centré en haut de l'écran principal.
pub fn default_layout(app: &AppHandle) -> Layout {
    let monitor = app.primary_monitor().ok().flatten();
    let area = monitor.as_ref().map(work_area).unwrap_or_else(fallback_area);
    Layout {
        x: (area.x + (area.width - BASE_WIDTH) / 2.0).round(),
        y: area.y - 30.0,
        scale: 1.0,
        display_id: monitor.as_ref().map(monitor_id).unwrap_or_else(|| "primary".into()),
    }
}

pub fn centered_on(app: &AppHandle, layout: &Layout) -> Layout {
    let area = target_monitor(app, &layout.display_id).as_ref().map(work_area).unwrap_or_else(fallback_area);
    let width = (BASE_WIDTH * layout.scale).round();
    Layout { x: (area.x + (area.width - width) / 2.0).round(), y: area.y - 30.0, ..layout.clone() }
}

/// Fusionne un patch dans une configuration existante.
pub fn merge(base: &Layout, patch: &LayoutPatch) -> Layout {
    Layout {
        x: number(&patch.x).unwrap_or(base.x),
        y: number(&patch.y).unwrap_or(base.y),
        scale: number(&patch.scale).map(clamp_scale).unwrap_or(base.scale),
        display_id: text(&patch.display_id).unwrap_or_else(|| base.display_id.clone()),
    }
}

/// Garde la fenêtre dans la zone de travail de son écran (40 px de marge en haut).
/// Décalage du haut de la pilule dans la fenêtre, en pixels CSS (`top: 50px` de l'interface).
const PILL_TOP_OFFSET: f64 = 50.0;
/// Demi-largeur visible minimale de la pilule repliée (120 px) et hauteur qui doit rester à l'écran.
const PILL_MIN_VISIBLE_WIDTH: f64 = 60.0;
const PILL_MIN_VISIBLE_HEIGHT: f64 = 40.0;

pub fn clamp(app: &AppHandle, layout: &Layout) -> Layout {
    let monitor = target_monitor(app, &layout.display_id);
    let area = monitor.as_ref().map(work_area).unwrap_or_else(fallback_area);
    let scale = clamp_scale(layout.scale);
    let w = (BASE_WIDTH * scale).round();
    // Les limites suivent la pilule, pas la fenêtre (qui grandit avec la taille) :
    // la pilule peut aller jusqu'au bord de l'écran, quelle que soit la taille choisie.
    // La fenêtre reste transparente, elle peut donc dépasser de l'écran.
    let centre_min_x = area.x + PILL_MIN_VISIBLE_WIDTH * scale;
    let centre_max_x = area.x + area.width - PILL_MIN_VISIBLE_WIDTH * scale;
    let min_x = centre_min_x - w / 2.0;
    let max_x = (centre_max_x - w / 2.0).max(min_x);
    // Le haut de la pilule peut toucher le bord supérieur ; il reste une bande visible en bas.
    let min_y = area.y - PILL_TOP_OFFSET * scale;
    let max_y = (area.y + area.height - (PILL_TOP_OFFSET + PILL_MIN_VISIBLE_HEIGHT) * scale).max(min_y);
    Layout {
        x: layout.x.clamp(min_x, max_x),
        y: layout.y.clamp(min_y, max_y),
        scale,
        // Un identifiant inconnu (écran débranché, ancienne config) retombe sur l'écran réel.
        display_id: monitor.as_ref().map(monitor_id).unwrap_or_else(|| layout.display_id.clone()),
    }
}

pub fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("liquid-island-layout.json")
}

/// La position enregistrée est le coin de la fenêtre. Si la fenêtre a changé de largeur depuis,
/// on la décale de la moitié de la différence : la pilule (centrée dans la fenêtre) reste au
/// même endroit de l'écran.
pub fn adapt_to_width(layout: Layout, saved_width: f64) -> Layout {
    if !saved_width.is_finite() || saved_width <= 0.0 || saved_width == BASE_WIDTH {
        return layout;
    }
    let shift = (BASE_WIDTH - saved_width) * clamp_scale(layout.scale) / 2.0;
    Layout { x: (layout.x - shift).round(), ..layout }
}

pub fn load(app: &AppHandle, data_dir: &Path) -> Layout {
    let saved = std::fs::read_to_string(config_path(data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            // Fichier sans `windowWidth` : écrit par une version à fenêtre de 620 px. Sans `x`,
            // la position par défaut (déjà à la bonne largeur) est gardée telle quelle.
            let width = match value.get("x") {
                Some(_) => value.get("windowWidth").and_then(serde_json::Value::as_f64).unwrap_or(LEGACY_WIDTH),
                None => BASE_WIDTH,
            };
            let patch = serde_json::from_value::<LayoutPatch>(value).ok()?;
            Some(adapt_to_width(merge(&default_layout(app), &patch), width))
        });
    clamp(app, &saved.unwrap_or_else(|| default_layout(app)))
}

/// Ce qui est écrit sur le disque : la position et la largeur de fenêtre qui lui correspond.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedLayout<'a> {
    #[serde(flatten)]
    layout: &'a Layout,
    window_width: f64,
}

pub fn save(data_dir: &Path, layout: &Layout) {
    if let Ok(json) = serde_json::to_string_pretty(&SavedLayout { layout, window_width: BASE_WIDTH }) {
        if let Err(error) = std::fs::write(config_path(data_dir), json) {
            crate::logger::log(&format!("[Layout] Failed to save layout: {error}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, scale: f64) -> Layout {
        Layout { x, y: 10.0, scale, display_id: "primary".into() }
    }

    #[test]
    fn la_pilule_reste_au_meme_endroit_quand_la_fenetre_s_elargit() {
        // Ancienne fenêtre de 620 px à x = 650 : pilule centrée à 960.
        let moved = adapt_to_width(at(650.0, 1.0), LEGACY_WIDTH);
        assert_eq!(moved.x + BASE_WIDTH / 2.0, 650.0 + LEGACY_WIDTH / 2.0);
        // À 150 %, la fenêtre (et le décalage) grandit d'autant.
        let scaled = adapt_to_width(at(500.0, 1.5), LEGACY_WIDTH);
        assert_eq!(scaled.x + BASE_WIDTH * 1.5 / 2.0, 500.0 + LEGACY_WIDTH * 1.5 / 2.0);
    }

    #[test]
    fn une_position_deja_a_la_bonne_largeur_ne_bouge_pas() {
        assert_eq!(adapt_to_width(at(650.0, 1.0), BASE_WIDTH), at(650.0, 1.0));
        assert_eq!(adapt_to_width(at(650.0, 1.0), f64::NAN), at(650.0, 1.0));
    }

    #[test]
    fn le_fichier_garde_le_meme_format_plus_la_largeur() {
        let json = serde_json::to_value(SavedLayout { layout: &at(12.0, 1.0), window_width: BASE_WIDTH }).unwrap();
        assert_eq!(json["x"], 12.0);
        assert_eq!(json["displayId"], "primary");
        assert_eq!(json["windowWidth"], BASE_WIDTH);
        // Relu comme avant par LayoutPatch (champ en trop ignoré).
        assert!(serde_json::from_value::<LayoutPatch>(json).is_ok());
    }
}
