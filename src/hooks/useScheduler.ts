import { useEffect } from "react";
import type { DownloadItem } from "../types";
import { queueOrder } from "../queueOrder";

/** Keeps at most `maxConcurrent` downloads active, promoting queued rows into
 *  running ones as slots free up — in queue order (see `queueOrder.ts`), FIFO
 *  unless the user reordered them. `held` (from `useQueueSchedule`) suspends
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
    queueOrder(downloads)
      .filter((d) => !d.retryPending)
      .slice(0, slots)
      .forEach((item) => startRun(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads, maxConcurrent, held]);
}
