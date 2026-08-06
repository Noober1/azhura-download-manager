// ---------------------------------------------------------------------------
// Persisted resume metadata (`<file>.adm.json`)
// ---------------------------------------------------------------------------

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::pieces::Shared;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Meta {
    pub(crate) url: String,
    pub(crate) filename: String,
    pub(crate) total: u64,
    pub(crate) piece_size: u64,
    pub(crate) connections: usize,
    pub(crate) done_pieces: Vec<usize>,
    /// (piece index, bytes already downloaded) for pieces that were in flight at
    /// pause/cancel time — lets resume continue mid-piece instead of restarting it.
    #[serde(default)]
    pub(crate) partial: Vec<(usize, u64)>,
    /// User-chosen destination folder; `None` means the default downloads folder.
    #[serde(default)]
    pub(crate) save_path: Option<String>,
    /// `ETag`/`Last-Modified` captured at probe time — sent back as
    /// `If-Range` on resume so a resource that changed while this download
    /// was paused is detected instead of silently splicing old and new
    /// bytes into one file. `#[serde(default)]` so a sidecar written before
    /// this field existed still resumes (just without that protection).
    #[serde(default)]
    pub(crate) validator: Option<String>,
}

#[derive(Clone)]
pub(crate) struct MetaCtx {
    pub(crate) meta_path: PathBuf,
    pub(crate) url: String,
    pub(crate) filename: String,
    pub(crate) total: u64,
    pub(crate) piece_size: u64,
    pub(crate) connections: usize,
    pub(crate) save_path: Option<String>,
    pub(crate) validator: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResumableInfo {
    pub(crate) path: String,
    pub(crate) url: String,
    pub(crate) filename: String,
    #[specta(type = specta_typescript::Number)]
    pub(crate) total: u64,
    #[specta(type = specta_typescript::Number)]
    pub(crate) connections: usize,
    #[specta(type = specta_typescript::Number)]
    pub(crate) downloaded: u64,
    pub(crate) save_path: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub(crate) added_at: Option<i64>,
}

pub(crate) fn meta_path_for(path: &Path) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(".adm.json");
    PathBuf::from(s)
}

pub(crate) async fn load_meta(path: &Path) -> Option<Meta> {
    let bytes = tokio::fs::read(meta_path_for(path)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) async fn write_meta(ctx: &MetaCtx, shared: &Shared, include_partials: bool) {
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
        validator: ctx.validator.clone(),
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

/// Epoch-ms creation time of `path` (falling back to modified time on
/// filesystems that don't track creation), or `None` if either call fails.
pub(crate) async fn file_added_at(path: &Path) -> Option<i64> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let time = metadata.created().or_else(|_| metadata.modified()).ok()?;
    let ms = time.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(ms as i64)
}
