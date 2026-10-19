use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub fn id() -> String { format!("{:032x}", rand::random::<u128>()) }
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
    pub extension: String,
    pub directory: bool,
    pub modified: u64,
    #[serde(skip_serializing)]
    pub path: PathBuf,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub format: String,
    pub quality: u8,
    pub max_edge: u32,
    pub background: Option<String>,
}

impl Options {
    pub fn validate(&self, action: &str) -> Result<(), String> {
        if !["convert", "resize", "compress", "copy"].contains(&action) {
            return Err("Cette action n’est pas disponible.".into());
        }
        if action == "copy" { return Ok(()); }
        if !["png", "jpg", "webp", "bmp"].contains(&self.format.as_str()) {
            return Err("Choisissez PNG, JPG, WebP ou BMP.".into());
        }
        if self.quality > 100 { return Err("La qualité doit être comprise entre 1 et 100.".into()); }
        if action == "compress" && self.format != "jpg" {
            return Err("La compression avec qualité réglable est disponible en JPG.".into());
        }
        if action == "resize" && !(1..=16384).contains(&self.max_edge) {
            return Err("Choisissez un grand côté de 1 à 16 384 pixels.".into());
        }
        if self.max_edge > 16384 { return Err("La dimension demandée est trop grande.".into()); }
        if let Some(color) = &self.background {
            if color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("La couleur de fond est invalide.".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
    pub input_id: String,
    pub name: String,
    pub status: String,
    pub error: Option<String>,
    pub output_id: Option<String>,
    pub size_before: u64,
    pub size_after: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub path: PathBuf,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub request_id: String,
    pub action: String,
    pub options: Options,
    pub status: String,
    pub created_at: u64,
    pub completed: usize,
    pub total: usize,
    pub items: Vec<ItemResult>,
    pub outputs: Vec<Output>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sequence: u64,
    pub jobs: Vec<JobView>,
    pub destination: String,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputView { pub id: String, pub name: String, pub size: u64 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String, pub action: String, pub status: String, pub created_at: u64,
    pub completed: usize, pub total: usize, pub items: Vec<ItemResult>, pub outputs: Vec<OutputView>,
}
impl From<&Job> for JobView {
    fn from(job: &Job) -> Self {
        Self { id: job.id.clone(), action: job.action.clone(), status: job.status.clone(), created_at: job.created_at,
            completed: job.completed, total: job.total, items: job.items.clone(),
            outputs: job.outputs.iter().map(|output| OutputView { id: output.id.clone(), name: output.name.clone(), size: output.size }).collect() }
    }
}
