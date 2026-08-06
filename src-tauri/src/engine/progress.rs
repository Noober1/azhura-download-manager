// ---------------------------------------------------------------------------
// Events + progress reporter
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;

use super::meta::MetaCtx;
use super::pieces::{Shared, WorkerUi};

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnInfo {
    #[specta(type = specta_typescript::Number)]
    downloaded: u64, // bytes into the current piece
    #[specta(type = specta_typescript::Number)]
    total: u64, // size of the current piece (0 = idle)
    #[specta(type = specta_typescript::Number)]
    pieces: u64, // pieces this connection has completed
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub(crate) enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        filename: String,
        path: String,
        #[specta(type = Option<specta_typescript::Number>)]
        total: Option<u64>,
        #[specta(type = specta_typescript::Number)]
        connections: usize,
        #[specta(type = specta_typescript::Number)]
        piece_size: u64,
        #[specta(type = specta_typescript::Number)]
        num_pieces: usize,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        #[specta(type = specta_typescript::Number)]
        downloaded: u64,
        #[specta(type = Option<specta_typescript::Number>)]
        total: Option<u64>,
        speed_bps: f64,
        connections: Vec<ConnInfo>,
    },
    Paused {
        #[specta(type = specta_typescript::Number)]
        downloaded: u64,
    },
    Canceled {
        #[specta(type = specta_typescript::Number)]
        downloaded: u64,
    },
    Verifying,
    #[serde(rename_all = "camelCase")]
    Finished {
        path: String,
        filename: String,
    },
    Error {
        message: String,
    },
}

pub(crate) async fn report_progress(
    workers: Vec<Arc<WorkerUi>>,
    total_downloaded: Arc<AtomicU64>,
    total: Option<u64>,
    on_event: Channel<DownloadEvent>,
    meta: Option<(MetaCtx, Arc<Shared>)>,
) {
    let mut ticker = tokio::time::interval(Duration::from_millis(150));
    let mut last = Instant::now();
    let mut last_bytes = 0u64;
    let mut last_meta = Instant::now();
    // EMA of the instantaneous rate. With 16 connections pulling pieces off a
    // shared queue, bytes arrive in bursts (a piece finishes, a new one hasn't
    // ramped up yet), so the raw 150ms-window rate swings several-fold tick to
    // tick — which then made the ETA readout (remaining / speed) flicker
    // wildly. Smoothing here fixes both the speed and ETA display at once.
    let mut smoothed_speed: Option<f64> = None;
    const SPEED_EMA_ALPHA: f64 = 0.15; // ~1s time constant at a 150ms tick

    loop {
        ticker.tick().await;
        let now = Instant::now();
        let sum = total_downloaded.load(Ordering::Relaxed);

        let secs = now.duration_since(last).as_secs_f64();
        let mut raw_speed = if secs > 0.0 {
            sum.saturating_sub(last_bytes) as f64 / secs
        } else {
            0.0
        };
        if !raw_speed.is_finite() {
            raw_speed = 0.0;
        }
        let speed = match smoothed_speed {
            Some(prev) => prev + SPEED_EMA_ALPHA * (raw_speed - prev),
            None => raw_speed,
        };
        smoothed_speed = Some(speed);

        let conns: Vec<ConnInfo> = workers
            .iter()
            .map(|w| ConnInfo {
                downloaded: w.piece_downloaded.load(Ordering::Relaxed),
                total: w.piece_total.load(Ordering::Relaxed),
                pieces: w.pieces_done.load(Ordering::Relaxed),
            })
            .collect();

        let _ = on_event.send(DownloadEvent::Progress {
            downloaded: sum,
            total,
            speed_bps: speed,
            connections: conns,
        });
        last = now;
        last_bytes = sum;

        if let Some((ctx, shared)) = &meta {
            if now.duration_since(last_meta) >= Duration::from_millis(1000) {
                super::meta::write_meta(ctx, shared, false).await;
                last_meta = now;
            }
        }
    }
}
