// Shared validation for download-target URLs entering the app from any
// untrusted boundary: the `start_download`/`probe_url` IPC commands, and the
// `adm://` deep link (browser extension or another process on the machine).
//
// `url::Url::parse` alone isn't enough here: per the WHATWG URL Standard it
// silently *strips* embedded TAB/CR/LF before parsing, so a string carrying
// those bytes still parses successfully — the parse just can't be used to
// detect them. Reject on the raw string first, before any parsing happens.

/// Rejects a download URL that isn't a plain, well-formed `http(s)` link, or
/// that carries embedded control characters (CR/LF above all — parsing alone
/// would silently swallow them instead of rejecting the input).
pub(crate) fn validate_download_url(url: &str) -> Result<(), String> {
    if url.chars().any(|c| c.is_control()) {
        return Err("URL contains control characters".to_string());
    }
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("Unsupported URL scheme: \"{}\"", parsed.scheme()));
    }
    Ok(())
}

/// Strips control characters from a string before it's written into a file
/// format where they're structurally significant (e.g. the `\r\n`-delimited
/// Mark-of-the-Web `Zone.Identifier` body). Best-effort, not a rejection —
/// callers on this path (`write_mark_of_the_web`) must never fail a download
/// that otherwise completed.
pub(crate) fn strip_controls(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_embedded_crlf() {
        assert!(validate_download_url("https://example.com/x\r\nZoneId=0").is_err());
        assert!(validate_download_url("https://example.com/\rx").is_err());
        assert!(validate_download_url("https://example.com/\nx").is_err());
    }

    #[test]
    fn rejects_the_exact_motw_bypass_payload() {
        let payload = "https://evil.example/setup.exe\r\nZoneId=0";
        assert!(validate_download_url(payload).is_err());
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(validate_download_url("javascript:alert(1)").is_err());
        assert!(validate_download_url("file:///etc/passwd").is_err());
        assert!(validate_download_url("ftp://example.com/x").is_err());
        assert!(validate_download_url("adm://add?url=x").is_err());
    }

    #[test]
    fn rejects_empty_and_unparseable() {
        assert!(validate_download_url("").is_err());
        assert!(validate_download_url("not a url").is_err());
        assert!(validate_download_url("   ").is_err());
    }

    #[test]
    fn accepts_ordinary_urls() {
        assert!(validate_download_url("https://example.com/file.zip").is_ok());
        assert!(validate_download_url("http://example.com/file.zip").is_ok());
        assert!(validate_download_url("https://example.com/path?a=1&b=2#frag").is_ok());
        assert!(validate_download_url("https://example.com:8443/file%20name.zip").is_ok());
        assert!(validate_download_url("https://user:pass@example.com/x").is_ok());
        assert!(validate_download_url("HTTPS://Example.com/X").is_ok());
    }

    #[test]
    fn strip_controls_removes_cr_lf_but_keeps_everything_else() {
        assert_eq!(
            strip_controls("https://example.com/x\r\nZoneId=0"),
            "https://example.com/xZoneId=0"
        );
        assert_eq!(
            strip_controls("https://example.com/plain"),
            "https://example.com/plain"
        );
    }
}
