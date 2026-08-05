// Download engine.
// v3: dynamic segmentation via a shared piece queue. The file is split into
// many small pieces; N workers each pull the next piece as soon as they finish
// one, so fast connections naturally do more work and no connection sits idle
// while a slow one finishes. Per-piece completion is persisted for resume.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use futures_util::future::join_all;
use futures_util::StreamExt;
use reqwest::header::{HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager as _};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

const MIN_SEGMENT: u64 = 1024 * 1024; // 1 MB — threshold to bother going parallel
const MAX_CONNECTIONS: usize = 16;
const MAX_RETRIES: u32 = 5;
const PIECE_MIN: u64 = 1024 * 1024; // 1 MB
const PIECE_MAX: u64 = 8 * 1024 * 1024; // 8 MB

// ---------------------------------------------------------------------------
// Pause / cancel control registry
// ---------------------------------------------------------------------------

struct Control {
    paused: AtomicBool,
    canceled: AtomicBool,
    /// This download's own rate cap, reachable after `start_download` returns
    /// so `set_download_speed_limit` can adjust it live.
    limiter: Arc<RateLimiter>,
}

impl Control {
    fn new(rate: u64) -> Self {
        Self {
            paused: AtomicBool::new(false),
            canceled: AtomicBool::new(false),
            limiter: Arc::new(RateLimiter::new(rate)),
        }
    }
    fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
    fn is_canceled(&self) -> bool {
        self.canceled.load(Ordering::Relaxed)
    }
}

struct Manager {
    downloads: Mutex<HashMap<String, Arc<Control>>>,
    global: Arc<RateLimiter>,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            downloads: Mutex::new(HashMap::new()),
            global: Arc::new(RateLimiter::new(0)),
        }
    }
}

/// Holds an `adm://` link seen before the Add window's frontend had a
/// chance to mount (i.e. a cold start — see `handle_deep_link_cold_start`
/// below). The Add window collects it once via `take_pending_deep_link`
/// right after it starts up, prefills the form from it, and reveals itself.
#[derive(Default)]
struct PendingDeepLink(Mutex<Option<serde_json::Value>>);

// ---------------------------------------------------------------------------
// App settings (persisted to disk — tray/minimize behavior + the scheduler
// knobs that used to reset every launch)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct AppSettings {
    max_concurrent: usize,
    global_limit_mbps: f64,
    minimize_to_tray: bool,
    /// "system" | "dark" | "light". Applied entirely on the frontend (see
    /// `src/theme.ts`); Rust only persists it.
    theme: String,
    notifications: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_concurrent: 3,
            global_limit_mbps: 0.0,
            minimize_to_tray: false,
            theme: "system".to_string(),
            notifications: true,
        }
    }
}

struct SettingsState(Mutex<AppSettings>);

fn config_dir() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("Could not locate the config directory")?
        .join("AzhuraDownloadManager"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("settings.json"))
}

/// Write JSON via a temp file + rename so a crash mid-write can never leave a
/// truncated config behind. Serialized through a process-wide lock: Tauri
/// commands run concurrently on the tokio runtime, and two overlapping writes
/// to the same file would otherwise interleave through the temp path.
async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _guard = LOCK.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;

    let mut tmp = path.to_path_buf().into_os_string();
    tmp.push(format!(".{}.tmp", std::process::id()));
    let tmp = PathBuf::from(tmp);
    let _ = tokio::fs::remove_file(&tmp).await;

    tokio::fs::write(&tmp, &json)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_settings_from_disk() -> AppSettings {
    settings_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn load_settings(state: tauri::State<'_, SettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    *state.0.lock().unwrap() = settings.clone();
    write_json_atomic(&settings_path()?, &settings).await
}

// ---------------------------------------------------------------------------
// Add-window preferences (remembered connections/speed-cap defaults + a
// per-category save-path override). Kept in their own file rather than
// folded into `AppSettings`: the main window's `save_settings` call always
// rewrites the *entire* settings object from its own state, so any field
// only the Add window knows about would get reset to its default on the
// next settings save.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Prefs {
    /// Add-window defaults, remembered across sessions.
    connections: usize,
    speed_limit_mbps: f64,
    /// category id ("video" | "audio" | …) → absolute folder override.
    /// Absent or empty = the built-in `<base>/<Category>` folder.
    category_paths: HashMap<String, String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            connections: 8,
            speed_limit_mbps: 0.0,
            category_paths: HashMap::new(),
        }
    }
}

struct PrefsState(Mutex<Prefs>);

fn prefs_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("prefs.json"))
}

fn load_prefs_from_disk() -> Prefs {
    prefs_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn load_prefs(state: tauri::State<'_, PrefsState>) -> Prefs {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn save_add_defaults(
    connections: usize,
    speed_limit_mbps: f64,
    state: tauri::State<'_, PrefsState>,
) -> Result<(), String> {
    let prefs = {
        let mut guard = state.0.lock().unwrap();
        guard.connections = connections;
        guard.speed_limit_mbps = speed_limit_mbps;
        guard.clone()
    };
    write_json_atomic(&prefs_path()?, &prefs).await
}

#[tauri::command]
async fn set_category_path(
    category: String,
    path: String,
    state: tauri::State<'_, PrefsState>,
) -> Result<(), String> {
    let prefs = {
        let mut guard = state.0.lock().unwrap();
        if path.trim().is_empty() {
            guard.category_paths.remove(&category);
        } else {
            guard.category_paths.insert(category, path.trim().to_string());
        }
        guard.clone()
    };
    write_json_atomic(&prefs_path()?, &prefs).await
}

// ---------------------------------------------------------------------------
// Download history (completed / error / canceled rows, persisted across runs)
// ---------------------------------------------------------------------------

/// One finished download. `state` always holds the real terminal state —
/// "missing" is never stored, it is recomputed from disk on every load so a
/// file that reappears recovers its original status.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct HistoryEntry {
    id: String,
    url: String,
    /// Credential headers are stripped before this is written — see `needs_auth`.
    headers: Vec<(String, String)>,
    allow_insecure: bool,
    checksum: String,
    speed_limit: u64,
    filename: String,
    filename_override: String,
    path: String,
    save_path: String,
    total: Option<u64>,
    downloaded: u64,
    connections: usize,
    used_connections: usize,
    state: String,
    error: Option<String>,
    /// Kept so a redownload of a credential-gated link can reopen the page
    /// that produced it and wait for the extension to capture a fresh request.
    referer: String,
    needs_auth: bool,
    finished_at: i64,
    /// When this download first entered the list; 0 for rows persisted before
    /// this field existed (the frontend falls back to `finished_at` then).
    added_at: i64,
    #[serde(skip_deserializing)]
    missing: bool,
}

const HISTORY_VERSION: u32 = 1;
const HISTORY_MAX: usize = 500;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    version: u32,
    entries: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryLoad {
    entries: Vec<HistoryEntry>,
    /// False only when an existing file could not be parsed. The frontend uses
    /// this to refuse to save for the rest of the session, so one bad byte
    /// can't cascade into overwriting everything that was still readable.
    readable: bool,
}

fn history_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("history.json"))
}

#[tauri::command]
async fn load_history() -> Result<HistoryLoad, String> {
    let path = history_path()?;
    let Ok(bytes) = tokio::fs::read(&path).await else {
        // No file yet — first run, and safe to write.
        return Ok(HistoryLoad {
            entries: Vec::new(),
            readable: true,
        });
    };

    let file = match serde_json::from_slice::<HistoryFile>(&bytes) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("history.json is unreadable ({e}); keeping it as history.json.bad");
            let mut bad = path.clone().into_os_string();
            bad.push(".bad");
            let _ = tokio::fs::rename(&path, PathBuf::from(bad)).await;
            return Ok(HistoryLoad {
                entries: Vec::new(),
                readable: false,
            });
        }
    };

    // Per-entry parsing: one malformed row costs one row, not the whole file.
    let entries = file
        .entries
        .into_iter()
        .filter_map(|v| serde_json::from_value::<HistoryEntry>(v).ok())
        .map(|mut e| {
            e.missing = !e.path.is_empty() && !Path::new(&e.path).exists();
            e
        })
        .collect();

    Ok(HistoryLoad {
        entries,
        readable: true,
    })
}

#[tauri::command]
async fn save_history(mut entries: Vec<HistoryEntry>) -> Result<(), String> {
    entries.sort_by(|a, b| b.finished_at.cmp(&a.finished_at));
    entries.truncate(HISTORY_MAX);

    let entries = entries
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    write_json_atomic(
        &history_path()?,
        &HistoryFile {
            version: HISTORY_VERSION,
            entries,
        },
    )
    .await
}

/// Set when the tray "Quit" item fires, so `CloseRequested`'s hide-to-tray
/// intercept lets the real close through instead of looping back to hidden.
struct Quitting(AtomicBool);

// ---------------------------------------------------------------------------
// Tray download list
// ---------------------------------------------------------------------------

/// One download row currently rendered in the tray menu, alongside the
/// `MenuItem` it owns so a same-shape update (the common case, ~1/sec) can
/// patch labels in place via `set_text` instead of rebuilding the whole menu.
struct TrayEntry {
    download_id: String,
    label: String,
    item: MenuItem<tauri::Wry>,
}

#[derive(Default)]
struct TrayMenuState(Mutex<Vec<TrayEntry>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayDownload {
    id: String,
    label: String,
}

/// Rebuild the tray's dropdown menu from scratch: Show, a separator, one item
/// per active download (or a disabled placeholder when there are none),
/// another separator, then Quit.
fn rebuild_tray_menu(
    app: &tauri::AppHandle,
    items: &[TrayDownload],
) -> Result<(Menu<tauri::Wry>, Vec<TrayEntry>), String> {
    let tray_show = MenuItem::with_id(app, "show", "Show Azhura Download Manager", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let tray_quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep_top = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep_bottom = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;

    let mut entries: Vec<TrayEntry> = Vec::with_capacity(items.len());
    if items.is_empty() {
        let placeholder = MenuItem::with_id(app, "dl:none", "No active downloads", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        let menu = Menu::with_items(app, &[&tray_show, &sep_top, &placeholder, &sep_bottom, &tray_quit])
            .map_err(|e| e.to_string())?;
        return Ok((menu, entries));
    }

    let mut menu_items: Vec<MenuItem<tauri::Wry>> = Vec::with_capacity(items.len());
    for d in items {
        let item = MenuItem::with_id(app, format!("dl:{}", d.id), &d.label, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        menu_items.push(item);
    }
    for (d, item) in items.iter().zip(menu_items.iter()) {
        entries.push(TrayEntry {
            download_id: d.id.clone(),
            label: d.label.clone(),
            item: item.clone(),
        });
    }

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![&tray_show, &sep_top];
    for item in &menu_items {
        refs.push(item);
    }
    refs.push(&sep_bottom);
    refs.push(&tray_quit);
    let menu = Menu::with_items(app, &refs).map_err(|e| e.to_string())?;
    Ok((menu, entries))
}

/// Push a fresh snapshot of active downloads into the tray menu, called
/// roughly once a second from the frontend. Patches labels in place when the
/// same set of ids is still showing (by far the common case) so the menu
/// doesn't visibly flicker; otherwise rebuilds it.
#[tauri::command]
fn update_tray_downloads(
    app: tauri::AppHandle,
    items: Vec<TrayDownload>,
    tooltip: String,
    state: tauri::State<'_, TrayMenuState>,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };

    let mut cached = state.0.lock().unwrap();
    let same_shape = cached.len() == items.len()
        && cached
            .iter()
            .zip(items.iter())
            .all(|(c, d)| c.download_id == d.id);

    if same_shape {
        for (c, d) in cached.iter_mut().zip(items.iter()) {
            if c.label != d.label {
                let _ = c.item.set_text(&d.label);
                c.label = d.label.clone();
            }
        }
    } else {
        let (menu, entries) = rebuild_tray_menu(&app, &items)?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        *cached = entries;
    }

    let _ = tray.set_tooltip(Some(&tooltip));
    Ok(())
}

// ---------------------------------------------------------------------------
// Rate limiting (token bucket)
// ---------------------------------------------------------------------------

struct Bucket {
    tokens: f64,
    last: Instant,
}

/// A shared token bucket. `rate` is bytes/sec (0 = unlimited). Multiple workers
/// call `acquire` before writing each chunk; the bucket refills over wall-clock
/// time, bounding aggregate throughput.
struct RateLimiter {
    rate: AtomicU64,
    bucket: Mutex<Bucket>,
}

impl RateLimiter {
    fn new(rate: u64) -> Self {
        Self {
            rate: AtomicU64::new(rate),
            bucket: Mutex::new(Bucket {
                tokens: 0.0,
                last: Instant::now(),
            }),
        }
    }

    fn set_rate(&self, r: u64) {
        self.rate.store(r, Ordering::Relaxed);
    }

    async fn acquire(&self, n: u64) {
        loop {
            let rate = self.rate.load(Ordering::Relaxed);
            if rate == 0 || n == 0 {
                return; // unlimited
            }
            // Burst capacity: at least 4 MB so a single chunk can always fit.
            let cap = (rate as f64).max(4.0 * 1024.0 * 1024.0);
            let wait_secs = {
                let mut b = self.bucket.lock().unwrap();
                let now = Instant::now();
                let elapsed = now.duration_since(b.last).as_secs_f64();
                b.last = now;
                b.tokens = (b.tokens + elapsed * rate as f64).min(cap);
                if b.tokens >= n as f64 {
                    b.tokens -= n as f64;
                    0.0
                } else {
                    (n as f64 - b.tokens) / rate as f64
                }
            };
            if wait_secs <= 0.0 {
                return;
            }
            // Cap the nap so pause and rate changes take effect quickly.
            tokio::time::sleep(Duration::from_secs_f64(wait_secs.min(0.25))).await;
        }
    }
}

/// The two limiters every chunk must pass: the shared global one and this
/// download's own. Either may be unlimited (rate 0).
struct Limits {
    global: Arc<RateLimiter>,
    per: Arc<RateLimiter>,
}

impl Limits {
    async fn acquire(&self, n: u64) {
        self.global.acquire(n).await;
        self.per.acquire(n).await;
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnInfo {
    downloaded: u64, // bytes into the current piece
    total: u64,      // size of the current piece (0 = idle)
    pieces: u64,     // pieces this connection has completed
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        filename: String,
        path: String,
        total: Option<u64>,
        connections: usize,
        piece_size: u64,
        num_pieces: usize,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        downloaded: u64,
        total: Option<u64>,
        speed_bps: f64,
        connections: Vec<ConnInfo>,
    },
    Paused {
        downloaded: u64,
    },
    Canceled {
        downloaded: u64,
    },
    Verifying,
    #[serde(rename_all = "camelCase")]
    Finished {
        path: String,
        filename: String,
    },
    Error {
        message: String,
    },
}

// ---------------------------------------------------------------------------
// Persisted resume metadata (`<file>.adm.json`)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct Meta {
    url: String,
    filename: String,
    total: u64,
    piece_size: u64,
    connections: usize,
    done_pieces: Vec<usize>,
    /// (piece index, bytes already downloaded) for pieces that were in flight at
    /// pause/cancel time — lets resume continue mid-piece instead of restarting it.
    #[serde(default)]
    partial: Vec<(usize, u64)>,
    /// User-chosen destination folder; `None` means the default downloads folder.
    #[serde(default)]
    save_path: Option<String>,
}

#[derive(Clone)]
struct MetaCtx {
    meta_path: PathBuf,
    url: String,
    filename: String,
    total: u64,
    piece_size: u64,
    connections: usize,
    save_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResumableInfo {
    path: String,
    url: String,
    filename: String,
    total: u64,
    connections: usize,
    downloaded: u64,
    save_path: Option<String>,
    added_at: Option<i64>,
}

fn meta_path_for(path: &Path) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(".adm.json");
    PathBuf::from(s)
}

async fn load_meta(path: &Path) -> Option<Meta> {
    let bytes = tokio::fs::read(meta_path_for(path)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn write_meta(ctx: &MetaCtx, shared: &Shared, include_partials: bool) {
    let done: Vec<usize> = (0..shared.plan.num_pieces)
        .filter(|&k| shared.done[k].load(Ordering::Relaxed))
        .collect();

    // Record in-flight piece offsets ONLY when the caller has just fsync'd
    // (pause/cancel/error) — never in the periodic active-download writes, whose
    // bytes may not be durable yet.
    let partial: Vec<(usize, u64)> = if include_partials {
        let done_set: std::collections::HashSet<usize> = done.iter().copied().collect();
        shared
            .workers
            .iter()
            .filter_map(|w| {
                let k = w.current_piece.load(Ordering::Relaxed);
                if k < 0 {
                    return None;
                }
                let k = k as usize;
                let off = w.piece_downloaded.load(Ordering::Relaxed);
                if off > 0 && k < shared.plan.num_pieces && !done_set.contains(&k) && off < shared.plan.size(k) {
                    Some((k, off))
                } else {
                    None
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    let meta = Meta {
        url: ctx.url.clone(),
        filename: ctx.filename.clone(),
        total: ctx.total,
        piece_size: ctx.piece_size,
        connections: ctx.connections,
        done_pieces: done,
        partial,
        save_path: ctx.save_path.clone(),
    };
    if let Ok(json) = serde_json::to_vec_pretty(&meta) {
        let mut tmp: OsString = ctx.meta_path.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        if tokio::fs::write(&tmp, &json).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &ctx.meta_path).await;
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "download.bin".to_string()
    } else {
        cleaned
    }
}

fn filename_from(resp: &reqwest::Response, url: &str) -> String {
    if let Some(cd) = resp.headers().get(reqwest::header::CONTENT_DISPOSITION) {
        if let Ok(s) = cd.to_str() {
            if let Some(idx) = s.to_ascii_lowercase().find("filename=") {
                let raw = s[idx + "filename=".len()..]
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_matches('"');
                if !raw.is_empty() {
                    return sanitize(raw);
                }
            }
        }
    }
    let path = url.split(['?', '#']).next().unwrap_or(url);
    sanitize(path.rsplit('/').next().unwrap_or(""))
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
    let ext = p.extension().and_then(|s| s.to_str());
    for i in 1..=10_000 {
        let name = match ext {
            Some(e) => format!("{stem} ({i}).{e}"),
            None => format!("{stem} ({i})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(filename)
}

fn downloads_base() -> Result<PathBuf, String> {
    Ok(dirs::download_dir()
        .ok_or("Could not locate the Downloads directory")?
        .join("AzhuraDownloadManager"))
}

/// File-type category id for `filename`'s extension, or "other". Extension
/// lists MUST stay in sync with `src/categories.ts` (`EXT_CATEGORY`) — the
/// frontend uses the same classification for its sidebar filters.
fn category_id(filename: &str) -> &'static str {
    let ext = match filename.rsplit_once('.') {
        Some((_, e)) if !e.is_empty() => e.to_ascii_lowercase(),
        _ => return "other",
    };
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpg" | "mpeg" | "ts"
        | "3gp" | "m2ts" | "ogv" => "video",
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "mid" | "aiff" => "audio",
        "exe" | "msi" | "appx" | "msix" | "apk" | "aab" | "jar" | "dll" | "sys" | "deb" | "rpm"
        | "dmg" | "pkg" | "appimage" | "bat" | "cmd" | "sh" | "ps1" => "program",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "xls" | "xlsx" | "ods" | "csv"
        | "tsv" | "ppt" | "pptx" | "odp" | "epub" | "mobi" | "azw3" | "nfo" | "log" => "docs",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "cab" | "arj"
        | "iso" | "img" => "archive",
        _ => "other",
    }
}

/// Folder name under `downloads_base()` for a category id. MUST match
/// `CATEGORY_FOLDER` in `src/categories.ts`.
fn category_folder(id: &str) -> &'static str {
    match id {
        "video" => "Video",
        "audio" => "Audio",
        "program" => "Program",
        "docs" => "Docs",
        "archive" => "Archive",
        _ => "Other",
    }
}

/// The six category folder names, for creating them once at launch.
const CATEGORY_FOLDERS: [&str; 6] = ["Video", "Audio", "Program", "Docs", "Archive", "Other"];

/// Destination directory for `filename` when the user hasn't picked an
/// explicit save path: the remembered override for its category if one is
/// set (and absolute), otherwise `<base>/<CategoryFolder>`.
fn category_dir(filename: &str, prefs: &Prefs) -> Result<PathBuf, String> {
    let id = category_id(filename);
    if let Some(custom) = prefs.category_paths.get(id) {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return Ok(p);
        }
    }
    Ok(downloads_base()?.join(category_folder(id)))
}

fn volume_prefix(p: &Path) -> Option<OsString> {
    for c in p.components() {
        if let std::path::Component::Prefix(pre) = c {
            return Some(pre.as_os_str().to_os_string());
        }
    }
    None
}

fn same_volume(a: &Path, b: &Path) -> bool {
    match (volume_prefix(a), volume_prefix(b)) {
        (Some(x), Some(y)) => x.eq_ignore_ascii_case(&y),
        _ => false,
    }
}

fn temp_download_dir() -> Result<PathBuf, String> {
    let base = downloads_base()?;
    let sys_temp = std::env::temp_dir();
    if same_volume(&sys_temp, &base) {
        Ok(sys_temp.join("AzhuraDownloadManager"))
    } else {
        Ok(base.join(".incomplete"))
    }
}

fn is_insecure_http(url: &str) -> bool {
    url.trim_start().to_ascii_lowercase().starts_with("http://")
}

fn is_html_response(resp: &reqwest::Response) -> bool {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| {
            let ct = ct.trim().to_ascii_lowercase();
            ct.starts_with("text/html") || ct.starts_with("application/xhtml")
        })
        .unwrap_or(false)
}

fn build_headers(raw: &[(String, String)]) -> Result<Vec<(HeaderName, HeaderValue)>, String> {
    let mut out = Vec::with_capacity(raw.len());
    for (name, value) in raw {
        let hname = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("Invalid header name: \"{name}\""))?;
        let hvalue = HeaderValue::from_str(value)
            .map_err(|_| format!("Invalid value for header \"{name}\""))?;
        out.push((hname, hvalue));
    }
    Ok(out)
}

fn apply_headers(
    mut req: reqwest::RequestBuilder,
    headers: &[(HeaderName, HeaderValue)],
) -> reqwest::RequestBuilder {
    for (name, value) in headers {
        req = req.header(name.clone(), value.clone());
    }
    req
}

fn parse_total_from_content_range(resp: &reqwest::Response) -> Option<u64> {
    let v = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    v.rsplit('/').next()?.trim().parse::<u64>().ok()
}

fn choose_connections(requested: usize, supports_ranges: bool, total: Option<u64>) -> usize {
    if !supports_ranges {
        return 1;
    }
    let Some(total) = total else { return 1 };
    if total < 2 * MIN_SEGMENT {
        return 1;
    }
    let by_size = (total / MIN_SEGMENT).max(1) as usize;
    requested.clamp(1, MAX_CONNECTIONS).min(by_size).max(1)
}

fn build_client(allow_insecure: bool) -> Result<reqwest::Client, String> {
    let redirect_allow = allow_insecure;
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 10 {
            attempt.stop()
        } else if !redirect_allow && attempt.url().scheme() == "http" {
            attempt.error("redirected to an insecure http:// URL")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

struct Probe {
    total: Option<u64>,
    supports_ranges: bool,
    filename: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeInfo {
    total: Option<u64>,
    supports_ranges: bool,
    filename: String,
}

async fn probe(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
) -> Result<Probe, String> {
    let req = apply_headers(
        client.get(url).header(reqwest::header::RANGE, "bytes=0-0"),
        headers,
    );
    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    if is_html_response(&resp) {
        return Err(
            "The server returned an HTML web page, not a file. The link probably \
             needs a login/cookie or isn't a direct download URL. Nothing was saved."
                .to_string(),
        );
    }

    let filename = filename_from(&resp, url);
    if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        Ok(Probe {
            total: parse_total_from_content_range(&resp),
            supports_ranges: true,
            filename,
        })
    } else {
        Ok(Probe {
            total: resp.content_length(),
            supports_ranges: false,
            filename,
        })
    }
}

// ---------------------------------------------------------------------------
// Checksum verification
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Algo {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

/// Pick the algorithm from the hex length; `None` if it's not a known width.
fn detect_algo(hash: &str) -> Option<Algo> {
    match hash.len() {
        32 => Some(Algo::Md5),
        40 => Some(Algo::Sha1),
        64 => Some(Algo::Sha256),
        128 => Some(Algo::Sha512),
        _ => None,
    }
}

/// Stream the file through the hasher on a blocking thread (CPU-bound).
async fn compute_checksum(path: PathBuf, algo: Algo) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::Read;
        let mut file =
            std::fs::File::open(&path).map_err(|e| format!("Could not open for checksum: {e}"))?;
        let mut hasher: Box<dyn digest::DynDigest> = match algo {
            Algo::Md5 => Box::new(md5::Md5::default()),
            Algo::Sha1 => Box::new(sha1::Sha1::default()),
            Algo::Sha256 => Box::new(sha2::Sha256::default()),
            Algo::Sha512 => Box::new(sha2::Sha512::default()),
        };
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| format!("Read error during checksum: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| format!("Checksum task failed: {e}"))?
}

async fn move_to_destination(
    temp_path: &Path,
    filename: &str,
    save_path: Option<&str>,
    prefs: &Prefs,
) -> Result<PathBuf, String> {
    let base = match save_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => {
            let p = PathBuf::from(s);
            if !p.is_absolute() {
                return Err("Save folder must be an absolute path".to_string());
            }
            p
        }
        None => category_dir(filename, prefs)?,
    };
    tokio::fs::create_dir_all(&base)
        .await
        .map_err(|e| format!("Could not create target folder: {e}"))?;
    let dest = unique_path(&base, filename);
    if tokio::fs::rename(temp_path, &dest).await.is_err() {
        tokio::fs::copy(temp_path, &dest)
            .await
            .map_err(|e| format!("Could not move file to destination: {e}"))?;
        let _ = tokio::fs::remove_file(temp_path).await;
    }
    Ok(dest)
}

// ---------------------------------------------------------------------------
// Piece plan + shared work state
// ---------------------------------------------------------------------------

struct PiecePlan {
    piece_size: u64,
    num_pieces: usize,
    total: u64,
}

impl PiecePlan {
    fn range(&self, k: usize) -> (u64, u64) {
        let start = k as u64 * self.piece_size;
        let end = (start + self.piece_size).min(self.total) - 1;
        (start, end)
    }
    fn size(&self, k: usize) -> u64 {
        let (s, e) = self.range(k);
        e - s + 1
    }
}

/// Aim for ~4 pieces per connection so fast workers can pull ahead, but keep
/// each piece within [1 MB, 8 MB] to bound per-request overhead.
fn plan_pieces(total: u64, conns: usize) -> PiecePlan {
    let target = (total / (conns as u64 * 4).max(1)).max(1);
    let piece_size = target.clamp(PIECE_MIN, PIECE_MAX);
    let num_pieces = ((total + piece_size - 1) / piece_size).max(1) as usize;
    PiecePlan {
        piece_size,
        num_pieces,
        total,
    }
}

struct WorkerUi {
    piece_downloaded: AtomicU64,
    piece_total: AtomicU64,
    pieces_done: AtomicU64,
    current_piece: AtomicI64, // -1 = idle / none
}

impl WorkerUi {
    fn new() -> Self {
        Self {
            piece_downloaded: AtomicU64::new(0),
            piece_total: AtomicU64::new(0),
            pieces_done: AtomicU64::new(0),
            current_piece: AtomicI64::new(-1),
        }
    }
}

struct Shared {
    plan: PiecePlan,
    queue: Mutex<VecDeque<usize>>,
    done: Vec<AtomicBool>,
    total_downloaded: Arc<AtomicU64>,
    workers: Vec<Arc<WorkerUi>>,
    /// Seed offsets for pieces resumed mid-way: piece index → bytes already on disk.
    resume_offsets: HashMap<usize, u64>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn start_download(
    id: String,
    url: String,
    allow_insecure: bool,
    headers: Vec<(String, String)>,
    connections: usize,
    resume: bool,
    resume_path: Option<String>,
    expected_checksum: Option<String>,
    speed_limit: Option<u64>,
    filename: Option<String>,
    save_path: Option<String>,
    on_event: Channel<DownloadEvent>,
    manager: tauri::State<'_, Manager>,
    prefs_state: tauri::State<'_, PrefsState>,
) -> Result<(), String> {
    let control = Arc::new(Control::new(speed_limit.unwrap_or(0)));
    manager
        .downloads
        .lock()
        .unwrap()
        .insert(id.clone(), control.clone());

    let limits = Arc::new(Limits {
        global: manager.global.clone(),
        per: control.limiter.clone(),
    });
    // Cloned out of the mutex before the first `.await` below — the guard
    // itself isn't `Send`, so it can't be held across an await point.
    let prefs = prefs_state.0.lock().unwrap().clone();

    let result = download_inner(
        &url,
        allow_insecure,
        &headers,
        connections,
        resume,
        resume_path.as_deref(),
        expected_checksum.as_deref(),
        filename.as_deref(),
        save_path.as_deref(),
        limits,
        on_event.clone(),
        control,
        &prefs,
    )
    .await;

    manager.downloads.lock().unwrap().remove(&id);

    if let Err(ref message) = result {
        let _ = on_event.send(DownloadEvent::Error {
            message: message.clone(),
        });
    }
    result
}

#[tauri::command]
fn pause_download(id: String, manager: tauri::State<'_, Manager>) {
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.paused.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn cancel_download(id: String, manager: tauri::State<'_, Manager>) {
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.canceled.store(true, Ordering::Relaxed);
    }
}

/// Set the global download speed cap in bytes/sec (0 = unlimited). Live —
/// affects all active downloads immediately since they share this bucket.
#[tauri::command]
fn set_global_speed_limit(bytes_per_sec: u64, manager: tauri::State<'_, Manager>) {
    manager.global.set_rate(bytes_per_sec);
}

/// Set one download's own speed cap in bytes/sec (0 = unlimited). Live — the
/// running workers share this bucket, so it takes effect on the next chunk.
#[tauri::command]
fn set_download_speed_limit(id: String, bytes_per_sec: u64, manager: tauri::State<'_, Manager>) {
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.limiter.set_rate(bytes_per_sec);
    }
}

/// Show + focus the (hidden-at-startup) "Add Download" window — it's owned by
/// `main` (see `setup()`), so it's always above `main` in z-order without
/// needing an explicit always-on-top flag. Also disable `main` so clicking it
/// is a no-op until the add window closes (a real, OS-level modal — not just
/// visual stacking).
/// Bring `main` back from the tray: clear the modal-disable left over from
/// the Add window trick, undo a minimize, show, and focus.
///
/// The disable is only cleared when the Add window isn't actually on screen.
/// A *visible* Add window holds a real, OS-level modal disable on `main`, and
/// this function is reachable from the tray (left-click, "Show", and the
/// per-download entries) while that dialog is open — re-enabling `main` there
/// would leave both windows interactive at once.
fn reveal_main_window(app: &tauri::AppHandle) {
    let add = app
        .get_webview_window("add")
        .filter(|w| w.is_visible().unwrap_or(false));

    if let Some(m) = app.get_webview_window("main") {
        if add.is_none() {
            let _ = m.set_enabled(true);
        }
        let _ = m.unminimize();
        let _ = m.show();
        let _ = m.set_focus();
    }

    // `main` can't take input while the modal is up, so hand focus to the
    // dialog that's actually blocking it rather than leaving it ambiguous.
    if let Some(w) = add {
        let _ = w.set_focus();
    }
}

/// Send `main` (and the owned Add/Details windows, if open) to the tray
/// without destroying any webview — downloads and the React scheduler keep
/// running, they're just not visible.
fn hide_to_tray(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    for (label, w) in app.webview_windows() {
        if label.starts_with("detail-") {
            let _ = w.hide();
        }
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.hide();
    }
}

/// Tray "Quit": pause every in-flight download so its resume sidecar is
/// flushed immediately (mirrors `pause_download`), give the periodic meta
/// writer a moment to catch up, then actually exit.
fn quit_app(app: &tauri::AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::Relaxed);
    for c in app.state::<Manager>().downloads.lock().unwrap().values() {
        c.paused.store(true, Ordering::Relaxed);
    }
    // Lets the frontend flush its download history immediately instead of
    // waiting out its debounce, which would otherwise eat most of the grace
    // period below.
    let _ = app.emit_to("main", "app-quitting", ());
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        handle.exit(0);
    });
}

fn reveal_add_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(false);
    }
}

/// Strip the browser-isms out of a WebView2 host: the find bar (Ctrl+F), reload
/// (F5/Ctrl+R), print, caret browsing (F7), zoom, the link-hover status bubble,
/// the default context menu, pinch-zoom and swipe-to-navigate. Without this the
/// app behaves like a web page in a frame no matter what the JS layer does,
/// because these are host accelerators, not page key events.
fn harden_webview(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(|webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings3, ICoreWebView2Settings5, ICoreWebView2Settings6,
            };
            use windows::core::Interface;
            let Ok(core) = webview.controller().CoreWebView2() else { return };
            let Ok(settings) = core.Settings() else { return };
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            #[cfg(not(debug_assertions))]
            let _ = settings.SetAreDevToolsEnabled(false);
            if let Ok(s) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = s.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(s) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = s.SetIsPinchZoomEnabled(false);
            }
            if let Ok(s) = settings.cast::<ICoreWebView2Settings6>() {
                let _ = s.SetIsSwipeNavigationEnabled(false);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// Reveal the Add window for the "+" button case, and let it know it was
/// just opened so it can check the clipboard for a URL to prefill.
#[tauri::command]
fn open_add_window(app: tauri::AppHandle) {
    reveal_add_window(&app);
    let _ = app.emit_to("add", "window-opened", ());
}

/// Reveal the Add window without the clipboard-prefill side effect above —
/// used once the Add window has already been prefilled from a captured
/// download (extension deep link) and just needs to become visible.
#[tauri::command]
fn reveal_add_window_cmd(app: tauri::AppHandle) {
    reveal_add_window(&app);
}

/// Receive the form data from the add window, hand it to the main window,
/// hide the add window (kept alive for reuse), and re-enable + focus the main
/// window.
#[tauri::command]
fn submit_add(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit_to("main", "add-download", payload)
        .map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn close_add_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.set_focus();
    }
}

/// Build (or reveal, if it already exists) a "Download Details" popup for one
/// download, labeled `detail-<id>` — every row gets its own window instead of
/// all of them fighting over a single reused one. Unlike the Add window,
/// `main` is never disabled: these are non-modal inspectors the user can
/// leave open while continuing to work in the main table.
///
/// The window is built hidden; `main`'s `detail-ready` handshake (once the
/// popup's own React tree has mounted and asked for its first snapshot) is
/// what actually shows it via `show_detail_window`, so there's never a flash
/// of an empty popup.
///
/// Must be `async`: a plain (blocking) command runs inline on the same thread
/// that pumps WebView2's IPC messages — i.e. the main/UI thread. Creating a
/// *new* OS window needs to hand off to that same thread's event loop and
/// wait for it, which can't happen while that thread is busy running us, so
/// a non-async version of this command deadlocks the whole app the moment it
/// tries to build the window. Being `async` moves execution onto a tokio
/// worker thread first, so the handoff to the real UI thread can complete.
#[tauri::command]
async fn open_detail_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = format!("detail-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    let main = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;

    // Cascade new popups a little so stacking several isn't pixel-identical.
    let existing = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("detail-"))
        .count();
    let offset = 28.0 * (existing % 6) as f64;

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("detail.html".into()))
            .title("Download Details")
            .inner_size(620.0, 540.0)
            .min_inner_size(520.0, 420.0)
            .decorations(false)
            .visible(false)
            .shadow(true)
            .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
            .owner(&main)
            .map_err(|e| e.to_string())?;

    // `outer_position()` is physical pixels but `position()` takes logical
    // ones — skipping the conversion would place the popup off-screen on any
    // scaled display (125%/150%/etc, the Windows default on most laptops).
    if let (Ok(pos), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + offset, logical.y + offset);
    }

    let w = builder.build().map_err(|e| e.to_string())?;
    harden_webview(&w);
    Ok(())
}

/// Show + focus a detail popup once its frontend has actually rendered the
/// snapshot `main` handed it (see `detail-ready` in `App.tsx`).
#[tauri::command]
fn show_detail_window(app: tauri::AppHandle, id: String) {
    if let Some(w) = app.get_webview_window(&format!("detail-{id}")) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Destroy one detail popup (they're created on demand now, not pooled) and
/// tell `main` it's gone so it stops pushing snapshots at it.
///
/// `async` for the same reason as `open_detail_window`: tearing down an OS
/// window is thread-affine like creating one, so this can't safely run
/// inline on the IPC/UI thread either.
#[tauri::command]
async fn close_detail_window(app: tauri::AppHandle, id: String) {
    if let Some(w) = app.get_webview_window(&format!("detail-{id}")) {
        let _ = w.destroy();
    }
    let _ = app.emit_to("main", "detail-closed", id);
}

/// Parse an `adm://add?url=...&filename=...&referrer=...&cookie=...` deep
/// link into an `AddPayload`-shaped JSON value (see `src/types.ts`), or
/// `None` if it isn't a well-formed link for this app.
fn build_deep_link_payload(link: &str) -> Option<serde_json::Value> {
    let parsed = url::Url::parse(link).ok()?;
    if parsed.scheme() != "adm" {
        return None;
    }
    let mut target_url = String::new();
    let mut filename = String::new();
    let mut referrer = String::new();
    let mut cookie = String::new();
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
            _ => {}
        }
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
fn handle_deep_link(app: &tauri::AppHandle, link: &str) {
    let Some(payload) = build_deep_link_payload(link) else { return };
    reveal_main_window(app);
    let _ = app.emit_to("main", "deep-link-captured", payload);
}

/// Handle a deep link seen at cold start (`std::env::args()` in `setup()`):
/// the Add window's frontend hasn't mounted yet at this point, so emitting
/// immediately would silently drop the event. Stash it instead — the Add
/// window calls `take_pending_deep_link` right after it starts up.
fn handle_deep_link_cold_start(app: &tauri::AppHandle, link: &str) {
    let Some(payload) = build_deep_link_payload(link) else { return };
    app.state::<PendingDeepLink>().0.lock().unwrap().replace(payload);
}

#[tauri::command]
fn take_pending_deep_link(state: tauri::State<'_, PendingDeepLink>) -> Option<serde_json::Value> {
    state.0.lock().unwrap().take()
}

/// Pull an `adm://` URL out of raw process args (used both for the
/// single-instance callback's `argv` and for `std::env::args()` at cold
/// start, since the deep-link plugin only auto-fires for warm starts).
fn deep_link_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find(|a| a.starts_with("adm://"))
}

/// Remove a row's resume sidecar (always) and, if requested, the file itself.
/// Save folders are now user-chosen, so this only sanity-checks the path
/// instead of confining it to the default downloads/temp roots.
#[tauri::command]
async fn delete_download(path: String, delete_file: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("Refusing to delete a non-absolute path".to_string());
    }
    if p.parent().is_none() {
        return Err("Refusing to delete a filesystem root".to_string());
    }
    if delete_file {
        if p.is_dir() {
            return Err("Refusing to delete a directory".to_string());
        }
        let _ = tokio::fs::remove_file(&p).await;
    }
    // Always drop the resume sidecar so a removed row cannot reappear via list_resumable.
    let _ = tokio::fs::remove_file(meta_path_for(&p)).await;
    Ok(())
}

/// Check a URL's size and filename ahead of committing to a download, for the
/// Add window's live "Size:" readout. Reuses the same client/probe path as an
/// actual download so the reported size matches what a real run would see.
#[tauri::command]
async fn probe_url(
    url: String,
    allow_insecure: bool,
    headers: Vec<(String, String)>,
) -> Result<ProbeInfo, String> {
    if is_insecure_http(&url) && !allow_insecure {
        return Err(
            "This is an insecure http:// connection and was not allowed.".to_string(),
        );
    }
    let built_headers = build_headers(&headers)?;
    let client = build_client(allow_insecure)?;
    let info = probe(&client, &url, &built_headers).await?;
    Ok(ProbeInfo {
        total: info.total,
        supports_ranges: info.supports_ranges,
        filename: info.filename,
    })
}

/// The default destination folder, for the Add window's "Save path" field.
#[tauri::command]
fn default_download_dir() -> Result<String, String> {
    Ok(downloads_base()?.to_string_lossy().to_string())
}

/// Folder containing the unpacked browser extension, for the titlebar
/// "install extension" button. In a bundled build this is the `extension`
/// resource shipped next to the app (see `bundle.resources` in
/// `tauri.conf.json`); in dev it's the `extension/` folder at the repo root.
/// `flavor` picks the build: "chrome" (Chromium/Edge/Brave) or "firefox"
/// (Firefox/Zen/LibreWolf), which ship as separate folders because Chrome and
/// Gecko disagree on the MV3 background key.
#[tauri::command]
fn extension_dir(app: tauri::AppHandle, flavor: Option<String>) -> Result<String, String> {
    let folder = match flavor.as_deref() {
        Some("firefox") => "extension-firefox",
        _ => "extension",
    };
    #[cfg(debug_assertions)]
    {
        let _ = &app;
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(folder);
        return Ok(dir.to_string_lossy().to_string());
    }
    #[cfg(not(debug_assertions))]
    {
        let dir = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join(folder);
        Ok(dir.to_string_lossy().to_string())
    }
}

/// Epoch-ms creation time of `path` (falling back to modified time on
/// filesystems that don't track creation), or `None` if either call fails.
async fn file_added_at(path: &Path) -> Option<i64> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let time = metadata.created().or_else(|_| metadata.modified()).ok()?;
    let ms = time.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(ms as i64)
}

#[tauri::command]
async fn list_resumable() -> Result<Vec<ResumableInfo>, String> {
    let dir = temp_download_dir()?;
    let mut out = Vec::new();
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(_) => return Ok(out),
    };
    while let Ok(Some(entry)) = rd.next_entry().await {
        let meta_path = entry.path();
        let name = meta_path.to_string_lossy().to_string();
        if !name.ends_with(".adm.json") {
            continue;
        }
        let Ok(bytes) = tokio::fs::read(&meta_path).await else {
            continue;
        };
        let Ok(meta) = serde_json::from_slice::<Meta>(&bytes) else {
            continue;
        };
        let data_path = PathBuf::from(name.strip_suffix(".adm.json").unwrap_or(&name));
        // The temp dir usually lives under %TEMP%, which Storage Sense and Disk
        // Cleanup purge — without this the sidecar would still report progress
        // for a file that is gone, and Resume would fail. Reaping the orphan
        // lets the persisted history row for this download show as missing
        // instead, which can be redownloaded.
        if !data_path.exists() {
            let _ = tokio::fs::remove_file(&meta_path).await;
            continue;
        }
        let plan = PiecePlan {
            piece_size: meta.piece_size,
            num_pieces: ((meta.total + meta.piece_size - 1) / meta.piece_size).max(1) as usize,
            total: meta.total,
        };
        let downloaded: u64 = meta.done_pieces.iter().map(|&k| plan.size(k)).sum::<u64>()
            + meta.partial.iter().map(|&(_, off)| off).sum::<u64>();
        if downloaded >= meta.total {
            continue;
        }
        let added_at = file_added_at(&meta_path).await;
        out.push(ResumableInfo {
            path: data_path.to_string_lossy().to_string(),
            url: meta.url,
            filename: meta.filename,
            total: meta.total,
            connections: meta.connections,
            downloaded,
            save_path: meta.save_path,
            added_at,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

enum Outcome {
    Completed,
    Paused,
    Canceled,
}

enum PieceOutcome {
    Done,
    Paused,
    Canceled,
}

#[allow(clippy::too_many_arguments)]
async fn download_inner(
    url: &str,
    allow_insecure: bool,
    headers_raw: &[(String, String)],
    connections: usize,
    resume: bool,
    resume_path: Option<&str>,
    expected_checksum: Option<&str>,
    filename: Option<&str>,
    save_path: Option<&str>,
    limits: Arc<Limits>,
    on_event: Channel<DownloadEvent>,
    control: Arc<Control>,
    prefs: &Prefs,
) -> Result<(), String> {
    if is_insecure_http(url) && !allow_insecure {
        return Err(
            "This is an insecure http:// connection and was not allowed. Nothing was saved."
                .to_string(),
        );
    }

    let headers = Arc::new(build_headers(headers_raw)?);
    let client = build_client(allow_insecure)?;

    // ------- Resolve setup (path, plan, parallel/single, fresh/resume) -------
    struct Plan {
        path: PathBuf,
        total: Option<u64>,
        filename: String,
        parallel: bool,
        fresh: bool,
        shared: Option<Arc<Shared>>,
        single_worker: Arc<WorkerUi>,
        total_downloaded: Arc<AtomicU64>,
        workers: Vec<Arc<WorkerUi>>,
        piece_size: u64,
        num_pieces: usize,
        connections: usize,
        save_path: Option<String>,
    }

    let setup: Plan = if resume {
        let rp = resume_path.ok_or("Missing resume path")?;
        let path = PathBuf::from(rp);
        if !path.exists() {
            return Err("The partial file is missing; cannot resume.".to_string());
        }
        let meta = load_meta(&path).await.ok_or("No resume data found for this file.")?;
        let plan = plan_pieces_from_meta(&meta);
        // Honor a connection-count change made since this file was paused —
        // the piece plan and progress are independent of worker count, since
        // workers just pull the next piece off a shared queue.
        let conns = choose_connections(connections, true, Some(meta.total));

        let done_set: std::collections::HashSet<usize> = meta.done_pieces.iter().copied().collect();

        // Rebuild mid-piece offsets for pieces that were in flight at pause time.
        let mut resume_offsets: HashMap<usize, u64> = HashMap::new();
        let mut partial_bytes = 0u64;
        for &(k, off) in &meta.partial {
            if k < plan.num_pieces && !done_set.contains(&k) && off > 0 && off < plan.size(k) {
                resume_offsets.insert(k, off);
                partial_bytes += off;
            }
        }
        let done_bytes: u64 =
            meta.done_pieces.iter().map(|&k| plan.size(k)).sum::<u64>() + partial_bytes;

        let done: Vec<AtomicBool> = (0..plan.num_pieces).map(|_| AtomicBool::new(false)).collect();
        for &k in &meta.done_pieces {
            if k < done.len() {
                done[k].store(true, Ordering::Relaxed);
            }
        }
        let queue: VecDeque<usize> = (0..plan.num_pieces).filter(|k| !done_set.contains(k)).collect();

        let total_downloaded = Arc::new(AtomicU64::new(done_bytes));
        let workers: Vec<Arc<WorkerUi>> =
            (0..conns).map(|_| Arc::new(WorkerUi::new())).collect();
        let piece_size = plan.piece_size;
        let num_pieces = plan.num_pieces;
        let shared = Arc::new(Shared {
            plan,
            queue: Mutex::new(queue),
            done,
            total_downloaded: total_downloaded.clone(),
            workers: workers.clone(),
            resume_offsets,
        });
        Plan {
            path,
            total: Some(meta.total),
            filename: meta.filename,
            parallel: true,
            fresh: false,
            shared: Some(shared),
            single_worker: Arc::new(WorkerUi::new()),
            total_downloaded,
            workers,
            piece_size,
            num_pieces,
            connections: conns,
            // A resumed download keeps landing in the folder it started in,
            // regardless of what the caller passes this time around.
            save_path: meta.save_path,
        }
    } else {
        let info = probe(&client, url, &headers).await?;
        let chosen_filename = filename
            .map(sanitize)
            .filter(|s| !s.is_empty() && s != "download.bin")
            .unwrap_or(info.filename);
        let temp_dir = temp_download_dir()?;
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|e| format!("Could not create temp folder: {e}"))?;
        let path = unique_path(&temp_dir, &chosen_filename);
        let conns = choose_connections(connections, info.supports_ranges, info.total);

        if conns > 1 {
            let total = info.total.expect("Some when conns > 1");
            let plan = plan_pieces(total, conns);
            let done: Vec<AtomicBool> =
                (0..plan.num_pieces).map(|_| AtomicBool::new(false)).collect();
            let queue: VecDeque<usize> = (0..plan.num_pieces).collect();
            let total_downloaded = Arc::new(AtomicU64::new(0));
            let workers: Vec<Arc<WorkerUi>> =
                (0..conns).map(|_| Arc::new(WorkerUi::new())).collect::<Vec<_>>();
            let piece_size = plan.piece_size;
            let num_pieces = plan.num_pieces;
            let shared = Arc::new(Shared {
                plan,
                queue: Mutex::new(queue),
                done,
                total_downloaded: total_downloaded.clone(),
                workers: workers.clone(),
                resume_offsets: HashMap::new(),
            });
            Plan {
                path,
                total: info.total,
                filename: chosen_filename,
                parallel: true,
                fresh: true,
                shared: Some(shared),
                single_worker: Arc::new(WorkerUi::new()),
                total_downloaded,
                workers,
                piece_size,
                num_pieces,
                connections: conns,
                save_path: save_path.map(str::to_string),
            }
        } else {
            let total_downloaded = Arc::new(AtomicU64::new(0));
            let single_worker = Arc::new(WorkerUi::new());
            single_worker
                .piece_total
                .store(info.total.unwrap_or(0), Ordering::Relaxed);
            Plan {
                path,
                total: info.total,
                filename: chosen_filename,
                parallel: false,
                fresh: true,
                shared: None,
                single_worker: single_worker.clone(),
                total_downloaded,
                workers: vec![single_worker],
                piece_size: 0,
                num_pieces: 0,
                connections: 1,
                save_path: save_path.map(str::to_string),
            }
        }
    };

    let path_str = setup.path.to_string_lossy().to_string();
    let meta_path = meta_path_for(&setup.path);

    let _ = on_event.send(DownloadEvent::Started {
        filename: setup.filename.clone(),
        path: path_str.clone(),
        total: setup.total,
        connections: setup.connections,
        piece_size: setup.piece_size,
        num_pieces: setup.num_pieces,
    });

    let meta_ctx = setup.shared.as_ref().map(|_| MetaCtx {
        meta_path: meta_path.clone(),
        url: url.to_string(),
        filename: setup.filename.clone(),
        total: setup.total.unwrap_or(0),
        piece_size: setup.piece_size,
        connections: setup.connections,
        save_path: setup.save_path.clone(),
    });

    let started = Instant::now();
    let reporter = tokio::spawn(report_progress(
        setup.workers.clone(),
        setup.total_downloaded.clone(),
        setup.total,
        on_event.clone(),
        meta_ctx.clone().zip(setup.shared.clone()),
    ));

    let outcome = if setup.parallel {
        let shared = setup.shared.clone().expect("parallel has shared");
        download_parallel(
            client.clone(),
            url.to_string(),
            headers.clone(),
            Arc::new(setup.path.clone()),
            shared,
            control.clone(),
            limits.clone(),
            setup.fresh,
        )
        .await
    } else {
        download_single(
            &client,
            url,
            &headers,
            &setup.path,
            &setup.single_worker,
            &setup.total_downloaded,
            &control,
            &limits,
        )
        .await
    };

    reporter.abort();

    let downloaded_now = setup.total_downloaded.load(Ordering::Relaxed);

    match outcome {
        Ok(Outcome::Completed) => {
            // Force everything to disk, verify size, then promote temp → final.
            if let Ok(f) = tokio::fs::OpenOptions::new().write(true).open(&setup.path).await {
                let _ = f.sync_all().await;
            }
            if let Some(total) = setup.total {
                let len = tokio::fs::metadata(&setup.path)
                    .await
                    .map_err(|e| format!("Could not read finished file: {e}"))?
                    .len();
                if len != total {
                    if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                        write_meta(ctx, shared, true).await;
                    }
                    return Err(format!(
                        "Verification failed: expected {total} bytes but the file is {len}. \
                         Kept the partial file so you can resume."
                    ));
                }
            }

            // Optional checksum verification against a user-supplied hash.
            if let Some(expected) = expected_checksum {
                let expected = expected.trim().to_ascii_lowercase().replace(' ', "");
                if !expected.is_empty() {
                    if !expected.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Err("Expected checksum is not valid hex.".to_string());
                    }
                    let algo = detect_algo(&expected).ok_or(
                        "Unrecognized checksum length — expected MD5 (32), SHA-1 (40), \
                         SHA-256 (64), or SHA-512 (128) hex characters.",
                    )?;
                    let _ = on_event.send(DownloadEvent::Verifying);
                    let actual = compute_checksum(setup.path.clone(), algo).await?;
                    if actual != expected {
                        // Corrupt: not resumable (bytes are wrong, not missing).
                        // Keep the file for inspection but drop the meta.
                        let _ = tokio::fs::remove_file(&meta_path).await;
                        return Err(format!(
                            "Checksum mismatch — expected {expected}, got {actual}. \
                             The file was NOT moved to the downloads folder."
                        ));
                    }
                }
            }

            let dest = move_to_destination(
                &setup.path,
                &setup.filename,
                setup.save_path.as_deref(),
                prefs,
            )
            .await?;
            let _ = tokio::fs::remove_file(&meta_path).await;

            let elapsed = started.elapsed().as_secs_f64();
            let avg = if elapsed > 0.0 && downloaded_now > 0 {
                downloaded_now as f64 / elapsed
            } else {
                0.0
            };
            let _ = on_event.send(DownloadEvent::Progress {
                downloaded: downloaded_now,
                total: setup.total,
                speed_bps: avg,
                connections: Vec::new(),
            });
            // `dest` may differ from `setup.filename` if a same-named file
            // already existed in the destination folder — `move_to_destination`
            // appends " (1)", " (2)", etc. to avoid overwriting it. Report the
            // name actually used on disk so the UI doesn't keep showing stale text.
            let final_filename = dest
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| setup.filename.clone());
            let _ = on_event.send(DownloadEvent::Finished {
                path: dest.to_string_lossy().to_string(),
                filename: final_filename,
            });
            Ok(())
        }
        Ok(Outcome::Paused) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            let _ = on_event.send(DownloadEvent::Paused {
                downloaded: downloaded_now,
            });
            Ok(())
        }
        Ok(Outcome::Canceled) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            let _ = on_event.send(DownloadEvent::Canceled {
                downloaded: downloaded_now,
            });
            Ok(())
        }
        Err(e) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            Err(e)
        }
    }
}

fn plan_pieces_from_meta(meta: &Meta) -> PiecePlan {
    PiecePlan {
        piece_size: meta.piece_size,
        num_pieces: ((meta.total + meta.piece_size - 1) / meta.piece_size).max(1) as usize,
        total: meta.total,
    }
}

// ---------------------------------------------------------------------------
// Progress reporter
// ---------------------------------------------------------------------------

async fn report_progress(
    workers: Vec<Arc<WorkerUi>>,
    total_downloaded: Arc<AtomicU64>,
    total: Option<u64>,
    on_event: Channel<DownloadEvent>,
    meta: Option<(MetaCtx, Arc<Shared>)>,
) {
    let mut ticker = tokio::time::interval(Duration::from_millis(150));
    let mut last = Instant::now();
    let mut last_bytes = 0u64;
    let mut last_meta = Instant::now();
    // EMA of the instantaneous rate. With 16 connections pulling pieces off a
    // shared queue, bytes arrive in bursts (a piece finishes, a new one hasn't
    // ramped up yet), so the raw 150ms-window rate swings several-fold tick to
    // tick — which then made the ETA readout (remaining / speed) flicker
    // wildly. Smoothing here fixes both the speed and ETA display at once.
    let mut smoothed_speed: Option<f64> = None;
    const SPEED_EMA_ALPHA: f64 = 0.15; // ~1s time constant at a 150ms tick

    loop {
        ticker.tick().await;
        let now = Instant::now();
        let sum = total_downloaded.load(Ordering::Relaxed);

        let secs = now.duration_since(last).as_secs_f64();
        let mut raw_speed = if secs > 0.0 {
            sum.saturating_sub(last_bytes) as f64 / secs
        } else {
            0.0
        };
        if !raw_speed.is_finite() {
            raw_speed = 0.0;
        }
        let speed = match smoothed_speed {
            Some(prev) => prev + SPEED_EMA_ALPHA * (raw_speed - prev),
            None => raw_speed,
        };
        smoothed_speed = Some(speed);

        let conns: Vec<ConnInfo> = workers
            .iter()
            .map(|w| ConnInfo {
                downloaded: w.piece_downloaded.load(Ordering::Relaxed),
                total: w.piece_total.load(Ordering::Relaxed),
                pieces: w.pieces_done.load(Ordering::Relaxed),
            })
            .collect();

        let _ = on_event.send(DownloadEvent::Progress {
            downloaded: sum,
            total,
            speed_bps: speed,
            connections: conns,
        });
        last = now;
        last_bytes = sum;

        if let Some((ctx, shared)) = &meta {
            if now.duration_since(last_meta) >= Duration::from_millis(1000) {
                write_meta(ctx, shared, false).await;
                last_meta = now;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Single-stream (no range support) — pausable, not resumable
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn download_single(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
) -> Result<Outcome, String> {
    let req = apply_headers(client.get(url), headers);
    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }

    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Could not create file: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut outcome = Outcome::Completed;
    while let Some(chunk) = stream.next().await {
        if control.is_canceled() {
            outcome = Outcome::Canceled;
            break;
        }
        if control.is_paused() {
            outcome = Outcome::Paused;
            break;
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        limits.acquire(chunk.len() as u64).await;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        let n = chunk.len() as u64;
        total_downloaded.fetch_add(n, Ordering::Relaxed);
        worker
            .piece_downloaded
            .store(total_downloaded.load(Ordering::Relaxed), Ordering::Relaxed);
    }

    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    file.sync_all().await.map_err(|e| format!("Sync error: {e}"))?;
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Parallel piece-queue download
// ---------------------------------------------------------------------------

async fn download_parallel(
    client: reqwest::Client,
    url: String,
    headers: Arc<Vec<(HeaderName, HeaderValue)>>,
    path: Arc<PathBuf>,
    shared: Arc<Shared>,
    control: Arc<Control>,
    limits: Arc<Limits>,
    fresh: bool,
) -> Result<Outcome, String> {
    if fresh {
        let file = tokio::fs::File::create(&*path)
            .await
            .map_err(|e| format!("Could not create file: {e}"))?;
        file.set_len(shared.plan.total)
            .await
            .map_err(|e| format!("Could not allocate file: {e}"))?;
        drop(file);
    }

    let conns = shared.workers.len();
    let mut handles = Vec::with_capacity(conns);
    for idx in 0..conns {
        let client = client.clone();
        let url = url.clone();
        let headers = headers.clone();
        let path = path.clone();
        let shared = shared.clone();
        let control = control.clone();
        let limits = limits.clone();
        handles.push(tokio::spawn(async move {
            worker_loop(idx, client, url, headers, path, shared, control, limits).await
        }));
    }

    let mut paused = false;
    let mut canceled = false;
    for res in join_all(handles).await {
        match res {
            Ok(Ok(PieceOutcome::Done)) => {}
            Ok(Ok(PieceOutcome::Paused)) => paused = true,
            Ok(Ok(PieceOutcome::Canceled)) => canceled = true,
            Ok(Err(e)) => return Err(e),
            Err(join_err) => return Err(format!("A download task crashed: {join_err}")),
        }
    }

    if canceled {
        Ok(Outcome::Canceled)
    } else if paused {
        Ok(Outcome::Paused)
    } else {
        Ok(Outcome::Completed)
    }
}

async fn worker_loop(
    idx: usize,
    client: reqwest::Client,
    url: String,
    headers: Arc<Vec<(HeaderName, HeaderValue)>>,
    path: Arc<PathBuf>,
    shared: Arc<Shared>,
    control: Arc<Control>,
    limits: Arc<Limits>,
) -> Result<PieceOutcome, String> {
    let worker = shared.workers[idx].clone();
    loop {
        if control.is_canceled() {
            return Ok(PieceOutcome::Canceled);
        }
        if control.is_paused() {
            return Ok(PieceOutcome::Paused);
        }

        // Pull the next piece from the shared queue.
        let next = { shared.queue.lock().unwrap().pop_front() };
        let Some(k) = next else {
            worker.piece_total.store(0, Ordering::Relaxed); // idle
            worker.current_piece.store(-1, Ordering::Relaxed);
            return Ok(PieceOutcome::Done);
        };

        let (start, end) = shared.plan.range(k);
        let initial = shared.resume_offsets.get(&k).copied().unwrap_or(0);
        worker.current_piece.store(k as i64, Ordering::Relaxed);
        worker.piece_downloaded.store(initial, Ordering::Relaxed);
        worker.piece_total.store(end - start + 1, Ordering::Relaxed);

        match download_piece(
            &client, &url, &headers, &path, start, end, initial, &worker,
            &shared.total_downloaded, &control, &limits,
        )
        .await
        {
            Ok(PieceOutcome::Done) => {
                shared.done[k].store(true, Ordering::Relaxed);
                worker.pieces_done.fetch_add(1, Ordering::Relaxed);
            }
            Ok(other) => return Ok(other), // Paused / Canceled
            Err(e) => return Err(e),
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
async fn download_piece(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    start: u64,
    end: u64,
    initial: u64,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
) -> Result<PieceOutcome, String> {
    let mut written = initial; // bytes of this piece already on disk (incl. resumed)
    let mut attempt = 0u32;
    loop {
        if control.is_canceled() {
            return Ok(PieceOutcome::Canceled);
        }
        if control.is_paused() {
            return Ok(PieceOutcome::Paused);
        }
        let cur = start + written;
        if cur > end {
            return Ok(PieceOutcome::Done);
        }
        match stream_piece(
            client, url, headers, path, cur, end, worker, total_downloaded, control, limits,
            &mut written,
        )
        .await
        {
            Ok(outcome) => return Ok(outcome),
            Err(e) => {
                attempt += 1;
                if attempt > MAX_RETRIES {
                    return Err(format!("Piece failed after {MAX_RETRIES} retries: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_piece(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    start: u64,
    end: u64,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
    written: &mut u64,
) -> Result<PieceOutcome, String> {
    let range = format!("bytes={start}-{end}");
    let req = apply_headers(client.get(url).header(reqwest::header::RANGE, range), headers);
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Piece request failed: {e}"))?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("Server did not honor Range (HTTP {})", resp.status()));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(|e| format!("Could not open file for a piece: {e}"))?;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| format!("Seek error: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut outcome = PieceOutcome::Done;
    while let Some(chunk) = stream.next().await {
        if control.is_canceled() {
            outcome = PieceOutcome::Canceled;
            break;
        }
        if control.is_paused() {
            outcome = PieceOutcome::Paused;
            break;
        }
        let chunk = chunk.map_err(|e| format!("Piece stream error: {e}"))?;
        limits.acquire(chunk.len() as u64).await;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Piece write error: {e}"))?;
        let n = chunk.len() as u64;
        *written += n;
        total_downloaded.fetch_add(n, Ordering::Relaxed);
        worker.piece_downloaded.store(*written, Ordering::Relaxed);
    }

    file.flush()
        .await
        .map_err(|e| format!("Piece flush error: {e}"))?;
    // Force partial/complete piece data to disk when stopping.
    if !matches!(outcome, PieceOutcome::Done) {
        file.sync_all()
            .await
            .map_err(|e| format!("Piece sync error: {e}"))?;
    }
    Ok(outcome)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before other plugins: routes an `adm://` URL passed
    // to a second launch into this (already running) instance instead of
    // spawning a duplicate process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(link) = deep_link_from_args(argv) {
                handle_deep_link(app, &link);
            } else {
                // Plain second launch (no deep link) while we're already
                // running, possibly hidden in the tray — surface the window
                // instead of doing nothing.
                reveal_main_window(app);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Manager::default())
        .manage(PendingDeepLink::default())
        .manage(SettingsState(Mutex::new(load_settings_from_disk())))
        .manage(PrefsState(Mutex::new(load_prefs_from_disk())))
        .manage(Quitting(AtomicBool::new(false)))
        .manage(TrayMenuState::default())
        .setup(|app| {
            // Built here (rather than declared in tauri.conf.json) so it can be
            // given `main` as its OS-level owner: an owned window is always
            // above its owner in z-order, but — unlike always-on-top — it has
            // no effect on other applications, so switching focus away to
            // another app is unaffected.
            let main = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            harden_webview(&main);
            let add = tauri::WebviewWindowBuilder::new(app, "add", tauri::WebviewUrl::App("add.html".into()))
                .title("Add Download")
                .inner_size(610.0, 465.0)
                .min_inner_size(528.0, 400.0)
                .decorations(false)
                .visible(false)
                .shadow(true)
                .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
                .owner(&main)?
                .build()?;
            harden_webview(&add);

            // Per-download "Download Details" popups are created on demand by
            // `open_detail_window` (labeled `detail-<id>`) rather than built
            // here, so each download can have its own independent popup.

            // Tray icon: left-click shows/focuses `main`, the menu offers the
            // same plus a real Quit (closing `main` normally just hides it —
            // see `on_window_event` below). The download rows in between are
            // pushed live by `update_tray_downloads` once the frontend is up.
            //
            // Built through that same helper with an empty list so the initial
            // menu already carries the "No active downloads" placeholder that
            // an empty `TrayMenuState` stands for. Hand-rolling a different
            // menu here would desync the two: the first push is also empty, so
            // it takes the no-op `same_shape` path and would never replace it.
            let (tray_menu, _) = rebuild_tray_menu(app.handle(), &[])
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("app icon is configured in tauri.conf.json"))
                .tooltip("Azhura Download Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => reveal_main_window(app),
                    "quit" => quit_app(app),
                    id if id.starts_with("dl:") => {
                        reveal_main_window(app);
                        let download_id = id.trim_start_matches("dl:").to_string();
                        let _ = app.emit_to("main", "tray-open-detail", download_id);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Registers the `adm` scheme at runtime (dev builds only need
            // this — a bundled installer registers it via the `deep-link`
            // plugin config in tauri.conf.json).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Covers macOS/Linux "open URL" OS events, delivered after
            // startup rather than as a plain argv entry.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if let Some(link) = event.urls().first() {
                        handle_deep_link(&handle, link.as_str());
                    }
                });
            }

            // Cold start on Windows: the deep-link plugin only auto-fires
            // for *subsequent* launches (relayed via single-instance), so a
            // fresh launch with `adm://...` as an argument has to be
            // detected here instead.
            if let Some(link) = deep_link_from_args(std::env::args()) {
                handle_deep_link_cold_start(&app.handle().clone(), &link);
            }

            // Pre-create the category folders so they show up (even empty) as
            // soon as the app is installed. Best-effort: `move_to_destination`
            // creates whichever one it actually needs anyway, so a failure
            // here just means the folder appears a bit later.
            if let Ok(base) = downloads_base() {
                for name in CATEGORY_FOLDERS {
                    let _ = std::fs::create_dir_all(base.join(name));
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match window.label() {
            // The add window is reused, so its titlebar close button just
            // hides it — this is the one hide path that bypasses the
            // `submit_add`/`close_add_window` commands, so main's re-enable +
            // refocus has to be duplicated here too.
            "add" => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(m) = window.get_webview_window("main") {
                        let _ = m.set_enabled(true);
                        let _ = m.set_focus();
                    }
                }
            }
            // The detail popup is reused too, and — unlike "add" — never
            // disabled `main`, so there's nothing to re-enable here; just
            // hide and let `main` know so it stops pushing `detail-data`.
            label if label.starts_with("detail-") => {
                // Per-download popups are created on demand, so let the close
                // through and just tell `main` to stop pushing snapshots at
                // this one (unlike "add" above, there's nothing to hide-and-reuse).
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let id = label.trim_start_matches("detail-").to_string();
                    let _ = window.emit_to("main", "detail-closed", id);
                }
            }
            "main" => match event {
                // Closing the window (titlebar X) never quits the app — it
                // hides to the tray, keeping downloads running in the
                // background. The tray's own "Quit" flips `Quitting` first
                // and lets this same event through.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if !window.state::<Quitting>().0.load(Ordering::Relaxed) {
                        api.prevent_close();
                        hide_to_tray(window.app_handle());
                    }
                }
                // Tauri 2 has no `Minimized` variant — `Resized` + `is_minimized()`
                // is the standard way to detect it, and it catches every path
                // (titlebar button, taskbar, Win+D) in one place.
                tauri::WindowEvent::Resized(_) => {
                    let settings = window.state::<SettingsState>();
                    let minimize_to_tray = settings.0.lock().unwrap().minimize_to_tray;
                    if minimize_to_tray && window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            start_download,
            pause_download,
            cancel_download,
            set_global_speed_limit,
            set_download_speed_limit,
            delete_download,
            list_resumable,
            probe_url,
            default_download_dir,
            extension_dir,
            take_pending_deep_link,
            open_add_window,
            reveal_add_window_cmd,
            submit_add,
            close_add_window,
            open_detail_window,
            show_detail_window,
            close_detail_window,
            update_tray_downloads,
            load_settings,
            save_settings,
            load_prefs,
            save_add_defaults,
            set_category_path,
            load_history,
            save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
