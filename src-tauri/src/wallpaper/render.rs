//! Rendu du fond d'écran flouté / « cinématique » à partir d'une pochette.

use std::path::{Path, PathBuf};

use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};

use crate::platform::system;

/// Flou par boîte (une passe horizontale + une verticale), comme l'original.
fn box_blur(source: &RgbImage, radius: i32) -> RgbImage {
    let (width, height) = source.dimensions();
    let (w, h) = (width as i32, height as i32);
    let blur_pass = |input: &RgbImage, horizontal: bool| {
        let mut output = RgbImage::new(width, height);
        for y in 0..h {
            for x in 0..w {
                let (mut sum, mut count) = ([0u32; 3], 0u32);
                for k in -radius..=radius {
                    let (px, py) = if horizontal { (x + k, y) } else { (x, y + k) };
                    if px >= 0 && px < w && py >= 0 && py < h {
                        let p = input.get_pixel(px as u32, py as u32);
                        sum[0] += p[0] as u32;
                        sum[1] += p[1] as u32;
                        sum[2] += p[2] as u32;
                        count += 1;
                    }
                }
                output.put_pixel(x as u32, y as u32, Rgb([(sum[0] / count) as u8, (sum[1] / count) as u8, (sum[2] / count) as u8]));
            }
        }
        output
    };
    blur_pass(&blur_pass(source, true), false)
}

/// Génère `processed_wallpaper_N.jpg` puis l'applique. Retombe sur l'image brute en cas d'erreur.
pub fn apply_blurred(image_path: &Path, style: &str, passes: u32, darken_percent: u32) {
    match render(image_path, style, passes, darken_percent) {
        Ok(output) => system::set_wallpaper(&output.to_string_lossy()),
        Err(error) => {
            crate::logger::log(&format!("[Core stderr] Error blurring wallpaper: {error}"));
            system::set_wallpaper(&image_path.to_string_lossy());
        }
    }
}

fn render(image_path: &Path, style: &str, passes: u32, darken_percent: u32) -> Result<PathBuf, String> {
    let (target_w, target_h) = system::largest_screen_size();
    // Format détecté d'après le contenu : les pochettes SMTC sont souvent des PNG nommés .jpg.
    let original = image::ImageReader::open(image_path)
        .and_then(|reader| reader.with_guessed_format())
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?
        .to_rgb8();

    let mut blurred = imageops::resize(&original, 200, 200, FilterType::Triangle);
    for _ in 0..passes.clamp(1, 15) {
        blurred = box_blur(&blurred, 3);
    }

    let mut canvas = imageops::resize(&blurred, target_w, target_h, FilterType::CatmullRom);
    let brightness = 1.0 - (darken_percent.min(50) as f32 / 100.0);
    for pixel in canvas.pixels_mut() {
        for channel in pixel.0.iter_mut() {
            *channel = (*channel as f32 * brightness).round().min(255.0) as u8;
        }
    }

    if style == "cinematic" {
        let cover_size = (target_h as f64 * 0.6) as i64;
        let cover_x = (target_w as i64 - cover_size) / 2;
        let cover_y = (target_h as i64 - cover_size) / 2;

        // Ombre douce : 20 rectangles concentriques de plus en plus opaques.
        const SHADOW_OFFSET: i64 = 4;
        const SHADOW_SIZE: i64 = 20;
        for i in (1..=SHADOW_SIZE).rev() {
            let alpha = (8.0 * (1.0 - i as f64 / SHADOW_SIZE as f64)) as u32;
            if alpha == 0 {
                continue;
            }
            let (sx, sy, size) = (cover_x + SHADOW_OFFSET - i, cover_y + SHADOW_OFFSET - i, cover_size + 2 * i);
            darken_rect(&mut canvas, sx, sy, size, size, alpha);
        }

        let cover = imageops::resize(&original, cover_size as u32, cover_size as u32, FilterType::CatmullRom);
        imageops::overlay(&mut canvas, &cover, cover_x, cover_y);
    }

    let dir = image_path.parent().map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir);
    let suffix = if image_path.to_string_lossy().contains("_2.jpg") { "_2" } else { "_1" };
    let output = dir.join(format!("processed_wallpaper{suffix}.jpg"));
    let _ = std::fs::remove_file(&output);
    // Qualité 92 : à 75 (par défaut), les grands dégradés du flou se marquaient en bandes.
    let file = std::fs::File::create(&output).map_err(|e| e.to_string())?;
    image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 92)
        .encode_image(&canvas)
        .map_err(|e| e.to_string())?;
    Ok(output)
}

/// Assombrit un rectangle comme un remplissage noir semi-transparent (alpha sur 255).
fn darken_rect(canvas: &mut RgbImage, x: i64, y: i64, w: i64, h: i64, alpha: u32) {
    let (cw, ch) = (canvas.width() as i64, canvas.height() as i64);
    let keep = 255 - alpha;
    for py in y.max(0)..(y + h).min(ch) {
        for px in x.max(0)..(x + w).min(cw) {
            let pixel = canvas.get_pixel_mut(px as u32, py as u32);
            for channel in pixel.0.iter_mut() {
                *channel = ((*channel as u32 * keep) / 255) as u8;
            }
        }
    }
}
