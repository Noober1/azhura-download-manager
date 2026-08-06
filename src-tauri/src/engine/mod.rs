// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

pub(crate) mod checksum;
pub(crate) mod client;
pub(crate) mod control;
pub(crate) mod limiter;
pub(crate) mod meta;
pub(crate) mod pieces;
pub(crate) mod progress;
pub(crate) mod worker;

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::ipc::Channel;

use crate::config::prefs::{Prefs, ProxyConfig};
use crate::paths::{move_to_destination, sanitize, temp_download_dir, unique_path, write_mark_of_the_web};

use checksum::{compute_checksum, detect_algo};
use client::{build_client, build_headers, choose_connections, is_insecure_http, probe};
use control::Control;
use limiter::Limits;
use meta::{load_meta, meta_path_for, write_meta, MetaCtx};
use pieces::{plan_pieces, plan_pieces_from_meta, Shared, WorkerUi};
use progress::{report_progress, DownloadEvent};
use worker::{download_parallel, download_single};

pub(crate) enum Outcome {
    Completed,
    Paused,
    Canceled,
}

pub(crate) enum PieceOutcome {
    Done,
    Paused,
    Canceled,
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_inner(
    url: &str,
    allow_insecure: bool,
    headers_raw: &[(String, String)],
    connections: usize,
    resume: bool,
    resume_path: Option<&str>,
    expected_checksum: Option<&str>,
    filename: Option<&str>,
    save_path: Option<&str>,
    limits: Arc<Limits>,
    on_event: Channel<DownloadEvent>,
    control: Arc<Control>,
    prefs: &Prefs,
    proxy: &ProxyConfig,
) -> Result<(), String> {
    if is_insecure_http(url) && !allow_insecure {
        return Err(
            "This is an insecure http:// connection and was not allowed. Nothing was saved."
                .to_string(),
        );
    }

    let headers = Arc::new(build_headers(headers_raw)?);
    let client = build_client(allow_insecure, proxy)?;

    // ------- Resolve setup (path, plan, parallel/single, fresh/resume) -------
    struct Plan {
        path: std::path::PathBuf,
        total: Option<u64>,
        filename: String,
        parallel: bool,
        fresh: bool,
        shared: Option<Arc<Shared>>,
        single_worker: Arc<WorkerUi>,
        total_downloaded: Arc<AtomicU64>,
        workers: Vec<Arc<WorkerUi>>,
        piece_size: u64,
        num_pieces: usize,
        connections: usize,
        save_path: Option<String>,
    }

    let setup: Plan = if resume {
        let rp = resume_path.ok_or("Missing resume path")?;
        let path = std::path::PathBuf::from(rp);
        if !path.exists() {
            return Err("The partial file is missing; cannot resume.".to_string());
        }
        let meta = load_meta(&path).await.ok_or("No resume data found for this file.")?;
        let plan = plan_pieces_from_meta(&meta);
        // Honor a connection-count change made since this file was paused —
        // the piece plan and progress are independent of worker count, since
        // workers just pull the next piece off a shared queue.
        let conns = choose_connections(connections, true, Some(meta.total));

        let done_set: std::collections::HashSet<usize> = meta.done_pieces.iter().copied().collect();

        // Rebuild mid-piece offsets for pieces that were in flight at pause time.
        let mut resume_offsets: HashMap<usize, u64> = HashMap::new();
        let mut partial_bytes = 0u64;
        for &(k, off) in &meta.partial {
            if k < plan.num_pieces && !done_set.contains(&k) && off > 0 && off < plan.size(k) {
                resume_offsets.insert(k, off);
                partial_bytes += off;
            }
        }
        let done_bytes: u64 =
            meta.done_pieces.iter().map(|&k| plan.size(k)).sum::<u64>() + partial_bytes;

        let done: Vec<std::sync::atomic::AtomicBool> =
            (0..plan.num_pieces).map(|_| std::sync::atomic::AtomicBool::new(false)).collect();
        for &k in &meta.done_pieces {
            if k < done.len() {
                done[k].store(true, Ordering::Relaxed);
            }
        }
        let queue: VecDeque<usize> = (0..plan.num_pieces).filter(|k| !done_set.contains(k)).collect();

        let total_downloaded = Arc::new(AtomicU64::new(done_bytes));
        let workers: Vec<Arc<WorkerUi>> =
            (0..conns).map(|_| Arc::new(WorkerUi::new())).collect();
        let piece_size = plan.piece_size;
        let num_pieces = plan.num_pieces;
        let shared = Arc::new(Shared {
            plan,
            queue: Mutex::new(queue),
            done,
            total_downloaded: total_downloaded.clone(),
            workers: workers.clone(),
            resume_offsets,
            validator: meta.validator,
        });
        Plan {
            path,
            total: Some(meta.total),
            filename: meta.filename,
            parallel: true,
            fresh: false,
            shared: Some(shared),
            single_worker: Arc::new(WorkerUi::new()),
            total_downloaded,
            workers,
            piece_size,
            num_pieces,
            connections: conns,
            // A resumed download keeps landing in the folder it started in,
            // regardless of what the caller passes this time around.
            save_path: meta.save_path,
        }
    } else {
        let info = probe(&client, url, &headers).await?;
        let chosen_filename = filename
            .map(sanitize)
            .filter(|s| !s.is_empty() && s != "download.bin")
            .unwrap_or(info.filename);
        let temp_dir = temp_download_dir()?;
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|e| format!("Could not create temp folder: {e}"))?;
        let path = unique_path(&temp_dir, &chosen_filename);
        let conns = choose_connections(connections, info.supports_ranges, info.total);

        if conns > 1 {
            let total = info.total.expect("Some when conns > 1");
            let plan = plan_pieces(total, conns);
            let done: Vec<std::sync::atomic::AtomicBool> =
                (0..plan.num_pieces).map(|_| std::sync::atomic::AtomicBool::new(false)).collect();
            let queue: VecDeque<usize> = (0..plan.num_pieces).collect();
            let total_downloaded = Arc::new(AtomicU64::new(0));
            let workers: Vec<Arc<WorkerUi>> =
                (0..conns).map(|_| Arc::new(WorkerUi::new())).collect::<Vec<_>>();
            let piece_size = plan.piece_size;
            let num_pieces = plan.num_pieces;
            let shared = Arc::new(Shared {
                plan,
                queue: Mutex::new(queue),
                done,
                total_downloaded: total_downloaded.clone(),
                workers: workers.clone(),
                resume_offsets: HashMap::new(),
                validator: info.validator,
            });
            Plan {
                path,
                total: info.total,
                filename: chosen_filename,
                parallel: true,
                fresh: true,
                shared: Some(shared),
                single_worker: Arc::new(WorkerUi::new()),
                total_downloaded,
                workers,
                piece_size,
                num_pieces,
                connections: conns,
                save_path: save_path.map(str::to_string),
            }
        } else {
            let total_downloaded = Arc::new(AtomicU64::new(0));
            let single_worker = Arc::new(WorkerUi::new());
            single_worker
                .piece_total
                .store(info.total.unwrap_or(0), Ordering::Relaxed);
            Plan {
                path,
                total: info.total,
                filename: chosen_filename,
                parallel: false,
                fresh: true,
                shared: None,
                single_worker: single_worker.clone(),
                total_downloaded,
                workers: vec![single_worker],
                piece_size: 0,
                num_pieces: 0,
                connections: 1,
                save_path: save_path.map(str::to_string),
            }
        }
    };

    let path_str = setup.path.to_string_lossy().to_string();
    let meta_path = meta_path_for(&setup.path);

    let _ = on_event.send(DownloadEvent::Started {
        filename: setup.filename.clone(),
        path: path_str.clone(),
        total: setup.total,
        connections: setup.connections,
        piece_size: setup.piece_size,
        num_pieces: setup.num_pieces,
    });

    let meta_ctx = setup.shared.as_ref().map(|shared| MetaCtx {
        meta_path: meta_path.clone(),
        url: url.to_string(),
        filename: setup.filename.clone(),
        total: setup.total.unwrap_or(0),
        piece_size: setup.piece_size,
        connections: setup.connections,
        save_path: setup.save_path.clone(),
        validator: shared.validator.clone(),
    });

    let started = Instant::now();
    let reporter = tokio::spawn(report_progress(
        setup.workers.clone(),
        setup.total_downloaded.clone(),
        setup.total,
        on_event.clone(),
        meta_ctx.clone().zip(setup.shared.clone()),
    ));

    let outcome = if setup.parallel {
        let shared = setup.shared.clone().expect("parallel has shared");
        download_parallel(
            client.clone(),
            url.to_string(),
            headers.clone(),
            Arc::new(setup.path.clone()),
            shared,
            control.clone(),
            limits.clone(),
            setup.fresh,
        )
        .await
    } else {
        download_single(
            &client,
            url,
            &headers,
            &setup.path,
            &setup.single_worker,
            &setup.total_downloaded,
            &control,
            &limits,
            setup.total,
        )
        .await
    };

    reporter.abort();

    let downloaded_now = setup.total_downloaded.load(Ordering::Relaxed);

    match outcome {
        Ok(Outcome::Completed) => {
            // Force everything to disk, verify size, then promote temp → final.
            if let Ok(f) = tokio::fs::OpenOptions::new().write(true).open(&setup.path).await {
                let _ = f.sync_all().await;
            }
            if let Some(total) = setup.total {
                let len = tokio::fs::metadata(&setup.path)
                    .await
                    .map_err(|e| format!("Could not read finished file: {e}"))?
                    .len();
                if len != total {
                    if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                        write_meta(ctx, shared, true).await;
                    }
                    return Err(format!(
                        "Verification failed: expected {total} bytes but the file is {len}. \
                         Kept the partial file so you can resume."
                    ));
                }
            }

            // Optional checksum verification against a user-supplied hash.
            if let Some(expected) = expected_checksum {
                let expected = expected.trim().to_ascii_lowercase().replace(' ', "");
                if !expected.is_empty() {
                    if !expected.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Err("Expected checksum is not valid hex.".to_string());
                    }
                    let algo = detect_algo(&expected).ok_or(
                        "Unrecognized checksum length — expected MD5 (32), SHA-1 (40), \
                         SHA-256 (64), or SHA-512 (128) hex characters.",
                    )?;
                    let _ = on_event.send(DownloadEvent::Verifying);
                    let actual = compute_checksum(setup.path.clone(), algo).await?;
                    if actual != expected {
                        // Corrupt: not resumable (bytes are wrong, not missing).
                        // Keep the file for inspection but drop the meta.
                        let _ = tokio::fs::remove_file(&meta_path).await;
                        return Err(format!(
                            "Checksum mismatch — expected {expected}, got {actual}. \
                             The file was NOT moved to the downloads folder."
                        ));
                    }
                }
            }

            let dest = move_to_destination(
                &setup.path,
                &setup.filename,
                setup.save_path.as_deref(),
                prefs,
            )
            .await?;
            let _ = tokio::fs::remove_file(&meta_path).await;

            // Must run after the move, not before: `move_to_destination` falls
            // back to a plain copy when the temp file and destination are on
            // different volumes, and a copy does not carry the source's
            // alternate data streams — tagging `setup.path` first would leave
            // the actual saved file with no Mark-of-the-Web at all.
            let referrer = headers_raw
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("referer"))
                .map(|(_, v)| v.as_str());
            write_mark_of_the_web(&dest, url, referrer).await;

            let elapsed = started.elapsed().as_secs_f64();
            let avg = if elapsed > 0.0 && downloaded_now > 0 {
                downloaded_now as f64 / elapsed
            } else {
                0.0
            };
            let _ = on_event.send(DownloadEvent::Progress {
                downloaded: downloaded_now,
                total: setup.total,
                speed_bps: avg,
                connections: Vec::new(),
            });
            // `dest` may differ from `setup.filename` if a same-named file
            // already existed in the destination folder — `move_to_destination`
            // appends " (1)", " (2)", etc. to avoid overwriting it. Report the
            // name actually used on disk so the UI doesn't keep showing stale text.
            let final_filename = dest
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| setup.filename.clone());
            let _ = on_event.send(DownloadEvent::Finished {
                path: dest.to_string_lossy().to_string(),
                filename: final_filename,
            });
            Ok(())
        }
        Ok(Outcome::Paused) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            let _ = on_event.send(DownloadEvent::Paused {
                downloaded: downloaded_now,
            });
            Ok(())
        }
        Ok(Outcome::Canceled) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            let _ = on_event.send(DownloadEvent::Canceled {
                downloaded: downloaded_now,
            });
            Ok(())
        }
        Err(e) => {
            if let (Some(ctx), Some(shared)) = (&meta_ctx, &setup.shared) {
                write_meta(ctx, shared, true).await;
            }
            Err(e)
        }
    }
}
