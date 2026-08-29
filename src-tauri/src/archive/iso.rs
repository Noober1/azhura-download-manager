// ---------------------------------------------------------------------------
// ISO 9660 listing — hand-written walk over the volume descriptor set and
// directory extents (sector 2048 bytes), with optional Joliet name
// resolution. No crate exists for this in the Rust ecosystem that reads
// over an arbitrary `Read + Seek` rather than a local file, so — like
// RAR — this is hand-rolled.
//
// Everything here is metadata: the Primary Volume Descriptor at a fixed
// sector (LBA 16), a possible Supplementary Volume Descriptor announcing
// Joliet a sector or two after it, and directory extents that are just
// flat lists of fixed-ish-size records. One HTTP range request per
// directory visited; file payload sectors are never read.
// ---------------------------------------------------------------------------

use std::collections::VecDeque;
use std::io::{self, Read, Seek, SeekFrom};

use super::range_reader::{is_budget_exceeded, RangeFetcher, RangeReader};
use super::{ArchiveEntry, ArchiveListing, MAX_ENTRIES};

const SECTOR_SIZE: u64 = 2048;
/// The Volume Descriptor Set starts here; real images have 2-4 descriptors
/// before the terminator, so this is a generous safety margin against
/// spinning forever on a corrupt image with no terminator at all.
const MAX_VOLUME_DESCRIPTOR_SECTORS: u32 = 64;
/// Caps how deep the directory tree is walked — a pathologically deep tree
/// (or one crafted to be) stops being expanded past this rather than
/// recursing without bound; already-listed entries stay, `truncated` is set.
const MAX_DEPTH: u32 = 16;

pub(crate) fn list<F: RangeFetcher>(
    mut reader: RangeReader<F>,
    filename: &str,
    total: u64,
) -> Result<ArchiveListing, String> {
    let (root, is_joliet) = find_root_directory(&mut reader)
        .map_err(|e| classify_error(&e, "Failed to read the ISO 9660 volume descriptors"))?;

    let mut entries = Vec::new();
    let mut truncated = false;
    let mut queue = VecDeque::new();
    queue.push_back(DirTask { extent_lba: root.extent_lba, data_length: root.data_length, prefix: String::new(), depth: 0 });

    while let Some(task) = queue.pop_front() {
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let records = match read_directory_entries(&mut reader, task.extent_lba, task.data_length) {
            Ok(records) => records,
            Err(e) if is_budget_exceeded(&e) => {
                truncated = true;
                break;
            }
            Err(e) => return Err(format!("Failed to read a directory in the ISO image: {e}")),
        };

        for record in records {
            let name = decode_name(&record.name_bytes, is_joliet);
            let name = strip_version_suffix(&name, record.is_dir);
            let path = if task.prefix.is_empty() { name } else { format!("{}/{name}", task.prefix) };

            entries.push(ArchiveEntry {
                path: path.clone(),
                is_dir: record.is_dir,
                size: u64::from(record.data_length),
                compressed: None,
                encrypted: false,
                modified: record.modified,
            });
            if entries.len() >= MAX_ENTRIES {
                truncated = true;
                break;
            }
            if record.is_dir {
                if task.depth < MAX_DEPTH {
                    queue.push_back(DirTask {
                        extent_lba: record.extent_lba,
                        data_length: record.data_length,
                        prefix: path,
                        depth: task.depth + 1,
                    });
                } else {
                    truncated = true;
                }
            }
        }
    }

    Ok(ArchiveListing {
        format: "iso".to_string(),
        filename: filename.to_string(),
        total,
        entries,
        truncated,
        encrypted_names: false,
    })
}

fn classify_error(err: &io::Error, context: &str) -> String {
    if is_budget_exceeded(err) {
        "The ISO image's directory structure is too large to preview.".to_string()
    } else {
        format!("{context}: {err}")
    }
}

struct RootDirRef {
    extent_lba: u32,
    data_length: u32,
}

struct DirTask {
    extent_lba: u32,
    data_length: u32,
    prefix: String,
    depth: u32,
}

struct RawDirEntry {
    name_bytes: Vec<u8>,
    is_dir: bool,
    extent_lba: u32,
    data_length: u32,
    modified: Option<String>,
}

/// Scans the Volume Descriptor Set starting at LBA 16 for a Primary Volume
/// Descriptor (required) and a Joliet-flavored Supplementary Volume
/// Descriptor (optional, preferred when present — its names are the real,
/// long, mixed-case, non-ASCII-capable ones; the primary tree only carries
/// the mangled 8.3 versions alongside it).
fn find_root_directory<R: Read + Seek>(reader: &mut R) -> io::Result<(RootDirRef, bool)> {
    let mut primary: Option<RootDirRef> = None;
    let mut joliet: Option<RootDirRef> = None;

    for i in 0..MAX_VOLUME_DESCRIPTOR_SECTORS {
        let lba = 16 + i;
        let sector = read_sector(reader, lba)?;
        if &sector[1..6] != b"CD001" {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not an ISO 9660 image (missing CD001 marker)"));
        }
        match sector[0] {
            1 if primary.is_none() => primary = Some(parse_dir_record_sizes(&sector[156..190])),
            2 if joliet.is_none() && is_joliet_escape(&sector[88..91]) => {
                joliet = Some(parse_dir_record_sizes(&sector[156..190]));
            }
            255 => break, // Volume Descriptor Set Terminator
            _ => {}
        }
    }

    match (joliet, primary) {
        (Some(root), _) => Ok((root, true)),
        (None, Some(root)) => Ok((root, false)),
        (None, None) => {
            Err(io::Error::new(io::ErrorKind::InvalidData, "no Primary Volume Descriptor found"))
        }
    }
}

fn is_joliet_escape(bytes: &[u8]) -> bool {
    matches!(bytes, b"%/@" | b"%/C" | b"%/E")
}

fn read_sector<R: Read + Seek>(reader: &mut R, lba: u32) -> io::Result<[u8; SECTOR_SIZE as usize]> {
    reader.seek(SeekFrom::Start(u64::from(lba) * SECTOR_SIZE))?;
    let mut buf = [0u8; SECTOR_SIZE as usize];
    reader.read_exact(&mut buf)?;
    Ok(buf)
}

/// Extracts `(extent LBA, data length)` from a 34-byte ISO 9660 directory
/// record — both fields are stored "both-endian" (little-endian value
/// immediately followed by the same value big-endian); only the
/// little-endian half is read. Shared by the root-directory record embedded
/// in a volume descriptor and by every record read while walking a
/// directory extent — both are the same on-disk structure.
fn parse_dir_record_sizes(rec: &[u8]) -> RootDirRef {
    RootDirRef {
        extent_lba: u32::from_le_bytes([rec[2], rec[3], rec[4], rec[5]]),
        data_length: u32::from_le_bytes([rec[10], rec[11], rec[12], rec[13]]),
    }
}

fn parse_recording_datetime(b: &[u8]) -> Option<String> {
    if b.len() < 5 {
        return None;
    }
    let year = 1900 + u32::from(b[0]);
    let (month, day, hour, minute) = (b[1], b[2], b[3], b[4]);
    if month == 0 || day == 0 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}"))
}

/// Reads every directory record in one extent (which may span several
/// sectors). Records never cross a sector boundary — when there isn't room
/// left in the current sector for another record, the producer zero-pads
/// the rest of it, signaled by a length byte of 0, and the next record
/// starts at the following sector.
fn read_directory_entries<R: Read + Seek>(
    reader: &mut R,
    extent_lba: u32,
    data_length: u32,
) -> io::Result<Vec<RawDirEntry>> {
    let extent_start = u64::from(extent_lba) * SECTOR_SIZE;
    let total = u64::from(data_length);
    let mut offset: u64 = 0;
    let mut out = Vec::new();

    while offset < total {
        reader.seek(SeekFrom::Start(extent_start + offset))?;
        let mut len_dr = [0u8; 1];
        reader.read_exact(&mut len_dr)?;
        let len_dr = len_dr[0];

        if len_dr == 0 {
            let next_sector = offset / SECTOR_SIZE + 1;
            offset = next_sector * SECTOR_SIZE;
            continue;
        }

        let mut record = vec![0u8; len_dr as usize];
        record[0] = len_dr;
        reader.read_exact(&mut record[1..])?;
        offset += u64::from(len_dr);

        // 33 fixed bytes + at least 1 identifier byte is the minimum any
        // real record has; anything shorter is padding this reader doesn't
        // recognize the shape of, not a file to report.
        if record.len() < 34 {
            continue;
        }

        let sizes = parse_dir_record_sizes(&record);
        let file_flags = record[25];
        let is_dir = file_flags & 0x02 != 0;
        let len_fi = record[32] as usize;
        let name_end = (33 + len_fi).min(record.len());
        let name_bytes = record[33..name_end].to_vec();

        // The "this directory" (0x00) and "parent directory" (0x01)
        // entries are single-byte identifiers present in every directory —
        // skip them rather than surfacing a `.`/`..` row.
        if name_bytes.len() == 1 && (name_bytes[0] == 0 || name_bytes[0] == 1) {
            continue;
        }

        out.push(RawDirEntry {
            name_bytes,
            is_dir,
            extent_lba: sizes.extent_lba,
            data_length: sizes.data_length,
            modified: parse_recording_datetime(&record[18..25]),
        });
    }
    Ok(out)
}

/// Joliet names are UCS-2BE; the primary tree's are effectively ASCII, safe
/// to decode as (lossy) UTF-8.
fn decode_name(bytes: &[u8], is_joliet: bool) -> String {
    if is_joliet {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Strips the `;N` version suffix ISO 9660 appends to every file (not
/// directory) identifier, and the trailing `.` Level 1 leaves on an
/// extension-less file name — both are on-disk artifacts, not part of the
/// name a user would recognize.
fn strip_version_suffix(name: &str, is_dir: bool) -> String {
    if is_dir {
        return name.to_string();
    }
    let stripped = name.split(';').next().unwrap_or(name);
    stripped.strip_suffix('.').unwrap_or(stripped).to_string()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use bytes::Bytes;

    use super::*;

    /// Shared in-memory `RangeFetcher`, the same role `HttpRangeFetcher`
    /// plays in production but with no network.
    ///
    /// As with the RAR fixtures, there's no ISO-authoring tool available in
    /// this environment, so these images are hand-built from this file's
    /// own understanding of ISO 9660 — they verify internal consistency and
    /// guard against regressions rather than independently confirming the
    /// format's own correctness the way the ZIP/7z tests (built from real
    /// writer crates) do.
    struct MemFetcher(Vec<u8>);

    impl RangeFetcher for MemFetcher {
        fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<Bytes, String> {
            let start = start as usize;
            let end = (end_inclusive as usize + 1).min(self.0.len());
            Ok(Bytes::copy_from_slice(&self.0[start..end]))
        }
    }

    struct FixtureFile {
        name: &'static str,
        is_dir: bool,
        content_len: u32,
    }

    /// Lays out a minimal-but-real ISO 9660 image: system area, one PVD,
    /// optionally one Joliet SVD, a terminator, a root directory extent
    /// listing `files` (plus synthetic `.`/`..` records, as a real image
    /// always has), and — for any directory among `files` — an empty
    /// directory extent of its own (with `.`/`..` only) so a recursive walk
    /// has something valid to read.
    fn build_iso(files: &[FixtureFile], with_joliet: bool) -> Vec<u8> {
        let mut sectors: Vec<[u8; SECTOR_SIZE as usize]> = vec![[0u8; SECTOR_SIZE as usize]; 16]; // system area, LBA 0-15

        let root_lba = 20u32; // placeholder root extent LBA, sectors pushed below in order
        let mut next_lba = root_lba;
        let root_extent_lba = next_lba;
        next_lba += 1;

        let mut child_dir_lbas = Vec::new();
        for f in files {
            if f.is_dir {
                child_dir_lbas.push((f.name, next_lba));
                next_lba += 1;
            }
        }

        let root_extent = build_directory_extent(root_extent_lba, root_extent_lba, files, &child_dir_lbas, with_joliet);
        let root_data_len = root_extent.len() as u32;

        let pvd = build_volume_descriptor(1, None, root_extent_lba, root_data_len);
        sectors.push(pvd);
        let svd_lba_offset = if with_joliet {
            let svd = build_volume_descriptor(2, Some(b"%/E"), root_extent_lba, root_data_len);
            sectors.push(svd);
            1
        } else {
            0
        };
        let _ = svd_lba_offset;

        let mut terminator = [0u8; SECTOR_SIZE as usize];
        terminator[0] = 255;
        terminator[1..6].copy_from_slice(b"CD001");
        sectors.push(terminator);

        // Pad system area + volume descriptors out to where `root_extent_lba` says the root starts.
        while sectors.len() < root_extent_lba as usize {
            sectors.push([0u8; SECTOR_SIZE as usize]);
        }

        let mut out = Vec::new();
        for s in &sectors {
            out.extend_from_slice(s);
        }
        out.extend_from_slice(&pad_to_sectors(&root_extent));

        for (name, lba) in &child_dir_lbas {
            while (out.len() as u64) < u64::from(*lba) * SECTOR_SIZE {
                out.extend_from_slice(&[0u8; SECTOR_SIZE as usize]);
            }
            let child_extent = build_directory_extent(*lba, root_extent_lba, &[], &[], with_joliet);
            let _ = name;
            out.extend_from_slice(&pad_to_sectors(&child_extent));
        }

        out
    }

    fn pad_to_sectors(data: &[u8]) -> Vec<u8> {
        let mut out = data.to_vec();
        let rem = out.len() % SECTOR_SIZE as usize;
        if rem != 0 {
            out.extend(std::iter::repeat(0u8).take(SECTOR_SIZE as usize - rem));
        }
        out
    }

    fn build_directory_extent(
        _self_lba: u32,
        parent_lba: u32,
        files: &[FixtureFile],
        child_dir_lbas: &[(&'static str, u32)],
        with_joliet: bool,
    ) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(build_dir_record(&[0u8], true, parent_lba, 2048, with_joliet)); // "."
        out.extend(build_dir_record(&[1u8], true, parent_lba, 2048, with_joliet)); // ".."
        for f in files {
            let lba = if f.is_dir {
                child_dir_lbas.iter().find(|(n, _)| *n == f.name).map(|(_, l)| *l).unwrap_or(0)
            } else {
                0
            };
            let name_bytes = encode_name(f.name, f.is_dir, with_joliet);
            out.extend(build_dir_record(&name_bytes, f.is_dir, lba, f.content_len, with_joliet));
        }
        out
    }

    fn encode_name(name: &str, is_dir: bool, joliet: bool) -> Vec<u8> {
        let full = if is_dir { name.to_string() } else { format!("{name};1") };
        if joliet {
            full.encode_utf16().flat_map(|u| u.to_be_bytes()).collect()
        } else {
            full.as_bytes().to_vec()
        }
    }

    fn build_dir_record(name_bytes: &[u8], is_dir: bool, extent_lba: u32, data_length: u32, _joliet: bool) -> Vec<u8> {
        let len_fi = name_bytes.len();
        let mut len_dr = 33 + len_fi;
        if len_fi % 2 == 0 {
            len_dr += 1; // padding byte to keep the record even-length
        }
        let mut rec = vec![0u8; len_dr];
        rec[0] = len_dr as u8;
        rec[1] = 0; // extended attribute record length
        rec[2..6].copy_from_slice(&extent_lba.to_le_bytes());
        rec[6..10].copy_from_slice(&extent_lba.to_be_bytes());
        rec[10..14].copy_from_slice(&data_length.to_le_bytes());
        rec[14..18].copy_from_slice(&data_length.to_be_bytes());
        rec[18] = 124; // year (2024 - 1900)
        rec[19] = 3; // month
        rec[20] = 7; // day
        rec[21] = 9; // hour
        rec[22] = 5; // minute
        rec[23] = 0; // second
        rec[24] = 0; // GMT offset
        rec[25] = if is_dir { 0x02 } else { 0x00 };
        rec[26] = 0; // file unit size
        rec[27] = 0; // interleave gap
        rec[28..30].copy_from_slice(&1u16.to_le_bytes());
        rec[30..32].copy_from_slice(&1u16.to_be_bytes());
        rec[32] = len_fi as u8;
        rec[33..33 + len_fi].copy_from_slice(name_bytes);
        rec
    }

    fn build_volume_descriptor(vd_type: u8, joliet_escape: Option<&[u8; 3]>, root_lba: u32, root_len: u32) -> [u8; SECTOR_SIZE as usize] {
        let mut sector = [0u8; SECTOR_SIZE as usize];
        sector[0] = vd_type;
        sector[1..6].copy_from_slice(b"CD001");
        sector[6] = 1;
        if let Some(esc) = joliet_escape {
            sector[88..91].copy_from_slice(esc);
        }
        let root_record = build_dir_record(&[0u8], true, root_lba, root_len, false);
        sector[156..156 + root_record.len()].copy_from_slice(&root_record);
        sector
    }

    #[test]
    fn lists_files_and_a_directory_from_the_primary_tree() {
        let files = [
            FixtureFile { name: "README.TXT", is_dir: false, content_len: 11 },
            FixtureFile { name: "DOCS", is_dir: true, content_len: 0 },
        ];
        let data = build_iso(&files, false);
        let total = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), total);

        let listing = list(reader, "test.iso", total).unwrap();

        assert_eq!(listing.format, "iso");
        assert!(!listing.truncated);
        let names: Vec<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.contains(&"README.TXT"), "names: {names:?}");
        assert!(names.contains(&"DOCS"), "names: {names:?}");

        let readme = listing.entries.iter().find(|e| e.path == "README.TXT").unwrap();
        assert!(!readme.is_dir);
        assert_eq!(readme.size, 11);
        assert_eq!(readme.modified.as_deref(), Some("2024-03-07 09:05"));

        let docs = listing.entries.iter().find(|e| e.path == "DOCS").unwrap();
        assert!(docs.is_dir);
    }

    #[test]
    fn joliet_names_are_preferred_over_the_mangled_primary_names() {
        let files = [FixtureFile { name: "a long mixed Case name.txt", is_dir: false, content_len: 3 }];
        let data = build_iso(&files, true);
        let total = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), total);

        let listing = list(reader, "test.iso", total).unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.contains(&"a long mixed Case name.txt"), "names: {names:?}");
    }

    #[test]
    fn version_suffix_and_trailing_dot_are_stripped() {
        assert_eq!(strip_version_suffix("README.TXT;1", false), "README.TXT");
        assert_eq!(strip_version_suffix("NOEXT.;1", false), "NOEXT");
        assert_eq!(strip_version_suffix("SUBDIR", true), "SUBDIR");
    }

    #[test]
    fn joliet_escape_sequences_are_recognized() {
        assert!(is_joliet_escape(b"%/@"));
        assert!(is_joliet_escape(b"%/C"));
        assert!(is_joliet_escape(b"%/E"));
        assert!(!is_joliet_escape(b"xyz"));
    }

    #[test]
    fn a_buffer_with_no_iso_signature_is_a_clear_error() {
        let data = vec![0u8; 40_000];
        let total = data.len() as u64;
        let reader = RangeReader::new(MemFetcher(data), total);
        assert!(list(reader, "fake.iso", total).is_err());
    }

    #[test]
    fn recording_datetime_rejects_a_zeroed_field() {
        assert_eq!(parse_recording_datetime(&[0, 0, 0, 0, 0, 0, 0]), None);
    }
}
