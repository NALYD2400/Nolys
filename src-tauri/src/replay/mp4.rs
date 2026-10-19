//! Bounded ISO-BMFF reader. Only complete moof/mdat pairs enter the replay buffer.
use std::{
    io::{self, Read},
    sync::Arc,
};

const MAX_BOX: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Fragment {
    pub bytes: Arc<[u8]>,
    pub start: f64,
    pub end: f64,
    pub keyframe: bool,
}

pub enum Part {
    Header(Arc<[u8]>),
    Fragment(Fragment),
}

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Flux MP4 fragmenté invalide ou trop volumineux.",
    )
}
fn u32_at(b: &[u8], i: usize) -> io::Result<u32> {
    Ok(u32::from_be_bytes(
        b.get(i..i + 4)
            .ok_or_else(invalid)?
            .try_into()
            .map_err(|_| invalid())?,
    ))
}
fn u64_at(b: &[u8], i: usize) -> io::Result<u64> {
    Ok(u64::from_be_bytes(
        b.get(i..i + 8)
            .ok_or_else(invalid)?
            .try_into()
            .map_err(|_| invalid())?,
    ))
}

fn boxes(mut b: &[u8]) -> io::Result<Vec<(&[u8], &[u8])>> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let size = u32_at(b, 0)? as usize;
        let (size, header) = if size == 1 {
            (usize::try_from(u64_at(b, 8)?).map_err(|_| invalid())?, 16)
        } else {
            (size, 8)
        };
        if size < header || size > b.len() {
            return Err(invalid());
        }
        out.push((&b[4..8], &b[header..size]));
        b = &b[size..];
    }
    Ok(out)
}

fn video_info(moov: &[u8]) -> io::Result<(u32, u32)> {
    for (kind, trak) in boxes(moov)? {
        if kind != b"trak" {
            continue;
        }
        let mut id = 0;
        let mut scale = 0;
        let mut video = false;
        for (kind, body) in boxes(trak)? {
            if kind == b"tkhd" {
                id = u32_at(body, if body.first() == Some(&1) { 20 } else { 12 })?;
            }
            if kind == b"mdia" {
                for (kind, body) in boxes(body)? {
                    if kind == b"hdlr" {
                        video = body.get(8..12) == Some(b"vide");
                    }
                    if kind == b"mdhd" {
                        scale = u32_at(body, if body.first() == Some(&1) { 20 } else { 12 })?;
                    }
                }
            }
        }
        if video && id != 0 && scale != 0 {
            return Ok((id, scale));
        }
    }
    Err(invalid())
}

fn timing(moof: &[u8], video_id: u32, scale: u32) -> io::Result<Option<(f64, f64, bool)>> {
    for (kind, traf) in boxes(moof)? {
        if kind != b"traf" {
            continue;
        }
        let children = boxes(traf)?;
        let Some((_, tfhd)) = children.iter().find(|(kind, _)| *kind == b"tfhd") else {
            continue;
        };
        if u32_at(tfhd, 4)? != video_id {
            continue;
        }
        let flags = u32_at(tfhd, 0)? & 0x00ff_ffff;
        let mut offset = 8;
        if flags & 1 != 0 {
            offset += 8;
        }
        if flags & 2 != 0 {
            offset += 4;
        }
        let default_duration = if flags & 8 != 0 {
            let v = u32_at(tfhd, offset)?;
            offset += 4;
            v
        } else {
            0
        };
        if flags & 16 != 0 {
            offset += 4;
        }
        let default_flags = if flags & 32 != 0 {
            u32_at(tfhd, offset)?
        } else {
            0x10000
        };
        let tfdt = children
            .iter()
            .find(|(kind, _)| *kind == b"tfdt")
            .ok_or_else(invalid)?
            .1;
        let time = if tfdt.first() == Some(&1) {
            u64_at(tfdt, 4)?
        } else {
            u32_at(tfdt, 4)? as u64
        };
        let mut duration = 0u64;
        let mut first_flags = None;
        for (_, trun) in children.iter().filter(|(kind, _)| *kind == b"trun") {
            let flags = u32_at(trun, 0)? & 0x00ff_ffff;
            let count = u32_at(trun, 4)?;
            if count > 100_000 {
                return Err(invalid());
            }
            let mut offset = 8;
            if flags & 1 != 0 {
                offset += 4;
            }
            let first = if flags & 4 != 0 {
                let f = u32_at(trun, offset)?;
                offset += 4;
                Some(f)
            } else {
                None
            };
            for index in 0..count {
                let d = if flags & 0x100 != 0 {
                    let v = u32_at(trun, offset)?;
                    offset += 4;
                    v
                } else {
                    default_duration
                };
                duration = duration.checked_add(d as u64).ok_or_else(invalid)?;
                if flags & 0x200 != 0 {
                    offset += 4;
                }
                let sample_flags = if flags & 0x400 != 0 {
                    let f = u32_at(trun, offset)?;
                    offset += 4;
                    f
                } else if index == 0 {
                    first.unwrap_or(default_flags)
                } else {
                    default_flags
                };
                if first_flags.is_none() {
                    first_flags = Some(sample_flags);
                }
                if flags & 0x800 != 0 {
                    offset += 4;
                }
                if offset > trun.len() {
                    return Err(invalid());
                }
            }
        }
        if duration == 0 {
            return Err(invalid());
        }
        return Ok(Some((
            time as f64 / scale as f64,
            (time + duration) as f64 / scale as f64,
            first_flags.is_some_and(|f| f & 0x10000 == 0),
        )));
    }
    Ok(None)
}

pub fn read_stream(mut input: impl Read, mut consume: impl FnMut(Part) -> bool) -> io::Result<()> {
    let mut header = Vec::new();
    let mut video = None;
    let mut pending = None;
    loop {
        let mut h = [0u8; 8];
        // Distinguish a clean EOF from a truncated box.
        match input.read(&mut h[..1])? {
            0 => {
                return if pending.is_none() {
                    Ok(())
                } else {
                    Err(invalid())
                }
            }
            _ => input.read_exact(&mut h[1..])?,
        }
        let small = u32::from_be_bytes(h[..4].try_into().map_err(|_| invalid())?) as usize;
        let mut data = h.to_vec();
        let size = if small == 1 {
            let mut extended = [0u8; 8];
            input.read_exact(&mut extended)?;
            data.extend(extended);
            usize::try_from(u64::from_be_bytes(extended)).map_err(|_| invalid())?
        } else {
            small
        };
        if size < data.len() || size > MAX_BOX {
            return Err(invalid());
        }
        let start = data.len();
        data.resize(size, 0);
        input.read_exact(&mut data[start..])?;
        match &h[4..8] {
            b"ftyp" if video.is_none() => {
                if header.len() + data.len() > 1024 * 1024 {
                    return Err(invalid());
                }
                header.extend(data);
            }
            b"moov" if video.is_none() => {
                video = Some(video_info(&data[start..])?);
                header.extend(data);
                if !consume(Part::Header(header.clone().into())) {
                    return Ok(());
                }
            }
            b"moof" => {
                if pending.is_some() {
                    return Err(invalid());
                }
                let (id, scale) = video.ok_or_else(invalid)?;
                let info = timing(&data[start..], id, scale)?;
                pending = Some((data, info));
            }
            b"mdat" => {
                let (mut bytes, info) = pending.take().ok_or_else(invalid)?;
                bytes.extend(data);
                if let Some((start, end, keyframe)) = info {
                    if !consume(Part::Fragment(Fragment {
                        bytes: bytes.into(),
                        start,
                        end,
                        keyframe,
                    })) {
                        return Ok(());
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unbounded_or_truncated_boxes() {
        for b in [
            vec![255, 255, 255, 255, b'm', b'd', b'a', b't'],
            vec![0, 0, 0, 9, b'f', b't', b'y', b'p'],
        ] {
            assert!(read_stream(b.as_slice(), |_| true).is_err());
        }
        assert!(read_stream(&[][..], |_| true).is_ok());
    }
}
