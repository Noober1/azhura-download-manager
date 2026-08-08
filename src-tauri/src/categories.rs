use std::path::{Path, PathBuf};

use crate::config::prefs::Prefs;
use crate::paths::downloads_base;

/// File-type category id for `filename`'s extension, or "other". Extension
/// lists MUST stay in sync with `src/categories.ts` (`EXT_CATEGORY`) — the
/// frontend uses the same classification for its sidebar filters.
pub(crate) fn category_id(filename: &str) -> &'static str {
    let ext = match filename.rsplit_once('.') {
        Some((_, e)) if !e.is_empty() => e.to_ascii_lowercase(),
        _ => return "other",
    };
    match ext.as_str() {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpg" | "mpeg" | "ts"
        | "3gp" | "m2ts" | "ogv" => "video",
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "mid" | "aiff" => "audio",
        "exe" | "msi" | "appx" | "msix" | "apk" | "aab" | "jar" | "dll" | "sys" | "deb" | "rpm"
        | "dmg" | "pkg" | "appimage" | "bat" | "cmd" | "sh" | "ps1" => "program",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "xls" | "xlsx" | "ods" | "csv"
        | "tsv" | "ppt" | "pptx" | "odp" | "epub" | "mobi" | "azw3" | "nfo" | "log" => "docs",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "cab" | "arj"
        | "iso" | "img" => "archive",
        _ => "other",
    }
}

/// Folder name under `downloads_base()` for a category id. MUST match
/// `CATEGORY_FOLDER` in `src/categories.ts`.
pub(crate) fn category_folder(id: &str) -> &'static str {
    match id {
        "video" => "Videos",
        "audio" => "Audios",
        "program" => "Programs",
        "docs" => "Documents",
        "archive" => "Archives",
        _ => "Others",
    }
}

/// The six category folder names, for creating them once at launch.
pub(crate) const CATEGORY_FOLDERS: [&str; 6] = [
    "Videos",
    "Audios",
    "Programs",
    "Documents",
    "Archives",
    "Others",
];

/// Old singular folder name → its current plural name, for one-time migration
/// of installs created before v0.2.1. Every entry MUST have a matching value
/// in `CATEGORY_FOLDERS`.
pub(crate) const LEGACY_CATEGORY_FOLDERS: [(&str, &str); 6] = [
    ("Video", "Videos"),
    ("Audio", "Audios"),
    ("Program", "Programs"),
    ("Docs", "Documents"),
    ("Archive", "Archives"),
    ("Other", "Others"),
];

/// Result of `migrate_legacy_category_folders()`, stashed via `.manage()` so
/// `.setup()` — the earliest point an `AppHandle` exists — can warn the user
/// if any legacy folder failed to migrate. Populated before `.manage()` is
/// even called (see `run()`), so unlike `PendingDeepLink` this needs no
/// `Mutex`/`Option`: `.setup()` only runs once, and the value is already
/// known by the time anything reads it.
pub(crate) struct PendingMigrationWarnings(pub Vec<String>);

/// Best-effort rename of the legacy singular category folders under
/// `downloads_base()` to their plural replacements. Renames only when the old
/// folder exists and the new one does not — if both exist the user has files
/// in each and a merge could overwrite, so it's left alone: the new folder
/// wins for future downloads, the old one just sits there untouched.
///
/// Returns the old (singular) names of any folder that failed to rename, so
/// the caller can surface it to the user once a window exists.
pub(crate) fn migrate_legacy_category_folders() -> Vec<String> {
    match downloads_base() {
        Ok(base) => migrate_legacy_category_folders_in(&base),
        Err(_) => Vec::new(),
    }
}

fn migrate_legacy_category_folders_in(base: &Path) -> Vec<String> {
    let mut failed = Vec::new();
    for (old, new) in LEGACY_CATEGORY_FOLDERS {
        let old_path = base.join(old);
        let new_path = base.join(new);
        if old_path.is_dir() && !new_path.exists() {
            if let Err(e) = std::fs::rename(&old_path, &new_path) {
                eprintln!(
                    "could not migrate legacy folder {} -> {}: {e}",
                    old_path.display(),
                    new_path.display()
                );
                failed.push(old.to_string());
            }
        }
    }
    failed
}

/// If `path` sits inside a legacy singular category folder that no longer
/// exists (because `migrate_legacy_category_folders` just renamed it) and the
/// renamed equivalent does exist, returns the rewritten path; otherwise
/// returns `path` unchanged. Only ever rewrites paths under `downloads_base()`,
/// so paths the user redirected elsewhere are never touched.
pub(crate) fn retarget_legacy_path(path: &str) -> String {
    if path.is_empty() {
        return path.to_string();
    }
    let Ok(base) = downloads_base() else { return path.to_string() };
    retarget_legacy_path_in(path, &base)
}

fn retarget_legacy_path_in(path: &str, base: &Path) -> String {
    let p = PathBuf::from(path);
    for (old, new) in LEGACY_CATEGORY_FOLDERS {
        let old_dir = base.join(old);
        if let Ok(rest) = p.strip_prefix(&old_dir) {
            let new_dir = base.join(new);
            if !old_dir.exists() && new_dir.exists() {
                return new_dir.join(rest).to_string_lossy().into_owned();
            }
        }
    }
    path.to_string()
}

/// Destination directory for `filename` when the user hasn't picked an
/// explicit save path: the remembered override for its category if one is
/// set (and absolute), otherwise `<base>/<CategoryFolder>`.
pub(crate) fn category_dir(filename: &str, prefs: &Prefs) -> Result<PathBuf, String> {
    let id = category_id(filename);
    if let Some(custom) = prefs.category_paths.get(id) {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            return Ok(p);
        }
    }
    Ok(downloads_base()?.join(category_folder(id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_id_covers_all_buckets() {
        assert_eq!(category_id("movie.mp4"), "video");
        assert_eq!(category_id("song.mp3"), "audio");
        assert_eq!(category_id("setup.exe"), "program");
        assert_eq!(category_id("report.pdf"), "docs");
        assert_eq!(category_id("bundle.zip"), "archive");
        assert_eq!(category_id("unknown.xyz"), "other");
        assert_eq!(category_id("noext"), "other");
        assert_eq!(category_id("archive.tar.gz"), "archive");
    }

    #[test]
    fn category_folder_matches_every_id() {
        assert_eq!(category_folder("video"), "Videos");
        assert_eq!(category_folder("audio"), "Audios");
        assert_eq!(category_folder("program"), "Programs");
        assert_eq!(category_folder("docs"), "Documents");
        assert_eq!(category_folder("archive"), "Archives");
        assert_eq!(category_folder("other"), "Others");
        assert_eq!(category_folder("bogus"), "Others");
    }

    #[test]
    fn migrate_renames_legacy_folder_when_new_one_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("Video");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("clip.mp4"), b"x").unwrap();

        let failed = migrate_legacy_category_folders_in(dir.path());

        let new = dir.path().join("Videos");
        assert!(new.is_dir());
        assert!(new.join("clip.mp4").exists());
        assert!(!old.exists());
        assert!(failed.is_empty());
    }

    #[test]
    fn migrate_leaves_both_folders_when_new_one_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("Video");
        let new = dir.path().join("Videos");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        let failed = migrate_legacy_category_folders_in(dir.path());

        assert!(old.exists());
        assert!(new.exists());
        // Not a rename failure — both already existing is the deliberate
        // "leave it alone" case, not an error worth surfacing to the user.
        assert!(failed.is_empty());
    }

    #[test]
    fn retarget_rewrites_path_under_renamed_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Videos")).unwrap();
        let old_path = dir.path().join("Video").join("clip.mp4");

        let retargeted = retarget_legacy_path_in(old_path.to_str().unwrap(), dir.path());

        assert_eq!(retargeted, dir.path().join("Videos").join("clip.mp4").to_string_lossy());
    }

    #[test]
    fn retarget_leaves_path_unchanged_when_old_folder_still_exists() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Video")).unwrap();
        std::fs::create_dir_all(dir.path().join("Videos")).unwrap();
        let old_path = dir.path().join("Video").join("clip.mp4");

        let retargeted = retarget_legacy_path_in(old_path.to_str().unwrap(), dir.path());

        assert_eq!(retargeted, old_path.to_string_lossy());
    }

    #[test]
    fn retarget_leaves_unrelated_path_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let unrelated = dir.path().join("SomewhereElse").join("clip.mp4");

        let retargeted = retarget_legacy_path_in(unrelated.to_str().unwrap(), dir.path());

        assert_eq!(retargeted, unrelated.to_string_lossy());
    }

    // --- Rust↔TS category contract guard --------------------------------------
    //
    // `category_id`/`category_folder` here and `EXT_CATEGORY`/`CATEGORY_FOLDER`
    // in `src/categories.ts` are hand-duplicated on purpose (see the "MUST stay
    // in sync" comments at both definitions) — the frontend needs the same
    // classification client-side for its sidebar filters, without a round trip.
    // These tests parse both sources as text and fail loudly on any drift,
    // instead of silently sending a file to the wrong category folder.

    /// Extracts `(extensions, category)` pairs from `category_id`'s `match
    /// ext.as_str() { "a" | "b" => "cat", ... }` block, by scanning for each
    /// `=>` and taking the quoted literals on either side of it.
    fn parse_rust_category_arms(source: &str) -> Vec<(Vec<String>, String)> {
        let marker = "match ext.as_str() {";
        let start = source
            .find(marker)
            .expect("category_id's match arm not found in categories.rs — did its shape change?");
        let after_match = &source[start + marker.len()..];
        let end = after_match
            .find("_ => \"other\",")
            .expect("category_id's fallback arm not found");
        let body = &after_match[..end];

        let mut arms = Vec::new();
        let mut rest = body;
        while let Some(arrow) = rest.find("=>") {
            let lhs = &rest[..arrow];
            let after_arrow = &rest[arrow + 2..];
            let comma = after_arrow
                .find(',')
                .expect("category_id arm is missing its trailing comma");
            let rhs = after_arrow[..comma].trim().trim_matches('"').to_string();
            let exts: Vec<String> = lhs
                .split('|')
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !exts.is_empty() {
                arms.push((exts, rhs));
            }
            rest = &after_arrow[comma + 1..];
        }
        arms
    }

    /// Extracts `(category, extensions)` pairs from `categories.ts`'s
    /// `register("cat", ["a", "b", ...]);` calls, one per source line.
    fn parse_ts_categories(source: &str) -> Vec<(String, Vec<String>)> {
        let mut out = Vec::new();
        for line in source.lines() {
            let line = line.trim();
            let Some(rest) = line.strip_prefix("register(\"") else {
                continue;
            };
            let Some(quote_end) = rest.find('"') else {
                continue;
            };
            let category = rest[..quote_end].to_string();
            let Some(bracket_start) = rest.find('[') else {
                continue;
            };
            let Some(bracket_end) = rest.find(']') else {
                continue;
            };
            let exts: Vec<String> = rest[bracket_start + 1..bracket_end]
                .split(',')
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .collect();
            out.push((category, exts));
        }
        out
    }

    /// Extracts a `["a", "b", ...]` string array assigned to `const_name`
    /// (used for `FILE_CATEGORIES`).
    fn parse_ts_string_array(source: &str, const_name: &str) -> Vec<String> {
        let start = source
            .find(const_name)
            .unwrap_or_else(|| panic!("`{const_name}` not found in categories.ts"));
        // Anchor on the `=` sign, not just the next `[` — a type annotation
        // like `FileCategory[]` between the name and the real array literal
        // has its own (empty) bracket pair that would otherwise match first.
        let after_eq = &source[start..]
            .split_once('=')
            .map(|(_, rest)| rest)
            .unwrap_or_else(|| panic!("no `=` found after `{const_name}` in categories.ts"));
        let bracket_start = after_eq.find('[').unwrap();
        let bracket_end = after_eq.find(']').unwrap();
        after_eq[bracket_start + 1..bracket_end]
            .split(',')
            .map(|s| s.trim().trim_matches('"').to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// Extracts `key: "value"` pairs from a `Record<...>` object literal
    /// assigned to `const_name` (used for `CATEGORY_FOLDER`).
    fn parse_ts_record_block(source: &str, const_name: &str) -> Vec<(String, String)> {
        let start = source
            .find(const_name)
            .unwrap_or_else(|| panic!("`{const_name}` not found in categories.ts"));
        let after = &source[start..];
        let brace_start = after.find('{').unwrap();
        let brace_end = after[brace_start..].find('}').unwrap() + brace_start;
        let body = &after[brace_start + 1..brace_end];
        body.lines()
            .filter_map(|line| {
                let line = line.trim().trim_end_matches(',');
                let (k, v) = line.split_once(':')?;
                let k = k.trim().to_string();
                let v = v.trim().trim_matches('"').to_string();
                if k.is_empty() || v.is_empty() {
                    None
                } else {
                    Some((k, v))
                }
            })
            .collect()
    }

    fn read_categories_ts() -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/categories.ts");
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()))
    }

    #[test]
    fn category_id_matches_categories_ts() {
        let rust_arms = parse_rust_category_arms(include_str!("categories.rs"));
        let ts_regs = parse_ts_categories(&read_categories_ts());

        assert!(
            !rust_arms.is_empty(),
            "failed to parse any extensions out of category_id's match arms"
        );
        assert!(
            !ts_regs.is_empty(),
            "failed to parse any register(...) calls out of categories.ts"
        );

        let mut rust_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (exts, category) in &rust_arms {
            for ext in exts {
                rust_map.insert(ext.clone(), category.clone());
            }
        }
        let mut ts_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (category, exts) in &ts_regs {
            for ext in exts {
                ts_map.insert(ext.clone(), category.clone());
            }
        }

        for (ext, category) in &ts_map {
            assert_eq!(
                rust_map.get(ext).map(String::as_str),
                Some(category.as_str()),
                "extension `.{ext}` is registered as `{category}` in src/categories.ts but \
                 category_id() in categories.rs classifies it differently (or not at all)"
            );
        }
        for (ext, category) in &rust_map {
            assert_eq!(
                ts_map.get(ext).map(String::as_str),
                Some(category.as_str()),
                "extension `.{ext}` is classified as `{category}` by category_id() in \
                 categories.rs but is not registered in src/categories.ts"
            );
        }
    }

    #[test]
    fn category_folder_matches_categories_ts() {
        let ts_source = read_categories_ts();
        let ids = parse_ts_string_array(&ts_source, "FILE_CATEGORIES");
        let folder_map: std::collections::HashMap<String, String> =
            parse_ts_record_block(&ts_source, "CATEGORY_FOLDER").into_iter().collect();

        assert!(!ids.is_empty(), "failed to parse FILE_CATEGORIES out of categories.ts");
        assert_eq!(
            ids.len(),
            folder_map.len(),
            "FILE_CATEGORIES and CATEGORY_FOLDER in categories.ts list a different number of ids"
        );

        for id in &ids {
            let expected = folder_map
                .get(id)
                .unwrap_or_else(|| panic!("CATEGORY_FOLDER has no entry for \"{id}\""));
            assert_eq!(
                category_folder(id),
                expected.as_str(),
                "category_folder(\"{id}\") in categories.rs disagrees with \
                 CATEGORY_FOLDER[\"{id}\"] in src/categories.ts"
            );
        }

        // Anything category_folder() doesn't explicitly recognize falls back to
        // "Other" — check that fallback still agrees with categories.ts's own
        // "other" entry.
        assert_eq!(
            category_folder("not-a-real-category-id"),
            folder_map["other"],
            "category_folder()'s fallback disagrees with CATEGORY_FOLDER[\"other\"] in \
             src/categories.ts"
        );
    }
}
