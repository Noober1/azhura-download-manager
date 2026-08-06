import type { DownloadItem, HistoryEntry } from "./types";
import { DEFAULT_PROXY } from "./types";
import { CREDENTIAL_HEADERS, TERMINAL_STATES } from "./constants";

export function toHistoryEntry(d: DownloadItem): HistoryEntry {
  const headers = d.headers.filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase()));
  return {
    id: d.id,
    url: d.url,
    headers,
    allowInsecure: d.allowInsecure,
    checksum: d.checksum,
    speedLimit: d.speedLimit,
    filename: d.filename,
    filenameOverride: d.filenameOverride,
    path: d.path,
    savePath: d.savePath,
    proxy: { ...d.proxy, password: "" },
    total: d.total,
    downloaded: d.downloaded,
    connections: d.connections,
    usedConnections: d.usedConnections,
    state: d.state,
    error: d.error ?? null,
    referer: d.referer ?? headers.find(([k]) => k.toLowerCase() === "referer")?.[1] ?? "",
    // Dropping a credential header means a redownload can't just replay this
    // request — it has to wait for the extension to capture a fresh one.
    needsAuth: d.needsAuth || headers.length !== d.headers.length,
    finishedAt: d.finishedAt ?? 0,
    addedAt: d.addedAt,
  };
}

export function fromHistoryEntry(e: HistoryEntry): DownloadItem {
  return {
    id: e.id,
    url: e.url,
    headers: e.headers,
    connections: e.connections,
    allowInsecure: e.allowInsecure,
    checksum: e.checksum,
    speedLimit: e.speedLimit,
    filename: e.filename,
    filenameOverride: e.filenameOverride,
    path: e.path,
    savePath: e.savePath,
    proxy: e.proxy ?? DEFAULT_PROXY,
    total: e.total,
    downloaded: e.downloaded,
    speed: 0,
    usedConnections: e.usedConnections,
    numPieces: 0,
    pieceSize: 0,
    conns: [],
    state: e.state,
    error: e.error ?? undefined,
    missing: e.missing,
    fromHistory: true,
    referer: e.referer,
    needsAuth: e.needsAuth,
    finishedAt: e.finishedAt,
    addedAt: e.addedAt || e.finishedAt || Date.now(),
  };
}

/** Rows worth persisting to history.json: terminal states only. */
export function historyPayload(items: DownloadItem[]): HistoryEntry[] {
  return items
    .filter((d) => (TERMINAL_STATES as readonly string[]).includes(d.state))
    .map(toHistoryEntry);
}
