// ---------------------------------------------------------------------------
// 7z listing — thin wrapper over `sevenz-rust2`. `Archive::read` parses only
// the header block (seeking to the tail to find it, decoding it if it's
// LZMA-compressed) and never touches any file's compressed payload — that
// header decode is exactly why this uses the crate instead of hand-rolling,
// unlike RAR/ISO below.
// ---------------------------------------------------------------------------

use std::time::{SystemTime, UNIX_EPOCH};

use sevenz_rust2::{Archive, Error as SevenZError, Password};

use super::range_reader::{is_budget_exceeded, RangeFetcher, RangeReader};
use super::{format_unix_timestamp, ArchiveEntry, ArchiveListing, MAX_ENTRIES};

pub(crate) fn list<F: RangeFetcher>(
    mut reader: RangeReader<F>,
    filename: &str,
    total: u64,
) -> Result<ArchiveListing, String> {
    let archive = match Archive::read(&mut reader, &Password::empty()) {
        Ok(archive) => archive,
        // The header itself is encrypted (`7z -mhe=on -p...`) — nothing can
        // be listed without the password, but that's a legitimate outcome,
        // not a failure.
        Err(SevenZError::PasswordRequired) => {
            return Ok(ArchiveListing {
                format: "7z".to_string(),
                filename: filename.to_string(),
                total,
                entries: Vec::new(),
                truncated: false,
                encrypted_names: true,
            });
        }
        Err(SevenZError::Io(io_err, _)) if is_budget_exceeded(&io_err) => {
            return Err("The archive's header is too large to preview.".to_string());
        }
        Err(e) => return Err(format!("Not a valid 7z archive: {e}")),
    };

    let truncated = archive.files.len() > MAX_ENTRIES;
    let entries = archive
        .files
        .into_iter()
        .take(MAX_ENTRIES)
        .map(|f| {
            let modified = f.has_last_modified_date.then(|| {
                let when: SystemTime = f.last_modified_date.into();
                let secs = when.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                format_unix_timestamp(secs)
            });
            ArchiveEntry {
                path: f.name.trim_end_matches('/').replace('\\', "/"),
                is_dir: f.is_directory,
                size: f.size,
                compressed: Some(f.compressed_size),
                // Per-entry encryption isn't exposed by this crate's
                // `ArchiveEntry`; whole-archive header encryption (which
                // *is* detectable, above) is the case that actually matters
                // for a listing — content-only encryption doesn't stop us
                // from showing the file list.
                encrypted: false,
                modified,
            }
        })
        .collect();

    Ok(ArchiveListing {
        format: "7z".to_string(),
        filename: filename.to_string(),
        total,
        entries,
        truncated,
        encrypted_names: false,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::io::Cursor;

    use sevenz_rust2::{ArchiveEntry as SevenZEntry, ArchiveWriter};

    use super::super::range_reader::RangeReader;
    use super::*;

    struct MemFetcher(Vec<u8>);

    impl RangeFetcher for MemFetcher {
        fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<bytes::Bytes, String> {
            let start = start as usize;
            let end = (end_inclusive as usize + 1).min(self.0.len());
            Ok(bytes::Bytes::copy_from_slice(&self.0[start..end]))
        }
    }

    fn build_test_7z() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut writer = ArchiveWriter::new(Cursor::new(&mut buf)).unwrap();
            writer
                .push_archive_entry(SevenZEntry::new_file("readme.txt"), Some(&b"hello world"[..]))
                .unwrap();
            writer.finish().unwrap();
        }
        buf
    }

    #[test]
    fn lists_files_from_a_real_7z_archive() {
        let data = build_test_7z();
        let len = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), len);

        let listing = list(reader, "test.7z", len).unwrap();

        assert_eq!(listing.format, "7z");
        assert!(!listing.truncated);
        assert!(!listing.encrypted_names);
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].path, "readme.txt");
        assert_eq!(listing.entries[0].size, 11);
        assert!(!listing.entries[0].is_dir);
    }

    #[test]
    fn a_non_7z_buffer_is_a_clear_error() {
        let data = b"not a 7z file at all, just plain bytes".to_vec();
        let len = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), len);
        assert!(list(reader, "fake.7z", len).is_err());
    }
}
