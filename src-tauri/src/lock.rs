// App lock: an optional numeric PIN gating the UI (not the download engine).
// The Argon2 hash lives in its own lock.json — never in settings.json, which
// the frontend overwrites wholesale — and never crosses IPC.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager as _};

use crate::config::{config_dir, write_json_atomic};

pub(crate) const PIN_MIN: usize = 4;
pub(crate) const PIN_MAX: usize = 8;
const FREE_ATTEMPTS: u32 = 5;
const BASE_COOLDOWN_SECS: u64 = 30;
const MAX_COOLDOWN_SECS: u64 = 300;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum AddReveal {
    Open,
    Reveal,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockFile {
    pin_hash: String,
}

#[derive(Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LockStatus {
    enabled: bool,
    locked: bool,
    retry_after_secs: u32,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnlockResult {
    ok: bool,
    retry_after_secs: u32,
}

#[derive(Default)]
struct LockInner {
    hash: Option<String>,
    locked: bool,
    failures: u32,
    blocked_until: Option<Instant>,
    pending_add: Option<AddReveal>,
}

impl LockInner {
    fn retry_after(&self, now: Instant) -> u32 {
        match self.blocked_until {
            Some(until) if until > now => (until - now).as_secs_f64().ceil() as u32,
            _ => 0,
        }
    }

    fn register_failure(&mut self, now: Instant) {
        self.failures += 1;
        let secs = cooldown_secs(self.failures);
        if secs > 0 {
            self.blocked_until = Some(now + Duration::from_secs(secs));
        }
    }

    fn register_success(&mut self) {
        self.failures = 0;
        self.blocked_until = None;
    }

    fn status(&self, now: Instant) -> LockStatus {
        LockStatus {
            enabled: self.hash.is_some(),
            locked: self.locked,
            retry_after_secs: self.retry_after(now),
        }
    }
}

pub(crate) struct LockState(Mutex<LockInner>);

/// Length within `PIN_MIN..=PIN_MAX` and every char an ASCII digit — rejects
/// non-ASCII digit scripts (e.g. Arabic-Indic) that `char::is_numeric()` would
/// otherwise accept but Argon2 hashing (byte-based) would treat inconsistently.
pub(crate) fn is_valid_pin(pin: &str) -> bool {
    (PIN_MIN..=PIN_MAX).contains(&pin.chars().count()) && pin.chars().all(|c| c.is_ascii_digit())
}

fn cooldown_secs(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let shift = (failures - FREE_ATTEMPTS).min(8);
    (BASE_COOLDOWN_SECS << shift).min(MAX_COOLDOWN_SECS)
}

/// `Reveal` wins over `Open`: a prefilled capture must not be replaced by the
/// clipboard read that `window-opened` triggers.
fn merge_pending(cur: Option<AddReveal>, new: AddReveal) -> AddReveal {
    if cur == Some(AddReveal::Reveal) || new == AddReveal::Reveal {
        AddReveal::Reveal
    } else {
        AddReveal::Open
    }
}

fn hash_pin(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

fn verify_pin(pin: &str, phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else {
        return false;
    };
    Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok()
}

/// Fail-open (returns `None`) on a missing/corrupt/non-PHC file, consistent
/// with the documented recovery of deleting the file by hand.
fn parse_lock_file(bytes: &[u8]) -> Option<String> {
    let file: LockFile = serde_json::from_slice(bytes).ok()?;
    if PasswordHash::new(&file.pin_hash).is_ok() {
        Some(file.pin_hash)
    } else {
        eprintln!("lock.json's pin_hash isn't a valid PHC string; ignoring it");
        None
    }
}

fn lock_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("lock.json"))
}

impl LockState {
    pub(crate) fn load() -> Self {
        let hash = lock_path()
            .ok()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|bytes| parse_lock_file(&bytes));
        let locked = hash.is_some();
        Self(Mutex::new(LockInner { hash, locked, ..Default::default() }))
    }
}

pub(crate) fn is_locked(app: &tauri::AppHandle) -> bool {
    let state = app.state::<LockState>();
    let locked = state.0.lock().unwrap().locked;
    locked
}

fn emit_status(app: &tauri::AppHandle) {
    let state = app.state::<LockState>();
    let status = state.0.lock().unwrap().status(Instant::now());
    let _ = app.emit_to("main", "lock-changed", status);
}

/// Engages the lock (on app start via `locked` already being true at load, on
/// hide-to-tray, and on Ctrl+L / File > Lock Now). No-op if no PIN is set or
/// it's already locked.
pub(crate) fn engage(app: &tauri::AppHandle) {
    {
        let state = app.state::<LockState>();
        let mut inner = state.0.lock().unwrap();
        if inner.hash.is_none() || inner.locked {
            return;
        }
        if app.get_webview_window("add").is_some_and(|w| w.is_visible().unwrap_or(false)) {
            inner.pending_add = Some(merge_pending(inner.pending_add, AddReveal::Reveal));
        }
        inner.locked = true;
    }
    crate::windows::hide_secondary_windows(app);
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
    }
    crate::tray::clear_tray_downloads(app);
    emit_status(app);
}

/// Called from `open_add_window`/`reveal_add_window_cmd` before they do
/// anything else. Returns `true` (caller should return early) when locked —
/// the request is stashed and replayed once `unlock_app` succeeds.
pub(crate) fn defer_add(app: &tauri::AppHandle, kind: AddReveal) -> bool {
    let state = app.state::<LockState>();
    let mut inner = state.0.lock().unwrap();
    if !inner.locked {
        return false;
    }
    inner.pending_add = Some(merge_pending(inner.pending_add, kind));
    drop(inner);
    crate::windows::reveal_main_window(app);
    true
}

#[tauri::command]
#[specta::specta]
pub(crate) fn lock_status(state: tauri::State<'_, LockState>) -> LockStatus {
    state.0.lock().unwrap().status(Instant::now())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn unlock_app(app: tauri::AppHandle, pin: String) -> Result<UnlockResult, String> {
    let hash = {
        let state = app.state::<LockState>();
        let inner = state.0.lock().unwrap();
        if !inner.locked {
            return Ok(UnlockResult { ok: true, retry_after_secs: 0 });
        }
        let retry = inner.retry_after(Instant::now());
        if retry > 0 {
            return Ok(UnlockResult { ok: false, retry_after_secs: retry });
        }
        inner.hash.clone()
    };

    let ok = !pin.is_empty()
        && pin.len() <= PIN_MAX
        && tauri::async_runtime::spawn_blocking(move || {
            hash.as_deref().is_some_and(|h| verify_pin(&pin, h))
        })
        .await
        .unwrap_or(false);

    let pending = {
        let state = app.state::<LockState>();
        let mut inner = state.0.lock().unwrap();
        if !ok {
            inner.register_failure(Instant::now());
            return Ok(UnlockResult { ok: false, retry_after_secs: inner.retry_after(Instant::now()) });
        }
        inner.register_success();
        inner.locked = false;
        inner.pending_add.take()
    };

    emit_status(&app);
    match pending {
        Some(AddReveal::Open) => crate::windows::add::open_add_window(app),
        Some(AddReveal::Reveal) => crate::windows::add::reveal_add_window_cmd(app),
        None => {}
    }
    Ok(UnlockResult { ok: true, retry_after_secs: 0 })
}

#[tauri::command]
#[specta::specta]
pub(crate) fn lock_app(app: tauri::AppHandle) {
    engage(&app);
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn set_app_pin(
    app: tauri::AppHandle,
    current: Option<String>,
    new_pin: String,
) -> Result<(), String> {
    if !is_valid_pin(&new_pin) {
        return Err("PIN must be 4–8 digits".into());
    }

    let existing = {
        let state = app.state::<LockState>();
        let inner = state.0.lock().unwrap();
        inner.hash.clone()
    };
    if let Some(existing_hash) = existing {
        {
            let state = app.state::<LockState>();
            let inner = state.0.lock().unwrap();
            let retry = inner.retry_after(Instant::now());
            if retry > 0 {
                return Err(format!("Too many attempts — try again in {retry}s"));
            }
        }
        let current = current.unwrap_or_default();
        let ok = tauri::async_runtime::spawn_blocking(move || verify_pin(&current, &existing_hash))
            .await
            .unwrap_or(false);
        if !ok {
            let state = app.state::<LockState>();
            let mut inner = state.0.lock().unwrap();
            inner.register_failure(Instant::now());
            return Err("Wrong PIN".into());
        }
    }

    let hash = tauri::async_runtime::spawn_blocking(move || hash_pin(&new_pin))
        .await
        .map_err(|e| e.to_string())??;
    write_json_atomic(&lock_path()?, &LockFile { pin_hash: hash.clone() }).await?;

    {
        let state = app.state::<LockState>();
        let mut inner = state.0.lock().unwrap();
        inner.hash = Some(hash);
        inner.register_success();
    }
    emit_status(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn clear_app_pin(app: tauri::AppHandle, current: String) -> Result<(), String> {
    let existing = {
        let state = app.state::<LockState>();
        let inner = state.0.lock().unwrap();
        let retry = inner.retry_after(Instant::now());
        if retry > 0 {
            return Err(format!("Too many attempts — try again in {retry}s"));
        }
        inner.hash.clone()
    };
    let Some(existing_hash) = existing else {
        return Ok(());
    };

    let ok = tauri::async_runtime::spawn_blocking(move || verify_pin(&current, &existing_hash))
        .await
        .unwrap_or(false);
    if !ok {
        let state = app.state::<LockState>();
        let mut inner = state.0.lock().unwrap();
        inner.register_failure(Instant::now());
        return Err("Wrong PIN".into());
    }

    let path = lock_path()?;
    if let Err(e) = tokio::fs::remove_file(&path).await {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(e.to_string());
        }
    }

    {
        let state = app.state::<LockState>();
        let mut inner = state.0.lock().unwrap();
        inner.hash = None;
        inner.locked = false;
        inner.pending_add = None;
        inner.register_success();
    }
    emit_status(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_pin_accepts_4_to_8_ascii_digits() {
        assert!(is_valid_pin("1234"));
        assert!(is_valid_pin("12345678"));
        assert!(!is_valid_pin("123"));
        assert!(!is_valid_pin("123456789"));
        assert!(!is_valid_pin("12a4"));
        assert!(!is_valid_pin(""));
        // Arabic-Indic digits — `char::is_numeric()` would accept these, but
        // they aren't ASCII, so hashing them wouldn't round-trip the way a
        // user typing on a numeric keypad expects.
        assert!(!is_valid_pin("١٢٣٤"));
    }

    #[test]
    fn cooldown_secs_ramps_up_and_caps() {
        for f in 0..FREE_ATTEMPTS {
            assert_eq!(cooldown_secs(f), 0);
        }
        assert_eq!(cooldown_secs(5), 30);
        assert_eq!(cooldown_secs(6), 60);
        assert_eq!(cooldown_secs(20), MAX_COOLDOWN_SECS);
    }

    #[test]
    fn merge_pending_reveal_wins_both_ways() {
        assert_eq!(merge_pending(None, AddReveal::Open), AddReveal::Open);
        assert_eq!(merge_pending(Some(AddReveal::Open), AddReveal::Reveal), AddReveal::Reveal);
        assert_eq!(merge_pending(Some(AddReveal::Reveal), AddReveal::Open), AddReveal::Reveal);
    }

    #[test]
    fn retry_after_reflects_registered_failures() {
        let mut inner = LockInner::default();
        let t0 = Instant::now();
        for _ in 0..5 {
            inner.register_failure(t0);
        }
        let retry = inner.retry_after(t0);
        assert!((29..=30).contains(&retry), "expected ~30s, got {retry}");
        inner.register_success();
        assert_eq!(inner.retry_after(t0), 0);
    }

    #[test]
    fn hash_pin_round_trips_through_verify_pin() {
        let hash = hash_pin("135790").unwrap();
        assert!(verify_pin("135790", &hash));
        assert!(!verify_pin("000000", &hash));
        assert!(!verify_pin("135790", "not-a-phc-string"));
    }

    #[test]
    fn parse_lock_file_rejects_bad_json_and_non_phc_hash() {
        assert!(parse_lock_file(b"not json").is_none());
        assert!(parse_lock_file(br#"{"pinHash":"not-a-phc-string"}"#).is_none());
        let hash = hash_pin("1234").unwrap();
        let json = serde_json::to_vec(&LockFile { pin_hash: hash.clone() }).unwrap();
        assert_eq!(parse_lock_file(&json), Some(hash));
    }
}
