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
};

export type ConnInfo = { downloaded: number; total: number; pieces: number };

export type DownloadEvent =
  | {
      event: "started";
      data: {
        filename: string;
        path: string;
        total: number | null;
        connections: number;
        pieceSize: number;
        numPieces: number;
      };
    }
  | {
      event: "progress";
      data: { downloaded: number; total: number | null; speedBps: number; connections: ConnInfo[] };
    }
  | { event: "paused"; data: { downloaded: number } }
  | { event: "canceled"; data: { downloaded: number } }
  | { event: "verifying" }
  | { event: "finished"; data: { path: string; filename: string } }
  | { event: "error"; data: { message: string } };

export type ResumableInfo = {
  path: string;
  url: string;
  filename: string;
  total: number;
  connections: number;
  downloaded: number;
  savePath: string | null;
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
};

/** One row in the tray's dropdown menu — Rust just renders the label verbatim. */
export type TrayDownload = { id: string; label: string };

/** Emitted by the detail popup when the user clicks an action button there. */
export type DetailAction = { id: string; action: "pause" | "resume" | "cancel" };

export type Category = "all" | "active" | "finished";

export type Theme = "system" | "dark" | "light";

export type AppSettings = {
  maxConcurrent: number;
  globalLimitMbps: number;
  minimizeToTray: boolean;
  theme: Theme;
  notifications: boolean;
};

/** One persisted finished download. `state` is always the real terminal state —
 *  `missing` is derived from disk by the backend on load and never written. */
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
  total: number | null;
  downloaded: number;
  connections: number;
  usedConnections: number;
  state: DlState;
  error: string | null;
  referer: string;
  needsAuth: boolean;
  finishedAt: number;
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
