use super::mp4::Fragment;
use std::collections::VecDeque;

pub struct Ring {
    parts: VecDeque<Fragment>,
    bytes: usize,
    max_bytes: usize,
    seconds: f64,
}

impl Ring {
    pub fn new(seconds: u32, memory_mb: u32) -> Self {
        Self {
            parts: VecDeque::new(),
            bytes: 0,
            max_bytes: memory_mb as usize * 1024 * 1024,
            seconds: seconds as f64,
        }
    }
    pub fn push(&mut self, part: Fragment) {
        if self.parts.is_empty() && !part.keyframe {
            return;
        }
        self.bytes += part.bytes.len();
        self.parts.push_back(part);
        // Evict a complete GOP, never leave a non-decodable first frame.
        loop {
            let next_key = self
                .parts
                .iter()
                .skip(1)
                .position(|p| p.keyframe)
                .map(|i| i + 1);
            // The requested duration is an upper bound, including when the encoder
            // misses a keyframe. Keeping the preceding GOP could grow indefinitely.
            let expired = self.duration() > self.seconds;
            if !expired && self.bytes <= self.max_bytes {
                break;
            }
            let count = next_key.unwrap_or(self.parts.len());
            for _ in 0..count {
                if let Some(part) = self.parts.pop_front() {
                    self.bytes -= part.bytes.len();
                }
            }
            if self.parts.is_empty() {
                break;
            }
        }
    }
    pub fn duration(&self) -> f64 {
        self.parts
            .front()
            .zip(self.parts.back())
            .map_or(0.0, |(a, b)| (b.end - a.start).max(0.0))
    }
    pub fn bytes(&self) -> usize {
        self.bytes
    }
    pub fn snapshot(&self) -> Vec<Fragment> {
        self.parts.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn part(t: u32, keyframe: bool, size: usize) -> Fragment {
        Fragment {
            bytes: Arc::from(vec![0; size]),
            start: t as f64,
            end: t as f64 + 1.0,
            keyframe,
        }
    }
    #[test]
    fn evicts_whole_gops_and_starts_at_a_keyframe() {
        let mut ring = Ring::new(5, 64);
        ring.push(part(0, false, 10));
        assert_eq!(ring.duration(), 0.0);
        for i in 0..20 {
            ring.push(part(i, i % 2 == 0, 10));
        }
        let parts = ring.snapshot();
        assert!(parts[0].keyframe);
        assert!(ring.duration() >= 3.0 && ring.duration() <= 5.0);
        assert_eq!(parts.last().unwrap().end, 20.0);
    }
    #[test]
    fn a_single_oversized_gop_cannot_exceed_the_budget() {
        let mut ring = Ring::new(60, 1);
        ring.push(part(0, true, 700_000));
        ring.push(part(1, false, 700_000));
        assert_eq!(ring.bytes(), 0);
        ring.push(part(2, false, 1));
        assert_eq!(ring.bytes(), 0);
        ring.push(part(3, true, 100));
        assert_eq!(ring.bytes(), 100);
    }
    #[test]
    fn exports_share_payloads_and_survive_eviction() {
        let mut ring = Ring::new(5, 1);
        ring.push(part(0, true, 10));
        let saved = ring.snapshot();
        let before = saved[0].bytes.clone();
        assert!(Arc::ptr_eq(&before, &ring.snapshot()[0].bytes));
        for i in 1..20 {
            ring.push(part(i, true, 10));
        }
        assert_eq!(saved[0].start, 0.0);
    }

    #[test]
    fn sixty_seconds_never_keeps_older_video_even_if_keyframes_are_missing() {
        for interval in [2, 17, 120] {
            let mut ring = Ring::new(60, 64);
            for t in 0..400 {
                ring.push(part(t, t % interval == 0, 10));
                assert!(ring.duration() <= 60.0, "interval={interval}, t={t}");
                let saved = ring.snapshot();
                if let Some(first) = saved.first() {
                    assert!(first.keyframe);
                    assert_eq!(saved.last().unwrap().end, t as f64 + 1.0);
                }
            }
        }
    }
}
