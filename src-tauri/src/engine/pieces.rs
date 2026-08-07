// ---------------------------------------------------------------------------
// Piece plan + shared work state
// ---------------------------------------------------------------------------

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64};
use std::sync::{Arc, Mutex};

use super::meta::Meta;

const PIECE_MIN: u64 = 1024 * 1024; // 1 MB
const PIECE_MAX: u64 = 8 * 1024 * 1024; // 8 MB

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
}
