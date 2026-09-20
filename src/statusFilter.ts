import type { DownloadItem } from "./types";
import { statusClass } from "./format";

export type StatusFilter =
  | "all" | "downloading" | "queued" | "paused" | "completed" | "error" | "canceled" | "missing";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "downloading", label: "Downloading" },
  { value: "queued", label: "Queued" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Failed" },
  { value: "canceled", label: "Canceled" },
  { value: "missing", label: "Moved / deleted" },
];

/** Buckets a row the same way the Status cell renders it (`statusClass`),
 *  collapsing display-only variants: verifying → downloading, held → queued
 *  (awaitingCapture/retryPending already map to "queued" in statusClass). */
export function statusBucket(item: DownloadItem): Exclude<StatusFilter, "all"> {
  const c = statusClass(item);
  if (c === "verifying") return "downloading";
  if (c === "held") return "queued";
  return c as Exclude<StatusFilter, "all">;
}

export function matchesStatus(item: DownloadItem, filter: StatusFilter): boolean {
  return filter === "all" || statusBucket(item) === filter;
}
