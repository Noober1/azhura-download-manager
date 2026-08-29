// ---------------------------------------------------------------------------
// `RangeReader` — a `Read + Seek` over a byte-range fetcher, block-aligned
// and cached, with hard budgets. This is the seam that lets every archive
// parser (the `zip`/`sevenz-rust2` crates, and the hand-written RAR/ISO
// walkers) run as ordinary synchronous code against a remote file without
// knowing anything about HTTP.
//
// The fetch side is abstracted behind `RangeFetcher` on purpose: production
// code fetches over HTTP (`archive::HttpRangeFetcher`), but the block
// alignment, caching and budget-enforcement logic below is exercised in
// tests with an in-memory fetcher instead, so none of it needs a network or
// an async runtime to verify.
// ---------------------------------------------------------------------------

use std::io::{self, Read, Seek, SeekFrom};

use bytes::Bytes;

pub(crate) trait RangeFetcher {
    /// Fetches the inclusive byte range `[start, end_inclusive]`.
    fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<Bytes, String>;
}

const BLOCK_SIZE: u64 = 256 * 1024; // 256 KB — one HTTP request's worth
const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024; // 16 MB total per scan
const MAX_REQUESTS: u32 = 96; // hard cap on request count per scan
const MAX_CACHED_BLOCKS: usize = 8;

/// The sentinel `io::Error` payload used to signal "ran out of budget" up
/// through a parser's own `io::Result`s, so `inspect_archive` can turn that
/// into a partial (`truncated: true`) listing instead of a hard failure.
/// Any other I/O error from this reader is a real failure.
const BUDGET_EXCEEDED: &str = "range reader budget exceeded";

pub(crate) fn is_budget_exceeded(err: &io::Error) -> bool {
    err.get_ref().map(|inner| inner.to_string() == BUDGET_EXCEEDED).unwrap_or(false)
}

fn budget_exceeded_err() -> io::Error {
    io::Error::new(io::ErrorKind::Other, BUDGET_EXCEEDED)
}

pub(crate) struct RangeReader<F: RangeFetcher> {
    fetcher: F,
    len: u64,
    pos: u64,
    /// Least-recently-used at the front, most-recently-used at the back.
    cache: Vec<(u64, Bytes)>,
    bytes_fetched: u64,
    requests_made: u32,
}

impl<F: RangeFetcher> RangeReader<F> {
    pub(crate) fn new(fetcher: F, len: u64) -> Self {
        Self { fetcher, len, pos: 0, cache: Vec::new(), bytes_fetched: 0, requests_made: 0 }
    }

    /// Returns the cached block starting at `block_start`, fetching (and, if
    /// the cache is full, evicting the least-recently-used block) on a miss.
    fn block(&mut self, block_start: u64) -> io::Result<&Bytes> {
        if let Some(idx) = self.cache.iter().position(|(start, _)| *start == block_start) {
            let entry = self.cache.remove(idx);
            self.cache.push(entry);
            return Ok(&self.cache.last().unwrap().1);
        }

        if self.requests_made >= MAX_REQUESTS || self.bytes_fetched >= MAX_PREVIEW_BYTES {
            return Err(budget_exceeded_err());
        }
        let block_end = (block_start + BLOCK_SIZE - 1).min(self.len.saturating_sub(1));
        let data = self
            .fetcher
            .fetch(block_start, block_end)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        self.requests_made += 1;
        self.bytes_fetched += data.len() as u64;

        if self.cache.len() >= MAX_CACHED_BLOCKS {
            self.cache.remove(0);
        }
        self.cache.push((block_start, data));
        Ok(&self.cache.last().unwrap().1)
    }
}

impl<F: RangeFetcher> Read for RangeReader<F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let block_start = (self.pos / BLOCK_SIZE) * BLOCK_SIZE;
        let offset_in_block = (self.pos - block_start) as usize;
        let block = self.block(block_start)?;
        let available = block.len().saturating_sub(offset_in_block);
        let n = available.min(buf.len());
        buf[..n].copy_from_slice(&block[offset_in_block..offset_in_block + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl<F: RangeFetcher> Seek for RangeReader<F> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new_pos = match pos {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::End(p) => self.len as i64 + p,
            SeekFrom::Current(p) => self.pos as i64 + p,
        };
        if new_pos < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek to a negative position"));
        }
        self.pos = new_pos as u64;
        Ok(self.pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// An in-memory `RangeFetcher` over a fixed buffer that counts calls, so
    /// tests can assert on cache-hit behavior and budget enforcement without
    /// any network or async runtime.
    struct StubFetcher {
        data: Vec<u8>,
        calls: Cell<u32>,
    }

    impl StubFetcher {
        fn new(data: Vec<u8>) -> Self {
            Self { data, calls: Cell::new(0) }
        }
    }

    impl RangeFetcher for StubFetcher {
        fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<Bytes, String> {
            self.calls.set(self.calls.get() + 1);
            let start = start as usize;
            let end = (end_inclusive as usize + 1).min(self.data.len());
            Ok(Bytes::copy_from_slice(&self.data[start..end]))
        }
    }

    fn buffer(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 256) as u8).collect()
    }

    #[test]
    fn reads_bytes_at_the_start() {
        let data = buffer(1024);
        let mut reader = RangeReader::new(StubFetcher::new(data.clone()), data.len() as u64);
        let mut buf = [0u8; 16];
        assert_eq!(reader.read(&mut buf).unwrap(), 16);
        assert_eq!(&buf, &data[..16]);
    }

    #[test]
    fn seek_from_end_is_free_and_reads_the_tail() {
        let data = buffer(1024);
        let mut reader = RangeReader::new(StubFetcher::new(data.clone()), data.len() as u64);
        reader.seek(SeekFrom::End(-16)).unwrap();
        let mut buf = [0u8; 16];
        assert_eq!(reader.read(&mut buf).unwrap(), 16);
        assert_eq!(&buf, &data[1008..1024]);
    }

    #[test]
    fn a_second_read_in_the_same_block_does_not_refetch() {
        let data = buffer(1024);
        let fetcher = StubFetcher::new(data);
        let mut reader = RangeReader::new(fetcher, 1024);
        let mut buf = [0u8; 8];
        reader.read(&mut buf).unwrap();
        reader.seek(SeekFrom::Start(8)).unwrap();
        reader.read(&mut buf).unwrap();
        assert_eq!(reader.requests_made, 1);
    }

    #[test]
    fn reading_a_different_block_issues_a_new_request() {
        let data = buffer(BLOCK_SIZE as usize * 2);
        let mut reader = RangeReader::new(StubFetcher::new(data), BLOCK_SIZE * 2);
        let mut buf = [0u8; 8];
        reader.read(&mut buf).unwrap();
        reader.seek(SeekFrom::Start(BLOCK_SIZE)).unwrap();
        reader.read(&mut buf).unwrap();
        assert_eq!(reader.requests_made, 2);
    }

    #[test]
    fn read_past_end_of_file_returns_zero() {
        let data = buffer(16);
        let mut reader = RangeReader::new(StubFetcher::new(data), 16);
        reader.seek(SeekFrom::Start(16)).unwrap();
        let mut buf = [0u8; 8];
        assert_eq!(reader.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn exceeding_the_request_budget_yields_the_budget_sentinel() {
        // One byte of unique data per block forces a fresh request every time.
        let block_count = MAX_REQUESTS as usize + 4;
        let data = buffer(block_count * BLOCK_SIZE as usize);
        let mut reader = RangeReader::new(StubFetcher::new(data), block_count as u64 * BLOCK_SIZE);
        let mut buf = [0u8; 1];
        let mut hit_budget = false;
        for i in 0..block_count {
            reader.seek(SeekFrom::Start(i as u64 * BLOCK_SIZE)).unwrap();
            match reader.read(&mut buf) {
                Ok(_) => {}
                Err(e) => {
                    assert!(is_budget_exceeded(&e));
                    hit_budget = true;
                    break;
                }
            }
        }
        assert!(hit_budget, "expected to hit the request budget before exhausting {block_count} blocks");
    }

    #[test]
    fn non_budget_io_errors_are_not_mistaken_for_the_budget_sentinel() {
        assert!(!is_budget_exceeded(&io::Error::new(io::ErrorKind::Other, "some other failure")));
    }
}
