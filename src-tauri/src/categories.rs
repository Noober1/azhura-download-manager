use std::path::PathBuf;

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
        "video" => "Video",
        "audio" => "Audio",
        "program" => "Program",
        "docs" => "Docs",
        "archive" => "Archive",
        _ => "Other",
    }
}

/// The six category folder names, for creating them once at launch.
pub(crate) const CATEGORY_FOLDERS: [&str; 6] = ["Video", "Audio", "Program", "Docs", "Archive", "Other"];

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
        assert_eq!(category_folder("video"), "Video");
        assert_eq!(category_folder("audio"), "Audio");
        assert_eq!(category_folder("program"), "Program");
        assert_eq!(category_folder("docs"), "Docs");
        assert_eq!(category_folder("archive"), "Archive");
        assert_eq!(category_folder("other"), "Other");
        assert_eq!(category_folder("bogus"), "Other");
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
