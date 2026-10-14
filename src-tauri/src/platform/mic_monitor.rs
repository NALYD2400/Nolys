//! Retour micro : le micro est rejoué en direct dans le casque (« sidetone »).
//!
//! Un thread dédié lit le micro en WASAPI partagé (piloté par événement), passe
//! le signal dans une petite chaîne de traitement (coupe-bas, réduction de
//! bruit RNNoise, porte de bruit, gain, balance) puis l'écrit sur la sortie
//! choisie. Windows convertit lui-même la fréquence d'échantillonnage côté
//! sortie (`AUTOCONVERTPCM`), on n'a donc pas de rééchantillonneur à écrire.
//!
//! Les réglages sont gardés dans `mic-monitor.json` et le retour reprend tout
//! seul au démarrage s'il était actif.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use nnnoiseless::DenoiseState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use windows::core::{GUID, HSTRING};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient, IAudioRenderClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, PKEY_AudioEndpoint_FormFactor, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use super::com;

const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
/// RNNoise travaille par trames de 10 ms à 48 kHz.
const DENOISE_RATE: u32 = 48_000;
const DENOISE_FRAME: usize = nnnoiseless::FRAME_SIZE;

// ---------------------------------------------------------------- Réglages

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitorConfig {
    pub enabled: bool,
    /// Identifiant WASAPI du micro ; vide = micro par défaut de Windows.
    pub input_id: String,
    /// Identifiant WASAPI de la sortie ; vide = sortie par défaut.
    pub output_id: String,
    /// Volume du retour, 0 à 200 %.
    pub volume: u32,
    /// Balance gauche/droite, -100 à 100.
    pub balance: i32,
    pub gate_enabled: bool,
    /// Seuil de la porte de bruit en dBFS (-80 à -10).
    pub gate_threshold: f32,
    /// Coupe-bas à 90 Hz (souffle, chocs sur le bureau).
    pub high_pass: bool,
    /// Réduction de bruit RNNoise (micro à 48 kHz uniquement).
    pub denoise: bool,
    /// « low », « normal » ou « safe » : marge contre les craquements.
    pub latency: String,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            input_id: String::new(),
            output_id: String::new(),
            volume: 60,
            balance: 0,
            gate_enabled: false,
            gate_threshold: -50.0,
            high_pass: true,
            denoise: false,
            latency: "normal".into(),
        }
    }
}

impl MonitorConfig {
    fn sanitized(mut self) -> Self {
        self.volume = self.volume.min(200);
        self.balance = self.balance.clamp(-100, 100);
        self.gate_threshold = if self.gate_threshold.is_finite() { self.gate_threshold.clamp(-80.0, -10.0) } else { -50.0 };
        if !matches!(self.latency.as_str(), "low" | "normal" | "safe") {
            self.latency = "normal".into();
        }
        if self.input_id.len() > 512 || self.input_id.contains(['\r', '\n']) {
            self.input_id.clear();
        }
        if self.output_id.len() > 512 || self.output_id.contains(['\r', '\n']) {
            self.output_id.clear();
        }
        self
    }

    fn latency_ms(&self) -> u32 {
        match self.latency.as_str() {
            "low" => 12,
            "safe" => 60,
            _ => 30,
        }
    }

    /// Ces réglages demandent de rouvrir les périphériques.
    fn needs_restart(&self, other: &Self) -> bool {
        self.enabled != other.enabled
            || self.input_id != other.input_id
            || self.output_id != other.output_id
            || self.latency != other.latency
    }
}

/// Paramètres lus par le thread audio à chaque paquet (modifiables à chaud).
#[derive(Debug, Clone, Copy)]
struct DspParams {
    gain: f32,
    left: f32,
    right: f32,
    gate_enabled: bool,
    gate_threshold: f32,
    high_pass: bool,
    denoise: bool,
}

impl From<&MonitorConfig> for DspParams {
    fn from(config: &MonitorConfig) -> Self {
        let balance = config.balance as f32 / 100.0;
        Self {
            gain: config.volume as f32 / 100.0,
            left: (1.0 - balance).min(1.0),
            right: (1.0 + balance).min(1.0),
            gate_enabled: config.gate_enabled,
            gate_threshold: 10f32.powf(config.gate_threshold / 20.0),
            high_pass: config.high_pass,
            denoise: config.denoise,
        }
    }
}

// ---------------------------------------------------------------- État publié

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorStatus {
    pub config: MonitorConfig,
    pub running: bool,
    pub error: Option<String>,
    /// Niveau brut du micro (avant tout traitement), 0 à 1.
    pub input_level: f32,
    /// Niveau envoyé au casque, 0 à 1.
    pub output_level: f32,
    pub gate_open: bool,
    /// Probabilité de voix donnée par RNNoise (0 si désactivée).
    pub voice: f32,
    pub input_name: String,
    pub output_name: String,
    /// « headphones », « headset », « speakers » ou « other ».
    pub output_kind: String,
    pub sample_rate: u32,
    pub latency_ms: u32,
    /// RNNoise n'est utilisable qu'avec un micro à 48 kHz.
    pub denoise_available: bool,
}

#[derive(Default)]
struct Meters {
    input: AtomicU32,
    output: AtomicU32,
    voice: AtomicU32,
    gate_open: AtomicBool,
}

impl Meters {
    fn store(slot: &AtomicU32, value: f32) {
        slot.store(value.to_bits(), Ordering::Relaxed);
    }
    fn load(slot: &AtomicU32) -> f32 {
        f32::from_bits(slot.load(Ordering::Relaxed))
    }
    fn reset(&self) {
        Self::store(&self.input, 0.0);
        Self::store(&self.output, 0.0);
        Self::store(&self.voice, 0.0);
        self.gate_open.store(false, Ordering::Relaxed);
    }
}

#[derive(Default, Clone)]
struct SessionInfo {
    running: bool,
    error: Option<String>,
    input_name: String,
    output_name: String,
    output_kind: String,
    sample_rate: u32,
    latency_ms: u32,
}

struct Worker {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

struct Monitor {
    path: Mutex<Option<PathBuf>>,
    config: Mutex<MonitorConfig>,
    params: Arc<Mutex<DspParams>>,
    meters: Arc<Meters>,
    session: Arc<Mutex<SessionInfo>>,
    worker: Mutex<Option<Worker>>,
}

fn monitor() -> &'static Monitor {
    static MONITOR: OnceLock<Monitor> = OnceLock::new();
    MONITOR.get_or_init(|| {
        let config = MonitorConfig::default();
        Monitor {
            path: Mutex::new(None),
            params: Arc::new(Mutex::new(DspParams::from(&config))),
            config: Mutex::new(config),
            meters: Arc::new(Meters::default()),
            session: Arc::new(Mutex::new(SessionInfo::default())),
            worker: Mutex::new(None),
        }
    })
}

// ---------------------------------------------------------------- API publique

/// Charge les réglages enregistrés et relance le retour s'il était actif.
pub fn init(data_dir: &Path) {
    let path = data_dir.join("mic-monitor.json");
    let saved = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<MonitorConfig>(&text).ok())
        .unwrap_or_default()
        .sanitized();
    *monitor().path.lock() = Some(path);
    apply(saved, false);
}

/// Le retour joue en ce moment (le visualiseur doit alors ignorer notre propre son).
pub fn is_running() -> bool {
    monitor().session.lock().running
}

pub fn status() -> MonitorStatus {
    let monitor = monitor();
    let session = monitor.session.lock().clone();
    let running = session.running;
    MonitorStatus {
        config: monitor.config.lock().clone(),
        running,
        error: session.error,
        input_level: if running { Meters::load(&monitor.meters.input) } else { 0.0 },
        output_level: if running { Meters::load(&monitor.meters.output) } else { 0.0 },
        gate_open: running && monitor.meters.gate_open.load(Ordering::Relaxed),
        voice: if running { Meters::load(&monitor.meters.voice) } else { 0.0 },
        input_name: session.input_name,
        output_name: session.output_name,
        output_kind: session.output_kind,
        sample_rate: session.sample_rate,
        latency_ms: session.latency_ms,
        denoise_available: !running || session.sample_rate == DENOISE_RATE,
    }
}

/// Applique de nouveaux réglages : à chaud si possible, sinon relance le thread audio.
pub fn set_config(config: MonitorConfig) -> MonitorStatus {
    apply(config.sanitized(), true);
    status()
}

/// Arrêt propre à la fermeture de l'application (sans changer le réglage enregistré).
pub fn shutdown() {
    stop_worker();
}

fn apply(config: MonitorConfig, persist: bool) {
    let monitor = monitor();
    let previous = std::mem::replace(&mut *monitor.config.lock(), config.clone());
    *monitor.params.lock() = DspParams::from(&config);
    let running = monitor.worker.lock().is_some();
    if config.enabled && (!running || config.needs_restart(&previous)) {
        stop_worker();
        start_worker(config.clone());
    } else if !config.enabled && running {
        stop_worker();
    }
    if persist {
        if let Some(path) = monitor.path.lock().clone() {
            if let Ok(text) = serde_json::to_string_pretty(&config) {
                let _ = std::fs::write(path, text);
            }
        }
    }
}

fn stop_worker() {
    let monitor = monitor();
    if let Some(worker) = monitor.worker.lock().take() {
        worker.stop.store(true, Ordering::Relaxed);
        let _ = worker.handle.join();
    }
    monitor.meters.reset();
    let mut session = monitor.session.lock();
    session.running = false;
    session.error = None;
}

fn start_worker(config: MonitorConfig) {
    let monitor = monitor();
    let stop = Arc::new(AtomicBool::new(false));
    let (params, meters, session) = (monitor.params.clone(), monitor.meters.clone(), monitor.session.clone());
    let thread_stop = stop.clone();
    let handle = std::thread::Builder::new()
        .name("mic-monitor".into())
        .spawn(move || worker_loop(config, params, meters, session, thread_stop))
        .expect("thread mic-monitor");
    *monitor.worker.lock() = Some(Worker { stop, handle });
}

// ---------------------------------------------------------------- Thread audio

enum Exit {
    Stopped,
    /// Le périphérique par défaut a changé : on rouvre sans signaler d'erreur.
    DefaultChanged,
}

fn worker_loop(
    config: MonitorConfig,
    params: Arc<Mutex<DspParams>>,
    meters: Arc<Meters>,
    session: Arc<Mutex<SessionInfo>>,
    stop: Arc<AtomicBool>,
) {
    com::ensure_mta();
    while !stop.load(Ordering::Relaxed) {
        match run_session(&config, &params, &meters, &session, &stop) {
            Ok(Exit::Stopped) => break,
            Ok(Exit::DefaultChanged) => continue,
            Err(message) => {
                crate::logger::log(&format!("[MicMonitor] {message}"));
                meters.reset();
                {
                    let mut info = session.lock();
                    info.running = false;
                    info.error = Some(message);
                }
                // Micro débranché, sortie occupée… on réessaie calmement.
                let until = Instant::now() + Duration::from_secs(2);
                while Instant::now() < until && !stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }
    }
    session.lock().running = false;
}

/// Événement Win32 fermé automatiquement.
struct Event(HANDLE);
impl Drop for Event {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Format de mixage alloué par WASAPI, libéré automatiquement.
struct MixFormat(*mut WAVEFORMATEX);
impl Drop for MixFormat {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0 as *const _)) }
    }
}

fn float_format(channels: u16, rate: u32) -> WAVEFORMATEX {
    let block = channels * 4;
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: channels,
        nSamplesPerSec: rate,
        nAvgBytesPerSec: rate * block as u32,
        nBlockAlign: block,
        wBitsPerSample: 32,
        cbSize: 0,
    }
}

fn run_session(
    config: &MonitorConfig,
    params: &Mutex<DspParams>,
    meters: &Meters,
    session: &Mutex<SessionInfo>,
    stop: &AtomicBool,
) -> Result<Exit, String> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(|e| format!("Audio indisponible ({e})"))?;
    let input = open_device(&enumerator, &config.input_id, eCapture).ok_or("Micro introuvable")?;
    let output = open_device(&enumerator, &config.output_id, eRender).ok_or("Sortie audio introuvable")?;
    let input_default_id = config.input_id.is_empty().then(|| device_id(&input)).flatten();
    let output_default_id = config.output_id.is_empty().then(|| device_id(&output)).flatten();

    unsafe {
        // --- Micro : format de mixage, en flottant 32 bits.
        let capture_client: IAudioClient = input.Activate(CLSCTX_ALL, None).map_err(|e| format!("Micro occupé ({e})"))?;
        let mix = MixFormat(capture_client.GetMixFormat().map_err(|e| format!("Format du micro illisible ({e})"))?);
        let in_channels = (*mix.0).nChannels.max(1);
        let rate = (*mix.0).nSamplesPerSec;
        let capture_format = float_format(in_channels, rate);
        capture_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                200_000, // 20 ms
                0,
                &capture_format,
                None,
            )
            .map_err(|e| format!("Impossible d'ouvrir le micro ({e})"))?;
        let event = Event(CreateEventW(None, false, false, None).map_err(|e| e.to_string())?);
        capture_client.SetEventHandle(event.0).map_err(|e| e.to_string())?;
        let capture: IAudioCaptureClient = capture_client.GetService().map_err(|e| e.to_string())?;

        // --- Casque : stéréo flottante à la fréquence du micro, Windows convertit si besoin.
        let render_client: IAudioClient = output.Activate(CLSCTX_ALL, None).map_err(|e| format!("Sortie occupée ({e})"))?;
        let render_format = float_format(2, rate);
        render_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                1_000_000, // 100 ms de réserve, on en remplit beaucoup moins
                0,
                &render_format,
                Some(&MONITOR_SESSION),
            )
            .map_err(|e| format!("Impossible d'ouvrir la sortie ({e})"))?;
        let render: IAudioRenderClient = render_client.GetService().map_err(|e| e.to_string())?;
        let render_size = render_client.GetBufferSize().map_err(|e| e.to_string())?;

        let target = ((rate as u64 * config.latency_ms() as u64) / 1000) as u32;
        let target = target.clamp(64, render_size / 2);
        // Pré-remplissage en silence : la sortie a de l'avance dès le départ.
        write_silence(&render, target)?;

        {
            let mut info = session.lock();
            *info = SessionInfo {
                running: true,
                error: None,
                input_name: friendly_name(&input),
                output_name: friendly_name(&output),
                output_kind: form_factor(&output).into(),
                sample_rate: rate,
                latency_ms: config.latency_ms() + 10 + if config.denoise && rate == DENOISE_RATE { 10 } else { 0 },
            };
        }
        crate::logger::log(&format!("[MicMonitor] started at {rate} Hz, {in_channels} ch, buffer {target} frames"));

        capture_client.Start().map_err(|e| e.to_string())?;
        render_client.Start().map_err(|e| e.to_string())?;

        let mut dsp = Dsp::new(rate);
        let mut mono: Vec<f32> = Vec::with_capacity(2048);
        let mut stereo: Vec<f32> = Vec::with_capacity(4096);
        let mut last_default_check = Instant::now();

        let result = loop {
            if stop.load(Ordering::Relaxed) {
                break Ok(Exit::Stopped);
            }
            if WaitForSingleObject(event.0, 200) != WAIT_OBJECT_0 {
                // Pas de paquet depuis 200 ms : micro probablement débranché.
                if capture_client.GetCurrentPadding().is_err() {
                    break Err("Micro déconnecté".into());
                }
            }

            // Suivre le périphérique par défaut quand l'utilisateur n'en a pas choisi.
            if last_default_check.elapsed() > Duration::from_secs(2) {
                last_default_check = Instant::now();
                let changed = |wanted: &Option<String>, flow| {
                    wanted.as_ref().is_some_and(|id| {
                        enumerator.GetDefaultAudioEndpoint(flow, eConsole).ok().and_then(|d| device_id(&d)).as_ref() != Some(id)
                    })
                };
                if changed(&input_default_id, eCapture) || changed(&output_default_id, eRender) {
                    break Ok(Exit::DefaultChanged);
                }
            }

            // Vider tous les paquets disponibles.
            mono.clear();
            loop {
                let packet = match capture.GetNextPacketSize() {
                    Ok(size) => size,
                    Err(e) => return finish(&capture_client, &render_client, Err(format!("Micro déconnecté ({e})"))),
                };
                if packet == 0 {
                    break;
                }
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                if let Err(e) = capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) {
                    return finish(&capture_client, &render_client, Err(format!("Lecture du micro impossible ({e})")));
                }
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null();
                if silent {
                    mono.extend(std::iter::repeat_n(0.0, frames as usize));
                } else {
                    let samples = std::slice::from_raw_parts(data as *const f32, frames as usize * in_channels as usize);
                    let scale = 1.0 / in_channels as f32;
                    mono.extend(samples.chunks_exact(in_channels as usize).map(|frame| frame.iter().sum::<f32>() * scale));
                }
                let _ = capture.ReleaseBuffer(frames);
            }
            if mono.is_empty() {
                continue;
            }

            let current = *params.lock();
            stereo.clear();
            dsp.process(&mono, &current, meters, &mut stereo);

            // Écrire dans la sortie en gardant le tampon proche de la cible.
            let padding = render_client.GetCurrentPadding().map_err(|e| format!("Sortie déconnectée ({e})"));
            let mut padding = match padding {
                Ok(p) => p,
                Err(e) => break Err(e),
            };
            if padding == 0 {
                // Sortie à sec : on remet un peu de silence pour éviter les craquements en série.
                if let Err(e) = write_silence(&render, target / 2) {
                    break Err(e);
                }
                padding = target / 2;
            }
            let frames_in = (stereo.len() / 2) as u32;
            let free = render_size.saturating_sub(padding);
            // Trop d'avance (dérive d'horloge entre micro et casque) : on saute des échantillons.
            let budget = (target * 2).saturating_sub(padding).min(free);
            let frames_out = frames_in.min(budget);
            if frames_out > 0 {
                let skip = (frames_in - frames_out) as usize * 2;
                match render.GetBuffer(frames_out) {
                    Ok(buffer) => {
                        let out = std::slice::from_raw_parts_mut(buffer as *mut f32, frames_out as usize * 2);
                        out.copy_from_slice(&stereo[skip..skip + out.len()]);
                        let _ = render.ReleaseBuffer(frames_out, 0);
                    }
                    Err(e) => break Err(format!("Sortie indisponible ({e})")),
                }
            }
        };
        finish(&capture_client, &render_client, result)
    }
}

/// Session audio propre au retour micro (le mélangeur de Windows l'affiche à part).
const MONITOR_SESSION: GUID = GUID::from_u128(0x6e6f6c79_735f_6d69_635f_6d6f6e69746f);

fn finish(capture: &IAudioClient, render: &IAudioClient, result: Result<Exit, String>) -> Result<Exit, String> {
    unsafe {
        let _ = capture.Stop();
        let _ = render.Stop();
    }
    result
}

unsafe fn write_silence(render: &IAudioRenderClient, frames: u32) -> Result<(), String> {
    if frames == 0 {
        return Ok(());
    }
    unsafe {
        render.GetBuffer(frames).map_err(|e| format!("Sortie indisponible ({e})"))?;
        render.ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32).map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------- Traitement du signal

struct Dsp {
    rate: f32,
    // Coupe-bas (biquad, 90 Hz).
    hp: Biquad,
    // RNNoise : entrée accumulée par trames de 480, sortie en file.
    denoiser: Option<Box<DenoiseState<'static>>>,
    denoise_in: Vec<f32>,
    denoise_out: std::collections::VecDeque<f32>,
    denoise_frame: Vec<f32>,
    voice: f32,
    // Porte de bruit.
    envelope: f32,
    gate_gain: f32,
    hold: f32,
    // Gain lissé (évite les clics quand on bouge le curseur).
    gain: f32,
    // Crêtes avec retombée, pour les vumètres.
    in_peak: f32,
    out_peak: f32,
}

impl Dsp {
    fn new(rate: u32) -> Self {
        Self {
            rate: rate as f32,
            hp: Biquad::high_pass(90.0, rate as f32),
            denoiser: None,
            denoise_in: Vec::with_capacity(DENOISE_FRAME * 2),
            denoise_out: std::collections::VecDeque::with_capacity(DENOISE_FRAME * 4),
            denoise_frame: vec![0.0; DENOISE_FRAME],
            voice: 0.0,
            envelope: 0.0,
            gate_gain: 0.0,
            hold: 0.0,
            gain: 0.0,
            in_peak: 0.0,
            out_peak: 0.0,
        }
    }

    fn process(&mut self, input: &[f32], params: &DspParams, meters: &Meters, out: &mut Vec<f32>) {
        let mut signal: Vec<f32> = input.to_vec();

        if params.high_pass {
            for sample in &mut signal {
                *sample = self.hp.run(*sample);
            }
        }

        let denoise = params.denoise && self.rate as u32 == DENOISE_RATE;
        if denoise {
            signal = self.denoise(&signal);
        } else {
            self.denoiser = None;
            self.denoise_in.clear();
            self.denoise_out.clear();
            self.voice = 0.0;
        }

        // Constantes de temps (par échantillon).
        let attack = (-1.0 / (0.002 * self.rate)).exp();
        let release = (-1.0 / (0.120 * self.rate)).exp();
        let gate_open_speed = 1.0 - (-1.0 / (0.004 * self.rate)).exp();
        let gate_close_speed = 1.0 - (-1.0 / (0.080 * self.rate)).exp();
        let gain_speed = 1.0 - (-1.0 / (0.030 * self.rate)).exp();
        let hold_time = 0.15 * self.rate;
        let meter_decay = (-(input.len() as f32) / (0.25 * self.rate)).exp();

        // Vumètre : le micro brut, avant coupe-bas et anti-bruit (sinon le silence parfait
        // de RNNoise affichait −∞ dès qu'on se taisait).
        let block_in = input.iter().fold(0f32, |peak, s| peak.max(s.abs()));
        let mut block_out = 0f32;
        out.reserve(signal.len() * 2);
        for &sample in &signal {
            let level = sample.abs();

            // Porte : enveloppe rapide à l'attaque, lente à la retombée, avec maintien.
            let coeff = if level > self.envelope { attack } else { release };
            self.envelope = coeff * self.envelope + (1.0 - coeff) * level;
            let target_gate = if !params.gate_enabled {
                1.0
            } else if self.envelope >= params.gate_threshold {
                self.hold = hold_time;
                1.0
            } else if self.hold > 0.0 {
                self.hold -= 1.0;
                1.0
            } else {
                0.0
            };
            let speed = if target_gate > self.gate_gain { gate_open_speed } else { gate_close_speed };
            self.gate_gain += (target_gate - self.gate_gain) * speed;

            self.gain += (params.gain - self.gain) * gain_speed;
            let value = soft_clip(sample * self.gate_gain * self.gain);
            block_out = block_out.max(value.abs());
            out.push(value * params.left);
            out.push(value * params.right);
        }

        self.in_peak = (self.in_peak * meter_decay).max(block_in);
        self.out_peak = (self.out_peak * meter_decay).max(block_out);
        Meters::store(&meters.input, self.in_peak.min(1.0));
        Meters::store(&meters.output, self.out_peak.min(1.0));
        Meters::store(&meters.voice, self.voice);
        meters.gate_open.store(self.gate_gain > 0.5, Ordering::Relaxed);
    }

    /// RNNoise : même nombre d'échantillons en sortie qu'en entrée (10 ms de retard).
    fn denoise(&mut self, input: &[f32]) -> Vec<f32> {
        let state = self.denoiser.get_or_insert_with(|| {
            // Une trame de silence d'avance : la sortie ne manque jamais d'échantillons.
            self.denoise_out.extend(std::iter::repeat_n(0.0, DENOISE_FRAME));
            DenoiseState::new()
        });
        self.denoise_in.extend(input.iter().map(|s| s * 32_768.0));
        while self.denoise_in.len() >= DENOISE_FRAME {
            let frame: Vec<f32> = self.denoise_in.drain(..DENOISE_FRAME).collect();
            let vad = state.process_frame(&mut self.denoise_frame, &frame);
            self.voice = self.voice * 0.6 + vad * 0.4;
            self.denoise_out.extend(self.denoise_frame.iter().map(|s| s / 32_768.0));
        }
        (0..input.len()).map(|_| self.denoise_out.pop_front().unwrap_or(0.0)).collect()
    }
}

/// Saturation douce au-delà de -3 dBFS : pas de clic dur si le gain pousse trop.
fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.707;
    let magnitude = x.abs();
    if magnitude <= KNEE {
        x
    } else {
        let over = (magnitude - KNEE) / (1.0 - KNEE);
        x.signum() * (KNEE + (1.0 - KNEE) * over.tanh())
    }
}

/// Filtre biquad (RBJ), utilisé en passe-haut.
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn high_pass(cutoff: f32, rate: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * cutoff / rate;
        let alpha = w0.sin() / (2.0 * std::f32::consts::FRAC_1_SQRT_2);
        let cos = w0.cos();
        let a0 = 1.0 + alpha;
        Self {
            b0: (1.0 + cos) / 2.0 / a0,
            b1: -(1.0 + cos) / a0,
            b2: (1.0 + cos) / 2.0 / a0,
            a1: -2.0 * cos / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

// ---------------------------------------------------------------- Périphériques

fn open_device(enumerator: &IMMDeviceEnumerator, id: &str, flow: EDataFlow) -> Option<IMMDevice> {
    unsafe {
        if !id.is_empty() {
            if let Ok(device) = enumerator.GetDevice(&HSTRING::from(id)) {
                return Some(device);
            }
        }
        enumerator.GetDefaultAudioEndpoint(flow, eConsole).ok()
    }
}

fn device_id(device: &IMMDevice) -> Option<String> {
    unsafe {
        let raw = device.GetId().ok()?;
        let id = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0 as *const _));
        id
    }
}

fn friendly_name(device: &IMMDevice) -> String {
    unsafe {
        device
            .OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|value| value.to_string())
            .unwrap_or_default()
    }
}

/// Type de sortie (EndpointFormFactor) : sert à prévenir du Larsen sur des enceintes.
///
/// Beaucoup de casques USB se déclarent « haut-parleurs » : le nom tranche alors.
fn form_factor(device: &IMMDevice) -> &'static str {
    const HEADSET_WORDS: [&str; 9] = ["headset", "headphone", "casque", "écouteur", "ecouteur", "buds", "airpods", "earphone", "hands-free"];
    let name = friendly_name(device).to_lowercase();
    if HEADSET_WORDS.iter().any(|word| name.contains(word)) {
        return "headset";
    }
    let value = unsafe {
        device
            .OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_AudioEndpoint_FormFactor))
            .ok()
            .and_then(|value| u32::try_from(&value).ok())
    };
    match value {
        Some(1) => "speakers",
        Some(3) => "headphones",
        Some(5) => "headset",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ouvre le vrai micro et la vraie sortie, volume à zéro (rien d'audible).
    #[test]
    #[ignore = "nécessite un micro et une sortie audio"]
    fn opens_real_devices() {
        let config = MonitorConfig { enabled: true, volume: 0, denoise: true, gate_enabled: true, ..Default::default() };
        set_config(config);
        let mut max_level = 0f32;
        for _ in 0..30 {
            std::thread::sleep(Duration::from_millis(100));
            max_level = max_level.max(status().input_level);
        }
        println!("niveau max du micro : {max_level}");
        println!("visualiseur (sans le retour) : {:?}", crate::platform::audio::peak());
        let status = status();
        shutdown();
        println!("{status:#?}");
        assert!(status.running, "erreur : {:?}", status.error);
        assert!(status.sample_rate > 0);
    }
}
