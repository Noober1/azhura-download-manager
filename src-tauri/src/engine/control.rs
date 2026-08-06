// ---------------------------------------------------------------------------
// Pause / cancel control registry
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::limiter::RateLimiter;

pub(crate) struct Control {
    pub(crate) paused: AtomicBool,
    pub(crate) canceled: AtomicBool,
    /// This download's own rate cap, reachable after `start_download` returns
    /// so `set_download_speed_limit` can adjust it live.
    pub(crate) limiter: Arc<RateLimiter>,
}

impl Control {
    pub(crate) fn new(rate: u64) -> Self {
        Self {
            paused: AtomicBool::new(false),
            canceled: AtomicBool::new(false),
            limiter: Arc::new(RateLimiter::new(rate)),
        }
    }
    pub(crate) fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
    pub(crate) fn is_canceled(&self) -> bool {
        self.canceled.load(Ordering::Relaxed)
    }
}

pub(crate) struct Manager {
    pub(crate) downloads: Mutex<HashMap<String, Arc<Control>>>,
    pub(crate) global: Arc<RateLimiter>,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            downloads: Mutex::new(HashMap::new()),
            global: Arc::new(RateLimiter::new(0)),
        }
    }
}
