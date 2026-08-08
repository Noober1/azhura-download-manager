use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::categories::category_dir;
use crate::config::prefs::Prefs;

pub(crate) fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "download.bin".to_string()
    } else {
        cleaned
    }
}

/// Pull a sanitized filename out of a raw `Content-Disposition` header value.
/// Prefers the RFC 5987/6266 `filename*=` extended parameter (percent-decoded,
/// with its `charset'lang'` prefix stripped) over the plain `filename=`
/// parameter, the same precedence browsers use — a server that sends both is
/// giving the plain one only as an ASCII-safe fallback. Returns `None` if
/// neither parameter is present, or decodes to nothing usable.
pub(crate) fn filename_from_content_disposition(header: &str) -> Option<String> {
    if let Some(name) = extended_filename_param(header) {
        return Some(name);
    }
    let idx = header.to_ascii_lowercase().find("filename=")?;
    let raw = header[idx + "filename=".len()..]
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"');
    if raw.is_empty() {
        None
    } else {
        Some(sanitize(raw))
    }
}

/// Extracts and decodes an RFC 5987 `filename*=charset'lang'value` parameter
/// (e.g. `filename*=UTF-8''na%C3%AFve%20file.zip`), the form servers use for
/// a filename with non-ASCII characters. `None` if the header has no such
/// parameter, or it doesn't decode as valid UTF-8.
fn extended_filename_param(header: &str) -> Option<String> {
    let idx = header.to_ascii_lowercase().find("filename*=")?;
    let raw = header[idx + "filename*=".len()..].split(';').next().unwrap_or("").trim();
    // Skip the `charset'lang'` prefix (e.g. `UTF-8''`) — everything after
    // the second `'` is the percent-encoded value. A malformed header with
    // no `'` at all is treated as already being the bare value.
    let value = raw.splitn(3, '\'').nth(2).unwrap_or(raw);
    let decoded = percent_encoding::percent_decode_str(value).decode_utf8().ok()?;
    let decoded = decoded.trim();
    if decoded.is_empty() {
        None
    } else {
        Some(sanitize(decoded))
    }
}

/// True if `name` has a plausible file extension: a `.` past position 0
/// whose tail is 1-8 ASCII alphanumeric characters. A cheap heuristic used
/// to decide whether a filename candidate is worth returning as-is, versus
/// one that needs a `Content-Type`-derived extension appended.
fn has_plausible_extension(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => {
            (1..=8).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

/// Maps a `Content-Type` value to a file extension, to fill in the extension
/// a filename derived from a URL path or query alone would be missing.
/// `None` for types with no single obvious extension, including
/// `application/octet-stream` — the generic type servers send for arbitrary
/// downloads, which carries no naming information at all.
fn ext_from_content_type(ct: &str) -> Option<&'static str> {
    let ct = ct.split(';').next().unwrap_or(ct).trim().to_ascii_lowercase();
    Some(match ct.as_str() {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/mpeg" => "mpg",
        "video/x-flv" => "flv",
        "video/3gpp" => "3gp",
        "video/mp2t" => "ts",
        "video/ogg" => "ogv",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/aac" => "aac",
        "audio/mp4" => "m4a",
        "audio/webm" => "weba",
        "audio/opus" => "opus",
        "audio/x-ms-wma" => "wma",
        "application/pdf" => "pdf",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/rtf" => "rtf",
        "application/epub+zip" => "epub",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "text/calendar" => "ics",
        "application/json" => "json",
        "application/xml" | "text/xml" => "xml",
        "application/zip" => "zip",
        "application/x-7z-compressed" => "7z",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/gzip" | "application/x-gzip" => "gz",
        "application/x-tar" => "tar",
        "application/x-bzip2" => "bz2",
        "application/x-xz" => "xz",
        "application/x-bittorrent" => "torrent",
        "application/x-msdownload" | "application/x-msdos-program" => "exe",
        "application/x-msi" => "msi",
        "application/vnd.android.package-archive" => "apk",
        "application/x-apple-diskimage" => "dmg",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        _ => return None,
    })
}

/// The URL's last non-empty path segment, percent-decoded and sanitized, or
/// `None` if the URL has no meaningful path segment (or fails to parse).
fn filename_from_url_path(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let segment = parsed.path_segments()?.rfind(|s| !s.is_empty())?;
    let decoded = percent_encoding::percent_decode_str(segment).decode_utf8_lossy();
    let cleaned = sanitize(&decoded);
    if cleaned.is_empty() || cleaned == "download.bin" {
        None
    } else {
        Some(cleaned)
    }
}

/// Scans the URL's query string for a filename hint — the shape servers use
/// when the path itself is an opaque route like `/download` or `/api/file`
/// and the real name lives in a query parameter instead (e.g.
/// `?filename=video.mp4`, or a pre-signed S3-style
/// `?response-content-disposition=attachment%3Bfilename%3D...`). Returned
/// even without a plausible extension — a bare hint like `?filename=invoice`
/// is still a far better name than a generic path segment like `download`,
/// and `filename_from` below decides how to fill in the missing extension.
fn filename_from_query(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    for (key, value) in parsed.query_pairs() {
        let candidate = if key.eq_ignore_ascii_case("response-content-disposition") {
            filename_from_content_disposition(&value)
        } else if matches!(
            key.to_ascii_lowercase().as_str(),
            "filename" | "file" | "name" | "fn" | "title" | "attachment" | "download"
        ) {
            let cleaned = sanitize(&value);
            (!cleaned.is_empty() && cleaned != "download.bin").then_some(cleaned)
        } else {
            None
        };
        if candidate.is_some() {
            return candidate;
        }
    }
    None
}

/// A filename stem (no extension) derived from the referring page's URL —
/// last-resort naming when neither the response headers nor the download
/// URL itself yield anything usable. Strips any extension from the
/// referer's last path segment (a page slug rarely has a real one, and a
/// stray `.html`/`.php` tail would be actively misleading once paired with
/// the caller's own `Content-Type`-derived extension).
fn filename_stem_from_referer(referer: &str) -> Option<String> {
    let name = filename_from_url_path(referer)?;
    let stem = match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => name,
    };
    (!stem.is_empty()).then_some(stem)
}

/// Derives a filename for a download response in two passes, so a good name
/// missing only its extension is never thrown away in favor of a worse one
/// that happens to have one:
///
/// 1. **Name.** The best candidate, tried in priority order — the server's
///    `Content-Disposition` header, a filename hint in the URL's query
///    string (e.g. `?filename=`), the URL's own last path segment, kept
///    *regardless* of whether it already has an extension.
/// 2. **Extension.** If that name lacks one, a `Content-Type`-derived
///    extension is appended when available; otherwise the bare name is
///    still returned as-is — a stem like `invoice` beats a generic
///    `download.bin` every time.
///
/// This is what rescues URLs shaped like `https://example.com/download?filename=x.mp4`
/// (an opaque path segment, a query hint with the real name) or
/// `https://example.com/stream` (no path segment or query hint at all, but a
/// video `Content-Type`) from saving as a bare `download`. The referring
/// page's slug is a last-resort name source, only used when the response and
/// URL together gave nothing at all.
pub(crate) fn filename_from(resp: &reqwest::Response, url: &str, referer: Option<&str>) -> String {
    let content_type =
        resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok());
    let ct_ext = content_type.and_then(ext_from_content_type);

    let cd_name = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(filename_from_content_disposition);
    let query_name = filename_from_query(url);
    let path_name = filename_from_url_path(url);

    // Pass 1: the first candidate that already has a plausible extension
    // wins outright, in source priority order — a path segment that's
    // already a proper filename beats an extension-less query hint even
    // though the query is checked first when neither has one (pass 2).
    for n in [&cd_name, &query_name, &path_name].into_iter().flatten() {
        if has_plausible_extension(n) {
            return n.clone();
        }
    }

    // Pass 2: none of them had an extension — take the best name by source
    // priority and fill in a Content-Type extension if we have one.
    if let Some(name) = cd_name.or(query_name).or(path_name) {
        return match ct_ext {
            Some(ext) => format!("{name}.{ext}"),
            None => name,
        };
    }

    // The referring page's slug, plus a Content-Type extension — only
    // reached when the response and URL together gave nothing to work with.
    if let Some(ext) = ct_ext {
        if let Some(stem) = referer.and_then(filename_stem_from_referer) {
            return format!("{stem}.{ext}");
        }
    }

    sanitize("")
}

pub(crate) fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
    let ext = p.extension().and_then(|s| s.to_str());
    for i in 1..=10_000 {
        let name = match ext {
            Some(e) => format!("{stem} ({i}).{e}"),
            None => format!("{stem} ({i})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(filename)
}

pub(crate) fn downloads_base() -> Result<PathBuf, String> {
    Ok(dirs::download_dir()
        .ok_or("Could not locate the Downloads directory")?
        .join("AzhuraDownloadManager"))
}

fn volume_prefix(p: &Path) -> Option<OsString> {
    for c in p.components() {
        if let std::path::Component::Prefix(pre) = c {
            return Some(pre.as_os_str().to_os_string());
        }
    }
    None
}

fn same_volume(a: &Path, b: &Path) -> bool {
    match (volume_prefix(a), volume_prefix(b)) {
        (Some(x), Some(y)) => x.eq_ignore_ascii_case(&y),
        _ => false,
    }
}

pub(crate) fn temp_download_dir() -> Result<PathBuf, String> {
    let base = downloads_base()?;
    let sys_temp = std::env::temp_dir();
    if same_volume(&sys_temp, &base) {
        Ok(sys_temp.join("AzhuraDownloadManager"))
    } else {
        Ok(base.join(".incomplete"))
    }
}

/// Writes a Windows Mark-of-the-Web (`Zone.Identifier` alternate data stream)
/// on `dest`, the same tag every browser attaches to a download so
/// SmartScreen, Office Protected View and Explorer's "this file came from
/// the internet" prompt all still fire for files ADM saves — including the
/// `.exe`/`.msi`/`.ps1`/`.bat` extensions `categories::category_id` buckets
/// as "program". Best-effort: swallows every error, since exFAT/FAT32 have
/// no alternate-data-stream support at all and that must never fail a
/// download that otherwise completed fine.
#[cfg(windows)]
pub(crate) async fn write_mark_of_the_web(dest: &Path, url: &str, referrer: Option<&str>) {
    let mut ads: OsString = dest.as_os_str().to_owned();
    ads.push(":Zone.Identifier");
    let mut body = format!("[ZoneTransfer]\r\nZoneId=3\r\nHostUrl={url}\r\n");
    if let Some(r) = referrer.filter(|r| !r.is_empty()) {
        body.push_str(&format!("ReferrerUrl={r}\r\n"));
    }
    let _ = tokio::fs::write(PathBuf::from(ads), body).await;
}

#[cfg(not(windows))]
pub(crate) async fn write_mark_of_the_web(_dest: &Path, _url: &str, _referrer: Option<&str>) {}

pub(crate) async fn move_to_destination(
    temp_path: &Path,
    filename: &str,
    save_path: Option<&str>,
    prefs: &Prefs,
) -> Result<PathBuf, String> {
    let base = match save_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => {
            let p = PathBuf::from(s);
            if !p.is_absolute() {
                return Err("Save folder must be an absolute path".to_string());
            }
            p
        }
        None => category_dir(filename, prefs)?,
    };
    tokio::fs::create_dir_all(&base)
        .await
        .map_err(|e| format!("Could not create target folder: {e}"))?;
    let dest = unique_path(&base, filename);
    if tokio::fs::rename(temp_path, &dest).await.is_err() {
        tokio::fs::copy(temp_path, &dest)
            .await
            .map_err(|e| format!("Could not move file to destination: {e}"))?;
        let _ = tokio::fs::remove_file(temp_path).await;
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_illegal_characters() {
        assert_eq!(sanitize("a/b\\c:d*e?f\"g<h>i|j"), "abcdefghij");
    }

    #[test]
    fn sanitize_trims_and_falls_back() {
        assert_eq!(sanitize("  ...  "), "download.bin");
        assert_eq!(sanitize(""), "download.bin");
        assert_eq!(sanitize("file.txt..."), "file.txt");
    }

    #[test]
    fn unique_path_appends_counter_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let first = unique_path(dir.path(), "file.txt");
        assert_eq!(first, dir.path().join("file.txt"));
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(dir.path(), "file.txt");
        assert_eq!(second, dir.path().join("file (1).txt"));
    }

    #[test]
    fn content_disposition_extracts_quoted_filename() {
        assert_eq!(
            filename_from_content_disposition(r#"attachment; filename="report.pdf""#),
            Some("report.pdf".to_string())
        );
    }

    #[test]
    fn content_disposition_ignores_trailing_params() {
        assert_eq!(
            filename_from_content_disposition("attachment; filename=data.zip; foo=bar"),
            Some("data.zip".to_string())
        );
    }

    #[test]
    fn content_disposition_none_without_filename() {
        assert_eq!(filename_from_content_disposition("attachment"), None);
    }

    #[test]
    fn content_disposition_prefers_extended_filename_star() {
        assert_eq!(
            filename_from_content_disposition(
                r#"attachment; filename="fallback.txt"; filename*=UTF-8''na%C3%AFve%20file.zip"#
            ),
            Some("naïve file.zip".to_string())
        );
    }

    #[test]
    fn content_disposition_decodes_extended_filename_star_alone() {
        assert_eq!(
            filename_from_content_disposition("attachment; filename*=UTF-8''report%20final.pdf"),
            Some("report final.pdf".to_string())
        );
    }

    #[test]
    fn has_plausible_extension_accepts_short_alnum_tail() {
        assert!(has_plausible_extension("movie.mp4"));
        assert!(has_plausible_extension("archive.tar"));
    }

    #[test]
    fn has_plausible_extension_rejects_missing_or_long_tail() {
        assert!(!has_plausible_extension("download"));
        assert!(!has_plausible_extension(".hidden"));
        assert!(!has_plausible_extension("file.reallylongext"));
    }

    #[test]
    fn ext_from_content_type_maps_common_types() {
        assert_eq!(ext_from_content_type("video/mp4"), Some("mp4"));
        assert_eq!(ext_from_content_type("audio/mpeg; charset=binary"), Some("mp3"));
        assert_eq!(ext_from_content_type("application/octet-stream"), None);
        assert_eq!(ext_from_content_type("text/html"), None);
    }

    #[test]
    fn filename_from_url_path_decodes_and_sanitizes() {
        assert_eq!(
            filename_from_url_path("https://example.com/path/na%C3%AFve%20file.zip"),
            Some("naïve file.zip".to_string())
        );
        assert_eq!(filename_from_url_path("https://example.com/"), None);
    }

    #[test]
    fn filename_from_query_finds_filename_param_with_extension() {
        assert_eq!(
            filename_from_query("https://example.com/download?filename=test.mp4"),
            Some("test.mp4".to_string())
        );
    }

    #[test]
    fn filename_from_query_keeps_extension_less_hint() {
        // A bare `?filename=` hint is still returned — `filename_from` decides
        // how to fill in the missing extension, but the name itself is worth
        // more than a generic path segment like `download`.
        assert_eq!(
            filename_from_query("https://example.com/download?filename=test"),
            Some("test".to_string())
        );
    }

    #[test]
    fn filename_from_query_decodes_response_content_disposition() {
        assert_eq!(
            filename_from_query(
                "https://s3.example.com/bucket/key?response-content-disposition=attachment%3B%20filename%3D%22video.mp4%22"
            ),
            Some("video.mp4".to_string())
        );
    }

    #[test]
    fn filename_stem_from_referer_strips_extension() {
        assert_eq!(
            filename_stem_from_referer("https://example.com/watch/big-buck-bunny.html"),
            Some("big-buck-bunny".to_string())
        );
        assert_eq!(
            filename_stem_from_referer("https://example.com/watch/big-buck-bunny"),
            Some("big-buck-bunny".to_string())
        );
    }
}
