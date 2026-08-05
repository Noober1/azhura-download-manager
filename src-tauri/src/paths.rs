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

/// Pull a sanitized filename out of a raw `Content-Disposition` header value,
/// or `None` if it has no (non-empty) `filename=` parameter.
pub(crate) fn filename_from_content_disposition(header: &str) -> Option<String> {
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

pub(crate) fn filename_from(resp: &reqwest::Response, url: &str) -> String {
    if let Some(cd) = resp.headers().get(reqwest::header::CONTENT_DISPOSITION) {
        if let Ok(s) = cd.to_str() {
            if let Some(name) = filename_from_content_disposition(s) {
                return name;
            }
        }
    }
    let path = url.split(['?', '#']).next().unwrap_or(url);
    sanitize(path.rsplit('/').next().unwrap_or(""))
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
}
