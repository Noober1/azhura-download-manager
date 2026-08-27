import { useEffect } from "react";
import type { DownloadItem } from "../types";

/** Keeps at most `maxConcurrent` downloads active, promoting queued rows into
 *  running ones as slots free up. `held` (from `useQueueSchedule`) suspends
 *  that promotion entirely while a scheduled start time is still pending. */
export function useScheduler(
  downloads: DownloadItem[],
  maxConcurrent: number,
  startRun: (item: DownloadItem) => void,
  held = false,
) {
  useEffect(() => {
    if (held) return;
    const active = downloads.filter(
      (d) => d.state === "downloading" || d.state === "verifying",
    ).length;
    const slots = maxConcurrent - active;
    if (slots <= 0) return;
    downloads
      .filter((d) => d.state === "queued" && !d.retryPending)
      .slice(0, slots)
      .forEach((item) => startRun(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads, maxConcurrent, held]);
}
