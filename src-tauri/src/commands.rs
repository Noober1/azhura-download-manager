// ---------------------------------------------------------------------------
// Top-level Tauri commands that don't belong to a more specific module.
// ---------------------------------------------------------------------------

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::Deserialize;
use tauri::ipc::Channel;

use crate::config::prefs::{PrefsState, ProxyConfig};
use crate::engine::client::{build_client, build_headers, probe, ProbeInfo};
use crate::engine::control::{Control, Manager};
use crate::engine::limiter::Limits;
use crate::engine::meta::{file_added_at, meta_path_for, ResumableInfo};
use crate::engine::pieces::PiecePlan;
use crate::engine::progress::DownloadEvent;
use crate::engine::{client::is_insecure_http, download_inner};
use crate::paths::temp_download_dir;

/// `start_download`'s own arguments, bundled into one struct rather than left
/// as separate parameters: specta's `#[specta::specta]` macro (used to
/// generate `../src/bindings.ts`) only implements its `SpectaFn` trait for
/// functions of up to 10 parameters, and this command's domain arguments
/// alone numbered 12. Grouping them costs nothing at the call site — Tauri's
/// `invoke()` already sends named args as a single JSON object either way.
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartDownloadArgs {
    id: String,
    url: String,
    allow_insecure: bool,
    headers: Vec<(String, String)>,
    #[specta(type = specta_typescript::Number)]
    connections: usize,
    resume: bool,
    resume_path: Option<String>,
    expected_checksum: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    speed_limit: Option<u64>,
    filename: Option<String>,
    save_path: Option<String>,
    proxy: Option<ProxyConfig>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn start_download(
    args: StartDownloadArgs,
    on_event: Channel<DownloadEvent>,
    manager: tauri::State<'_, Manager>,
    prefs_state: tauri::State<'_, PrefsState>,
) -> Result<(), String> {
    let StartDownloadArgs {
        id,
        url,
        allow_insecure,
        headers,
        connections,
        resume,
        resume_path,
        expected_checksum,
        speed_limit,
        filename,
        save_path,
        proxy,
    } = args;

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
    let mut proxy = proxy.unwrap_or_default();
    // A history row persists without the proxy password (stripped like the
    // credential headers), and the Add dialog — the only place to edit proxy
    // settings — can't be reached for an existing row, so a redownload would
    // 407 forever. Refill from the remembered default when it's the same proxy.
    if proxy.enabled
        && proxy.password.is_empty()
        && prefs.proxy.host == proxy.host
        && prefs.proxy.port == proxy.port
        && prefs.proxy.username == proxy.username
    {
        proxy.password = prefs.proxy.password.clone();
    }

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
        &proxy,
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
#[specta::specta]
pub(crate) fn pause_download(id: String, manager: tauri::State<'_, Manager>) {
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.paused.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn cancel_download(id: String, manager: tauri::State<'_, Manager>) {
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.canceled.store(true, Ordering::Relaxed);
    }
}

/// A bare `u64`/`usize` command parameter can't carry the
/// `#[specta(type = Number)]` override needed to export it as `number`
/// rather than `bigint` — that attribute only works on `#[derive(Type)]`
/// struct fields (see `StartDownloadArgs` above). Shared by the two
/// speed-limit commands below, both of which take just this one value.
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpeedLimitArgs {
    #[specta(type = specta_typescript::Number)]
    bytes_per_sec: u64,
}

/// Set the global download speed cap in bytes/sec (0 = unlimited). Live —
/// affects all active downloads immediately since they share this bucket.
#[tauri::command]
#[specta::specta]
pub(crate) fn set_global_speed_limit(args: SpeedLimitArgs, manager: tauri::State<'_, Manager>) {
    manager.global.set_rate(args.bytes_per_sec);
}

/// Set one download's own speed cap in bytes/sec (0 = unlimited). Live — the
/// running workers share this bucket, so it takes effect on the next chunk.
#[tauri::command]
#[specta::specta]
pub(crate) fn set_download_speed_limit(
    id: String,
    args: SpeedLimitArgs,
    manager: tauri::State<'_, Manager>,
) {
    let bytes_per_sec = args.bytes_per_sec;
    if let Some(c) = manager.downloads.lock().unwrap().get(&id) {
        c.limiter.set_rate(bytes_per_sec);
    }
}

/// Remove a row's resume sidecar (always) and, if requested, the file itself.
/// Save folders are now user-chosen, so this only sanity-checks the path
/// instead of confining it to the default downloads/temp roots.
#[tauri::command]
#[specta::specta]
pub(crate) async fn delete_download(path: String, delete_file: bool) -> Result<(), String> {
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
#[specta::specta]
pub(crate) async fn probe_url(
    url: String,
    allow_insecure: bool,
    headers: Vec<(String, String)>,
    proxy: Option<ProxyConfig>,
) -> Result<ProbeInfo, String> {
    let proxy = proxy.unwrap_or_default();
    if is_insecure_http(&url) && !allow_insecure {
        return Err(
            "This is an insecure http:// connection and was not allowed.".to_string(),
        );
    }
    let built_headers = build_headers(&headers)?;
    let client = build_client(allow_insecure, &proxy)?;
    let info = probe(&client, &url, &built_headers).await?;
    Ok(ProbeInfo {
        total: info.total,
        supports_ranges: info.supports_ranges,
        filename: info.filename,
    })
}

/// The default destination folder, for the Add window's "Save path" field.
#[tauri::command]
#[specta::specta]
pub(crate) fn default_download_dir() -> Result<String, String> {
    Ok(crate::paths::downloads_base()?.to_string_lossy().to_string())
}

/// Folder containing the unpacked browser extension, for the titlebar
/// "install extension" button. In a bundled build this is the `extension`
/// resource shipped next to the app (see `bundle.resources` in
/// `tauri.conf.json`); in dev it's the `extension/` folder at the repo root.
/// `flavor` picks the build: "chrome" (Chromium/Edge/Brave) or "firefox"
/// (Firefox/Zen/LibreWolf), which ship as separate folders because Chrome and
/// Gecko disagree on the MV3 background key.
#[tauri::command]
#[specta::specta]
pub(crate) fn extension_dir(app: tauri::AppHandle, flavor: Option<String>) -> Result<String, String> {
    let folder = match flavor.as_deref() {
        Some("firefox") => "extension-firefox",
        _ => "extension",
    };
    #[cfg(debug_assertions)]
    {
        let _ = &app;
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(folder);
        Ok(dir.to_string_lossy().to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri::Manager as _;
        let dir = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join(folder);
        Ok(dir.to_string_lossy().to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn list_resumable() -> Result<Vec<ResumableInfo>, String> {
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
        let Ok(meta) = serde_json::from_slice::<crate::engine::meta::Meta>(&bytes) else {
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
            num_pieces: meta.total.div_ceil(meta.piece_size).max(1) as usize,
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
