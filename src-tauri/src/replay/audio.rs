//! Native WASAPI feeds. Silence is clocked too: an idle output must not shorten audio.
use parking_lot::Mutex;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::{
            CloseHandle, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING, HANDLE,
        },
        Media::Audio::*,
        Storage::FileSystem::{WriteFile, PIPE_ACCESS_OUTBOUND},
        System::{
            Com::{CoCreateInstance, CLSCTX_ALL},
            Performance::{QueryPerformanceCounter, QueryPerformanceFrequency},
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, PIPE_NOWAIT, PIPE_READMODE_BYTE,
                PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            },
        },
    },
};

// Each timestamped 10 ms PCM packet is smaller than 3900 bytes.
// Absorb short encoder/scheduler stalls without dropping audio or changing timestamps.
const MAX_PENDING_BYTES: usize = 3900 * 300;
const AUDIO_STALLED: &str =
    "La capture s’est arrêtée car le traitement du son est bloqué. Relancez la capture.";

fn flush_pending(
    pending: &mut Vec<u8>,
    mut write: impl FnMut(&[u8]) -> Result<usize, String>,
) -> Result<(), String> {
    let mut offset = 0;
    while offset < pending.len() {
        let end = (offset + 65_536).min(pending.len());
        let written = write(&pending[offset..end])?;
        if written == 0 {
            break; // A full nonblocking byte pipe is temporary backpressure.
        }
        offset += written;
    }
    // Reclaim consumed bytes even when the pipe only accepted part of the queue.
    pending.drain(..offset);
    if pending.len() > MAX_PENDING_BYTES {
        crate::logger::log(&format!(
            "[Replay audio] Backlog exceeded: {} bytes",
            pending.len()
        ));
        return Err(AUDIO_STALLED.into());
    }
    Ok(())
}

pub struct Feed {
    pub path: String,
    stop: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    worker: Option<JoinHandle<()>>,
}

impl Feed {
    pub fn start(system: bool, device_id: String) -> Result<Self, String> {
        let path = format!(
            "\\\\.\\pipe\\nolys-replay-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        );
        let stop = Arc::new(AtomicBool::new(false));
        let error = Arc::new(Mutex::new(None));
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let (p, s, e) = (path.clone(), stop.clone(), error.clone());
        let worker = std::thread::spawn(move || {
            crate::platform::com::ensure_mta();
            let init = unsafe { Audio::new(system, &device_id, &p) };
            match init {
                Err(err) => {
                    let _ = ready_tx.send(Err(err));
                }
                Ok(mut audio) => {
                    let _ = ready_tx.send(Ok(()));
                    if let Err(err) = unsafe { audio.run(&s) } {
                        if !s.load(Ordering::Acquire) {
                            *e.lock() = Some(err);
                        }
                    }
                }
            }
        });
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Self {
                path,
                stop,
                error,
                worker: Some(worker),
            }),
            Ok(Err(e)) => {
                let _ = worker.join();
                Err(e)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                Err("Le périphérique audio ne répond pas.".into())
            }
        }
    }
    pub fn error(&self) -> Option<String> {
        self.error.lock().clone()
    }
}
impl Drop for Feed {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Pipe(HANDLE);
impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct Audio {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    pipe: Pipe,
}

unsafe fn qpc_100ns() -> Result<i64, String> {
    let (mut ticks, mut frequency) = (0, 0);
    QueryPerformanceCounter(&mut ticks).map_err(|e| e.to_string())?;
    QueryPerformanceFrequency(&mut frequency).map_err(|e| e.to_string())?;
    if frequency <= 0 {
        return Err("Horloge audio indisponible.".into());
    }
    Ok((ticks as i128 * 10_000_000 / frequency as i128) as i64)
}

impl Audio {
    unsafe fn flush(&self, pending: &mut Vec<u8>) -> Result<(), String> {
        flush_pending(pending, |bytes| {
            let mut written = 0;
            WriteFile(self.pipe.0, Some(bytes), Some(&mut written), None)
                .map_err(|e| format!("Flux audio fermé : {e}"))?;
            Ok(written as usize)
        })
    }

    unsafe fn new(system: bool, id: &str, path: &str) -> Result<Self, String> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let device = if id.is_empty() {
            enumerator.GetDefaultAudioEndpoint(if system { eRender } else { eCapture }, eConsole)
        } else {
            enumerator.GetDevice(&HSTRING::from(id))
        }
        .map_err(|e| {
            format!(
                "Périphérique {} indisponible : {e}",
                if system { "audio" } else { "micro" }
            )
        })?;
        let client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let format = WAVEFORMATEX {
            wFormatTag: 3,
            nChannels: 2,
            nSamplesPerSec: 48_000,
            nAvgBytesPerSec: 384_000,
            nBlockAlign: 8,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        let flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
            | if system {
                AUDCLNT_STREAMFLAGS_LOOPBACK
            } else {
                0
            };
        client
            .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 1_000_000, 0, &format, None)
            .map_err(|e| format!("Impossible d’ouvrir le son à 48 kHz : {e}"))?;
        let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let handle = CreateNamedPipeW(
            PCWSTR(wide.as_ptr()),
            PIPE_ACCESS_OUTBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            131_072,
            131_072,
            0,
            None,
        );
        if handle.is_invalid() {
            return Err("Impossible de créer le flux audio local.".into());
        }
        Ok(Self {
            client,
            capture,
            pipe: Pipe(handle),
        })
    }

    unsafe fn run(&mut self, stop: &AtomicBool) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if stop.load(Ordering::Acquire) {
                return Ok(());
            }
            match ConnectNamedPipe(self.pipe.0, None) {
                Ok(()) => break,
                Err(e) if e.code() == ERROR_PIPE_CONNECTED.to_hresult() => break,
                Err(e)
                    if e.code() == ERROR_PIPE_LISTENING.to_hresult()
                        || e.code() == ERROR_NO_DATA.to_hresult() => {}
                Err(e) => return Err(format!("Connexion audio interrompue : {e}")),
            }
            if Instant::now() >= deadline {
                return Err("Le moteur n’a pas ouvert le flux audio.".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let origin = qpc_100ns()?;
        let wall = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        self.client
            .Start()
            .map_err(|e| format!("La capture audio n’a pas démarré : {e}"))?;
        let result = self.pump(stop, origin, wall);
        let _ = self.client.Stop();
        result
    }

    unsafe fn pump(&mut self, stop: &AtomicBool, origin: i64, wall: u64) -> Result<(), String> {
        let clock = Instant::now();
        let mut samples = VecDeque::<f32>::new();
        let mut base = 0i64;
        let mut pending = super::audio_container::header();
        while !stop.load(Ordering::Acquire) {
            while self
                .capture
                .GetNextPacketSize()
                .map_err(|e| format!("Périphérique audio déconnecté : {e}"))?
                > 0
            {
                let (mut ptr, mut count, mut flags, mut time) = (std::ptr::null_mut(), 0, 0, 0);
                self.capture
                    .GetBuffer(&mut ptr, &mut count, &mut flags, None, Some(&mut time))
                    .map_err(|e| e.to_string())?;
                let start = if flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0 {
                    base + samples.len() as i64 / 2
                } else {
                    ((time as i128 - origin as i128) * 48_000 / 10_000_000).max(0) as i64
                };
                let tail = base + samples.len() as i64 / 2;
                let gap = (start - tail).max(0) as usize;
                // A clock discontinuity cannot allocate an unlimited silence gap.
                if gap > 48_000 {
                    let _ = self.capture.ReleaseBuffer(count);
                    return Err(
                        "L’horloge du périphérique audio a changé. Relancez la capture.".into(),
                    );
                }
                samples.extend(std::iter::repeat_n(0.0, gap * 2));
                let skip = (tail - start).max(0).min(count as i64) as usize;
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || ptr.is_null() {
                    samples.extend(std::iter::repeat_n(0.0, (count as usize - skip) * 2));
                } else {
                    let bytes = std::slice::from_raw_parts(ptr, count as usize * 8);
                    for chunk in bytes[skip * 8..].chunks_exact(4) {
                        samples.push_back(f32::from_le_bytes(
                            chunk.try_into().map_err(|_| "Paquet audio invalide.")?,
                        ));
                    }
                }
                self.capture
                    .ReleaseBuffer(count)
                    .map_err(|e| e.to_string())?;
            }
            // Keep 40 ms to absorb shared-mode device scheduling jitter.
            let due = ((clock.elapsed().as_secs_f64() - 0.04).max(0.0) * 48_000.0) as i64;
            while base + 480 <= due {
                let mut pcm = Vec::with_capacity(3840);
                for _ in 0..960 {
                    pcm.extend_from_slice(&samples.pop_front().unwrap_or(0.0).to_le_bytes());
                }
                pending.extend(super::audio_container::packet(
                    wall + base as u64 * 1000 / 48_000,
                    &pcm,
                ));
                base += 480;
                // Try delivery before declaring a stall, also while catching up after
                // a scheduling pause. Bound allocation to the limit plus one packet.
                if pending.len() > MAX_PENDING_BYTES {
                    self.flush(&mut pending)?;
                }
            }
            self.flush(&mut pending)?;
            if samples.len() > 96_000 {
                return Err("La file audio a dépassé sa limite.".into());
            }
            std::thread::sleep(Duration::from_millis(3));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_writes_and_temporary_stalls_preserve_every_byte() {
        let original: Vec<u8> = (0..386_100).map(|n| (n % 251) as u8).collect();
        let mut pending = original.clone();
        let mut delivered = Vec::new();
        flush_pending(&mut pending, |_| Ok(0)).unwrap();
        assert_eq!(pending, original);

        flush_pending(&mut pending, |bytes| {
            if !delivered.is_empty() {
                return Ok(0);
            }
            let count = bytes.len().min(8192);
            delivered.extend_from_slice(&bytes[..count]);
            Ok(count)
        })
        .unwrap();
        assert_eq!(pending, original[8192..]);

        pending.extend_from_slice(b"next audio packet");
        flush_pending(&mut pending, |bytes| {
            let count = bytes.len().min(4096);
            delivered.extend_from_slice(&bytes[..count]);
            Ok(count)
        })
        .unwrap();
        assert!(pending.is_empty());
        assert_eq!(
            delivered,
            [original.as_slice(), b"next audio packet"].concat()
        );
    }

    #[test]
    fn full_queue_is_drained_before_enforcing_the_limit() {
        let mut pending = vec![0; MAX_PENDING_BYTES + 3900];
        flush_pending(&mut pending, |bytes| Ok(bytes.len())).unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn persistent_backpressure_stops_at_a_bounded_queue() {
        let mut pending = vec![0; MAX_PENDING_BYTES];
        flush_pending(&mut pending, |_| Ok(0)).unwrap();
        pending.extend_from_slice(&[0; 3900]);
        assert_eq!(
            flush_pending(&mut pending, |_| Ok(0)),
            Err(AUDIO_STALLED.into())
        );
        assert_eq!(pending.len(), MAX_PENDING_BYTES + 3900);
    }

    #[test]
    fn closed_pipe_is_reported_immediately() {
        let mut pending = vec![0; 3900];
        assert_eq!(
            flush_pending(&mut pending, |_| Err("closed".into())),
            Err("closed".into())
        );
    }
}
