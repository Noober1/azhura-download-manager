export const TERMINAL_STATES = ["completed", "error", "canceled"] as const;
/** Sent by the browser extension; re-captured on demand rather than stored. */
export const CREDENTIAL_HEADERS = ["cookie", "authorization", "proxy-authorization"];

export type SortKey = "name" | "added" | "status" | "size" | "downloaded" | "pct" | "speed";

/** Sort order for the Status column, keyed by *displayed* status (see
 *  `format.ts`'s `statusRank`) rather than raw `DlState` — a `missing` or
 *  `awaitingCapture` row shows a different label than its underlying state,
 *  and the sort must agree with what's on screen. What needs attention
 *  floats to the top. */
export const DISPLAY_STATUS_RANK = {
  downloading: 0,
  verifying: 1,
  queued: 2,
  awaitingCapture: 3,
  paused: 4,
  error: 5,
  missing: 6,
  canceled: 7,
  completed: 8,
} as const;

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
