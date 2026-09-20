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
    /// Whether a downloaded update may be installed silently: on quit, and on
    /// the next cold start if that was missed (e.g. the process was
    /// force-killed before it could quit normally). On by default: a
    /// downloaded update that nobody ever installs is the failure mode this
    /// exists to prevent. An update the feed marks `critical` ignores this —
    /// that flag already forced the restart dialog when it arrived, so it
    /// doesn't need this path too. Read by `update.rs`; the frontend only
    /// toggles it (see `useUpdateCheck.ts`).
    pub(crate) auto_install_updates: bool,
    /// Sidebar shown as a full-width panel vs. a narrow icon rail. Applied
    /// entirely on the frontend (see `src/components/Sidebar.tsx`); Rust
    /// only persists it.
    sidebar_collapsed: bool,
    /// System-wide shortcut that opens the Add window, in global-hotkey
    /// syntax ("Ctrl+Alt+D"). "" = off (the default — a preset combo could
    /// collide with another app). Registered by Rust (see `hotkey.rs`).
    pub(crate) global_hotkey: String,
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
            auto_install_updates: true,
            sidebar_collapsed: false,
            global_hotkey: String::new(),
        }
    }
}

impl AppSettings {
    /// Clamps an imported (i.e. untrusted, hand-editable) settings object to
    /// the same ranges the Settings dialog enforces.
    pub(crate) fn sanitized(mut self) -> Self {
        self.max_concurrent = self.max_concurrent.clamp(1, 10);
        if !self.global_limit_mbps.is_finite() || self.global_limit_mbps < 0.0 {
            self.global_limit_mbps = 0.0;
        }
        self.max_retry_attempts = self.max_retry_attempts.min(10);
        self.history_max_entries = self.history_max_entries.clamp(50, 5000);
        self.history_retention_days = self.history_retention_days.min(365);
        if !["system", "dark", "light"].contains(&self.theme.as_str()) {
            self.theme = "system".to_string();
        }
        self
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_clamps_out_of_range_numeric_fields() {
        let s = AppSettings {
            max_concurrent: 99,
            max_retry_attempts: 99,
            history_max_entries: 1,
            history_retention_days: 9999,
            ..AppSettings::default()
        }
        .sanitized();
        assert_eq!(s.max_concurrent, 10);
        assert_eq!(s.max_retry_attempts, 10);
        assert_eq!(s.history_max_entries, 50);
        assert_eq!(s.history_retention_days, 365);
    }

    #[test]
    fn sanitized_rejects_a_zero_max_concurrent() {
        let s = AppSettings { max_concurrent: 0, ..AppSettings::default() }.sanitized();
        assert_eq!(s.max_concurrent, 1);
    }

    #[test]
    fn sanitized_replaces_a_negative_or_non_finite_speed_limit_with_zero() {
        let s = AppSettings { global_limit_mbps: -5.0, ..AppSettings::default() }.sanitized();
        assert_eq!(s.global_limit_mbps, 0.0);
        let s = AppSettings { global_limit_mbps: f64::NAN, ..AppSettings::default() }.sanitized();
        assert_eq!(s.global_limit_mbps, 0.0);
    }

    #[test]
    fn sanitized_falls_back_to_system_theme_for_an_unknown_value() {
        let s = AppSettings { theme: "solarized".to_string(), ..AppSettings::default() }.sanitized();
        assert_eq!(s.theme, "system");
    }

    #[test]
    fn sanitized_leaves_valid_values_untouched() {
        let s = AppSettings {
            max_concurrent: 5,
            max_retry_attempts: 3,
            history_max_entries: 1000,
            history_retention_days: 30,
            theme: "dark".to_string(),
            global_limit_mbps: 2.5,
            ..AppSettings::default()
        }
        .sanitized();
        assert_eq!(s.max_concurrent, 5);
        assert_eq!(s.max_retry_attempts, 3);
        assert_eq!(s.history_max_entries, 1000);
        assert_eq!(s.history_retention_days, 30);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.global_limit_mbps, 2.5);
    }
}
