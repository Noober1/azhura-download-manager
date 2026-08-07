use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager as _};

use crate::bridge::HandoffStore;
#[cfg(test)]
use crate::bridge::Handoff;

/// Holds an `adm://` link seen before the Add window's frontend had a
/// chance to mount (i.e. a cold start — see `handle_deep_link_cold_start`
/// below). The Add window collects it once via `take_pending_deep_link`
/// right after it starts up, prefills the form from it, and reveals itself.
#[derive(Default)]
pub(crate) struct PendingDeepLink(Mutex<Option<serde_json::Value>>);

/// Parse an `adm://add?url=...&filename=...&handoff=...` deep link into an
/// `AddPayload`-shaped JSON value (see `src/types.ts`), or `None` if it isn't
/// a well-formed link for this app.
///
/// The referrer and cookie never travel in the link itself — the OS delivers
/// `adm://` links to this process as a plain command-line argument, which is
/// readable by any other process on the machine and captured verbatim by
/// process-creation logging. Instead the extension POSTs those over loopback
/// HTTP first (see `bridge.rs`) and hands this function only a one-time id
/// to claim them by. `handoffs` is threaded in as a plain argument rather
/// than reached for as global state, so this stays a pure, easily-tested
/// function.
///
/// `referrer=`/`cookie=` query params are still accepted as a fallback for
/// an extension build installed before the loopback handoff existed, or for
/// a session where no bridge port could bind (see `bridge::start`) — that
/// path still puts the secret on the command line, so it's deliberately
/// temporary and logged when taken.
pub(crate) fn build_deep_link_payload(link: &str, handoffs: &HandoffStore) -> Option<serde_json::Value> {
    let parsed = url::Url::parse(link).ok()?;
    if parsed.scheme() != "adm" {
        return None;
    }
    let mut target_url = String::new();
    let mut filename = String::new();
    let mut referrer = String::new();
    let mut cookie = String::new();
    let mut handoff_id = String::new();
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "url" => target_url = value.into_owned(),
            "filename" => filename = value.into_owned(),
            "referrer" => referrer = value.into_owned(),
            // Some hosts (e.g. gofile.io) gate their direct download URLs
            // behind a session cookie the browser sends automatically but a
            // plain HTTP client won't have — the extension looks it up via
            // `chrome.cookies` for a short allow-list of such hosts and
            // forwards it here so it can ride along as a real header.
            "cookie" => cookie = value.into_owned(),
            "handoff" => handoff_id = value.into_owned(),
            _ => {}
        }
    }

    if !handoff_id.is_empty() {
        match handoffs.take(&handoff_id) {
            Some(h) => {
                if !h.cookie.is_empty() {
                    cookie = h.cookie;
                }
                if !h.referrer.is_empty() {
                    referrer = h.referrer;
                }
            }
            None => {
                eprintln!(
                    "adm bridge: handoff id was not found (expired, already used, or a stale \
                     link) — continuing without credentials for this capture"
                );
            }
        }
    } else if !cookie.is_empty() {
        eprintln!(
            "adm: received a deep link with a cookie embedded directly in the URL (legacy \
             extension build, or no bridge port was available) — update the browser extension \
             to pick up the loopback handoff"
        );
    }

    // Reject anything that isn't an actual http(s) target — e.g. a
    // `javascript:` link the extension couldn't resolve to a real URL — so
    // it doesn't show up as a row that just immediately errors.
    let is_http = target_url.starts_with("http://") || target_url.starts_with("https://");
    if target_url.is_empty() || !is_http {
        return None;
    }
    let mut headers: Vec<(String, String)> = Vec::new();
    if !referrer.is_empty() {
        headers.push(("Referer".to_string(), referrer));
    }
    if !cookie.is_empty() {
        headers.push(("Cookie".to_string(), cookie));
    }
    Some(serde_json::json!({
        "url": target_url,
        // Reaching ADM via the extension is already a deliberate, single-link
        // user action (right-click → "Download with ADM"), unlike the Add
        // window's insecure-http path which pops a confirmation dialog before
        // retrying with this set — there's no such follow-up UI here.
        "allowInsecure": true,
        "headers": headers,
        "connections": 8,
        "checksum": "",
        "speedLimit": 0,
        "later": false,
        "filename": filename,
        "savePath": "",
        // The extension capture carries no proxy info; the Add window keeps
        // whatever the user has remembered rather than reading this.
        "proxy": {
            "enabled": false,
            "scheme": "http",
            "host": "",
            "port": 0,
            "username": "",
            "password": ""
        },
    }))
}

/// Handle a deep link while the app is already up (warm start via
/// single-instance, or an OS "open URL" event on an already-running app).
///
/// The payload goes to `main` rather than straight to the Add window, because
/// `main` is the only side that knows whether a history row is currently
/// waiting to re-capture credentials for this URL. It either claims the
/// capture and resumes that row itself, or calls `reveal_add_window_cmd` +
/// forwards the prefill for the normal review flow. Routing the decision
/// through one place avoids both a race and a visible Add-window flash.
pub(crate) fn handle_deep_link(app: &tauri::AppHandle, link: &str) {
    let handoffs = app.state::<Arc<HandoffStore>>();
    let Some(payload) = build_deep_link_payload(link, &handoffs) else {
        return;
    };
    crate::windows::reveal_main_window(app);
    let _ = app.emit_to("main", "deep-link-captured", payload);
}

/// Handle a deep link seen at cold start (`std::env::args()` in `setup()`):
/// the Add window's frontend hasn't mounted yet at this point, so emitting
/// immediately would silently drop the event. Stash it instead — the Add
/// window calls `take_pending_deep_link` right after it starts up.
pub(crate) fn handle_deep_link_cold_start(app: &tauri::AppHandle, link: &str) {
    let handoffs = app.state::<Arc<HandoffStore>>();
    let Some(payload) = build_deep_link_payload(link, &handoffs) else {
        return;
    };
    app.state::<PendingDeepLink>().0.lock().unwrap().replace(payload);
}

// Deliberately plain `#[tauri::command]` — see `submit_add` in
// `windows/add.rs` for why: this crate's `specta` (rc.25) overflows the
// stack trying to export a `serde_json::Value`-shaped command.
#[tauri::command]
pub(crate) fn take_pending_deep_link(state: tauri::State<'_, PendingDeepLink>) -> Option<serde_json::Value> {
    state.0.lock().unwrap().take()
}

/// Pull an `adm://` URL out of raw process args (used both for the
/// single-instance callback's `argv` and for `std::env::args()` at cold
/// start, since the deep-link plugin only auto-fires for warm starts).
pub(crate) fn deep_link_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find(|a| a.starts_with("adm://"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_link_payload_rejects_non_adm_scheme() {
        let handoffs = HandoffStore::default();
        assert!(build_deep_link_payload("https://example.com", &handoffs).is_none());
    }

    #[test]
    fn deep_link_payload_rejects_non_http_target() {
        let handoffs = HandoffStore::default();
        assert!(build_deep_link_payload("adm://add?url=ftp://example.com/file", &handoffs).is_none());
        assert!(build_deep_link_payload("adm://add", &handoffs).is_none());
    }

    #[test]
    fn deep_link_payload_carries_legacy_referrer_and_cookie_as_headers() {
        let handoffs = HandoffStore::default();
        let payload = build_deep_link_payload(
            "adm://add?url=https://example.com/file.zip&referrer=https://ref.example&cookie=a=b",
            &handoffs,
        )
        .expect("well-formed adm link should parse");
        assert_eq!(payload["url"], "https://example.com/file.zip");
        let headers = payload["headers"].as_array().unwrap();
        assert!(headers
            .iter()
            .any(|h| h[0] == "Referer" && h[1] == "https://ref.example"));
        assert!(headers.iter().any(|h| h[0] == "Cookie" && h[1] == "a=b"));
    }

    #[test]
    fn deep_link_payload_resolves_handoff_id_into_headers_without_url_credentials() {
        let handoffs = HandoffStore::default();
        handoffs.insert(
            "tok-1".to_string(),
            Handoff {
                cookie: "session=xyz".to_string(),
                referrer: "https://host.example/page".to_string(),
            },
        );
        let payload = build_deep_link_payload(
            "adm://add?url=https://example.com/file.zip&handoff=tok-1",
            &handoffs,
        )
        .expect("well-formed adm link should parse");
        let headers = payload["headers"].as_array().unwrap();
        assert!(headers
            .iter()
            .any(|h| h[0] == "Referer" && h[1] == "https://host.example/page"));
        assert!(headers.iter().any(|h| h[0] == "Cookie" && h[1] == "session=xyz"));
        // One-shot: a second parse of a link reusing the same id gets nothing.
        let second = build_deep_link_payload(
            "adm://add?url=https://example.com/file.zip&handoff=tok-1",
            &handoffs,
        )
        .expect("still a well-formed link");
        assert!(second["headers"].as_array().unwrap().is_empty());
    }

    #[test]
    fn deep_link_payload_with_unknown_handoff_id_drops_credentials_silently() {
        let handoffs = HandoffStore::default();
        let payload = build_deep_link_payload(
            "adm://add?url=https://example.com/file.zip&handoff=does-not-exist",
            &handoffs,
        )
        .expect("still parses as a valid link");
        assert!(payload["headers"].as_array().unwrap().is_empty());
    }

    #[test]
    fn deep_link_from_args_finds_adm_url() {
        let args = vec!["program".to_string(), "adm://add?url=https://x".to_string()];
        assert_eq!(
            deep_link_from_args(args),
            Some("adm://add?url=https://x".to_string())
        );
    }

    #[test]
    fn deep_link_from_args_none_when_absent() {
        let args = vec!["program".to_string(), "--flag".to_string()];
        assert_eq!(deep_link_from_args(args), None);
    }
}
