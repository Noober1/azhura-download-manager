// ---------------------------------------------------------------------------
// Loopback bridge: lets the browser extension hand a captured download's
// credentials (session cookie, referrer) off to this already-running app
// without ever putting them on the OS command line.
//
// The `adm://` deep link is still how the actual navigation happens — the OS
// delivers it to this process as a plain argument (see `deeplink.rs`), which
// on Windows is readable by any other process running as this user and is
// captured verbatim by Sysmon/EDR process-creation logging, crash dumps and
// Prefetch. Putting a live session cookie there hands it to anything
// watching. Instead the extension POSTs the secret here first over loopback
// HTTP, and the `adm://` link itself carries only an opaque, one-time
// handoff id.
//
// Residual risk: a local process that squats one of these ports *before* ADM
// starts could receive a handoff meant for ADM. Pairing the extension to a
// per-install secret would close that gap, but needs a user-facing pairing
// step in the extensions dialog — out of scope here. This still removes the
// credential from every place that logs command lines, which is the
// exposure that actually matters in practice.
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tiny_http::{Method, Response, Server};

const PORTS: std::ops::RangeInclusive<u16> = 47600..=47609;
const PING_BODY: &str = "azhura-download-manager";
/// A handoff not claimed within this window is dropped — the extension posts
/// it and navigates the `adm://` link within milliseconds, so this is purely
/// a bound on how long an unclaimed secret sits in memory.
const HANDOFF_TTL: Duration = Duration::from_secs(30);
const MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone, Default)]
pub(crate) struct Handoff {
    pub(crate) cookie: String,
    pub(crate) referrer: String,
}

#[derive(Deserialize)]
struct HandoffRequest {
    id: String,
    #[serde(default)]
    cookie: String,
    #[serde(default)]
    referrer: String,
}

#[derive(Default)]
pub(crate) struct HandoffStore(Mutex<HashMap<String, (Handoff, Instant)>>);

impl HandoffStore {
    pub(crate) fn insert(&self, id: String, handoff: Handoff) {
        let mut guard = self.0.lock().unwrap();
        let now = Instant::now();
        guard.retain(|_, (_, at)| now.duration_since(*at) < HANDOFF_TTL);
        guard.insert(id, (handoff, now));
    }

    /// One-shot: removes the entry so it can never be read back out twice —
    /// this, together with there being no route that reads an entry without
    /// consuming it, is what stops some other local page from fishing a
    /// cookie out of this store.
    pub(crate) fn take(&self, id: &str) -> Option<Handoff> {
        let mut guard = self.0.lock().unwrap();
        let now = Instant::now();
        guard.retain(|_, (_, at)| now.duration_since(*at) < HANDOFF_TTL);
        guard.remove(id).map(|(h, _)| h)
    }
}

/// Whether the loopback listener is up, and which port it landed on — queried
/// by the `grabber_status` command to drive the status-bar indicator. The
/// port is still never sent over the network (the extension just scans the
/// whole range itself); this only surfaces it to this same process's own
/// frontend over IPC.
#[derive(Default)]
pub(crate) struct BridgeStatus {
    pub(crate) port: Option<u16>,
    running: AtomicBool,
}

impl BridgeStatus {
    fn bound(port: u16) -> Self {
        Self {
            port: Some(port),
            running: AtomicBool::new(true),
        }
    }
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrabberStatus {
    running: bool,
    port: Option<u16>,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn grabber_status(status: tauri::State<'_, Arc<BridgeStatus>>) -> GrabberStatus {
    GrabberStatus {
        running: status.running.load(Ordering::Relaxed),
        port: status.port,
    }
}

/// Binds the loopback listener (synchronously, so the caller knows right away
/// whether a port was free) and starts serving it on its own OS thread — the
/// server is blocking/sync, so it can't run on the tokio runtime. Returns the
/// handoff store and the bind status Tauri commands and `deeplink.rs` can
/// query. Binds only to `127.0.0.1`, never `0.0.0.0`.
pub(crate) fn start() -> (Arc<HandoffStore>, Arc<BridgeStatus>) {
    let store = Arc::new(HandoffStore::default());
    let server = PORTS
        .clone()
        .find_map(|port| Server::http(("127.0.0.1", port)).ok().zip(Some(port)));

    let Some((server, port)) = server else {
        eprintln!(
            "adm bridge: no port in {}..={} was free; the browser extension will fall back to \
             the legacy URL-embedded handoff for this session",
            PORTS.start(),
            PORTS.end()
        );
        return (store, Arc::new(BridgeStatus::default()));
    };

    let status = Arc::new(BridgeStatus::bound(port));
    let worker_store = store.clone();
    let worker_status = status.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_request(&worker_store, request);
        }
        // `incoming_requests()` only stops iterating once the server itself
        // is gone — keep the indicator honest instead of leaving it frozen
        // at "running" forever.
        worker_status.running.store(false, Ordering::Relaxed);
    });
    (store, status)
}

fn handle_request(store: &HandoffStore, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().to_string();
    match (method, url.as_str()) {
        (Method::Get, "/adm-ping") => {
            let _ = request.respond(Response::from_string(PING_BODY));
        }
        (Method::Post, "/handoff") => {
            if request.body_length().unwrap_or(0) > MAX_BODY_BYTES {
                let _ = request.respond(Response::empty(413));
                return;
            }
            let mut body = String::new();
            if request
                .as_reader()
                .take(MAX_BODY_BYTES as u64)
                .read_to_string(&mut body)
                .is_err()
            {
                let _ = request.respond(Response::empty(400));
                return;
            }
            match serde_json::from_str::<HandoffRequest>(&body) {
                Ok(req) if !req.id.is_empty() => {
                    store.insert(
                        req.id,
                        Handoff {
                            cookie: req.cookie,
                            referrer: req.referrer,
                        },
                    );
                    let _ = request.respond(Response::empty(204));
                }
                _ => {
                    let _ = request.respond(Response::empty(400));
                }
            }
        }
        // No CORS headers are ever sent, and every other path/method 404s —
        // this endpoint has exactly two routes and nothing to discover.
        _ => {
            let _ = request.respond(Response::empty(404));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_returns_the_stored_handoff_once_and_then_nothing() {
        let store = HandoffStore::default();
        store.insert(
            "abc".to_string(),
            Handoff {
                cookie: "a=b".to_string(),
                referrer: "https://example.com".to_string(),
            },
        );
        let taken = store.take("abc").expect("first take should find it");
        assert_eq!(taken.cookie, "a=b");
        assert!(store.take("abc").is_none(), "a second take must find nothing");
    }

    #[test]
    fn take_of_unknown_id_is_none() {
        let store = HandoffStore::default();
        assert!(store.take("does-not-exist").is_none());
    }

    #[test]
    fn bridge_status_defaults_to_not_running_with_no_port() {
        let status = BridgeStatus::default();
        assert!(!status.running.load(Ordering::Relaxed));
        assert_eq!(status.port, None);
    }

    #[test]
    fn bridge_status_bound_reports_running_with_its_port() {
        let status = BridgeStatus::bound(47600);
        assert!(status.running.load(Ordering::Relaxed));
        assert_eq!(status.port, Some(47600));
    }
}
