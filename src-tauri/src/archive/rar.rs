// ---------------------------------------------------------------------------
// RAR listing — hand-written header walk (RAR4 and RAR5), headers only, no
// unpacking. `unrar` (the only Rust binding for the real RAR code) is FFI
// over the C library and only accepts a file path, so it can't run against
// an HTTP range reader — hence the hand-roll here, unlike ZIP/7z which reuse
// existing crates.
//
// Both formats keep a chain of block headers, each one self-describing its
// own length and (for a file entry) the length of the packed data that
// trails it, so the walk is: read one block header, extract what we need if
// it's a file, then jump straight to wherever the *next* header must start —
// never touching the packed payload in between.
// ---------------------------------------------------------------------------

use std::io::{self, Read, Seek, SeekFrom};

use super::range_reader::{is_budget_exceeded, RangeFetcher, RangeReader};
use super::{format_unix_timestamp, ArchiveEntry, ArchiveListing};

const RAR5_SIGNATURE: [u8; 8] = *b"Rar!\x1A\x07\x01\x00";
const RAR4_SIGNATURE: [u8; 7] = *b"Rar!\x1A\x07\x00";

pub(crate) fn list<F: RangeFetcher>(
    mut reader: RangeReader<F>,
    filename: &str,
    total: u64,
) -> Result<ArchiveListing, String> {
    let mut sig = [0u8; 8];
    reader
        .seek(SeekFrom::Start(0))
        .and_then(|_| reader.read_exact(&mut sig))
        .map_err(|e| format!("Failed to read the archive signature: {e}"))?;

    if sig == RAR5_SIGNATURE {
        rar5::list(reader, filename, total)
    } else if sig[..7] == RAR4_SIGNATURE {
        rar4::list(reader, filename, total)
    } else {
        Err("Not a valid RAR archive.".to_string())
    }
}

/// What one parsed block tells the walk to do next. Every variant carries
/// enough information to keep navigating without needing to re-read
/// anything — `Entry`/`Skip` carry the *absolute* offset of the next block,
/// computed from the current block's own declared size, not from how many
/// bytes this code happened to consume parsing it.
enum BlockOutcome {
    Entry(ArchiveEntry, u64),
    Skip(u64),
    EncryptedHeaders,
    EndOfArchive { volume_continues: bool },
}

fn is_eof(err: &io::Error) -> bool {
    err.kind() == io::ErrorKind::UnexpectedEof
}

fn read_u8<R: Read>(r: &mut R) -> io::Result<u8> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_u16_le<R: Read>(r: &mut R) -> io::Result<u16> {
    let mut buf = [0u8; 2];
    r.read_exact(&mut buf)?;
    Ok(u16::from_le_bytes(buf))
}

fn read_u32_le<R: Read>(r: &mut R) -> io::Result<u32> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

/// Decodes RAR5's variable-length integer: little-endian base-128, each
/// byte's high bit marking "more bytes follow". Returns the value alongside
/// how many bytes it occupied, since callers need that to find where the
/// following field starts. Rejects anything longer than 10 bytes (more than
/// enough for a full `u64`) rather than looping forever on a corrupt stream.
fn read_vint<R: Read>(r: &mut R) -> io::Result<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift: u32 = 0;
    for n in 1..=10 {
        let byte = read_u8(r)?;
        value |= u64::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Ok((value, n));
        }
        shift += 7;
    }
    Err(io::Error::new(io::ErrorKind::InvalidData, "RAR5 vint longer than 10 bytes"))
}

/// Decodes a classic MS-DOS packed date/time — the same convention ZIP's
/// legacy timestamp uses: the low 16 bits are the time (seconds/2, minutes,
/// hours) and the high 16 bits are the date (day, month, year-1980).
/// Returns `None` for an all-zero/implausible value rather than rendering a
/// nonsense date.
fn format_dos_timestamp(dos: u32) -> Option<String> {
    let minute = (dos >> 5) & 0x3F;
    let hour = (dos >> 11) & 0x1F;
    let day = (dos >> 16) & 0x1F;
    let month = (dos >> 21) & 0x0F;
    let year = 1980 + ((dos >> 25) & 0x7F);
    if day == 0 || month == 0 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}"))
}

mod rar5 {
    use super::{
        format_unix_timestamp, is_eof, read_u32_le, read_vint, ArchiveEntry, ArchiveListing,
        BlockOutcome,
    };
    use super::{is_budget_exceeded, RangeFetcher, RangeReader};
    use std::io::{self, Read, Seek, SeekFrom};

    const HEADER_FILE: u64 = 2;
    const HEADER_ENCRYPTION: u64 = 4;
    const HEADER_ENDARC: u64 = 5;

    const FLAG_DIRECTORY: u64 = 0x0001;
    const FLAG_UNIX_TIME: u64 = 0x0002;
    const FLAG_HAS_CRC: u64 = 0x0004;

    const EXTRA_RECORD_ENCRYPTION: u64 = 0x01;
    /// Refuses to buffer an implausibly large extra area just to check for
    /// an encryption record — a real one is a handful of bytes. Past this,
    /// the entry is reported as not (individually) encrypted rather than
    /// risking an unbounded allocation off a corrupt or adversarial length.
    const MAX_EXTRA_AREA_SCAN: u64 = 64 * 1024;
    const ENDARC_FLAG_NEXT_VOLUME: u64 = 0x0001;

    pub(super) fn list<F: RangeFetcher>(
        mut reader: RangeReader<F>,
        filename: &str,
        total: u64,
    ) -> Result<ArchiveListing, String> {
        let mut pos: u64 = 8; // past the 8-byte signature
        let mut entries = Vec::new();
        let mut truncated = false;

        loop {
            if pos >= total {
                break;
            }
            if entries.len() >= super::super::MAX_ENTRIES {
                truncated = true;
                break;
            }
            match read_one_block(&mut reader, pos) {
                Ok(BlockOutcome::EncryptedHeaders) => {
                    return Ok(encrypted_listing(filename, total));
                }
                Ok(BlockOutcome::Entry(entry, next_pos)) => {
                    entries.push(entry);
                    pos = next_pos;
                }
                Ok(BlockOutcome::Skip(next_pos)) => pos = next_pos,
                Ok(BlockOutcome::EndOfArchive { volume_continues }) => {
                    if volume_continues {
                        truncated = true;
                    }
                    break;
                }
                Err(e) if is_eof(&e) => break,
                Err(e) if is_budget_exceeded(&e) => {
                    truncated = true;
                    break;
                }
                Err(e) => return Err(format!("Failed to parse RAR5 archive: {e}")),
            }
        }

        Ok(ArchiveListing {
            format: "rar".to_string(),
            filename: filename.to_string(),
            total,
            entries,
            truncated,
            encrypted_names: false,
        })
    }

    fn encrypted_listing(filename: &str, total: u64) -> ArchiveListing {
        ArchiveListing {
            format: "rar".to_string(),
            filename: filename.to_string(),
            total,
            entries: Vec::new(),
            truncated: false,
            encrypted_names: true,
        }
    }

    fn read_one_block<R: Read + Seek>(reader: &mut R, pos: u64) -> io::Result<BlockOutcome> {
        reader.seek(SeekFrom::Start(pos))?;
        read_u32_le(reader)?; // header CRC32 — this is a preview, not an integrity check
        let (header_size, _) = read_vint(reader)?;
        // The vint we just read might have taken anywhere from 1 to 10
        // bytes — reading the actual stream position rather than tracking
        // vint lengths by hand is what makes this safe to get right.
        let header_data_start = reader.stream_position()?;

        let (header_type, _) = read_vint(reader)?;
        let (header_flags, _) = read_vint(reader)?;
        let extra_area_size = if header_flags & 0x0001 != 0 { read_vint(reader)?.0 } else { 0 };
        let data_size = if header_flags & 0x0002 != 0 { read_vint(reader)?.0 } else { 0 };

        let next_pos = header_data_start
            .checked_add(header_size)
            .and_then(|p| p.checked_add(data_size))
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "RAR5 header size overflow"))?;

        if header_type == HEADER_ENCRYPTION {
            return Ok(BlockOutcome::EncryptedHeaders);
        }
        if header_type == HEADER_FILE {
            let entry = parse_file_entry(reader, extra_area_size, data_size)?;
            return Ok(BlockOutcome::Entry(entry, next_pos));
        }
        if header_type == HEADER_ENDARC {
            let volume_continues =
                read_vint(reader).map(|(flags, _)| flags & ENDARC_FLAG_NEXT_VOLUME != 0).unwrap_or(false);
            return Ok(BlockOutcome::EndOfArchive { volume_continues });
        }
        Ok(BlockOutcome::Skip(next_pos))
    }

    fn parse_file_entry<R: Read>(
        reader: &mut R,
        extra_area_size: u64,
        data_size: u64,
    ) -> io::Result<ArchiveEntry> {
        let (file_flags, _) = read_vint(reader)?;
        let (unpacked_size, _) = read_vint(reader)?;
        let (_attributes, _) = read_vint(reader)?;
        let mtime = if file_flags & FLAG_UNIX_TIME != 0 { Some(read_u32_le(reader)?) } else { None };
        if file_flags & FLAG_HAS_CRC != 0 {
            read_u32_le(reader)?; // DataCRC32 — unused for a listing
        }
        let (_compression_info, _) = read_vint(reader)?;
        let (_host_os, _) = read_vint(reader)?;
        let (name_length, _) = read_vint(reader)?;
        let mut name_buf = vec![0u8; name_length as usize];
        reader.read_exact(&mut name_buf)?;
        // RAR5 names are always UTF-8 (unlike RAR4's ANSI/OEM names below).
        let name = String::from_utf8_lossy(&name_buf).into_owned();

        let encrypted = if extra_area_size > 0 && extra_area_size <= MAX_EXTRA_AREA_SCAN {
            let mut extra_buf = vec![0u8; extra_area_size as usize];
            reader.read_exact(&mut extra_buf)?;
            extra_area_has_encryption_record(&extra_buf)
        } else {
            false
        };

        Ok(ArchiveEntry {
            path: name.trim_end_matches('/').replace('\\', "/"),
            is_dir: file_flags & FLAG_DIRECTORY != 0,
            size: unpacked_size,
            compressed: Some(data_size),
            encrypted,
            modified: mtime.and_then(|t| Some(format_unix_timestamp(i64::from(t)))),
        })
    }

    /// Scans a RAR5 extra area (already read fully into memory, so a
    /// malformed record length can only end the scan early — never read
    /// past the buffer or loop forever) for an Encryption record (type 1).
    fn extra_area_has_encryption_record(buf: &[u8]) -> bool {
        let mut cursor = io::Cursor::new(buf);
        let len = buf.len() as u64;
        loop {
            if cursor.position() >= len {
                return false;
            }
            let Ok((record_size, _)) = read_vint(&mut cursor) else { return false };
            let Ok((record_type, record_type_len)) = read_vint(&mut cursor) else { return false };
            if record_type == EXTRA_RECORD_ENCRYPTION {
                return true;
            }
            let body_len = record_size.saturating_sub(record_type_len as u64);
            if body_len == 0 {
                return false; // nothing left that would advance the scan
            }
            let Some(new_pos) = cursor.position().checked_add(body_len) else { return false };
            if new_pos > len {
                return false;
            }
            cursor.set_position(new_pos);
        }
    }

    #[cfg(test)]
    #[allow(clippy::unwrap_used)]
    mod tests {
        use std::io::Cursor;

        use super::*;

        fn encode_vint(mut value: u64) -> Vec<u8> {
            let mut out = Vec::new();
            loop {
                let mut byte = (value & 0x7F) as u8;
                value >>= 7;
                if value != 0 {
                    byte |= 0x80;
                }
                out.push(byte);
                if value == 0 {
                    break;
                }
            }
            out
        }

        /// Builds one RAR5 block: CRC32(4, unused) + HeaderSize(vint) +
        /// [HeaderType, HeaderFlags, ...type-specific fields] where
        /// `header_data` is everything after HeaderSize.
        fn build_block(header_data: &[u8]) -> Vec<u8> {
            let mut out = vec![0u8; 4]; // fake CRC32, never checked
            out.extend(encode_vint(header_data.len() as u64));
            out.extend_from_slice(header_data);
            out
        }

        fn build_file_header(name: &str, size: u64, is_dir: bool, packed_data_len: u64) -> Vec<u8> {
            let mut header_data = Vec::new();
            header_data.extend(encode_vint(2)); // HeaderType = File
            let flags: u64 = 0x0002; // DataSize present
            header_data.extend(encode_vint(flags));
            header_data.extend(encode_vint(packed_data_len)); // DataSize

            // Type-specific fields:
            let file_flags: u64 = if is_dir { 0x0001 } else { 0 };
            header_data.extend(encode_vint(file_flags));
            header_data.extend(encode_vint(size)); // UnpackedSize
            header_data.extend(encode_vint(0)); // Attributes
            header_data.extend(encode_vint(0)); // CompressionInfo
            header_data.extend(encode_vint(0)); // HostOS
            header_data.extend(encode_vint(name.len() as u64)); // NameLength
            header_data.extend_from_slice(name.as_bytes());

            let mut block = build_block(&header_data);
            block.extend(std::iter::repeat(0xAA).take(packed_data_len as usize));
            block
        }

        fn build_end_of_archive() -> Vec<u8> {
            let mut header_data = Vec::new();
            header_data.extend(encode_vint(5)); // HeaderType = EndArc
            header_data.extend(encode_vint(0)); // HeaderFlags = none
            header_data.extend(encode_vint(0)); // EndArcFlags = 0 (no next volume)
            build_block(&header_data)
        }

        fn build_encryption_header() -> Vec<u8> {
            let mut header_data = Vec::new();
            header_data.extend(encode_vint(4)); // HeaderType = Encryption
            header_data.extend(encode_vint(0)); // HeaderFlags
            header_data.extend(encode_vint(0)); // KDF algorithm (unused by us)
            build_block(&header_data)
        }

        #[test]
        fn vint_round_trips_small_and_multi_byte_values() {
            for value in [0u64, 1, 127, 128, 300, 16384, u64::from(u32::MAX)] {
                let encoded = encode_vint(value);
                let (decoded, len) = read_vint(&mut Cursor::new(&encoded)).unwrap();
                assert_eq!(decoded, value);
                assert_eq!(len, encoded.len());
            }
        }

        #[test]
        fn vint_longer_than_ten_bytes_is_rejected() {
            let bytes = vec![0x80u8; 11];
            assert!(read_vint(&mut Cursor::new(&bytes)).is_err());
        }

        #[test]
        fn lists_a_file_and_stops_at_end_of_archive() {
            let mut data = super::super::RAR5_SIGNATURE.to_vec();
            data.extend(build_file_header("readme.txt", 11, false, 5));
            data.extend(build_end_of_archive());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert_eq!(listing.format, "rar");
            assert!(!listing.truncated);
            assert!(!listing.encrypted_names);
            assert_eq!(listing.entries.len(), 1);
            assert_eq!(listing.entries[0].path, "readme.txt");
            assert_eq!(listing.entries[0].size, 11);
            assert!(!listing.entries[0].is_dir);
        }

        #[test]
        fn a_directory_entry_is_flagged_as_a_directory() {
            let mut data = super::super::RAR5_SIGNATURE.to_vec();
            data.extend(build_file_header("docs", 0, true, 0));
            data.extend(build_end_of_archive());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert_eq!(listing.entries.len(), 1);
            assert!(listing.entries[0].is_dir);
        }

        #[test]
        fn multiple_files_are_all_listed_in_order() {
            let mut data = super::super::RAR5_SIGNATURE.to_vec();
            data.extend(build_file_header("a.txt", 1, false, 1));
            data.extend(build_file_header("b.txt", 2, false, 2));
            data.extend(build_end_of_archive());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            let names: Vec<&str> = listing.entries.iter().map(|e| e.path.as_str()).collect();
            assert_eq!(names, vec!["a.txt", "b.txt"]);
        }

        #[test]
        fn an_encryption_header_as_the_first_block_reports_encrypted_names() {
            let mut data = super::super::RAR5_SIGNATURE.to_vec();
            data.extend(build_encryption_header());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert!(listing.encrypted_names);
            assert!(listing.entries.is_empty());
        }
    }
}

mod rar4 {
    use super::{format_dos_timestamp, is_eof, read_u16_le, read_u32_le, read_u8, ArchiveEntry, ArchiveListing, BlockOutcome};
    use super::{is_budget_exceeded, RangeFetcher, RangeReader};
    use std::io::{self, Read, Seek, SeekFrom};

    const MAIN_HEAD: u8 = 0x73;
    const FILE_HEAD: u8 = 0x74;
    const ENDARC_HEAD: u8 = 0x7B;

    /// "Block headers are encrypted" — set on the main archive header when
    /// the archive was created with `-hp` (encrypt headers, not just data).
    const MHD_PASSWORD: u16 = 0x0080;
    /// Old-format RAR steals an otherwise-impossible dictionary-size value
    /// (all three window-size bits set) to flag "this is a directory entry"
    /// instead, rather than using a dedicated bit.
    const LHD_DIRECTORY_MASK: u16 = 0x00E0;
    const LHD_PASSWORD: u16 = 0x0004;
    const LHD_LARGE: u16 = 0x0100;
    const LHD_UNICODE: u16 = 0x0200;
    /// Generic "this header has a trailing 4-byte size field" flag, shared
    /// by every old-format block type — for `FILE_HEAD` that field is
    /// `PackSize` itself (read explicitly below); for anything else it's
    /// the size of data to skip over to reach the next header.
    const LONG_BLOCK: u16 = 0x8000;

    pub(super) fn list<F: RangeFetcher>(
        mut reader: RangeReader<F>,
        filename: &str,
        total: u64,
    ) -> Result<ArchiveListing, String> {
        let mut pos: u64 = 7; // past the 7-byte signature
        let mut entries = Vec::new();
        let mut truncated = false;

        loop {
            if pos >= total {
                break;
            }
            if entries.len() >= super::super::MAX_ENTRIES {
                truncated = true;
                break;
            }
            match read_one_block(&mut reader, pos) {
                Ok(BlockOutcome::EncryptedHeaders) => {
                    return Ok(ArchiveListing {
                        format: "rar".to_string(),
                        filename: filename.to_string(),
                        total,
                        entries: Vec::new(),
                        truncated: false,
                        encrypted_names: true,
                    });
                }
                Ok(BlockOutcome::Entry(entry, next_pos)) => {
                    entries.push(entry);
                    pos = next_pos;
                }
                Ok(BlockOutcome::Skip(next_pos)) => pos = next_pos,
                Ok(BlockOutcome::EndOfArchive { .. }) => break,
                Err(e) if is_eof(&e) => break,
                Err(e) if is_budget_exceeded(&e) => {
                    truncated = true;
                    break;
                }
                Err(e) => return Err(format!("Failed to parse RAR archive: {e}")),
            }
        }

        Ok(ArchiveListing {
            format: "rar".to_string(),
            filename: filename.to_string(),
            total,
            entries,
            truncated,
            encrypted_names: false,
        })
    }

    fn read_one_block<R: Read + Seek>(reader: &mut R, pos: u64) -> io::Result<BlockOutcome> {
        reader.seek(SeekFrom::Start(pos))?;
        read_u16_le(reader)?; // HeadCRC — unverified, this is a preview not an integrity check
        let head_type = read_u8(reader)?;
        let head_flags = read_u16_le(reader)?;
        let head_size = u64::from(read_u16_le(reader)?);

        if head_type == MAIN_HEAD && head_flags & MHD_PASSWORD != 0 {
            return Ok(BlockOutcome::EncryptedHeaders);
        }

        if head_type == FILE_HEAD {
            return parse_file_header(reader, pos, head_flags, head_size);
        }
        if head_type == ENDARC_HEAD {
            return Ok(BlockOutcome::EndOfArchive { volume_continues: head_flags & 0x0001 != 0 });
        }

        let add_size = if head_flags & LONG_BLOCK != 0 { u64::from(read_u32_le(reader)?) } else { 0 };
        Ok(BlockOutcome::Skip(pos + head_size + add_size))
    }

    fn parse_file_header<R: Read>(
        reader: &mut R,
        block_start: u64,
        head_flags: u16,
        head_size: u64,
    ) -> io::Result<BlockOutcome> {
        let pack_size_lo = u64::from(read_u32_le(reader)?);
        let unp_size_lo = u64::from(read_u32_le(reader)?);
        read_u8(reader)?; // HostOS — not needed for a listing
        read_u32_le(reader)?; // FileCRC
        let ftime = read_u32_le(reader)?;
        read_u8(reader)?; // UnpVer
        read_u8(reader)?; // Method
        let name_size = read_u16_le(reader)? as usize;
        read_u32_le(reader)?; // FileAttr

        let (high_pack, high_unp) = if head_flags & LHD_LARGE != 0 {
            (u64::from(read_u32_le(reader)?), u64::from(read_u32_le(reader)?))
        } else {
            (0, 0)
        };
        let pack_size = pack_size_lo | (high_pack << 32);
        let unpacked_size = unp_size_lo | (high_unp << 32);

        let mut name_buf = vec![0u8; name_size];
        reader.read_exact(&mut name_buf)?;
        let ansi_end = name_buf.iter().position(|&b| b == 0).unwrap_or(name_buf.len());
        // Old-format RAR's "Unicode name" extension packs a delta-encoded
        // UTF-16 name after the NUL byte, using a scheme intricate enough
        // that guessing it from memory risks silently mangling names rather
        // than failing loudly — RAR5 (fully supported above) is UTF-8
        // natively and is what current archives actually use, so this just
        // falls back to the embedded ANSI name for the legacy case.
        let _ = head_flags & LHD_UNICODE;
        let name = String::from_utf8_lossy(&name_buf[..ansi_end]).into_owned();

        let next_pos = block_start + head_size + pack_size;
        let entry = ArchiveEntry {
            path: name.trim_end_matches('/').replace('\\', "/"),
            is_dir: head_flags & LHD_DIRECTORY_MASK == LHD_DIRECTORY_MASK,
            size: unpacked_size,
            compressed: Some(pack_size),
            encrypted: head_flags & LHD_PASSWORD != 0,
            modified: format_dos_timestamp(ftime),
        };
        Ok(BlockOutcome::Entry(entry, next_pos))
    }

    #[cfg(test)]
    #[allow(clippy::unwrap_used)]
    mod tests {
        use super::*;

        fn build_file_header(name: &str, size: u32, is_dir: bool, packed_data: &[u8]) -> Vec<u8> {
            let flags: u16 = if is_dir { LHD_DIRECTORY_MASK } else { 0 };
            let mut fields = Vec::new();
            fields.extend((packed_data.len() as u32).to_le_bytes()); // PackSize
            fields.extend(size.to_le_bytes()); // UnpSize
            fields.push(0); // HostOS
            fields.extend(0u32.to_le_bytes()); // FileCRC
            fields.extend(0u32.to_le_bytes()); // FTime (no timestamp)
            fields.push(0); // UnpVer
            fields.push(0); // Method
            fields.extend((name.len() as u16).to_le_bytes()); // NameSize
            fields.extend(0u32.to_le_bytes()); // FileAttr
            fields.extend_from_slice(name.as_bytes());

            let head_size = (7 + fields.len()) as u16;
            let mut block = Vec::new();
            block.extend(0u16.to_le_bytes()); // HeadCRC (unchecked)
            block.push(FILE_HEAD);
            block.extend(flags.to_le_bytes());
            block.extend(head_size.to_le_bytes());
            block.extend(fields);
            block.extend_from_slice(packed_data);
            block
        }

        fn build_end_of_archive() -> Vec<u8> {
            let mut block = Vec::new();
            block.extend(0u16.to_le_bytes());
            block.push(ENDARC_HEAD);
            block.extend(0u16.to_le_bytes()); // flags
            block.extend(7u16.to_le_bytes()); // head_size == just the common header
            block
        }

        fn build_main_header(flags: u16) -> Vec<u8> {
            let mut block = Vec::new();
            block.extend(0u16.to_le_bytes());
            block.push(MAIN_HEAD);
            block.extend(flags.to_le_bytes());
            block.extend(13u16.to_le_bytes()); // HeadSize: 7 common + 2 HighPosAV + 4 PosAV (unused)
            block.extend(0u16.to_le_bytes());
            block.extend(0u32.to_le_bytes());
            block
        }

        #[test]
        fn lists_a_file_and_stops_at_end_of_archive() {
            let mut data = super::super::RAR4_SIGNATURE.to_vec();
            data.extend(build_file_header("readme.txt", 11, false, &[0xAA; 5]));
            data.extend(build_end_of_archive());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert_eq!(listing.format, "rar");
            assert!(!listing.encrypted_names);
            assert_eq!(listing.entries.len(), 1);
            assert_eq!(listing.entries[0].path, "readme.txt");
            assert_eq!(listing.entries[0].size, 11);
            assert!(!listing.entries[0].is_dir);
        }

        #[test]
        fn a_directory_entry_is_flagged_as_a_directory() {
            let mut data = super::super::RAR4_SIGNATURE.to_vec();
            data.extend(build_file_header("docs", 0, true, &[]));
            data.extend(build_end_of_archive());
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert_eq!(listing.entries.len(), 1);
            assert!(listing.entries[0].is_dir);
        }

        #[test]
        fn an_encrypted_main_header_reports_encrypted_names() {
            let mut data = super::super::RAR4_SIGNATURE.to_vec();
            data.extend(build_main_header(MHD_PASSWORD));
            let total = data.len() as u64;

            let reader = RangeReader::new(super::super::tests::MemFetcher(data), total);
            let listing = list(reader, "test.rar", total).unwrap();

            assert!(listing.encrypted_names);
            assert!(listing.entries.is_empty());
        }

        #[test]
        fn dos_timestamp_decodes_known_value() {
            // 2024-03-07, 09:05:00 packed as MS-DOS date/time.
            let year_bits = (2024 - 1980) << 9;
            let month_bits = 3 << 5;
            let day_bits = 7;
            let hour_bits = 9 << 11;
            let minute_bits = 5 << 5;
            let dos = ((year_bits | month_bits | day_bits) << 16) | hour_bits | minute_bits;
            assert_eq!(format_dos_timestamp(dos as u32), Some("2024-03-07 09:05".to_string()));
        }

        #[test]
        fn zero_dos_timestamp_is_not_a_date() {
            assert_eq!(format_dos_timestamp(0), None);
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use bytes::Bytes;

    use super::RangeFetcher;

    /// Shared in-memory `RangeFetcher` for both the RAR4 and RAR5 test
    /// modules above — the same role `HttpRangeFetcher` plays in
    /// production, but with no network.
    ///
    /// These fixtures are hand-built from this file's own understanding of
    /// the RAR4/RAR5 header formats (there's no RAR-writing crate or CLI
    /// available in this environment to generate ground-truth archives the
    /// way the ZIP/7z tests do), so they verify internal consistency and
    /// guard against regressions rather than independently confirming the
    /// format's own correctness.
    pub(super) struct MemFetcher(pub(super) Vec<u8>);

    impl RangeFetcher for MemFetcher {
        fn fetch(&mut self, start: u64, end_inclusive: u64) -> Result<Bytes, String> {
            let start = start as usize;
            let end = (end_inclusive as usize + 1).min(self.0.len());
            Ok(Bytes::copy_from_slice(&self.0[start..end]))
        }
    }

    #[test]
    fn an_unrecognized_signature_is_a_clear_error() {
        let data = b"not a rar file at all, just plain bytes".to_vec();
        let total = data.len() as u64;
        let reader = super::RangeReader::new(MemFetcher(data), total);
        assert!(super::list(reader, "fake.rar", total).is_err());
    }
}
