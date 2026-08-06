// ---------------------------------------------------------------------------
// Rate limiting (token bucket)
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) struct Bucket {
    tokens: f64,
    last: Instant,
}

/// A shared token bucket. `rate` is bytes/sec (0 = unlimited). Multiple workers
/// call `acquire` before writing each chunk; the bucket refills over wall-clock
/// time, bounding aggregate throughput.
pub(crate) struct RateLimiter {
    rate: AtomicU64,
    bucket: Mutex<Bucket>,
}

impl RateLimiter {
    pub(crate) fn new(rate: u64) -> Self {
        Self {
            rate: AtomicU64::new(rate),
            bucket: Mutex::new(Bucket {
                tokens: 0.0,
                last: Instant::now(),
            }),
        }
    }

    pub(crate) fn set_rate(&self, r: u64) {
        self.rate.store(r, Ordering::Relaxed);
    }

    pub(crate) async fn acquire(&self, n: u64) {
        loop {
            let rate = self.rate.load(Ordering::Relaxed);
            if rate == 0 || n == 0 {
                return; // unlimited
            }
            // Burst capacity: at least 4 MB so a single chunk can always fit.
            let cap = (rate as f64).max(4.0 * 1024.0 * 1024.0);
            let wait_secs = {
                let mut b = self.bucket.lock().unwrap();
                let now = Instant::now();
                let elapsed = now.duration_since(b.last).as_secs_f64();
                b.last = now;
                b.tokens = (b.tokens + elapsed * rate as f64).min(cap);
                if b.tokens >= n as f64 {
                    b.tokens -= n as f64;
                    0.0
                } else {
                    (n as f64 - b.tokens) / rate as f64
                }
            };
            if wait_secs <= 0.0 {
                return;
            }
            // Cap the nap so pause and rate changes take effect quickly.
            tokio::time::sleep(Duration::from_secs_f64(wait_secs.min(0.25))).await;
        }
    }
}

/// The two limiters every chunk must pass: the shared global one and this
/// download's own. Either may be unlimited (rate 0).
pub(crate) struct Limits {
    pub(crate) global: Arc<RateLimiter>,
    pub(crate) per: Arc<RateLimiter>,
}

impl Limits {
    pub(crate) async fn acquire(&self, n: u64) {
        self.global.acquire(n).await;
        self.per.acquire(n).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rate_limiter_unlimited_returns_immediately() {
        let limiter = RateLimiter::new(0);
        let start = Instant::now();
        limiter.acquire(50_000_000).await;
        assert!(start.elapsed() < Duration::from_millis(50));
    }

    #[tokio::test]
    async fn rate_limiter_limited_rate_delays_roughly_as_expected() {
        let limiter = RateLimiter::new(2000); // 2000 bytes/sec
        let start = Instant::now();
        limiter.acquire(500).await; // ~0.25s worth of tokens at this rate
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::from_millis(150), "elapsed too short: {elapsed:?}");
        assert!(elapsed <= Duration::from_millis(800), "elapsed too long: {elapsed:?}");
    }
}
