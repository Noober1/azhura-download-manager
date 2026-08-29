// ---------------------------------------------------------------------------
// ZIP listing — thin wrapper over the `zip` crate. `zip::ZipArchive::new`
// reads only the central directory (it seeks from the end of the file to
// find it), and `by_index_raw` skips decompression entirely, so nothing but
// header bytes is ever read through `RangeReader`.
// ---------------------------------------------------------------------------

// Imported by leading `::` throughout this file (rather than a bare `zip::`)
// because this module is itself named `zip` — an unqualified path would be
// ambiguous with the module path resolving to itself.
use ::zip::result::ZipError;
use ::zip::ZipArchive;

use super::range_reader::{is_budget_exceeded, RangeFetcher, RangeReader};
use super::{ArchiveEntry, ArchiveListing, MAX_ENTRIES};

pub(crate) fn list<F: RangeFetcher>(
    reader: RangeReader<F>,
    filename: &str,
    total: u64,
) -> Result<ArchiveListing, String> {
    let mut archive = ZipArchive::new(reader).map_err(|e| match &e {
        ZipError::Io(io_err) if is_budget_exceeded(io_err) => {
            "The archive's central directory is too large to preview.".to_string()
        }
        _ => format!("Not a valid ZIP archive: {e}"),
    })?;

    let count = archive.len();
    let mut entries = Vec::with_capacity(count.min(MAX_ENTRIES));
    let mut truncated = false;

    for i in 0..count {
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let file = match archive.by_index_raw(i) {
            Ok(f) => f,
            Err(ZipError::Io(io_err)) if is_budget_exceeded(&io_err) => {
                // A budget hit partway through the entry list still leaves a
                // useful partial listing — report what was gathered so far.
                truncated = true;
                break;
            }
            Err(e) => return Err(format!("Failed to read an entry in the archive: {e}")),
        };

        let path = file.name().trim_end_matches('/').to_string();
        let modified = file.last_modified().and_then(|dt| {
            format_unix_timestamp_from_parts(dt.year(), dt.month(), dt.day(), dt.hour(), dt.minute())
        });
        entries.push(ArchiveEntry {
            path,
            is_dir: file.is_dir(),
            size: file.size(),
            compressed: Some(file.compressed_size()),
            encrypted: file.encrypted(),
            modified,
        });
    }

    Ok(ArchiveListing {
        format: "zip".to_string(),
        filename: filename.to_string(),
        total,
        entries,
        truncated,
        // ZIP's central directory always stores file names in the clear —
        // only payload bytes can be encrypted (ZipCrypto/AES), never the
        // listing itself.
        encrypted_names: false,
    })
}

/// `zip::DateTime`'s components are already broken out (no epoch math
/// needed, unlike 7z's raw Windows file time) — just format them, treating
/// an implausible/zeroed MS-DOS timestamp as "no timestamp" rather than
/// rendering `0000-00-00`.
fn format_unix_timestamp_from_parts(year: u16, month: u8, day: u8, hour: u8, minute: u8) -> Option<String> {
    if year == 0 || month == 0 || day == 0 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::io::{Cursor, Write};

    use super::super::range_reader::RangeReader;
    use super::*;

    /// A `RangeFetcher` over an in-memory buffer — the same role
    /// `HttpRangeFetcher` plays in production, but with no network.
    struct MemFetcher(Vec<u8>);

    impl RangeFetcher for MemFetcher {
        fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<bytes::Bytes, String> {
            let start = start as usize;
            let end = (end_inclusive as usize + 1).min(self.0.len());
            Ok(bytes::Bytes::copy_from_slice(&self.0[start..end]))
        }
    }

    fn build_test_zip() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut writer = ::zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = ::zip::write::SimpleFileOptions::default()
                .compression_method(::zip::CompressionMethod::Stored);
            writer.start_file("readme.txt", opts).unwrap();
            writer.write_all(b"hello world").unwrap();
            writer.add_directory("docs/", opts).unwrap();
            writer.start_file("docs/notes.txt", opts).unwrap();
            writer.write_all(b"some notes").unwrap();
            writer.finish().unwrap();
        }
        buf
    }

    #[test]
    fn lists_files_and_directories_from_a_real_zip() {
        let data = build_test_zip();
        let len = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), len);

        let listing = list(reader, "test.zip", len).unwrap();

        assert_eq!(listing.format, "zip");
        assert!(!listing.truncated);
        assert!(!listing.encrypted_names);
        let names: Vec<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.contains(&"readme.txt"));
        assert!(names.contains(&"docs"));
        assert!(names.contains(&"docs/notes.txt"));

        let readme = listing.entries.iter().find(|e| e.path == "readme.txt").unwrap();
        assert!(!readme.is_dir);
        assert_eq!(readme.size, 11);

        let docs = listing.entries.iter().find(|e| e.path == "docs").unwrap();
        assert!(docs.is_dir);
    }

    #[test]
    fn a_non_zip_buffer_is_a_clear_error() {
        let data = b"not a zip file at all, just plain bytes".to_vec();
        let len = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), len);
        assert!(list(reader, "fake.zip", len).is_err());
    }

    #[test]
    fn zero_msdos_timestamp_is_not_a_date() {
        assert_eq!(format_unix_timestamp_from_parts(0, 0, 0, 0, 0), None);
    }

    #[test]
    fn a_real_timestamp_formats_as_expected() {
        assert_eq!(
            format_unix_timestamp_from_parts(2024, 3, 7, 9, 5),
            Some("2024-03-07 09:05".to_string())
        );
    }
}
