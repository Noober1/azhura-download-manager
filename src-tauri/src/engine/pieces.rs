// ---------------------------------------------------------------------------
// Piece plan + shared work state
// ---------------------------------------------------------------------------

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::meta::Meta;

const PIECE_MIN: u64 = 1024 * 1024; // 1 MB
const PIECE_MAX: u64 = 8 * 1024 * 1024; // 8 MB

/// Resolution of the detail window's per-piece progress map — fixed
/// regardless of file size, so a 100 GB download costs no more per progress
/// tick than a 10 MB one.
pub(crate) const PIECE_BUCKETS: usize = 160;

pub(crate) struct PiecePlan {
    pub(crate) piece_size: u64,
    pub(crate) num_pieces: usize,
    pub(crate) total: u64,
}

impl PiecePlan {
    pub(crate) fn range(&self, k: usize) -> (u64, u64) {
        let start = k as u64 * self.piece_size;
        let end = (start + self.piece_size).min(self.total) - 1;
        (start, end)
    }
    pub(crate) fn size(&self, k: usize) -> u64 {
        let (s, e) = self.range(k);
        e - s + 1
    }
}

/// Aim for ~4 pieces per connection so fast workers can pull ahead, but keep
/// each piece within [1 MB, 8 MB] to bound per-request overhead.
pub(crate) fn plan_pieces(total: u64, conns: usize) -> PiecePlan {
    let target = (total / (conns as u64 * 4).max(1)).max(1);
    let piece_size = target.clamp(PIECE_MIN, PIECE_MAX);
    let num_pieces = total.div_ceil(piece_size).max(1) as usize;
    PiecePlan {
        piece_size,
        num_pieces,
        total,
    }
}

pub(crate) fn plan_pieces_from_meta(meta: &Meta) -> PiecePlan {
    PiecePlan {
        piece_size: meta.piece_size,
        num_pieces: meta.total.div_ceil(meta.piece_size).max(1) as usize,
        total: meta.total,
    }
}

pub(crate) struct WorkerUi {
    pub(crate) piece_downloaded: AtomicU64,
    pub(crate) piece_total: AtomicU64,
    pub(crate) pieces_done: AtomicU64,
    pub(crate) current_piece: AtomicI64, // -1 = idle / none
}

impl WorkerUi {
    pub(crate) fn new() -> Self {
        Self {
            piece_downloaded: AtomicU64::new(0),
            piece_total: AtomicU64::new(0),
            pieces_done: AtomicU64::new(0),
            current_piece: AtomicI64::new(-1),
        }
    }
}

pub(crate) struct Shared {
    pub(crate) plan: PiecePlan,
    pub(crate) queue: Mutex<VecDeque<usize>>,
    pub(crate) done: Vec<AtomicBool>,
    pub(crate) total_downloaded: Arc<AtomicU64>,
    pub(crate) workers: Vec<Arc<WorkerUi>>,
    /// Seed offsets for pieces resumed mid-way: piece index → bytes already on disk.
    pub(crate) resume_offsets: HashMap<usize, u64>,
    /// `ETag`/`Last-Modified` from the initial probe — see `client::Probe`.
    pub(crate) validator: Option<String>,
}

/// Byte range covered by bucket `b` of `PIECE_BUCKETS` equal-sized slices of
/// a `total`-byte file — half-open, `[start, end)`.
fn bucket_range(b: usize, total: u64) -> (u64, u64) {
    let start = (b as u64 * total) / PIECE_BUCKETS as u64;
    let end = ((b as u64 + 1) * total / PIECE_BUCKETS as u64).min(total);
    (start, end)
}

/// Pure core of the piece map: how full each of `PIECE_BUCKETS` equal-sized
/// byte ranges of a `total`-byte file is, given the half-open `[start, end)`
/// byte ranges already on disk (pieces may overlap in `ranges`; overlaps are
/// summed then clamped, never double-scaled). Returns one 0..=255 fill level
/// per bucket, or an empty `Vec` when `total == 0` — there is nothing to
/// divide into buckets, and treating bucket 0 as spanning the whole (empty)
/// file would make every bucket after it zero-capacity anyway.
fn fill_buckets(total: u64, ranges: &[(u64, u64)]) -> Vec<u8> {
    if total == 0 {
        return Vec::new();
    }
    let mut filled = vec![0u64; PIECE_BUCKETS];
    for &(start, end) in ranges {
        if end <= start {
            continue;
        }
        let first = ((start * PIECE_BUCKETS as u64) / total) as usize;
        let last = (((end - 1) * PIECE_BUCKETS as u64) / total).min(PIECE_BUCKETS as u64 - 1) as usize;
        for b in first..=last {
            let (bucket_start, bucket_end) = bucket_range(b, total);
            let overlap = end.min(bucket_end).saturating_sub(start.max(bucket_start));
            filled[b] += overlap;
        }
    }
    (0..PIECE_BUCKETS)
        .map(|b| {
            let (bucket_start, bucket_end) = bucket_range(b, total);
            // Only the last few buckets of a file smaller than PIECE_BUCKETS
            // bytes can land here — each byte position maps to a distinct
            // bucket only up to `total`, so buckets beyond that have no
            // width at all.
            let cap = bucket_end.saturating_sub(bucket_start);
            if cap == 0 {
                0
            } else {
                ((filled[b].min(cap) * 255) / cap) as u8
            }
        })
        .collect()
}

/// Piece-level fill map for the detail window's per-piece progress
/// visualization: one 0..=255 byte per `PIECE_BUCKETS` equal-sized slice of
/// the file, built from completed pieces plus each worker's in-flight
/// progress on the piece it currently holds. Empty for a single-connection
/// download (`shared` only exists for the parallel path at all) and for a
/// resumed download whose sidecar happens to declare `total: 0` — the sidecar
/// is user-writable, so that's not guaranteed impossible the way it is for a
/// fresh download's own size probe.
pub(crate) fn piece_buckets(shared: &Shared) -> Vec<u8> {
    if shared.plan.total == 0 {
        return Vec::new();
    }

    let done: Vec<bool> = shared.done.iter().map(|d| d.load(Ordering::Relaxed)).collect();

    let mut ranges: Vec<(u64, u64)> = Vec::with_capacity(done.len() + shared.workers.len());
    for (k, &is_done) in done.iter().enumerate() {
        if is_done {
            let (start, end) = shared.plan.range(k);
            ranges.push((start, end + 1)); // `range` is inclusive; buckets want half-open.
        }
    }

    // In-flight pieces: a worker writes its piece sequentially from byte 0,
    // so the completed portion is exactly `[start, start + piece_downloaded)`.
    // The guards mirror `meta::write_meta`'s in-flight collection
    // (`meta.rs:86-106`), which does the same thing for the resume sidecar —
    // in particular `!done[k]` is load-bearing, not defensive: `worker.rs`
    // leaves a worker's `current_piece`/`piece_downloaded` pointing at the
    // piece it just *finished* until it claims the next one
    // (`worker.rs:215-217`), so without this check a just-completed piece
    // would have its range added a second time here.
    for w in &shared.workers {
        let k = w.current_piece.load(Ordering::Relaxed);
        if k < 0 {
            continue;
        }
        let k = k as usize;
        if k >= shared.plan.num_pieces || done[k] {
            continue;
        }
        let off = w.piece_downloaded.load(Ordering::Relaxed);
        let size = shared.plan.size(k);
        if off == 0 || off >= size {
            continue;
        }
        let (start, _) = shared.plan.range(k);
        ranges.push((start, start + off));
    }

    fill_buckets(shared.plan.total, &ranges)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_pieces_last_piece_is_shorter_and_sums_to_total() {
        let total = 10 * 1024 * 1024 + 123; // not an even multiple of any piece size
        let plan = plan_pieces(total, 4);
        let sum: u64 = (0..plan.num_pieces).map(|k| plan.size(k)).sum();
        assert_eq!(sum, total);
        for k in 0..plan.num_pieces - 1 {
            assert_eq!(plan.size(k), plan.piece_size);
        }
        assert!(plan.size(plan.num_pieces - 1) <= plan.piece_size);
    }

    #[test]
    fn plan_pieces_clamps_piece_size_to_bounds() {
        let tiny = plan_pieces(100, 4);
        assert_eq!(tiny.piece_size, PIECE_MIN);

        let huge = plan_pieces(4 * 1024 * 1024 * 1024, 1);
        assert_eq!(huge.piece_size, PIECE_MAX);
    }

    fn test_shared(plan: PiecePlan, done: Vec<bool>, workers: Vec<Arc<WorkerUi>>) -> Shared {
        Shared {
            plan,
            queue: Mutex::new(VecDeque::new()),
            done: done.into_iter().map(AtomicBool::new).collect(),
            total_downloaded: Arc::new(AtomicU64::new(0)),
            workers,
            resume_offsets: HashMap::new(),
            validator: None,
        }
    }

    #[test]
    fn piece_buckets_all_done_is_fully_filled() {
        let plan = plan_pieces(1_000_000, 4);
        let n = plan.num_pieces;
        let shared = test_shared(plan, vec![true; n], Vec::new());
        let buckets = piece_buckets(&shared);
        assert_eq!(buckets.len(), PIECE_BUCKETS);
        assert!(buckets.iter().all(|&b| b == 255));
    }

    #[test]
    fn piece_buckets_none_done_is_empty() {
        let plan = plan_pieces(1_000_000, 4);
        let n = plan.num_pieces;
        let shared = test_shared(plan, vec![false; n], Vec::new());
        let buckets = piece_buckets(&shared);
        assert_eq!(buckets.len(), PIECE_BUCKETS);
        assert!(buckets.iter().all(|&b| b == 0));
    }

    #[test]
    fn piece_buckets_zero_total_returns_empty_vec() {
        // The resume path builds `Shared` from a user-writable sidecar
        // (`plan_pieces_from_meta`), so `total == 0` isn't the impossible
        // case here that it would be on the fresh-download path.
        let plan = PiecePlan { piece_size: 1, num_pieces: 1, total: 0 };
        let shared = test_shared(plan, vec![false], Vec::new());
        assert!(piece_buckets(&shared).is_empty());
    }

    #[test]
    fn piece_buckets_total_smaller_than_bucket_count_does_not_panic() {
        let plan = plan_pieces(50, 1); // total(50) < PIECE_BUCKETS(160)
        let n = plan.num_pieces;
        let shared = test_shared(plan, vec![true; n], Vec::new());
        let buckets = piece_buckets(&shared);
        assert_eq!(buckets.len(), PIECE_BUCKETS);
    }

    #[test]
    fn piece_buckets_does_not_double_count_a_done_piece_a_worker_is_still_parked_on() {
        // A boundary bucket that's half piece 0 (done) and half piece 1 (not
        // done) is the only shape that can expose the bug: a bucket entirely
        // inside one piece can't tell a single count from a double count
        // apart (both clamp to the same full bucket), so the test needs a
        // piece boundary to land inside a bucket.
        //
        // total = 1600, PIECE_BUCKETS = 160 → each bucket is 10 bytes wide.
        // piece_size = 805 puts the piece 0/1 boundary at byte 805, inside
        // bucket 80 (bytes [800, 810)) — piece 0 covers half of it (5
        // bytes), piece 1 (not done) covers the other half.
        let plan = PiecePlan { piece_size: 805, num_pieces: 2, total: 1600 };
        let worker = WorkerUi::new();
        // Stale, as `worker.rs:215-217` leaves it: `current_piece` and
        // `piece_downloaded` still point at piece 0, which just finished.
        worker.current_piece.store(0, Ordering::Relaxed);
        worker.piece_downloaded.store(plan.size(0), Ordering::Relaxed);
        let shared = test_shared(plan, vec![true, false], vec![Arc::new(worker)]);

        let buckets = piece_buckets(&shared);
        // Correct: 5 of bucket 80's 10 bytes are done → (5*255)/10 = 127.
        // Double-counted (the bug this guards against): piece 0's range
        // added twice would clamp bucket 80 to fully done (255) even though
        // piece 1 hasn't started.
        assert_eq!(buckets[80], 127);
    }
}
