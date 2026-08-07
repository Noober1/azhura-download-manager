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
