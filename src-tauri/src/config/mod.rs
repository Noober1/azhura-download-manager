// ---------------------------------------------------------------------------
// Persisted app configuration: settings.json, prefs.json, history.json.
// ---------------------------------------------------------------------------

use std::path::{Path, PathBuf};

use serde::Serialize;

pub(crate) mod history;
pub(crate) mod prefs;
pub(crate) mod secret;
pub(crate) mod settings;

pub(crate) fn config_dir() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("Could not locate the config directory")?
        .join("AzhuraDownloadManager"))
}

/// Write JSON via a temp file + rename so a crash mid-write can never leave a
/// truncated config behind. Serialized through a process-wide lock: Tauri
/// commands run concurrently on the tokio runtime, and two overlapping writes
/// to the same file would otherwise interleave through the temp path.
pub(crate) async fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
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
