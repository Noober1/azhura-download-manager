// ---------------------------------------------------------------------------
// "Preview archive" — list a remote ZIP/7z/RAR/ISO's contents before
// committing to the download, the way IDM's built-in archive viewer does.
//
// Every one of these formats keeps its directory of contents in a small,
// locatable region of the file (a central directory, a header block, a
// volume descriptor), so a server that honors `Range` lets us read just
// that region — via `RangeReader`, a `Read + Seek` backed by HTTP byte
// ranges — instead of the whole archive. Payload bytes are never fetched.
// ---------------------------------------------------------------------------

mod iso;
mod range_reader;
mod rar;
mod sevenz;
mod zip;

use std::time::Duration;

use reqwest::header::{HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};

use crate::config::prefs::ProxyConfig;
use crate::engine::client::{build_client, build_headers, fetch_range, is_insecure_http, probe};
use crate::urls::validate_download_url;
use range_reader::{RangeFetcher, RangeReader};

// `Serialize` too (unusual for an inbound-only command argument struct):
// the Add window hands this to `open_archive_window` to stash, and the
// preview window's own `take_archive_request` hands the same shape back out
// to JS, which then calls `inspect_archive` with it — so it round-trips
// through both directions of the IPC boundary.
#[derive(Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveRequest {
    pub(crate) url: String,
    pub(crate) allow_insecure: bool,
    pub(crate) headers: Vec<(String, String)>,
    pub(crate) proxy: Option<ProxyConfig>,
}

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveEntry {
    /// Internal path, `/`-separated, no leading slash.
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    #[specta(type = specta_typescript::Number)]
    pub(crate) size: u64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub(crate) compressed: Option<u64>,
    pub(crate) encrypted: bool,
    /// `"YYYY-MM-DD HH:MM"`, when the format records one.
    pub(crate) modified: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveListing {
    pub(crate) format: String,
    pub(crate) filename: String,
    #[specta(type = specta_typescript::Number)]
    pub(crate) total: u64,
    pub(crate) entries: Vec<ArchiveEntry>,
    /// A request/byte budget was hit before the whole directory was read —
    /// `entries` is a partial (but not corrupt) listing.
    pub(crate) truncated: bool,
    /// The format encrypts its own file-name table (7z `-mhe`, RAR `-hp`),
    /// so nothing could be listed at all; `entries` is empty.
    pub(crate) encrypted_names: bool,
}

/// Hard cap on how many entries a single listing collects. Past this, a
/// parser stops early and the listing comes back `truncated: true` rather
/// than growing without bound for an archive with hundreds of thousands of
/// files.
pub(crate) const MAX_ENTRIES: usize = 20_000;

/// Formats a Unix timestamp as `"YYYY-MM-DD HH:MM"` (UTC), for formats like
/// 7z that only expose a raw epoch time — unlike ZIP's `DateTime`, which
/// already hands back broken-down year/month/day/hour/minute. Plain civil
/// calendar arithmetic (Howard Hinnant's `civil_from_days`, public domain)
/// rather than a date/time crate dependency for something this small.
pub(crate) fn format_unix_timestamp(unix_secs: i64) -> String {
    let days = unix_secs.div_euclid(86_400);
    let secs_of_day = unix_secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}")
}

/// Converts a day count since the Unix epoch (1970-01-01) into a
/// proleptic-Gregorian (year, month, day). Valid for the full `i64` range.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468; // shift the epoch to 0000-03-01, the start of this algorithm's year
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // day of era, [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // year of era, [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // day of year, [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], counting from March
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if month <= 2 { y + 1 } else { y }, month, day)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum ArchiveFormat {
    Zip,
    SevenZip,
    Rar,
    Iso,
}

/// Sniffs `head` (the first bytes of the file) for a known archive
/// signature, falling back to `filename`'s extension when the magic isn't
/// recognized. ISO 9660's own signature sits far into the file (LBA 16, i.e.
/// byte 0x8000) rather than at the start, so it is detected by extension
/// here and verified for real once the ISO walker reads that sector.
pub(crate) fn detect_format(head: &[u8], filename: &str) -> Option<ArchiveFormat> {
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") || head.starts_with(b"PK\x06\x06") {
        return Some(ArchiveFormat::Zip);
    }
    if head.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Some(ArchiveFormat::SevenZip);
    }
    if head.starts_with(b"Rar!\x1A\x07\x00") || head.starts_with(b"Rar!\x1A\x07\x01\x00") {
        return Some(ArchiveFormat::Rar);
    }

    let ext = filename.rsplit('.').next().map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("zip" | "apk" | "jar" | "epub" | "docx" | "xlsx" | "pptx" | "cbz" | "ipa" | "whl") => {
            Some(ArchiveFormat::Zip)
        }
        Some("7z") => Some(ArchiveFormat::SevenZip),
        Some("rar") => Some(ArchiveFormat::Rar),
        Some("iso" | "img") => Some(ArchiveFormat::Iso),
        _ => None,
    }
}

/// Bridges the synchronous `RangeFetcher` a parser drives (from inside
/// `spawn_blocking`) to the async `fetch_range`. Safe to `block_on` from
/// here specifically because this only ever runs on tokio's *blocking*
/// thread pool (via `spawn_blocking`), never on an async worker thread —
/// blocking one of those would be the actual problem.
struct HttpRangeFetcher {
    handle: tokio::runtime::Handle,
    client: reqwest::Client,
    url: String,
    headers: Vec<(HeaderName, HeaderValue)>,
}

impl RangeFetcher for HttpRangeFetcher {
    fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<bytes::Bytes, String> {
        let client = self.client.clone();
        let url = self.url.clone();
        let headers = self.headers.clone();
        self.handle.block_on(fetch_range(&client, &url, &headers, start, end_inclusive))
    }
}

/// Dispatches to the format-specific directory walker. Each one reads only
/// its format's header/directory region through `reader` — never the
/// archive's payload bytes.
fn scan_archive<F: RangeFetcher>(
    format: ArchiveFormat,
    reader: RangeReader<F>,
    filename: &str,
    total: u64,
) -> Result<ArchiveListing, String> {
    match format {
        ArchiveFormat::Zip => zip::list(reader, filename, total),
        ArchiveFormat::SevenZip => sevenz::list(reader, filename, total),
        ArchiveFormat::Rar => rar::list(reader, filename, total),
        ArchiveFormat::Iso => iso::list(reader, filename, total),
    }
}

/// Check a remote archive's contents ahead of committing to the download,
/// for the Add window's "Preview contents" button. Reuses the same
/// probe/client path as `probe_url` and a real download, so a listing here
/// reflects exactly what downloading the file would get.
#[tauri::command]
#[specta::specta]
pub(crate) async fn inspect_archive(req: ArchiveRequest) -> Result<ArchiveListing, String> {
    validate_download_url(&req.url)?;
    let proxy = req.proxy.unwrap_or_default();
    if is_insecure_http(&req.url) && !req.allow_insecure {
        return Err("This is an insecure http:// connection and was not allowed.".to_string());
    }
    let headers = build_headers(&req.headers)?;
    let client = build_client(req.allow_insecure, &proxy)?;
    let info = probe(&client, &req.url, &headers).await?;

    let Some(total) = info.total else {
        return Err(
            "This server didn't report the file's size, so its contents can't be listed \
             without downloading it first."
                .to_string(),
        );
    };
    if !info.supports_ranges {
        return Err(
            "This server doesn't support partial requests, so the archive's contents can't \
             be listed without downloading it first."
                .to_string(),
        );
    }

    let head_end = 15.min(total.saturating_sub(1));
    let head = fetch_range(&client, &req.url, &headers, 0, head_end).await?;
    let Some(format) = detect_format(&head, &info.filename) else {
        return Err("Preview isn't supported for this file type.".to_string());
    };

    let handle = tokio::runtime::Handle::current();
    let url = req.url.clone();
    let filename = info.filename.clone();
    let scan = tokio::task::spawn_blocking(move || {
        let fetcher = HttpRangeFetcher { handle, client, url, headers };
        let reader = RangeReader::new(fetcher, total);
        scan_archive(format, reader, &filename, total)
    });

    tokio::time::timeout(Duration::from_secs(60), scan)
        .await
        .map_err(|_| "Timed out while reading the archive.".to_string())?
        .map_err(|e| format!("Archive scan failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_a_known_unix_timestamp() {
        // 2024-03-07 09:05:00 UTC.
        assert_eq!(format_unix_timestamp(1_709_802_300), "2024-03-07 09:05");
    }

    #[test]
    fn formats_the_unix_epoch_itself() {
        assert_eq!(format_unix_timestamp(0), "1970-01-01 00:00");
    }

    #[test]
    fn formats_a_leap_day() {
        // 2024-02-29 00:00:00 UTC.
        assert_eq!(format_unix_timestamp(1_709_164_800), "2024-02-29 00:00");
    }

    #[test]
    fn formats_the_last_moment_of_a_year() {
        // 2023-12-31 23:59:00 UTC.
        assert_eq!(format_unix_timestamp(1_704_067_140), "2023-12-31 23:59");
    }

    #[test]
    fn detects_zip_by_magic() {
        assert_eq!(detect_format(b"PK\x03\x04rest-of-header", "download"), Some(ArchiveFormat::Zip));
    }

    #[test]
    fn detects_empty_zip_by_magic() {
        assert_eq!(detect_format(b"PK\x05\x06rest-of-header", "download"), Some(ArchiveFormat::Zip));
    }

    #[test]
    fn detects_sevenzip_by_magic() {
        assert_eq!(
            detect_format(b"7z\xBC\xAF\x27\x1Crest", "download"),
            Some(ArchiveFormat::SevenZip)
        );
    }

    #[test]
    fn detects_rar5_by_magic() {
        assert_eq!(
            detect_format(b"Rar!\x1A\x07\x01\x00rest", "download"),
            Some(ArchiveFormat::Rar)
        );
    }

    #[test]
    fn detects_rar4_by_magic() {
        assert_eq!(detect_format(b"Rar!\x1A\x07\x00rest", "download"), Some(ArchiveFormat::Rar));
    }

    #[test]
    fn falls_back_to_extension_when_magic_is_unrecognized() {
        assert_eq!(detect_format(b"not a real header", "movie.iso"), Some(ArchiveFormat::Iso));
        assert_eq!(detect_format(b"not a real header", "app.apk"), Some(ArchiveFormat::Zip));
        assert_eq!(detect_format(b"not a real header", "archive.7z"), Some(ArchiveFormat::SevenZip));
        assert_eq!(detect_format(b"not a real header", "backup.rar"), Some(ArchiveFormat::Rar));
    }

    #[test]
    fn unrecognized_format_returns_none() {
        assert_eq!(detect_format(b"not a real header", "video.mp4"), None);
        assert_eq!(detect_format(b"", "no-extension"), None);
    }

    #[test]
    fn magic_bytes_win_over_a_misleading_extension() {
        // A mislabeled file with a real zip header should still be treated as zip.
        assert_eq!(detect_format(b"PK\x03\x04rest", "not-actually.mp4"), Some(ArchiveFormat::Zip));
    }
}
