import type { DownloadItem } from "./types";
import { statusLabel } from "./format";

const HEADER = ["Name", "Status", "Size (bytes)", "URL", "Referer", "Saved to", "Added", "Finished", "Error"];

/** RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would
 *  evaluate as a formula (CSV injection — filenames/URLs are remote-controlled). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function iso(ms: number | undefined): string {
  return ms && ms > 0 ? new Date(ms).toISOString() : "";
}

/** BOM-prefixed so Excel opens it as UTF-8; CRLF per RFC 4180. */
export function historyToCsv(items: DownloadItem[]): string {
  const rows = items.map((d) => [
    d.filename, statusLabel(d), d.total != null ? String(d.total) : "", d.url, d.referer ?? "",
    d.path, iso(d.addedAt), iso(d.finishedAt), d.error ?? "",
  ]);
  return "﻿" + [HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** `azhura-<kind>-YYYY-MM-DD.<ext>` in local time. */
export function exportFileName(kind: string, ext: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `azhura-${kind}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.${ext}`;
}
