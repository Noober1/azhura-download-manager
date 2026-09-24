import { useEffect, useRef, type RefObject } from "react";
import { commands } from "../bindings";
import type { DownloadItem, TrayDownload } from "../types";
import { formatSpeed, pctOf, truncate } from "../format";

/** Pushes a live download list into the tray's dropdown roughly once a
 *  second — far coarser than the ~7/sec progress patches, and skipped
 *  entirely when nothing actually changed since the last push. `locked`
 *  (the PIN lock) doesn't stop this loop — Rust itself drops the push while
 *  locked (see `tray.rs`'s `update_tray_downloads`) so it never leaks a
 *  filename into the tray — but the dedupe ref needs resetting on unlock,
 *  otherwise the first post-unlock push would be skipped as "unchanged"
 *  even though Rust never actually applied the last one it saw. */
export function useTrayPush(downloadsRef: RefObject<DownloadItem[]>, locked: boolean) {
  const lastTraySentRef = useRef<string | null>(null);
  // Guards against piling up pushes if one command outlives the 1s interval.
  const traySendingRef = useRef(false);

  useEffect(() => {
    lastTraySentRef.current = null;
  }, [locked]);

  useEffect(() => {
    const t = setInterval(() => {
      const active = downloadsRef.current.filter(
        (d) => d.state === "downloading" || d.state === "verifying",
      );
      const shown = active.slice(0, 10);
      const items: TrayDownload[] = shown.map((d) => {
        const pct = pctOf(d);
        const pctLabel = pct !== null ? `${pct.toFixed(0)}%` : "—";
        const speedLabel = d.state === "downloading" ? formatSpeed(d.speed) : "verifying";
        return { id: d.id, label: `${truncate(d.filename, 38)} · ${pctLabel} · ${speedLabel}` };
      });
      if (active.length > shown.length) {
        items.push({ id: "more", label: `…and ${active.length - shown.length} more` });
      }
      const totalActiveSpeed = active
        .filter((d) => d.state === "downloading")
        .reduce((s, d) => s + d.speed, 0);
      const tooltip = active.length
        ? `Azhura Download Manager — ${active.length} active · ${formatSpeed(totalActiveSpeed)}`
        : "Azhura Download Manager";

      // Only record the payload as delivered once the command actually
      // succeeded. Marking it up front would strand a failed push whenever
      // the payload is stable — notably the idle `{items: [], …}` one, which
      // never changes again, leaving the tray listing finished downloads.
      const payload = JSON.stringify({ items, tooltip });
      if (payload === lastTraySentRef.current || traySendingRef.current) return;
      traySendingRef.current = true;
      commands
        .updateTrayDownloads(items, tooltip)
        .then(() => {
          lastTraySentRef.current = payload;
        })
        .catch(() => {
          /* leave the ref alone so the next tick retries */
        })
        .finally(() => {
          traySendingRef.current = false;
        });
    }, 1000);
    return () => clearInterval(t);
  }, [downloadsRef]);
}
