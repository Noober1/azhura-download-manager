// ---------------------------------------------------------------------------
// Add-window preferences (remembered connections/speed-cap defaults + a
// per-category save-path override). Kept in their own file rather than
// folded into `AppSettings`: the main window's `save_settings` call always
// rewrites the *entire* settings object from its own state, so any field
// only the Add window knows about would get reset to its default on the
// next settings save.
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::{config_dir, write_json_atomic};

#[derive(Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ProxyConfig {
    pub(crate) enabled: bool,
    /// "http" | "https" | "socks5h"
    pub(crate) scheme: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            scheme: "http".to_string(),
            host: String::new(),
            port: 0,
            username: String::new(),
            password: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Prefs {
    /// Add-window defaults, remembered across sessions.
    #[specta(type = specta_typescript::Number)]
    connections: usize,
    speed_limit_mbps: f64,
    /// category id ("video" | "audio" | …) → absolute folder override.
    /// Absent or empty = the built-in `<base>/<Category>` folder.
    pub(crate) category_paths: HashMap<String, String>,
    pub(crate) proxy: ProxyConfig,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            connections: 8,
            speed_limit_mbps: 0.0,
            category_paths: HashMap::new(),
            proxy: ProxyConfig::default(),
        }
    }
}

pub(crate) struct PrefsState(pub(crate) Mutex<Prefs>);

fn prefs_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("prefs.json"))
}

pub(crate) fn load_prefs_from_disk() -> Prefs {
    prefs_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub(crate) fn load_prefs(state: tauri::State<'_, PrefsState>) -> Prefs {
    state.0.lock().unwrap().clone()
}

/// `save_add_defaults`'s own arguments, bundled into one struct so
/// `connections` (a bare `usize`) can carry the `#[specta(type = Number)]`
/// override needed to export it as `number` rather than `bigint` — that
/// attribute is only available on `#[derive(Type)]` struct fields, not on
/// raw `#[specta::specta]` command parameters. See `StartDownloadArgs` in
/// `commands.rs` for the same pattern.
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveAddDefaultsArgs {
    #[specta(type = specta_typescript::Number)]
    connections: usize,
    speed_limit_mbps: f64,
    proxy: ProxyConfig,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_add_defaults(
    args: SaveAddDefaultsArgs,
    state: tauri::State<'_, PrefsState>,
) -> Result<(), String> {
    let SaveAddDefaultsArgs {
        connections,
        speed_limit_mbps,
        proxy,
    } = args;
    let prefs = {
        let mut guard = state.0.lock().unwrap();
        guard.connections = connections;
        guard.speed_limit_mbps = speed_limit_mbps;
        guard.proxy = proxy;
        guard.clone()
    };
    write_json_atomic(&prefs_path()?, &prefs).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn set_category_path(
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
