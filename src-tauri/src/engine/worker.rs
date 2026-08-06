// ---------------------------------------------------------------------------
// Single-stream (no range support) — pausable, not resumable — and the
// parallel piece-queue download.
// ---------------------------------------------------------------------------

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::join_all;
use futures_util::StreamExt;
use reqwest::header::{HeaderName, HeaderValue};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use super::client::apply_headers;
use super::control::Control;
use super::limiter::Limits;
use super::pieces::{Shared, WorkerUi};
use super::{Outcome, PieceOutcome};

const MAX_RETRIES: u32 = 5;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_single(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
) -> Result<Outcome, String> {
    let req = apply_headers(client.get(url), headers);
    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }

    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Could not create file: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut outcome = Outcome::Completed;
    while let Some(chunk) = stream.next().await {
        if control.is_canceled() {
            outcome = Outcome::Canceled;
            break;
        }
        if control.is_paused() {
            outcome = Outcome::Paused;
            break;
        }
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        limits.acquire(chunk.len() as u64).await;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        let n = chunk.len() as u64;
        total_downloaded.fetch_add(n, Ordering::Relaxed);
        worker
            .piece_downloaded
            .store(total_downloaded.load(Ordering::Relaxed), Ordering::Relaxed);
    }

    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    file.sync_all().await.map_err(|e| format!("Sync error: {e}"))?;
    Ok(outcome)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_parallel(
    client: reqwest::Client,
    url: String,
    headers: Arc<Vec<(HeaderName, HeaderValue)>>,
    path: Arc<PathBuf>,
    shared: Arc<Shared>,
    control: Arc<Control>,
    limits: Arc<Limits>,
    fresh: bool,
) -> Result<Outcome, String> {
    if fresh {
        let file = tokio::fs::File::create(&*path)
            .await
            .map_err(|e| format!("Could not create file: {e}"))?;
        file.set_len(shared.plan.total)
            .await
            .map_err(|e| format!("Could not allocate file: {e}"))?;
        drop(file);
    }

    let conns = shared.workers.len();
    let mut handles = Vec::with_capacity(conns);
    for idx in 0..conns {
        let client = client.clone();
        let url = url.clone();
        let headers = headers.clone();
        let path = path.clone();
        let shared = shared.clone();
        let control = control.clone();
        let limits = limits.clone();
        handles.push(tokio::spawn(async move {
            worker_loop(idx, client, url, headers, path, shared, control, limits).await
        }));
    }

    let mut paused = false;
    let mut canceled = false;
    for res in join_all(handles).await {
        match res {
            Ok(Ok(PieceOutcome::Done)) => {}
            Ok(Ok(PieceOutcome::Paused)) => paused = true,
            Ok(Ok(PieceOutcome::Canceled)) => canceled = true,
            Ok(Err(e)) => return Err(e),
            Err(join_err) => return Err(format!("A download task crashed: {join_err}")),
        }
    }

    if canceled {
        Ok(Outcome::Canceled)
    } else if paused {
        Ok(Outcome::Paused)
    } else {
        Ok(Outcome::Completed)
    }
}

#[allow(clippy::too_many_arguments)]
async fn worker_loop(
    idx: usize,
    client: reqwest::Client,
    url: String,
    headers: Arc<Vec<(HeaderName, HeaderValue)>>,
    path: Arc<PathBuf>,
    shared: Arc<Shared>,
    control: Arc<Control>,
    limits: Arc<Limits>,
) -> Result<PieceOutcome, String> {
    let worker = shared.workers[idx].clone();
    loop {
        if control.is_canceled() {
            return Ok(PieceOutcome::Canceled);
        }
        if control.is_paused() {
            return Ok(PieceOutcome::Paused);
        }

        // Pull the next piece from the shared queue.
        let next = { shared.queue.lock().unwrap().pop_front() };
        let Some(k) = next else {
            worker.piece_total.store(0, Ordering::Relaxed); // idle
            worker.current_piece.store(-1, Ordering::Relaxed);
            return Ok(PieceOutcome::Done);
        };

        let (start, end) = shared.plan.range(k);
        let initial = shared.resume_offsets.get(&k).copied().unwrap_or(0);
        worker.current_piece.store(k as i64, Ordering::Relaxed);
        worker.piece_downloaded.store(initial, Ordering::Relaxed);
        worker.piece_total.store(end - start + 1, Ordering::Relaxed);

        match download_piece(
            &client, &url, &headers, &path, start, end, initial, &worker,
            &shared.total_downloaded, &control, &limits,
        )
        .await
        {
            Ok(PieceOutcome::Done) => {
                shared.done[k].store(true, Ordering::Relaxed);
                worker.pieces_done.fetch_add(1, Ordering::Relaxed);
            }
            Ok(other) => return Ok(other), // Paused / Canceled
            Err(e) => return Err(e),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn download_piece(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    start: u64,
    end: u64,
    initial: u64,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
) -> Result<PieceOutcome, String> {
    let mut written = initial; // bytes of this piece already on disk (incl. resumed)
    let mut attempt = 0u32;
    loop {
        if control.is_canceled() {
            return Ok(PieceOutcome::Canceled);
        }
        if control.is_paused() {
            return Ok(PieceOutcome::Paused);
        }
        let cur = start + written;
        if cur > end {
            return Ok(PieceOutcome::Done);
        }
        match stream_piece(
            client, url, headers, path, cur, end, worker, total_downloaded, control, limits,
            &mut written,
        )
        .await
        {
            Ok(outcome) => return Ok(outcome),
            Err(e) => {
                attempt += 1;
                if attempt > MAX_RETRIES {
                    return Err(format!("Piece failed after {MAX_RETRIES} retries: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_piece(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
    path: &Path,
    start: u64,
    end: u64,
    worker: &WorkerUi,
    total_downloaded: &AtomicU64,
    control: &Control,
    limits: &Limits,
    written: &mut u64,
) -> Result<PieceOutcome, String> {
    let range = format!("bytes={start}-{end}");
    let req = apply_headers(client.get(url).header(reqwest::header::RANGE, range), headers);
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Piece request failed: {e}"))?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("Server did not honor Range (HTTP {})", resp.status()));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(|e| format!("Could not open file for a piece: {e}"))?;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| format!("Seek error: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut outcome = PieceOutcome::Done;
    while let Some(chunk) = stream.next().await {
        if control.is_canceled() {
            outcome = PieceOutcome::Canceled;
            break;
        }
        if control.is_paused() {
            outcome = PieceOutcome::Paused;
            break;
        }
        let chunk = chunk.map_err(|e| format!("Piece stream error: {e}"))?;
        limits.acquire(chunk.len() as u64).await;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Piece write error: {e}"))?;
        let n = chunk.len() as u64;
        *written += n;
        total_downloaded.fetch_add(n, Ordering::Relaxed);
        worker.piece_downloaded.store(*written, Ordering::Relaxed);
    }

    file.flush()
        .await
        .map_err(|e| format!("Piece flush error: {e}"))?;
    // Force partial/complete piece data to disk when stopping.
    if !matches!(outcome, PieceOutcome::Done) {
        file.sync_all()
            .await
            .map_err(|e| format!("Piece sync error: {e}"))?;
    }
    Ok(outcome)
}
