// ---------------------------------------------------------------------------
// App settings (persisted to disk — tray/minimize behavior + the scheduler
// knobs that used to reset every launch)
// ---------------------------------------------------------------------------

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri_plugin_autostart::ManagerExt;

use super::{config_dir, write_json_atomic};

#[derive(Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AppSettings {
    #[specta(type = specta_typescript::Number)]
    max_concurrent: usize,
    global_limit_mbps: f64,
    pub(crate) minimize_to_tray: bool,
    /// "system" | "dark" | "light". Applied entirely on the frontend (see
    /// `src/theme.ts`); Rust only persists it.
    theme: String,
    notifications: bool,
    /// User opt-in on top of the OS-level `prefers-reduced-motion` — only
    /// ever adds reduction, never overrides the OS setting the other way.
    /// Applied entirely on the frontend (see `src/reducedMotion.ts`); Rust
    /// only persists it.
    reduce_motion: bool,
    /// How many times a failed download retries itself automatically before
    /// giving up for good, with backoff between attempts. 0 = disabled
    /// (today's behavior). Applied entirely on the frontend (see
    /// `useDownloads.ts`); Rust only persists it.
    max_retry_attempts: u32,
    /// Watch the clipboard for copied http(s) links and offer them as
    /// downloads. Off by default: a watcher that reacts to every copy is
    /// intrusive enough that it has to be opt-in. Applied entirely on the
    /// frontend (see `useClipboardWatch.ts`); Rust only persists it.
    clipboard_watch: bool,
    /// Hold the queue until `scheduled_start_time` each day, so downloads
    /// added in the meantime wait instead of starting. Applied entirely on
    /// the frontend (see `queueSchedule.ts`); Rust only persists it.
    scheduled_start_enabled: bool,
    /// "HH:MM", 24-hour. Only meaningful when `scheduled_start_enabled`.
    scheduled_start_time: String,
    /// Cap on rows kept in history.json. Unlike every other field here this
    /// one IS read by Rust — `save_history` is the only writer, so it's the
    /// backstop behind the frontend's own retention sweep.
    pub(crate) history_max_entries: u32,
    /// Drop history rows finished more than this many days ago. 0 = keep
    /// forever (the behavior before this setting existed). Applied on the
    /// frontend, where the download list actually lives (see
    /// `useHistoryPersistence.ts`).
    history_retention_days: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_concurrent: 3,
            global_limit_mbps: 0.0,
            minimize_to_tray: false,
            theme: "system".to_string(),
            notifications: true,
            reduce_motion: false,
            max_retry_attempts: 3,
            clipboard_watch: false,
            scheduled_start_enabled: false,
            scheduled_start_time: "02:00".to_string(),
            history_max_entries: 500,
            history_retention_days: 0,
        }
    }
}

pub(crate) struct SettingsState(pub(crate) Mutex<AppSettings>);

fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(config_dir()?.join("settings.json"))
}

pub(crate) fn load_settings_from_disk() -> AppSettings {
    settings_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub(crate) fn load_settings(state: tauri::State<'_, SettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    *state.0.lock().unwrap() = settings.clone();
    write_json_atomic(&settings_path()?, &settings).await
}

// ---------------------------------------------------------------------------
// Run at startup
// ---------------------------------------------------------------------------
//
// Deliberately NOT a field on `AppSettings`: the OS-level registry entry (or
// macOS LaunchAgent) the `autostart` plugin manages is the single source of
// truth. Mirroring it into settings.json would let the two disagree — e.g. a
// user removing the entry from Task Manager's Startup tab would leave
// settings.json still claiming it's on.

/// Tracks whether *this* process launch was the autostart one (passed the
/// `--autostart` flag the plugin was registered with) — set once at startup
/// in `lib.rs` and read by the frontend to decide whether to skip showing
/// the main window on first paint.
pub(crate) struct AutostartLaunch(pub(crate) bool);

#[tauri::command]
#[specta::specta]
pub(crate) fn get_run_at_startup(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn set_run_at_startup(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled { autolaunch.enable() } else { autolaunch.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn launched_at_startup(state: tauri::State<'_, AutostartLaunch>) -> bool {
    state.0
}
