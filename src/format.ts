import type { DownloadItem } from "./types";
import { STATE_LABEL } from "./types";
import { DISPLAY_STATUS_RANK } from "./constants";

export function isInsecureHttp(url: string): boolean {
  return /^\s*http:\/\//i.test(url);
}

export function looksLikeUrl(text: string): boolean {
  try {
    return /^https?:$/.test(new URL(text).protocol);
  } catch {
    return false;
  }
}

export function parseHeaders(text: string): [string, string][] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes(":"))
    .map((line) => {
      const idx = line.indexOf(":");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string];
    })
    .filter(([name, value]) => name.length > 0 && value.length > 0);
}

/** Dedicated fields win over same-named lines in the raw textarea (case-insensitive). */
export function mergeHeaders(
  text: string,
  extra: { userAgent?: string; referer?: string; cookie?: string },
): [string, string][] {
  const headers = parseHeaders(text);
  const overrides: [string, string][] = [
    ["User-Agent", extra.userAgent ?? ""],
    ["Referer", extra.referer ?? ""],
    ["Cookie", extra.cookie ?? ""],
  ];
  for (const [name, value] of overrides) {
    if (!value.trim()) continue;
    const idx = headers.findIndex(([n]) => n.toLowerCase() === name.toLowerCase());
    if (idx >= 0) headers.splice(idx, 1);
    headers.push([name, value.trim()]);
  }
  return headers;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

export function formatDateAdded(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const FILENAME_QUERY_KEYS = ["filename", "file", "name", "fn", "title", "attachment", "download"];

/** Mirrors `has_plausible_extension` in `src-tauri/src/paths.rs`: a `.` past
 *  position 0 whose tail is 1-8 ASCII alphanumerics. */
function hasPlausibleExtension(name: string): boolean {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return false;
  const ext = name.slice(idx + 1);
  return ext.length >= 1 && ext.length <= 8 && /^[a-zA-Z0-9]+$/.test(ext);
}

/** Cosmetic pre-start filename for the Add window's readout, before the
 *  backend's `started` event reports the real name it chose. Mirrors the
 *  first two URL-only steps of `paths::filename_from` in
 *  `src-tauri/src/paths.rs`: a query-param filename hint with a plausible
 *  extension (e.g. `?filename=video.mp4`), then the URL's own last path
 *  segment, percent-decoded. `Content-Type` isn't available client-side, so
 *  the extension-rescue steps that need it are backend-only. */
export function fallbackName(url: string): string {
  try {
    const parsed = new URL(url);
    for (const [key, value] of parsed.searchParams) {
      if (
        FILENAME_QUERY_KEYS.includes(key.toLowerCase()) &&
        value &&
        hasPlausibleExtension(value)
      ) {
        return value;
      }
    }
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Not a parseable absolute URL — fall through to the naive split below.
  }
  const clean = url.split(/[?#]/)[0];
  return clean.split("/").pop() || "download";
}

export function pctOf(item: DownloadItem): number | null {
  if (!item.total || item.total <= 0) return null;
  return Math.min(100, (item.downloaded / item.total) * 100);
}

/** Shortens to at most `max` chars, ellipsis in the middle so the extension stays visible. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(s.length - (max - 1 - half))}`;
}

/** A completed download whose file is still on disk has nothing to resume.
 *  `missing` rows stay resumable on purpose — that's the redownload path. */
export function isResumable(item: DownloadItem): boolean {
  if (item.state === "completed" && !item.missing) return false;
  return (
    !!item.missing ||
    !!item.fromHistory ||
    !!item.awaitingCapture ||
    ["paused", "error", "canceled"].includes(item.state)
  );
}

/** A "resume" that can't continue from a resume sidecar restarts from byte
 *  zero instead — `resumeMany` (useDownloads.ts) clears path/downloaded/total
 *  for exactly these rows. The UI calls this action "Redownload" instead of
 *  "Resume" so it doesn't imply the download picks up where it left off.
 *  `awaitingCapture` deliberately isn't included here: that path reopens the
 *  browser page to retry credential capture, not a plain restart. */
export function isRedownload(item: DownloadItem): boolean {
  return !!item.missing || !!item.fromHistory;
}

export function statusClass(item: DownloadItem): string {
  if (item.awaitingCapture) return "queued";
  return item.missing ? "missing" : item.state;
}

export function statusLabel(item: DownloadItem): string {
  if (item.awaitingCapture) return "Waiting for browser";
  return item.missing ? "Moved / deleted" : STATE_LABEL[item.state];
}

/** Sort rank for the Status column — mirrors the same `awaitingCapture` →
 *  `missing` → `state` precedence `statusClass`/`statusLabel` use, so the
 *  sort order always agrees with what's actually rendered in the cell. */
export function statusRank(item: DownloadItem): number {
  if (item.awaitingCapture) return DISPLAY_STATUS_RANK.awaitingCapture;
  if (item.missing) return DISPLAY_STATUS_RANK.missing;
  return DISPLAY_STATUS_RANK[item.state];
}
