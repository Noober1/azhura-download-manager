// ---------------------------------------------------------------------------
// Download history (completed / error / canceled rows, persisted across runs)
// ---------------------------------------------------------------------------

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{config_dir, write_json_atomic};
use crate::categories::retarget_legacy_path;
use crate::config::prefs::ProxyConfig;
use crate::config::settings::SettingsState;

/// One finished download. `state` always holds the real terminal state —
/// "missing" is never stored, it is recomputed from disk on every load so a
/// file that reappears recovers its original status.
#[derive(Serialize, Deserialize, Clone, Default, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct HistoryEntry {
    pub(crate) id: String,
    pub(crate) url: String,
    /// Credential headers are stripped before this is written — see `needs_auth`.
    pub(crate) headers: Vec<(String, String)>,
    pub(crate) allow_insecure: bool,
    pub(crate) checksum: String,
    #[specta(type = specta_typescript::Number)]
    pub(crate) speed_limit: u64,
    pub(crate) filename: String,
    pub(crate) filename_override: String,
    pub(crate) path: String,
    pub(crate) save_path: String,
    #[specta(type = Option<specta_typescript::Number>)]
    pub(crate) total: Option<u64>,
    #[specta(type = specta_typescript::Number)]
    pub(crate) downloaded: u64,
    #[specta(type = specta_typescript::Number)]
    pub(crate) connections: usize,
    #[specta(type = specta_typescript::Number)]
    pub(crate) used_connections: usize,
    pub(crate) state: String,
    pub(crate) error: Option<String>,
    /// Kept so a redownload of a credential-gated link can reopen the page
    /// that produced it and wait for the extension to capture a fresh request.
    pub(crate) referer: String,
    pub(crate) needs_auth: bool,
    pub(crate) proxy: ProxyConfig,
    #[specta(type = specta_typescript::Number)]
    pub(crate) finished_at: i64,
    /// When this download first entered the list; 0 for rows persisted before
    /// this field existed (the frontend falls back to `finished_at` then).
    #[specta(type = specta_typescript::Number)]
    pub(crate) added_at: i64,
    #[serde(skip_deserializing)]
    pub(crate) missing: bool,
}

const HISTORY_VERSION: u32 = 1;
/// Bounds on the user-configurable `history_max_entries`, applied here rather
/// than trusting settings.json — that file is user-editable, and a 0 there
/// would silently throw every finished download away on the next save.
const HISTORY_MAX_BOUNDS: std::ops::RangeInclusive<usize> = 50..=5000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    version: u32,
    entries: Vec<serde_json::Value>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryLoad {
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
#[specta::specta]
pub(crate) async fn load_history() -> Result<HistoryLoad, String> {
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
            // Follows a v0.2.1 category-folder rename (e.g. `Video` -> `Videos`)
            // so a row saved by an older install doesn't show up as missing.
            e.path = retarget_legacy_path(&e.path);
            e.save_path = retarget_legacy_path(&e.save_path);
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
#[specta::specta]
pub(crate) async fn save_history(
    mut entries: Vec<HistoryEntry>,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    // Block-scoped so the guard is dropped before the `.await` below: holding
    // a `std::sync::MutexGuard` across an await point makes the future
    // non-`Send`, which `#[tauri::command]` won't accept.
    let max = {
        let settings = state.0.lock().unwrap();
        (settings.history_max_entries as usize)
            .clamp(*HISTORY_MAX_BOUNDS.start(), *HISTORY_MAX_BOUNDS.end())
    };

    entries.sort_by_key(|e| std::cmp::Reverse(e.finished_at));
    entries.truncate(max);

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
