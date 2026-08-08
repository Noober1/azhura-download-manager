import type { FileCategory } from "./categories";
export type {
  AppSettings,
  ConnInfo,
  DownloadEvent,
  Prefs,
  ProxyConfig,
  ResumableInfo,
  TrayDownload,
} from "./bindings";
import type { ConnInfo, ProxyConfig } from "./bindings";

export type ProxyScheme = "http" | "https" | "socks5h";

export const DEFAULT_PROXY: ProxyConfig = {
  enabled: false,
  scheme: "http",
  host: "",
  port: 0,
  username: "",
  password: "",
};

export type AddPayload = {
  url: string;
  allowInsecure: boolean;
  headers: [string, string][];
  connections: number;
  checksum: string;
  speedLimit: number; // bytes/sec, 0 = off
  later: boolean;
  filename: string; // "" = derive from server / URL
  savePath: string; // "" = default downloads folder
  proxy: ProxyConfig;
};

export type DlState =
  | "queued"
  | "downloading"
  | "verifying"
  | "paused"
  | "completed"
  | "error"
  | "canceled";

export type DownloadItem = {
  id: string;
  url: string;
  headers: [string, string][];
  connections: number;
  allowInsecure: boolean;
  checksum: string;
  speedLimit: number;
  filename: string;
  /** "" = no user override; let the backend derive it from the server/URL. */
  filenameOverride: string;
  path: string;
  savePath: string;
  proxy: ProxyConfig;
  total: number | null;
  downloaded: number;
  speed: number;
  usedConnections: number;
  numPieces: number;
  /** Size of one piece in bytes, from the `started` event; 0 = single-stream (no pieces). */
  pieceSize: number;
  conns: ConnInfo[];
  state: DlState;
  error?: string;
  /** File is no longer at `path`. Recomputed from disk on every load, never persisted. */
  missing?: boolean;
  /** Restored from history, so it has no resume sidecar — resuming must restart it. */
  fromHistory?: boolean;
  /** Waiting for the extension to re-capture credentials before it can run. */
  awaitingCapture?: boolean;
  /** Page the download came from; used to reopen it when re-capturing credentials. */
  referer?: string;
  /** Credential headers were stripped before persisting, so a redownload needs re-capture. */
  needsAuth?: boolean;
  finishedAt?: number;
  /** Timestamp the current run started; used for the detail popup's elapsed-time readout. */
  startedAt?: number;
  /** When this row first entered the list — drives the "Date Added" column and default sort. */
  addedAt: number;
};

/** Emitted by the detail popup when the user clicks an action button there. */
export type DetailAction = { id: string; action: "pause" | "resume" | "cancel" };

/** Emitted by the Rust backend for one-off warnings with no dedicated event
 *  of their own (e.g. a failed legacy-folder migration) — see `useBackendWarnings`. */
export type BackendWarning = { message: string; level: "error" | "info" };

export type Category = "all" | "active" | "finished" | FileCategory;

export type Theme = "system" | "dark" | "light";

/** One persisted finished download. `state` is always the real terminal state —
 *  `missing` is derived from disk by the backend on load and never written.
 *
 *  Hand-written rather than re-exported from bindings.ts: Rust's
 *  `#[serde(skip_deserializing)] missing: bool` makes specta generate
 *  asymmetric HistoryEntry_Serialize/_Deserialize variants (one requires
 *  `missing`, the other omits it and marks everything optional), but the
 *  frontend only ever needs one shape — both toHistoryEntry's output and
 *  fromHistoryEntry's input (history.ts) are always fully populated. */
export type HistoryEntry = {
  id: string;
  url: string;
  headers: [string, string][];
  allowInsecure: boolean;
  checksum: string;
  speedLimit: number;
  filename: string;
  filenameOverride: string;
  path: string;
  savePath: string;
  proxy: ProxyConfig;
  total: number | null;
  downloaded: number;
  connections: number;
  usedConnections: number;
  state: DlState;
  error: string | null;
  referer: string;
  needsAuth: boolean;
  finishedAt: number;
  addedAt: number;
  missing?: boolean;
};

export type HistoryLoad = { entries: HistoryEntry[]; readable: boolean };

export const STATE_LABEL: Record<DlState, string> = {
  queued: "Queued",
  downloading: "Downloading",
  verifying: "Verifying",
  paused: "Paused",
  completed: "Complete",
  error: "Error",
  canceled: "Canceled",
};
