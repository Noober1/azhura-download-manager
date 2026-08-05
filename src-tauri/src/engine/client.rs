use reqwest::header::{HeaderName, HeaderValue};
use serde::Serialize;

use crate::config::prefs::ProxyConfig;

const MIN_SEGMENT: u64 = 1024 * 1024; // 1 MB — threshold to bother going parallel
const MAX_CONNECTIONS: usize = 16;

pub(crate) fn is_insecure_http(url: &str) -> bool {
    url.trim_start().to_ascii_lowercase().starts_with("http://")
}

fn is_html_response(resp: &reqwest::Response) -> bool {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| {
            let ct = ct.trim().to_ascii_lowercase();
            ct.starts_with("text/html") || ct.starts_with("application/xhtml")
        })
        .unwrap_or(false)
}

pub(crate) fn build_headers(raw: &[(String, String)]) -> Result<Vec<(HeaderName, HeaderValue)>, String> {
    let mut out = Vec::with_capacity(raw.len());
    for (name, value) in raw {
        let hname = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("Invalid header name: \"{name}\""))?;
        let hvalue = HeaderValue::from_str(value)
            .map_err(|_| format!("Invalid value for header \"{name}\""))?;
        out.push((hname, hvalue));
    }
    Ok(out)
}

pub(crate) fn apply_headers(
    mut req: reqwest::RequestBuilder,
    headers: &[(HeaderName, HeaderValue)],
) -> reqwest::RequestBuilder {
    for (name, value) in headers {
        req = req.header(name.clone(), value.clone());
    }
    req
}

fn parse_total_from_content_range(resp: &reqwest::Response) -> Option<u64> {
    let v = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    v.rsplit('/').next()?.trim().parse::<u64>().ok()
}

pub(crate) fn choose_connections(requested: usize, supports_ranges: bool, total: Option<u64>) -> usize {
    if !supports_ranges {
        return 1;
    }
    let Some(total) = total else { return 1 };
    if total < 2 * MIN_SEGMENT {
        return 1;
    }
    let by_size = (total / MIN_SEGMENT).max(1) as usize;
    requested.clamp(1, MAX_CONNECTIONS).min(by_size).max(1)
}

pub(crate) fn build_client(allow_insecure: bool, proxy: &ProxyConfig) -> Result<reqwest::Client, String> {
    let redirect_allow = allow_insecure;
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 10 {
            attempt.stop()
        } else if !redirect_allow && attempt.url().scheme() == "http" {
            attempt.error("redirected to an insecure http:// URL")
        } else {
            attempt.follow()
        }
    });
    let mut builder = reqwest::Client::builder().redirect(policy);

    if proxy.enabled {
        let host = proxy.host.trim();
        if host.is_empty() || proxy.port == 0 {
            return Err("Proxy is enabled but its host or port is missing.".to_string());
        }
        let scheme = if proxy.scheme.is_empty() { "http" } else { proxy.scheme.as_str() };
        let url = format!("{scheme}://{host}:{}", proxy.port);
        let mut p = reqwest::Proxy::all(url).map_err(|e| format!("Invalid proxy: {e}"))?;
        if !proxy.username.is_empty() {
            p = p.basic_auth(&proxy.username, &proxy.password);
        }
        builder = builder.proxy(p);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

pub(crate) struct Probe {
    pub(crate) total: Option<u64>,
    pub(crate) supports_ranges: bool,
    pub(crate) filename: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbeInfo {
    pub(crate) total: Option<u64>,
    pub(crate) supports_ranges: bool,
    pub(crate) filename: String,
}

pub(crate) async fn probe(
    client: &reqwest::Client,
    url: &str,
    headers: &[(HeaderName, HeaderValue)],
) -> Result<Probe, String> {
    let req = apply_headers(
        client.get(url).header(reqwest::header::RANGE, "bytes=0-0"),
        headers,
    );
    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    if is_html_response(&resp) {
        return Err(
            "The server returned an HTML web page, not a file. The link probably \
             needs a login/cookie or isn't a direct download URL. Nothing was saved."
                .to_string(),
        );
    }

    let filename = crate::paths::filename_from(&resp, url);
    if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        Ok(Probe {
            total: parse_total_from_content_range(&resp),
            supports_ranges: true,
            filename,
        })
    } else {
        Ok(Probe {
            total: resp.content_length(),
            supports_ranges: false,
            filename,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_connections_single_stream_without_ranges() {
        assert_eq!(choose_connections(8, false, Some(100 * MIN_SEGMENT)), 1);
    }

    #[test]
    fn choose_connections_unknown_total() {
        assert_eq!(choose_connections(8, true, None), 1);
    }

    #[test]
    fn choose_connections_small_file_stays_single() {
        assert_eq!(choose_connections(8, true, Some(2 * MIN_SEGMENT - 1)), 1);
    }

    #[test]
    fn choose_connections_clamps_to_max() {
        assert_eq!(
            choose_connections(64, true, Some(1000 * MIN_SEGMENT)),
            MAX_CONNECTIONS
        );
    }

    #[test]
    fn choose_connections_limited_by_file_size() {
        assert_eq!(choose_connections(8, true, Some(3 * MIN_SEGMENT)), 3);
    }

    #[test]
    fn build_headers_accepts_valid_pairs() {
        let raw = vec![("X-Test".to_string(), "value".to_string())];
        let built = build_headers(&raw).unwrap();
        assert_eq!(built.len(), 1);
    }

    #[test]
    fn build_headers_rejects_illegal_name() {
        let raw = vec![("Invalid Header".to_string(), "value".to_string())];
        assert!(build_headers(&raw).is_err());
    }

    #[test]
    fn is_insecure_http_matches_http_scheme_only() {
        assert!(is_insecure_http("http://example.com"));
        assert!(is_insecure_http("HTTP://example.com"));
        assert!(is_insecure_http("  http://example.com"));
        assert!(!is_insecure_http("https://example.com"));
    }
}
