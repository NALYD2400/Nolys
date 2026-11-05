//! Client HTTP minimal basé sur `Windows.Web.Http` (aucune dépendance réseau embarquée).

use windows::core::HSTRING;
use windows::Foundation::Uri;
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicBool, Ordering};
use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};
use windows::Web::Http::{HttpClient, HttpCompletionOption};

use super::com;

static OFFLINE: AtomicBool = AtomicBool::new(false);
pub fn set_offline(offline: bool) { OFFLINE.store(offline, Ordering::Release); }
pub fn is_offline() -> bool { OFFLINE.load(Ordering::Acquire) }

fn client() -> windows::core::Result<HttpClient> {
    com::ensure_mta();
    HttpClient::new()
}

pub fn get_text(url: &str) -> Option<String> {
    String::from_utf8(request(url, 1024 * 1024, Duration::from_secs(10), &|| false)?).ok()
}

pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

/// A superseded wallpaper request can cancel its current WinRT operation.
pub fn get_bytes_cancellable(url: &str, cancelled: &dyn Fn() -> bool) -> Option<Vec<u8>> {
    request(url, MAX_IMAGE_BYTES, Duration::from_secs(10), cancelled)
}

fn wait<T>(ready: impl Fn() -> Option<bool>, result: impl Fn() -> Option<T>, cancel: impl FnOnce(), deadline: Instant, cancelled: &dyn Fn() -> bool) -> Option<T> {
    loop {
        if is_offline() || cancelled() || Instant::now() >= deadline { cancel(); return None; }
        if ready()? { return result(); }
        std::thread::sleep(Duration::from_millis(15));
    }
}

macro_rules! bounded {
    ($operation:expr, $deadline:expr, $cancelled:expr) => {{
        let operation = $operation;
        wait(|| operation.Status().ok().map(|status| status.0 != 0), || operation.GetResults().ok(), || { let _ = operation.Cancel(); }, $deadline, $cancelled)
    }};
}

fn request(url: &str, limit: usize, timeout: Duration, cancelled: &dyn Fn() -> bool) -> Option<Vec<u8>> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || is_offline() || cancelled() { return None; }
    let uri = Uri::CreateUri(&HSTRING::from(url)).ok()?;
    let client = client().ok()?;
    let deadline = Instant::now() + timeout;
    let result = (|| {
        // ResponseContentRead would allocate the entire reply before our cap.
        let response = bounded!(client.GetWithOptionAsync(&uri, HttpCompletionOption::ResponseHeadersRead).ok()?, deadline, cancelled)?;
        let result = (|| {
            if !response.IsSuccessStatusCode().ok()? { return None; }
            let content = response.Content().ok()?;
            let stream = bounded!(content.ReadAsInputStreamAsync().ok()?, deadline, cancelled)?;
            let result = (|| {
                let mut bytes = Vec::new();
                loop {
                    let chunk = Buffer::Create(16 * 1024).ok()?;
                    let buffer = bounded!(stream.ReadAsync(&chunk, 16 * 1024, InputStreamOptions::Partial).ok()?, deadline, cancelled)?;
                    let length = buffer.Length().ok()? as usize;
                    if length == 0 { return Some(bytes); }
                    if length > limit.saturating_sub(bytes.len()) { return None; }
                    let reader = DataReader::FromBuffer(&buffer).ok()?;
                    let start = bytes.len(); bytes.resize(start + length, 0);
                    reader.ReadBytes(&mut bytes[start..]).ok()?;
                }
            })();
            let _ = stream.Close();
            result
        })();
        let _ = response.Close();
        result
    })();
    let _ = client.Close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[test]
    fn an_expired_or_cancelled_wait_cancels_without_joining() {
        let called = AtomicBool::new(false);
        let result: Option<()> = wait(|| Some(false), || Some(()), || { called.store(true, Ordering::Release); }, Instant::now(), &|| false);
        assert!(result.is_none()); assert!(called.load(Ordering::Acquire));
        called.store(false, Ordering::Release);
        let result: Option<()> = wait(|| Some(false), || Some(()), || { called.store(true, Ordering::Release); }, Instant::now() + Duration::from_secs(2), &|| true);
        assert!(result.is_none()); assert!(called.load(Ordering::Acquire));
    }
    #[test]
    fn completed_wait_returns_the_value() {
        assert_eq!(wait(|| Some(true), || Some(42), || panic!("completed operation must not be cancelled"), Instant::now() + Duration::from_secs(1), &|| false), Some(42));
    }
    #[test]
    fn streamed_replies_enforce_size_and_timeout_against_a_local_server() {
        use std::{io::{Read, Write}, net::TcpListener};
        fn local_response(body: Vec<u8>, stall: bool) -> (String, std::thread::JoinHandle<()>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/bounded-test", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let server = std::thread::spawn(move || {
                let until = Instant::now() + Duration::from_secs(3);
                let mut stream = loop {
                    if let Ok((stream, _)) = listener.accept() { break stream; }
                    if Instant::now() >= until { return; }
                    std::thread::sleep(Duration::from_millis(5));
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                // TCP peut fragmenter les en-têtes. Fermer avec des octets de
                // requête non lus peut produire un RST et tronquer la réponse.
                let mut request = Vec::new();
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let mut chunk = [0; 4096];
                    let count = stream.read(&mut chunk).unwrap();
                    assert!(count > 0 && request.len() + count <= 16 * 1024);
                    request.extend_from_slice(&chunk[..count]);
                }
                let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(header.as_bytes());
                if stall { std::thread::sleep(Duration::from_millis(350)); }
                let _ = stream.write_all(&body);
            });
            (url, server)
        }
        let (url, server) = local_response(vec![b'a'; 32], false);
        assert!(request(&url, 16, Duration::from_secs(2), &|| false).is_none()); server.join().unwrap();
        let (url, server) = local_response(b"bounded reply".to_vec(), false);
        assert_eq!(request(&url, 16, Duration::from_secs(2), &|| false), Some(b"bounded reply".to_vec())); server.join().unwrap();
        let (url, server) = local_response(vec![b'a'; 32], true);
        let started = Instant::now();
        assert!(request(&url, 64, Duration::from_millis(100), &|| false).is_none());
        assert!(started.elapsed() < Duration::from_secs(2)); server.join().unwrap();
    }
}

pub fn get_json(url: &str) -> Option<serde_json::Value> {
    serde_json::from_str(&get_text(url)?).ok()
}
