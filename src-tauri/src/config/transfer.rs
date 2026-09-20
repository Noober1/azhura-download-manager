// ---------------------------------------------------------------------------
// File-system round-trips that need a native dialog: CSV export and the
// settings/prefs/history backup (export + import). The dialog always runs
// here in Rust rather than trusting a path the frontend hands over, so it
// never needs a `dialog:allow-save`/`allow-open` permission of its own.
// ---------------------------------------------------------------------------

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::history::HistoryEntry;
use super::prefs::{Prefs, PrefsState};
use super::settings::{AppSettings, SettingsState};

async fn pick_save_path(
    app: &tauri::AppHandle,
    default_name: &str,
    filter: &str,
    ext: &str,
) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut b = app.dialog().file().set_file_name(default_name).add_filter(filter, &[ext]);
    if let Some(main) = app.get_webview_window("main") {
        b = b.set_parent(&main);
    }
    b.save_file(move |p| {
        let _ = tx.send(p);
    });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}

async fn pick_open_path(app: &tauri::AppHandle, filter: &str, ext: &str) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut b = app.dialog().file().add_filter(filter, &[ext]);
    if let Some(main) = app.get_webview_window("main") {
        b = b.set_parent(&main);
    }
    b.pick_file(move |p| {
        let _ = tx.send(p);
    });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}

async fn confirm(app: &tauri::AppHandle, title: &str, message: String, ok: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(ok.to_string(), "Cancel".to_string()))
        .show(move |yes| {
            let _ = tx.send(yes);
        });
    rx.await.unwrap_or(false)
}

/// Writes `csv` (built by the frontend, see `src/csvExport.ts`) to a path the
/// user picks in a native save dialog. Ok(None) = user canceled.
#[tauri::command]
#[specta::specta]
pub(crate) async fn export_history_csv(
    app: tauri::AppHandle,
    csv: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let Some(path) = pick_save_path(&app, &default_name, "CSV", "csv").await else {
        return Ok(None);
    };
    tokio::fs::write(&path, csv.as_bytes())
        .await
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// Backup: settings + prefs + history bundled into one JSON file, so a user
// can move to another PC or restore after a reinstall.
// ---------------------------------------------------------------------------

const BACKUP_FORMAT: &str = "azhura-download-manager-backup";
const BACKUP_VERSION: u32 = 1;
/// Refuse absurd files before reading them into memory.
const MAX_BACKUP_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupOut<'a> {
    format: &'a str,
    version: u32,
    exported_at: i64, // unix ms
    settings: AppSettings,
    prefs: Prefs, // proxy.password blanked
    history: Vec<HistoryEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupIn {
    format: String,
    version: u32,
    #[serde(default)]
    exported_at: i64,
    #[serde(default)]
    settings: AppSettings,
    #[serde(default)]
    prefs: Prefs,
    #[serde(default)]
    history: Vec<serde_json::Value>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupImport {
    #[specta(type = specta_typescript::Number)]
    exported_at: i64,
    settings: AppSettings,
    prefs: Prefs,
    history: Vec<HistoryEntry>,
}

/// Pure parse + validation, unit-tested.
fn parse_backup(bytes: &[u8]) -> Result<BackupImport, String> {
    let b: BackupIn =
        serde_json::from_slice(bytes).map_err(|_| "This file isn't a valid backup.".to_string())?;
    if b.format != BACKUP_FORMAT {
        return Err("This file isn't an Azhura Download Manager backup.".to_string());
    }
    if b.version > BACKUP_VERSION {
        return Err("This backup was made by a newer version of the app — update first.".to_string());
    }
    let history = b
        .history
        .into_iter()
        .filter_map(|v| serde_json::from_value::<HistoryEntry>(v).ok())
        .filter(|e| !e.id.is_empty() && !e.url.is_empty())
        .map(super::history::hydrate)
        .collect();
    Ok(BackupImport {
        exported_at: b.exported_at,
        settings: b.settings.sanitized(),
        prefs: b.prefs,
        history,
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn export_backup(
    app: tauri::AppHandle,
    history: Vec<HistoryEntry>,
    default_name: String,
    settings_state: tauri::State<'_, SettingsState>,
    prefs_state: tauri::State<'_, PrefsState>,
) -> Result<Option<String>, String> {
    // Snapshot before the dialog await — std MutexGuard must not cross an await.
    let settings = settings_state.0.lock().unwrap().clone();
    let mut prefs = prefs_state.0.lock().unwrap().clone();
    prefs.proxy.password.clear(); // backups are plaintext files that travel
    let Some(path) = pick_save_path(&app, &default_name, "Backup", "json").await else {
        return Ok(None);
    };
    let exported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let json = serde_json::to_vec_pretty(&BackupOut {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exported_at,
        settings,
        prefs,
        history,
    })
    .map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Pick → parse → confirm. Applies nothing itself: the frontend applies
/// settings/history (it owns that state) and calls `apply_imported_prefs`.
/// Ok(None) = canceled at either step.
#[tauri::command]
#[specta::specta]
pub(crate) async fn import_backup(app: tauri::AppHandle) -> Result<Option<BackupImport>, String> {
    let Some(path) = pick_open_path(&app, "Backup", "json").await else {
        return Ok(None);
    };
    let len = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?.len();
    if len > MAX_BACKUP_BYTES {
        return Err("That file is too large to be a backup.".to_string());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let data = parse_backup(&bytes)?;
    let msg = format!(
        "Replace your settings and download defaults with the ones in this backup, and add {} download history entries (entries you already have are skipped)?",
        data.history.len()
    );
    if !confirm(&app, "Import backup", msg, "Import").await {
        return Ok(None);
    }
    Ok(Some(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_backup_json() -> serde_json::Value {
        serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "exportedAt": 1_700_000_000_000i64,
            "settings": AppSettings::default(),
            "prefs": Prefs::default(),
            "history": [],
        })
    }

    #[test]
    fn parse_backup_rejects_the_wrong_format_tag() {
        let mut v = valid_backup_json();
        v["format"] = serde_json::Value::String("something-else".to_string());
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(parse_backup(&bytes).is_err());
    }

    #[test]
    fn parse_backup_rejects_a_newer_version() {
        let mut v = valid_backup_json();
        v["version"] = serde_json::Value::from(BACKUP_VERSION + 1);
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(parse_backup(&bytes).is_err());
    }

    #[test]
    fn parse_backup_skips_a_malformed_history_entry_but_keeps_a_valid_one() {
        let mut v = valid_backup_json();
        let mut good = serde_json::to_value(HistoryEntry {
            id: "good".to_string(),
            url: "https://example.com/a".to_string(),
            ..HistoryEntry::default()
        })
        .unwrap();
        good["total"] = serde_json::Value::from(123);
        let mut bad = good.clone();
        bad["id"] = serde_json::Value::String("bad".to_string());
        bad["total"] = serde_json::Value::String("not-a-number".to_string());
        v["history"] = serde_json::Value::Array(vec![good, bad]);
        let bytes = serde_json::to_vec(&v).unwrap();
        let out = parse_backup(&bytes).unwrap();
        assert_eq!(out.history.len(), 1);
        assert_eq!(out.history[0].id, "good");
    }

    #[test]
    fn parse_backup_sanitizes_out_of_range_settings() {
        let mut v = valid_backup_json();
        v["settings"]["maxConcurrent"] = serde_json::Value::from(99);
        let bytes = serde_json::to_vec(&v).unwrap();
        let out = parse_backup(&bytes).unwrap();
        // `max_concurrent` is private to `settings.rs` — go through JSON
        // (as any real caller of this Serialize type would) rather than the
        // Rust field.
        let out_json = serde_json::to_value(&out.settings).unwrap();
        assert_eq!(out_json["maxConcurrent"], serde_json::Value::from(10));
    }

    #[test]
    fn parse_backup_roundtrips_history_count() {
        let entries = vec![
            HistoryEntry { id: "a".to_string(), url: "https://example.com/a".to_string(), ..HistoryEntry::default() },
            HistoryEntry { id: "b".to_string(), url: "https://example.com/b".to_string(), ..HistoryEntry::default() },
        ];
        let out = BackupOut {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exported_at: 0,
            settings: AppSettings::default(),
            prefs: Prefs::default(),
            history: entries,
        };
        let bytes = serde_json::to_vec(&out).unwrap();
        let parsed = parse_backup(&bytes).unwrap();
        assert_eq!(parsed.history.len(), 2);
    }
}
