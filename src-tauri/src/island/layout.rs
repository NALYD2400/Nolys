//! Position, échelle et écran cible de l'Island (`liquid-island-layout.json`).
//!
//! Les coordonnées sont en pixels logiques de l'écran cible, comme les DIP
//! d'Electron : une configuration existante reste donc valable.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Monitor};

/// Fenêtre transparente, avec au moins 192 px autour des plus grandes capsules.
/// Le halo maximal respire jusqu'à 125 px de flou (50 × 2,5) ; son étendue
/// de rendu atteint environ 188 px. Les marges restent traversantes (hit_test).
pub const BASE_WIDTH: f64 = 1080.0;
pub const BASE_HEIGHT: f64 = 960.0;
/// Doit correspondre à --island-top-offset dans styles/base.css.
pub const PILL_TOP_OFFSET: f64 = 192.0;
const LEGACY_TOP_OFFSET: f64 = 50.0;
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
        y: area.y + 20.0 - PILL_TOP_OFFSET,
        scale: 1.0,
        display_id: monitor.as_ref().map(monitor_id).unwrap_or_else(|| "primary".into()),
    }
}

pub fn centered_on(app: &AppHandle, layout: &Layout) -> Layout {
    let area = target_monitor(app, &layout.display_id).as_ref().map(work_area).unwrap_or_else(fallback_area);
    let width = (BASE_WIDTH * layout.scale).round();
    Layout { x: (area.x + (area.width - width) / 2.0).round(), y: area.y + 20.0 - PILL_TOP_OFFSET * layout.scale, ..layout.clone() }
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

/// Demi-largeur visible minimale de la pilule repliée (120 px) et hauteur qui doit rester à l'écran.
const PILL_MIN_VISIBLE_WIDTH: f64 = 60.0;
const PILL_MIN_VISIBLE_HEIGHT: f64 = 40.0;

/// Garde au moins une partie de la pilule visible, sans limiter ses marges transparentes.
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

/// Place toute la capsule ouverte dans la zone utile, même à 150 % ou sur petit écran.
/// Le résultat est éphémère : la capsule repliée retrouve sa position et son échelle.
pub fn expanded_placement(base: &Layout, area: WorkArea, bounds: super::hit_test::CssRect) -> Layout {
    let margin = 8.0;
    let scale = base.scale.min(((area.width - margin * 2.0) / bounds.width).max(0.1))
        .min(((area.height - margin * 2.0) / bounds.height).max(0.1));
    // Garde le centre de la pilule lors d'une réduction automatique de l'échelle.
    let x = base.x + BASE_WIDTH * (base.scale - scale) / 2.0;
    let y = base.y + PILL_TOP_OFFSET * (base.scale - scale);
    let min_x = area.x + margin - bounds.x * scale;
    let max_x = area.x + area.width - margin - (bounds.x + bounds.width) * scale;
    let min_y = area.y + margin - bounds.y * scale;
    let max_y = area.y + area.height - margin - (bounds.y + bounds.height) * scale;
    Layout { x: x.clamp(min_x, max_x.max(min_x)), y: y.clamp(min_y, max_y.max(min_y)), scale, ..base.clone() }
}

pub fn save_checked(data_dir: &Path, layout: &Layout) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&SavedLayout { layout, window_width: BASE_WIDTH, pill_top_offset: PILL_TOP_OFFSET }).map_err(|e| e.to_string())?;
    let path = config_path(data_dir);
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
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

/// Les marges transparentes peuvent grandir sans déplacer la capsule à l'écran.
fn adapt_to_top_offset(layout: Layout, saved_offset: f64) -> Layout {
    if !saved_offset.is_finite() || saved_offset < 0.0 || saved_offset == PILL_TOP_OFFSET {
        return layout;
    }
    Layout { y: layout.y - (PILL_TOP_OFFSET - saved_offset) * clamp_scale(layout.scale), ..layout }
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
            let top = if value.get("y").is_some() {
                value.get("pillTopOffset").and_then(serde_json::Value::as_f64).unwrap_or(LEGACY_TOP_OFFSET)
            } else { PILL_TOP_OFFSET };
            let patch = serde_json::from_value::<LayoutPatch>(value).ok()?;
            Some(adapt_to_top_offset(adapt_to_width(merge(&default_layout(app), &patch), width), top))
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
    pill_top_offset: f64,
}

pub fn save(data_dir: &Path, layout: &Layout) {
    if let Err(error) = save_checked(data_dir, layout) {
        crate::logger::log(&format!("[Layout] Failed to save layout: {error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, scale: f64) -> Layout {
        Layout { x, y: 10.0, scale, display_id: "primary".into() }
    }

    #[test]
    fn every_open_shape_fits_edges_and_small_mixed_dpi_displays_without_changing_saved_position() {
        let areas = [WorkArea {x:0.,y:0.,width:1920.,height:1040.}, WorkArea {x:-1280.,y:40.,width:1280.,height:680.}, WorkArea{x:1600.,y:-500.,width:640.,height:440.}];
        for area in areas {
            for scale in [0.65, 1.0, 1.5] {
                for (width, height) in [(682.,526.), (602.,538.), (380.,398.), (460.,496.), (520.,400.)] {
                    for (x,y) in [(area.x-300., area.y-50.), (area.x+area.width-360., area.y+area.height-80.)] {
                        let base = Layout {x,y,scale,display_id:"test".into()};
                        let original = base.clone();
                        let bounds = super::super::hit_test::CssRect {x:(BASE_WIDTH-width)/2., y:PILL_TOP_OFFSET,width,height};
                        let placed = expanded_placement(&base, area, bounds);
                        assert!(placed.x+bounds.x*placed.scale >= area.x+7.99);
                        assert!(placed.y+bounds.y*placed.scale >= area.y+7.99);
                        assert!(placed.x+(bounds.x+width)*placed.scale <= area.x+area.width-7.99);
                        assert!(placed.y+(bounds.y+height)*placed.scale <= area.y+area.height-7.99);
                        assert_eq!(base, original);
                        assert!(placed.scale <= base.scale);
                    }
                }
            }
        }
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
        let json = serde_json::to_value(SavedLayout { layout: &at(12.0, 1.0), window_width: BASE_WIDTH, pill_top_offset: PILL_TOP_OFFSET }).unwrap();
        assert_eq!(json["x"], 12.0);
        assert_eq!(json["displayId"], "primary");
        assert_eq!(json["windowWidth"], BASE_WIDTH);
        assert_eq!(json["pillTopOffset"], PILL_TOP_OFFSET);
        // Relu comme avant par LayoutPatch (champ en trop ignoré).
        assert!(serde_json::from_value::<LayoutPatch>(json).is_ok());
    }

    #[test]
    fn larger_shadow_margins_preserve_saved_capsule_position_at_every_scale() {
        for scale in [0.65, 1.0, 1.5] {
            for width in [LEGACY_WIDTH, 720.0, BASE_WIDTH] {
                let top = if width == BASE_WIDTH { PILL_TOP_OFFSET } else { LEGACY_TOP_OFFSET };
                let original = at(650.0, scale);
                let moved = adapt_to_top_offset(adapt_to_width(original.clone(), width), top);
                assert!((moved.x + BASE_WIDTH * scale / 2.0 - (original.x + width * scale / 2.0)).abs() < 0.51);
                assert!((moved.y + PILL_TOP_OFFSET * scale - (original.y + top * scale)).abs() < 0.01);
                assert_eq!(adapt_to_top_offset(moved.clone(), PILL_TOP_OFFSET), moved);
            }
        }
    }
}
