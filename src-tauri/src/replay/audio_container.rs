//! Streaming Matroska PCM: timestamp every 10 ms block, including silence.
//! Raw PCM pipes have no timestamp origin; absolute timestamps keep devices aligned.
fn element(id: u32, body: &[u8]) -> Vec<u8> {
    let raw = id.to_be_bytes();
    let first = raw.iter().position(|b| *b != 0).unwrap_or(3);
    let mut out = raw[first..].to_vec();
    let n = body.len() as u64;
    let width = (1..=8)
        .find(|width| n < ((1u64 << (width * 7)) - 1))
        .unwrap_or(8);
    let encoded = (n | (1u64 << (width * 7))).to_be_bytes();
    out.extend_from_slice(&encoded[8 - width..]);
    out.extend_from_slice(body);
    out
}
fn uint(id: u32, n: u64) -> Vec<u8> {
    let raw = n.to_be_bytes();
    let start = raw.iter().position(|b| *b != 0).unwrap_or(7);
    element(id, &raw[start..])
}
fn group(id: u32, children: &[Vec<u8>]) -> Vec<u8> {
    element(id, &children.concat())
}

pub fn header() -> Vec<u8> {
    let mut out = group(
        0x1A45DFA3,
        &[
            uint(0x4286, 1),
            uint(0x42F7, 1),
            uint(0x42F2, 4),
            uint(0x42F3, 8),
            element(0x4282, b"matroska"),
            uint(0x4287, 4),
            uint(0x4285, 2),
        ],
    );
    out.extend_from_slice(&[
        0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    out.extend(group(
        0x1549A966,
        &[
            uint(0x2AD7B1, 1_000_000),
            element(0x4D80, b"Nolys"),
            element(0x5741, b"Nolys"),
        ],
    ));
    out.extend(group(
        0x1654AE6B,
        &[group(
            0xAE,
            &[
                uint(0xD7, 1),
                uint(0x73C5, 1),
                uint(0x83, 2),
                uint(0x9C, 0),
                element(0x86, b"A_PCM/FLOAT/IEEE"),
                group(
                    0xE1,
                    &[
                        element(0xB5, &48_000f64.to_be_bytes()),
                        uint(0x9F, 2),
                        uint(0x6264, 32),
                    ],
                ),
            ],
        )],
    ));
    out
}
pub fn packet(time_ms: u64, pcm: &[u8]) -> Vec<u8> {
    let mut block = Vec::with_capacity(pcm.len() + 4);
    block.extend_from_slice(&[0x81, 0, 0, 0x80]);
    block.extend_from_slice(pcm);
    group(0x1F43B675, &[uint(0xE7, time_ms), element(0xA3, &block)])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn size_encoding_does_not_use_reserved_unknown_values() {
        assert_eq!(&element(0xA3, &vec![0; 126])[..2], &[0xA3, 0xFE]);
        assert_eq!(&element(0xA3, &vec![0; 127])[..3], &[0xA3, 0x40, 0x7F]);
        assert!(header().windows(16).any(|w| w == b"A_PCM/FLOAT/IEEE"));
        assert!(packet(1_792_412_000_000, &[0; 3840]).len() < 3900);
    }
}
