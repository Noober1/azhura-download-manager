import type { DlState } from "./types";

export const TERMINAL_STATES = ["completed", "error", "canceled"] as const;
/** Sent by the browser extension; re-captured on demand rather than stored. */
export const CREDENTIAL_HEADERS = ["cookie", "authorization", "proxy-authorization"];

export type SortKey = "name" | "added" | "status" | "size" | "downloaded" | "pct" | "speed";
/** Sort order for the Status column: what needs attention floats to the top. */
export const STATUS_RANK: Record<DlState, number> = {
  downloading: 0,
  verifying: 1,
  queued: 2,
  paused: 3,
  error: 4,
  canceled: 5,
  completed: 6,
};

/** Presets offered in the context menu's "Speed cap" submenu, in bytes/sec. */
export const SPEED_PRESETS: { label: string; bytes: number }[] = [
  { label: "Unlimited", bytes: 0 },
  { label: "128 KB/s", bytes: 128 * 1024 },
  { label: "256 KB/s", bytes: 256 * 1024 },
  { label: "512 KB/s", bytes: 512 * 1024 },
  { label: "1 MB/s", bytes: 1 * 1024 * 1024 },
  { label: "2 MB/s", bytes: 2 * 1024 * 1024 },
  { label: "5 MB/s", bytes: 5 * 1024 * 1024 },
  { label: "10 MB/s", bytes: 10 * 1024 * 1024 },
];
export const CONNECTION_PRESETS = [1, 2, 4, 8, 16];
