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
  /** Set by Rust (see `auto_rules.rs`) when an auto rule matched this
   *  capture — the rule's pattern, shown in the "auto rule matched" toast. */
  autoRule?: string;
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
  /** Recent speed samples for the detail window's sparkline, newest last —
   *  sampled at a slower rate than progress events arrive at (see
   *  `useDownloads`). Session-only: `toHistoryEntry`/`fromHistoryEntry` in
   *  `history.ts` are an explicit field allowlist that doesn't mention this
   *  field, so it can never round-trip through history.json — no exclusion
   *  needed there. */
  speedHistory?: number[];
  /** Fill level (0..=255) of each equal-sized slice of the file for the
   *  detail window's per-piece progress map — empty for a single-connection
   *  download. Session-only, same as `speedHistory` above. */
  pieceMap?: number[];
  /** Highest `speed` seen so far this run, updated on every progress tick
   *  (not just the throttled ticks `speedHistory` samples on) so a brief
   *  spike between two samples still counts. Session-only, same as
   *  `speedHistory` above. */
  peakSpeed?: number;
  /** Consecutive automatic retries so far this failure streak. Deliberately
   *  does NOT reset on a fresh "started" event (see useDownloads.ts's
   *  comment: a download that starts fine but keeps dying mid-transfer must
   *  still hit the cap). Only reset on a real completion or a manual
   *  user-initiated resume. Session-only, same non-persistence reasoning as
   *  `speedHistory`. */
  retryCount?: number;
  /** True only during the backoff delay between a failed attempt and the
   *  next automatic retry — `state` is "queued" the whole time (see
   *  useScheduler's guard) so every part of the app that already treats
   *  "queued" as active keeps working unmodified; this flag only changes
   *  what's *displayed* (mirrors `awaitingCapture`'s exact pattern in
   *  format.ts). */
  retryPending?: boolean;
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
