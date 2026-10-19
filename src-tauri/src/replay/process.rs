//! Every helper has an owner, a deadline, and no console window.
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    time::{Duration, Instant},
};

pub fn command(engine: &Path) -> Command {
    let mut cmd = Command::new(engine);
    cmd.creation_flags(0x08000000);
    cmd
}

pub fn resolve(configured: &str, resources: &Path) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if !configured.is_empty() {
        candidates.push(PathBuf::from(configured));
    } else {
        candidates.push(resources.join("resources/replay/ffmpeg.exe"));
        candidates.push(resources.join("replay/ffmpeg.exe"));
        candidates
            .push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/replay/ffmpeg.exe"));
        candidates.extend(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .map(|p| p.join("ffmpeg.exe")),
        );
    }
    candidates
        .into_iter()
        .find(|p| {
            p.is_absolute()
                && p.is_file()
                && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        })
        .ok_or_else(|| {
            "Moteur vidéo introuvable. Choisissez ffmpeg.exe dans les réglages du module.".into()
        })
}

pub struct OwnedChild(pub Child, #[allow(dead_code)] Job); // The job is a lifetime guard, closed on drop.
struct Job(windows::Win32::Foundation::HANDLE);
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
impl OwnedChild {
    pub fn new(mut child: Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::{Foundation::HANDLE, System::JobObjects::*};
        let result = (|| unsafe {
            let handle =
                CreateJobObjectW(None, windows::core::PCWSTR::null()).map_err(|e| e.to_string())?;
            let job = Job(handle);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
            .map_err(|e| e.to_string())?;
            AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle())).map_err(|e| {
                format!("Impossible de protéger le processus vidéo contre un arrêt de Nolys : {e}")
            })?;
            Ok(job)
        })();
        match result {
            Ok(job) => Ok(Self(child, job)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(e)
            }
        }
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn output(engine: &Path, args: &[&str], seconds: u64) -> Result<Output, String> {
    // Drain both pipes concurrently so a full log pipe never deadlocks a probe.
    use std::io::Read;
    let mut child = OwnedChild::new(
        command(engine)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?,
    )?;
    let stdout = child.0.stdout.take().ok_or("Sortie vidéo indisponible.")?;
    let stderr = child.0.stderr.take().ok_or("Journal vidéo indisponible.")?;
    let read = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = pipe.by_ref().take(2 * 1024 * 1024).read_to_end(&mut b);
            let _ = std::io::copy(&mut pipe, &mut std::io::sink());
            b
        })
    };
    let out = read(Box::new(stdout));
    let err = read(Box::new(stderr));
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let status = loop {
        if let Some(s) = child.0.try_wait().map_err(|e| e.to_string())? {
            break Ok(s);
        }
        if Instant::now() >= deadline {
            let _ = child.0.kill();
            let _ = child.0.wait();
            break Err("Le moteur vidéo ne répond pas dans le délai prévu.".to_string());
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    Ok(Output {
        status: status?,
        stdout,
        stderr,
    })
}
