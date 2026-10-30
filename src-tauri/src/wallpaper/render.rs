//! Rendu du fond d'écran flouté / « cinématique » à partir d'une pochette.

use std::path::Path;
use std::io::Write;

use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};

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

fn bounded_dimensions(width: u32, height: u32) -> (u32, u32) {
    let width = width.max(1); let height = height.max(1);
    let scale = (16_000_000.0 / (width as f64 * height as f64)).sqrt().min(8192.0 / width as f64).min(8192.0 / height as f64).min(1.0);
    (((width as f64 * scale) as u32).max(1), ((height as f64 * scale) as u32).max(1))
}

/// Render only into a worker's staging directory. Publishing to the desktop is
/// a separate operation, checked again against the current generation.
pub fn prepare(bytes: &[u8], output: &Path, style: &str, passes: u32, darken_percent: u32, target: (u32, u32), cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    let check = || if cancelled() { Err("Pochette remplacée.".to_string()) } else { Ok(()) };
    check()?;
    let (target_w, target_h) = bounded_dimensions(target.0, target.1);
    // Format détecté d'après le contenu : les pochettes SMTC sont souvent des PNG nommés .jpg.
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192); limits.max_image_height = Some(8192); limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let original = reader.decode()
        .map_err(|e| e.to_string())?
        .to_rgb8();
    check()?;

    if style == "sharp" {
        let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 92).encode_image(&original).map_err(|e| e.to_string())?;
        writer.flush().and_then(|_| writer.get_ref().sync_all()).map_err(|e| e.to_string())?;
        return check();
    }

    let mut blurred = imageops::resize(&original, 200, 200, FilterType::Triangle);
    for _ in 0..passes.clamp(1, 15) {
        check()?;
        blurred = box_blur(&blurred, 3);
    }

    check()?;
    let mut canvas = imageops::resize(&blurred, target_w, target_h, FilterType::CatmullRom);
    let brightness = 1.0 - (darken_percent.min(50) as f32 / 100.0);
    for row in canvas.rows_mut() {
        check()?;
        for pixel in row {
            for channel in pixel.0.iter_mut() {
                *channel = (*channel as f32 * brightness).round().min(255.0) as u8;
            }
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

    check()?;
    // Qualité 92 : à 75 (par défaut), les grands dégradés du flou se marquaient en bandes.
    let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 92)
        .encode_image(&canvas)
        .map_err(|e| e.to_string())?;
    writer.flush().and_then(|_| writer.get_ref().sync_all()).map_err(|e| e.to_string())?;
    check()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screen_canvas_is_bounded_without_distorting_its_aspect_ratio() {
        assert_eq!(bounded_dimensions(1920, 1080), (1920, 1080));
        let (width, height) = bounded_dimensions(32768, 16384);
        assert!(width <= 8192 && height <= 8192 && width as u64 * height as u64 <= 16_000_000);
        assert!((width as f64 / height as f64 - 2.0).abs() < 0.001);
    }
    #[test]
    fn stale_and_oversized_covers_are_never_published() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("staged.jpg");
        assert!(prepare(b"image", &path, "sharp", 1, 0, (100, 100), &|| true).is_err());
        assert!(!path.exists());
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(RgbImage::new(9000, 1)).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        assert!(prepare(bytes.get_ref(), &path, "blur", 1, 0, (100, 100), &|| false).is_err());
        assert!(!path.exists());
    }
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
