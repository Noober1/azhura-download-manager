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

use super::secret;
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

// ---------------------------------------------------------------------------
// Disk shape. `ProxyConfig`/`Prefs` above are also the *IPC* shape shared
// with the Add window (see `src/components/add/ProxyTab.tsx`) — plaintext
// there is fine, since it never leaves this process. On disk the proxy
// password is DPAPI-protected (see `config::secret`) so it doesn't sit as
// cleartext in a config file that can outlive the process and end up
// somewhere other than this machine (a backup, a synced AppData folder).
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct StoredProxyConfig {
    enabled: bool,
    scheme: String,
    host: String,
    port: u16,
    username: String,
    /// DPAPI-protected, hex-encoded. Empty when there's no password to store.
    password_enc: String,
    /// Legacy plaintext field, from before this encryption existed. Only
    /// ever read here — `from_wire` never writes to it again once a file has
    /// gone through a save, which is what completes the migration.
    #[serde(default)]
    password: String,
}

impl StoredProxyConfig {
    fn from_wire(cfg: &ProxyConfig) -> Self {
        let (password_enc, password) = if cfg.password.is_empty() {
            (String::new(), String::new())
        } else {
            match secret::protect(&cfg.password) {
                Some(enc) => (enc, String::new()),
                // DPAPI failed for some reason — keep the password readable
                // rather than silently discard it. The next save retries
                // encryption from this same legacy field.
                None => (String::new(), cfg.password.clone()),
            }
        };
        Self {
            enabled: cfg.enabled,
            scheme: cfg.scheme.clone(),
            host: cfg.host.clone(),
            port: cfg.port,
            username: cfg.username.clone(),
            password_enc,
            password,
        }
    }

    fn into_wire(self) -> ProxyConfig {
        let password = if !self.password_enc.is_empty() {
            secret::unprotect(&self.password_enc).unwrap_or_default()
        } else {
            self.password
        };
        ProxyConfig {
            enabled: self.enabled,
            scheme: self.scheme,
            host: self.host,
            port: self.port,
            username: self.username,
            password,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct StoredPrefs {
    connections: usize,
    speed_limit_mbps: f64,
    category_paths: HashMap<String, String>,
    proxy: StoredProxyConfig,
}

impl StoredPrefs {
    fn from_wire(p: &Prefs) -> Self {
        Self {
            connections: p.connections,
            speed_limit_mbps: p.speed_limit_mbps,
            category_paths: p.category_paths.clone(),
            proxy: StoredProxyConfig::from_wire(&p.proxy),
        }
    }

    fn into_wire(self) -> Prefs {
        Prefs {
            connections: self.connections,
            speed_limit_mbps: self.speed_limit_mbps,
            category_paths: self.category_paths,
            proxy: self.proxy.into_wire(),
        }
    }
}

fn prefs_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("prefs.json"))
}

pub(crate) fn load_prefs_from_disk() -> Prefs {
    prefs_path()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice::<StoredPrefs>(&bytes).ok())
        .map(StoredPrefs::into_wire)
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
    write_json_atomic(&prefs_path()?, &StoredPrefs::from_wire(&prefs)).await
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
    write_json_atomic(&prefs_path()?, &StoredPrefs::from_wire(&prefs)).await
}
