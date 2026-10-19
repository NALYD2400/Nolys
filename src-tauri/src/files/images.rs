use super::model::Options;
use image::{
    DynamicImage, GenericImageView, ImageDecoder, ImageEncoder, ImageFormat, ImageReader, Limits,
};
use std::{
    fs::File,
    io::{Cursor, Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

const MAX_PIXELS: u64 = 64_000_000;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;

fn read_source(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| "Ce fichier ne peut pas être lu.")?;
    let too_large = "Cette image dépasse la limite de lecture de 128 Mo. Utilisez une image plus petite ou copiez l’original.";
    if file
        .metadata()
        .map_err(|_| "La taille de l’image ne peut pas être lue.")?
        .len()
        > limit
    {
        return Err(too_large.into());
    }
    let mut bytes = Vec::new();
    // Some decoder constructors read the entire stream before applying Limits.
    // Cap the read too: a source can grow after its metadata was inspected.
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "La lecture de l’image a été interrompue.")?;
    if bytes.len() as u64 > limit {
        return Err(too_large.into());
    }
    Ok(bytes)
}

fn check_rgb_profile(profile: &[u8]) -> Result<(), String> {
    if profile.len() < 128 || profile.len() > 4 * 1024 * 1024 || &profile[36..40] != b"acsp" {
        return Err("Le profil couleur est invalide ou dépasse les limites du moteur.".into());
    }
    let declared = u32::from_be_bytes(profile[..4].try_into().unwrap()) as usize;
    if declared < 128 || declared > profile.len() {
        return Err("L’en-tête du profil couleur est invalide.".into());
    }
    if &profile[16..20] != b"RGB " {
        return Err("Ce profil couleur nécessite un moteur spécialisé. Copiez l’original pour conserver ses couleurs.".into());
    }
    Ok(())
}

fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("Opération annulée.".into())
    } else {
        Ok(())
    }
}

pub fn encode(
    path: &Path,
    writer: &mut File,
    options: &Options,
    cancel: &AtomicBool,
) -> Result<(), String> {
    cancelled(cancel)?;
    let source = read_source(path, MAX_SOURCE_BYTES)?;
    cancelled(cancel)?;
    let mut reader = ImageReader::new(Cursor::new(source.as_slice()))
        .with_guessed_format()
        .map_err(|_| "Le format de cette image est illisible.")?;
    let format = reader
        .format()
        .ok_or("Le format de cette image n’est pas reconnu.")?;
    if !matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP | ImageFormat::Bmp
    ) {
        return Err("Cette image nécessite un moteur qui n’est pas encore disponible.".into());
    }
    // Refuse animated inputs rather than silently exporting only their first frame.
    match format {
        ImageFormat::Jpeg => {
            // image converts CMYK/YCCK to RGB internally. Reattaching the old ICC
            // profile afterward would assign the wrong color space to those pixels.
            let mut header =
                zune_jpeg::JpegDecoder::new(zune_core::bytestream::ZCursor::new(source.as_slice()));
            header
                .decode_headers()
                .map_err(|_| "Cette image JPG est endommagée ou non prise en charge.")?;
            if matches!(
                header.input_colorspace(),
                Some(
                    zune_core::colorspace::ColorSpace::CMYK
                        | zune_core::colorspace::ColorSpace::YCCK
                )
            ) {
                return Err("Cette image JPG est en CMJN. Elle nécessite un moteur de gestion des couleurs ; copiez l’original.".into());
            }
        }
        ImageFormat::Png => {
            let decoder = image::codecs::png::PngDecoder::new(Cursor::new(source.as_slice()))
                .map_err(|_| "Cette image PNG est endommagée.")?;
            if decoder.is_apng().unwrap_or(true) {
                return Err(
                    "Cette image est animée. La conversion statique ne conserve pas son animation."
                        .into(),
                );
            }
        }
        ImageFormat::WebP => {
            let decoder = image::codecs::webp::WebPDecoder::new(Cursor::new(source.as_slice()))
                .map_err(|_| "Cette image WebP est endommagée.")?;
            if decoder.has_animation() {
                return Err("Cette image WebP est animée. Son animation doit être conservée par un moteur dédié.".into());
            }
        }
        _ => {}
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(MAX_BYTES);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "L’image est illisible ou dépasse les limites de mémoire.")?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_PIXELS || decoder.total_bytes() > MAX_BYTES {
        return Err("Cette image est trop grande pour être traitée en toute sécurité (64 mégapixels maximum).".into());
    }
    if !matches!(
        decoder.color_type(),
        image::ColorType::Rgb8
            | image::ColorType::Rgba8
            | image::ColorType::L8
            | image::ColorType::La8
    ) {
        return Err("Cette profondeur de couleur nécessite un moteur spécialisé.".into());
    }
    let orientation = decoder
        .orientation()
        .map_err(|_| "L’orientation de l’image est illisible.")?;
    let profile = decoder
        .icc_profile()
        .map_err(|_| "Le profil de couleur est illisible.")?;
    if let Some(profile) = profile.as_ref().filter(|profile| !profile.is_empty()) {
        check_rgb_profile(profile)?;
    }
    if options.format == "bmp" && profile.as_ref().is_some_and(|p| !p.is_empty()) {
        return Err("Le format BMP ne permet pas de conserver ce profil de couleur. Choisissez PNG ou WebP.".into());
    }
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|_| "L’image est endommagée ou sa mémoire est insuffisante.")?;
    image.apply_orientation(orientation);
    cancelled(cancel)?;
    if options.max_edge > 0 {
        let (w, h) = image.dimensions();
        if w.max(h) > options.max_edge {
            image = image.resize(
                options.max_edge,
                options.max_edge,
                image::imageops::FilterType::Lanczos3,
            );
        }
    }
    cancelled(cancel)?;
    if options.format == "jpg" && image.color().has_alpha() {
        let rgba = image.into_rgba8();
        if rgba.pixels().all(|pixel| pixel[3] == 255) {
            image = DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(rgba).into_rgb8());
        } else {
            let background = options.background.as_ref().ok_or("Le JPG supprime la transparence. Choisissez une couleur de fond avant de continuer.")?;
            let color: Vec<u8> = [1, 3, 5]
                .iter()
                .map(|i| u8::from_str_radix(&background[*i..*i + 2], 16).unwrap_or(255))
                .collect();
            let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
            for (x, y, p) in rgba.enumerate_pixels() {
                let a = u32::from(p[3]);
                rgb.put_pixel(
                    x,
                    y,
                    image::Rgb(std::array::from_fn(|i| {
                        ((u32::from(p[i]) * a + u32::from(color[i]) * (255 - a) + 127) / 255) as u8
                    })),
                );
            }
            image = DynamicImage::ImageRgb8(rgb);
        }
    }
    match options.format.as_str() {
        "jpg" => {
            let rgb = image.into_rgb8();
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                writer,
                if options.quality == 0 {
                    85
                } else {
                    options.quality
                },
            );
            if let Some(profile) = profile {
                encoder
                    .set_icc_profile(profile)
                    .map_err(|_| "Impossible de conserver le profil couleur JPG.")?;
            }
            encoder
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|e| e.to_string())?;
        }
        "png" => {
            let rgba = image.into_rgba8();
            let mut encoder = image::codecs::png::PngEncoder::new(writer);
            if let Some(profile) = profile {
                encoder
                    .set_icc_profile(profile)
                    .map_err(|_| "Impossible de conserver le profil couleur PNG.")?;
            }
            encoder
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
        }
        "webp" => {
            let rgba = image.into_rgba8();
            let mut encoder = image::codecs::webp::WebPEncoder::new_lossless(writer);
            if let Some(profile) = profile {
                encoder
                    .set_icc_profile(profile)
                    .map_err(|_| "Impossible de conserver le profil couleur WebP.")?;
            }
            encoder
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
        }
        "bmp" => {
            let rgba = image.into_rgba8();
            image::codecs::bmp::BmpEncoder::new(writer)
                .encode(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Ce format de sortie n’est pas disponible.".into()),
    }
    cancelled(cancel)
}

pub fn copy(path: &Path, writer: &mut File, cancel: &AtomicBool) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "Le fichier ne peut pas être lu.")?;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        cancelled(cancel)?;
        let count = file
            .read(&mut buffer)
            .map_err(|_| "La lecture du fichier a été interrompue.")?;
        if count == 0 {
            break;
        }
        writer.write_all(&buffer[..count]).map_err(|_| {
            "Impossible d’écrire le résultat. Vérifiez l’espace et les droits du dossier."
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoded_source_is_bounded_before_decoder_construction() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("too-large.jpg");
        std::fs::write(&path, [0u8; 65]).unwrap();
        assert!(read_source(&path, 64).is_err());
        assert_eq!(std::fs::metadata(path).unwrap().len(), 65);
    }
    #[test]
    fn non_rgb_profiles_are_not_reattached_to_rgb_pixels() {
        let mut profile = [0u8; 128];
        profile[..4].copy_from_slice(&128u32.to_be_bytes());
        profile[36..40].copy_from_slice(b"acsp");
        profile[16..20].copy_from_slice(b"CMYK");
        assert!(check_rgb_profile(&profile).is_err());
        profile[16..20].copy_from_slice(b"GRAY");
        assert!(check_rgb_profile(&profile).is_err());
        profile[16..20].copy_from_slice(b"RGB ");
        assert!(check_rgb_profile(&profile).is_ok());
    }
    #[test]
    fn fully_opaque_rgba_does_not_require_a_jpeg_background() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("opaque.png");
        image::RgbaImage::from_pixel(8, 8, image::Rgba([80, 90, 100, 255]))
            .save(&path)
            .unwrap();
        let mut target = tempfile::NamedTempFile::new_in(folder.path()).unwrap();
        encode(
            &path,
            target.as_file_mut(),
            &Options {
                format: "jpg".into(),
                quality: 95,
                ..Default::default()
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        let decoded = image::load_from_memory(&std::fs::read(target.path()).unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (8, 8));
    }
}
