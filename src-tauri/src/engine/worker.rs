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
/// Cap for a single-stream download when the server didn't declare a size
/// (no `Content-Length`) — otherwise a malicious or misbehaving server could
/// stream forever and fill the disk. 64 GB comfortably covers any real file
/// this app is meant for; hitting it means something is wrong.
const MAX_UNKNOWN_SIZE: u64 = 64 * 1024 * 1024 * 1024;

/// Distinguishes errors worth retrying (network blips, a transient 5xx) from
/// ones where retrying is pointless or unsafe — e.g. the server ignored the
/// `Range` it was sent and is streaming past the piece boundary. Retrying a
/// fatal condition would just repeat the same overrun.
pub(crate) enum PieceError {
    Retryable(String),
    Fatal(String),
}

/// Truncates `chunk` to at most `remaining` bytes in place. Returns `true` if
/// truncation happened — i.e. the server sent more than what's left of the
/// requested range/expected size, and the extra bytes were dropped rather
/// than written to disk.
fn cap_chunk(chunk: &mut bytes::Bytes, remaining: u64) -> bool {
    if chunk.len() as u64 > remaining {
        chunk.truncate(remaining as usize);
        true
    } else {
        false
    }
}

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
    total: Option<u64>,
) -> Result<Outcome, String> {
    let req = apply_headers(client.get(url), headers);
    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }

    let cap = total.unwrap_or(MAX_UNKNOWN_SIZE);
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Could not create file: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut outcome = Outcome::Completed;
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        if control.is_canceled() {
            outcome = Outcome::Canceled;
            break;
        }
        if control.is_paused() {
            outcome = Outcome::Paused;
            break;
        }
        let mut chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let remaining = cap.saturating_sub(written);
        cap_chunk(&mut chunk, remaining);
        if !chunk.is_empty() {
            limits.acquire(chunk.len() as u64).await;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {e}"))?;
            let n = chunk.len() as u64;
            written += n;
            total_downloaded.fetch_add(n, Ordering::Relaxed);
            worker
                .piece_downloaded
                .store(total_downloaded.load(Ordering::Relaxed), Ordering::Relaxed);
        }
        if written >= cap {
            file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
            file.sync_all().await.map_err(|e| format!("Sync error: {e}"))?;
            // Filling the cap isn't itself an error — for a known `total` it's
            // simply the normal end of the file. Only error if the server had
            // more to give after that point (a real overrun), or if there was
            // no declared size at all (the 64 GB cap is a hard safety limit,
            // not a real file boundary, so reaching it is always suspicious).
            return match total {
                Some(t) => match stream.next().await {
                    None => Ok(outcome),
                    Some(Ok(extra)) if extra.is_empty() => Ok(outcome),
                    Some(Ok(_)) => Err(format!(
                        "The server sent more data than the expected size ({t} bytes) — refusing to write further. Nothing was saved to the downloads folder."
                    )),
                    Some(Err(e)) => Err(format!("Stream error: {e}")),
                },
                None => Err("The server did not declare a size and sent more than 64 GB — download aborted.".to_string()),
            };
        }
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
            &shared.total_downloaded, &control, &limits, shared.validator.as_deref(),
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
    validator: Option<&str>,
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
            &mut written, validator,
        )
        .await
        {
            Ok(outcome) => return Ok(outcome),
            Err(PieceError::Fatal(e)) => return Err(e),
            Err(PieceError::Retryable(e)) => {
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
    validator: Option<&str>,
) -> Result<PieceOutcome, PieceError> {
    let range = format!("bytes={start}-{end}");
    let mut req = client.get(url).header(reqwest::header::RANGE, range);
    // Sent so a resource that changed since it was probed (or since this
    // download was paused) answers `200` with the full, current body instead
    // of quietly honoring a byte range that no longer means what it did —
    // see the status check below.
    if let Some(v) = validator.and_then(|v| reqwest::header::HeaderValue::from_str(v).ok()) {
        req = req.header(reqwest::header::IF_RANGE, v);
    }
    let req = apply_headers(req, headers);
    let resp = req
        .send()
        .await
        .map_err(|e| PieceError::Retryable(format!("Piece request failed: {e}")))?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        if validator.is_some() && resp.status() == reqwest::StatusCode::OK {
            return Err(PieceError::Fatal(
                "The file on the server changed since this download started. Start it over to get a consistent copy.".to_string(),
            ));
        }
        return Err(PieceError::Retryable(format!(
            "Server did not honor Range (HTTP {})",
            resp.status()
        )));
    }

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(|e| PieceError::Retryable(format!("Could not open file for a piece: {e}")))?;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| PieceError::Retryable(format!("Seek error: {e}")))?;

    // Bytes this request may still write before it would spill past the
    // piece's own byte range — `start` here is the absolute file offset this
    // call resumes from, so `end - start + 1` is exactly what's left of the
    // piece. A server that ignores the requested `Range` and keeps streaming
    // must never overwrite bytes belonging to the next piece (possibly
    // already completed by another worker) or grow the file past its
    // preallocated size.
    let mut remaining = end - start + 1;

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
        let mut chunk = chunk.map_err(|e| PieceError::Retryable(format!("Piece stream error: {e}")))?;
        cap_chunk(&mut chunk, remaining);
        if !chunk.is_empty() {
            limits.acquire(chunk.len() as u64).await;
            file.write_all(&chunk)
                .await
                .map_err(|e| PieceError::Retryable(format!("Piece write error: {e}")))?;
            let n = chunk.len() as u64;
            *written += n;
            remaining -= n;
            total_downloaded.fetch_add(n, Ordering::Relaxed);
            worker.piece_downloaded.store(*written, Ordering::Relaxed);
        }
        if remaining == 0 {
            file.flush()
                .await
                .map_err(|e| PieceError::Retryable(format!("Piece flush error: {e}")))?;
            file.sync_all()
                .await
                .map_err(|e| PieceError::Retryable(format!("Piece sync error: {e}")))?;
            // The piece's whole byte range is now written. If the stream still
            // had more to give, the server ignored the Range it was sent —
            // fatal, since retrying would just repeat the same overrun.
            return match stream.next().await {
                None => Ok(PieceOutcome::Done),
                Some(Ok(extra)) if extra.is_empty() => Ok(PieceOutcome::Done),
                Some(Ok(_)) => Err(PieceError::Fatal(
                    "The server sent more data than the requested range — refusing to write past the end of the piece.".to_string(),
                )),
                Some(Err(e)) => Err(PieceError::Retryable(format!("Piece stream error: {e}"))),
            };
        }
    }

    file.flush()
        .await
        .map_err(|e| PieceError::Retryable(format!("Piece flush error: {e}")))?;
    // Force partial/complete piece data to disk when stopping.
    if !matches!(outcome, PieceOutcome::Done) {
        file.sync_all()
            .await
            .map_err(|e| PieceError::Retryable(format!("Piece sync error: {e}")))?;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_chunk_truncates_a_chunk_longer_than_remaining() {
        let mut chunk = bytes::Bytes::from(vec![1u8; 500]);
        let overran = cap_chunk(&mut chunk, 100);
        assert!(overran);
        assert_eq!(chunk.len(), 100);
    }

    #[test]
    fn cap_chunk_leaves_a_chunk_that_exactly_fills_remaining() {
        let mut chunk = bytes::Bytes::from(vec![1u8; 100]);
        let overran = cap_chunk(&mut chunk, 100);
        assert!(!overran);
        assert_eq!(chunk.len(), 100);
    }

    #[test]
    fn cap_chunk_leaves_a_chunk_shorter_than_remaining_untouched() {
        let mut chunk = bytes::Bytes::from(vec![1u8; 50]);
        let overran = cap_chunk(&mut chunk, 100);
        assert!(!overran);
        assert_eq!(chunk.len(), 50);
    }
}
