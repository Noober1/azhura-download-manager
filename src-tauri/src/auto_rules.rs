// ---------------------------------------------------------------------------
// Auto rules: an ordered list of URL patterns, each pointing at a destination
// folder. Evaluated in Rust (not the frontend) so a rule applies the same way
// whether the app was already running (`handle_deep_link`) or just cold-
// started from a browser click (`handle_deep_link_cold_start`) — the Add
// window's own frontend never sees the cold-start payload, so a JS-side check
// would silently miss that path. Running the user's own regex through the
// `regex` crate also keeps a hostile/careless pattern from ever backtracking
// catastrophically, unlike a JS `RegExp`.
// ---------------------------------------------------------------------------

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::categories::{category_dir_for_id, is_known_category};
use crate::config::prefs::Prefs;

const MAX_PATTERN_LEN: usize = 500;
const MAX_RULES: usize = 100;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AutoRule {
    pub(crate) id: String,
    pub(crate) enabled: bool,
    /// "wildcard" | "regex"
    pub(crate) kind: String,
    pub(crate) pattern: String,
    /// "folder" | "category"
    pub(crate) target: String,
    /// Absolute path, used when `target == "folder"`.
    pub(crate) folder: String,
    /// Category id, used when `target == "category"`.
    pub(crate) category: String,
}

impl Default for AutoRule {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            kind: "wildcard".to_string(),
            pattern: String::new(),
            target: "folder".to_string(),
            folder: String::new(),
            category: String::new(),
        }
    }
}

/// Compiles a rule's pattern into a `Regex`, either by escaping it as a
/// wildcard (`*`/`?`, everything else literal) or by using it as a regex
/// directly. Both flavors are matched case-insensitively.
fn compile(kind: &str, pattern: &str) -> Result<Regex, String> {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return Err("Pattern is empty".to_string());
    }
    if trimmed.len() > MAX_PATTERN_LEN {
        return Err(format!("Pattern is too long (max {MAX_PATTERN_LEN} characters)"));
    }
    let source = match kind {
        "wildcard" => wildcard_to_regex(trimmed),
        "regex" => trimmed.to_string(),
        _ => return Err(format!("Unknown pattern kind \"{kind}\"")),
    };
    RegexBuilder::new(&source)
        .case_insensitive(true)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| e.to_string().lines().next().unwrap_or("Invalid pattern").to_string())
}

/// `*` -> `.*`, `?` -> `.`, everything else escaped and anchored at both
/// ends so the whole subject has to match, not just a substring of it.
fn wildcard_to_regex(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() * 2 + 2);
    out.push('^');
    for c in pattern.chars() {
        match c {
            '*' => out.push_str(".*"),
            '?' => out.push('.'),
            _ => out.push_str(&regex::escape(&c.to_string())),
        }
    }
    out.push('$');
    out
}

/// The string a rule's pattern is actually matched against. Wildcards match
/// host + path (no scheme, no query/fragment) so a pattern like
/// `*.example.com/*` or `*.zip` reads naturally; a regex searches the raw
/// URL, unanchored, like any regex search.
fn match_subject(kind: &str, url: &str) -> String {
    if kind == "regex" {
        return url.to_string();
    }
    match url::Url::parse(url) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("");
            let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
            format!("{host}{port}{}", parsed.path())
        }
        Err(_) => String::new(),
    }
}

/// The index of the first enabled rule whose pattern matches `url`. A rule
/// that fails to compile is skipped rather than treated as an error, so one
/// bad rule never blocks the ones after it.
pub(crate) fn first_match(rules: &[AutoRule], url: &str) -> Option<usize> {
    rules.iter().position(|r| {
        if !r.enabled {
            return false;
        }
        let Ok(re) = compile(&r.kind, &r.pattern) else {
            return false;
        };
        if r.kind == "regex" {
            re.is_match(url)
        } else {
            re.is_match(&match_subject(&r.kind, url))
        }
    })
}

/// The destination folder a matched rule resolves to, or `None` if the rule's
/// target is malformed (a relative/empty folder, or an unknown category) —
/// the caller falls back to the Add window in that case.
pub(crate) fn resolve_folder(rule: &AutoRule, prefs: &Prefs) -> Option<String> {
    match rule.target.as_str() {
        "folder" => {
            let trimmed = rule.folder.trim();
            if trimmed.is_empty() || !std::path::Path::new(trimmed).is_absolute() {
                return None;
            }
            Some(trimmed.to_string())
        }
        "category" => {
            if !is_known_category(&rule.category) {
                return None;
            }
            category_dir_for_id(&rule.category, prefs)
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        }
        _ => None,
    }
}

/// Drops rules that could never legitimately match or resolve (a bad
/// pattern, an unknown kind/target, a relative folder, an unknown category),
/// and caps the list at `MAX_RULES`. Used when importing a backup or loading
/// a hand-edited settings.json, so a corrupt entry can't wedge every capture
/// into silently falling back to the Add window forever.
pub(crate) fn sanitize(rules: Vec<AutoRule>) -> Vec<AutoRule> {
    let prefs = Prefs::default();
    rules
        .into_iter()
        .filter(|r| compile(&r.kind, &r.pattern).is_ok())
        .filter(|r| resolve_folder(r, &prefs).is_some())
        .take(MAX_RULES)
        .collect()
}

/// Validates a single pattern exactly the way `first_match` will evaluate
/// it, so the rules dialog's inline error can never disagree with what a
/// real capture does. Used for live validation while a rule is being edited.
#[tauri::command]
#[specta::specta]
pub(crate) fn validate_auto_rule_pattern(kind: String, pattern: String) -> Result<(), String> {
    compile(&kind, &pattern).map(|_| ())
}

/// Runs `first_match` against a draft rule list the dialog hasn't saved yet,
/// for its "Test a URL" box — returns the matching rule's index, if any.
#[tauri::command]
#[specta::specta]
pub(crate) fn test_auto_rules(rules: Vec<AutoRule>, url: String) -> Option<u32> {
    first_match(&rules, &url).map(|i| i as u32)
}

/// Stamps `savePath`/`autoRule` onto a captured deep-link payload (see
/// `src/types.ts`'s `AddPayload`) when an enabled rule matches its `url`.
/// Returns whether it matched. Leaves the payload untouched on any failure
/// (no rules, no match, or a match that fails to resolve a real folder).
pub(crate) fn apply(app: &tauri::AppHandle, payload: &mut serde_json::Value) -> bool {
    use tauri::Manager as _;

    let Some(url) = payload.get("url").and_then(|v| v.as_str()).map(str::to_string) else {
        return false;
    };

    let rules = {
        let settings = app.state::<crate::config::settings::SettingsState>();
        let guard = settings.0.lock().unwrap();
        guard.auto_rules.clone()
    };
    let Some(idx) = first_match(&rules, &url) else {
        return false;
    };
    let rule = &rules[idx];

    let folder = {
        let prefs = app.state::<crate::config::prefs::PrefsState>();
        let prefs = prefs.0.lock().unwrap();
        resolve_folder(rule, &prefs)
    };
    let Some(folder) = folder else {
        return false;
    };

    if let Some(obj) = payload.as_object_mut() {
        obj.insert("savePath".to_string(), serde_json::Value::String(folder));
        obj.insert("autoRule".to_string(), serde_json::Value::String(rule.pattern.clone()));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(kind: &str, pattern: &str) -> AutoRule {
        AutoRule {
            id: "r1".to_string(),
            enabled: true,
            kind: kind.to_string(),
            pattern: pattern.to_string(),
            target: "folder".to_string(),
            folder: "D:\\Downloads".to_string(),
            category: String::new(),
        }
    }

    // --- wildcard matching ---------------------------------------------------

    #[test]
    fn wildcard_matches_host_subdomain() {
        let re = compile("wildcard", "*.example.com/*").unwrap();
        assert!(re.is_match(&match_subject("wildcard", "https://cdn.example.com/a/b.iso")));
    }

    #[test]
    fn wildcard_extension_match_ignores_query() {
        let re = compile("wildcard", "*.zip").unwrap();
        assert!(re.is_match(&match_subject("wildcard", "https://x.com/f.zip?token=1")));
    }

    #[test]
    fn wildcard_extension_match_does_not_match_longer_extension() {
        let re = compile("wildcard", "*.zip").unwrap();
        assert!(!re.is_match(&match_subject("wildcard", "https://x.com/f.zip.html")));
    }

    #[test]
    fn wildcard_matching_is_case_insensitive() {
        let re = compile("wildcard", "*.ZIP").unwrap();
        assert!(re.is_match(&match_subject("wildcard", "https://x.com/f.zip")));
    }

    #[test]
    fn wildcard_question_mark_matches_one_char() {
        let re = compile("wildcard", "*.i?o").unwrap();
        assert!(re.is_match(&match_subject("wildcard", "https://x.com/a.iso")));
        assert!(!re.is_match(&match_subject("wildcard", "https://x.com/a.iiso")));
    }

    // --- regex matching --------------------------------------------------------

    #[test]
    fn regex_search_is_unanchored() {
        let re = compile("regex", r"\.iso$").unwrap();
        assert!(re.is_match("https://x.com/path/file.iso"));
    }

    #[test]
    fn regex_flags_are_case_insensitive() {
        let re = compile("regex", r"EXAMPLE\.COM").unwrap();
        assert!(re.is_match("https://example.com/f"));
    }

    #[test]
    fn regex_invalid_pattern_errors() {
        assert!(compile("regex", "(").is_err());
    }

    #[test]
    fn empty_pattern_errors() {
        assert!(compile("regex", "").is_err());
        assert!(compile("wildcard", "   ").is_err());
    }

    #[test]
    fn overlong_pattern_errors() {
        let long = "a".repeat(MAX_PATTERN_LEN + 1);
        assert!(compile("regex", &long).is_err());
    }

    #[test]
    fn unknown_kind_errors() {
        assert!(compile("glob", "*.zip").is_err());
    }

    // --- first_match -------------------------------------------------------

    #[test]
    fn first_match_skips_disabled_rules() {
        let mut r = rule("wildcard", "*.zip");
        r.enabled = false;
        let rules = vec![r];
        assert_eq!(first_match(&rules, "https://x.com/f.zip"), None);
    }

    #[test]
    fn first_match_returns_the_first_matching_rule() {
        let rules = vec![rule("wildcard", "*.zip"), rule("wildcard", "*.zip")];
        assert_eq!(first_match(&rules, "https://x.com/f.zip"), Some(0));
    }

    #[test]
    fn first_match_skips_an_invalid_rule_and_keeps_going() {
        let rules = vec![rule("regex", "("), rule("wildcard", "*.zip")];
        assert_eq!(first_match(&rules, "https://x.com/f.zip"), Some(1));
    }

    // --- resolve_folder ------------------------------------------------------

    #[test]
    fn resolve_folder_rejects_relative_folder() {
        let mut r = rule("wildcard", "*.zip");
        r.folder = "relative/path".to_string();
        assert_eq!(resolve_folder(&r, &Prefs::default()), None);
    }

    #[test]
    fn resolve_folder_rejects_unknown_category() {
        let mut r = rule("wildcard", "*.zip");
        r.target = "category".to_string();
        r.category = "bogus".to_string();
        assert_eq!(resolve_folder(&r, &Prefs::default()), None);
    }

    #[test]
    fn resolve_folder_resolves_known_category_to_base_folder() {
        let mut r = rule("wildcard", "*.mp4");
        r.target = "category".to_string();
        r.category = "video".to_string();
        let resolved = resolve_folder(&r, &Prefs::default()).unwrap();
        assert!(resolved.ends_with("Videos"), "{resolved}");
    }

    // --- sanitize ------------------------------------------------------------

    #[test]
    fn sanitize_drops_invalid_rules() {
        let mut bad_pattern = rule("regex", "(");
        bad_pattern.id = "bad-pattern".to_string();
        let mut bad_folder = rule("wildcard", "*.zip");
        bad_folder.id = "bad-folder".to_string();
        bad_folder.folder = "relative".to_string();
        let good = rule("wildcard", "*.zip");

        let out = sanitize(vec![bad_pattern, bad_folder, good.clone()]);

        assert_eq!(out, vec![good]);
    }

    #[test]
    fn sanitize_caps_the_list_at_max_rules() {
        let rules: Vec<AutoRule> = (0..MAX_RULES + 10).map(|_| rule("wildcard", "*.zip")).collect();
        assert_eq!(sanitize(rules).len(), MAX_RULES);
    }
}
