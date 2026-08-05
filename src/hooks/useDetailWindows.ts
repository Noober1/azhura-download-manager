import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { DetailAction, DownloadItem } from "../types";

/** Owns every open "Download Details" popup window: which ids are open, and
 *  keeping each one's snapshot in sync with its targeted row. Action buttons
 *  in the popup emit back here rather than calling pause/cancel/resume
 *  directly, since `main` owns all download state. */
export function useDetailWindows(
  downloads: DownloadItem[],
  downloadsRef: RefObject<DownloadItem[]>,
  pauseMany: (items: DownloadItem[]) => void,
  cancelMany: (items: DownloadItem[]) => void,
  resumeMany: (items: DownloadItem[]) => void,
) {
  // Ids of every open "Download Details" popup. Main keeps pushing snapshots
  // to each one as long as its id is in this set.
  const [detailIds, setDetailIds] = useState<Set<string>>(new Set());
  const lastDetailSentRef = useRef<Map<string, string>>(new Map());

  // Opens (or reveals) a "Download Details" popup for `id` — a double-click,
  // a context-menu action, or the tray's per-download menu item all funnel
  // through here. The popup hands itself back via `detail-ready` once its own
  // React tree has mounted; that's what actually seeds and shows it (below),
  // so there's no race with the window-creation round-trip.
  function openDetail(id: string) {
    invoke("open_detail_window", { id }).catch(() => {});
  }

  // A popup announces itself once it's mounted and ready for its first
  // snapshot. Track it, push the current snapshot, then reveal the window —
  // ordering it this way means the popup never shows an empty state first.
  useEffect(() => {
    const unlisten = listen<string>("detail-ready", async (e) => {
      const id = e.payload;
      setDetailIds((prev) => new Set(prev).add(id));
      const item = downloadsRef.current.find((d) => d.id === id) ?? null;
      lastDetailSentRef.current.set(id, JSON.stringify(item));
      await emitTo(`detail-${id}`, "detail-data", item).catch(() => {});
      invoke("show_detail_window", { id }).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps every open detail popup's snapshot in sync with its targeted row.
  // A `null` payload tells it the row was removed. Skips a popup whose
  // snapshot hasn't actually changed, so N open popups don't each eat a push
  // on every one of the ~7/sec progress patches.
  useEffect(() => {
    if (detailIds.size === 0) return;
    detailIds.forEach((id) => {
      const item = downloads.find((d) => d.id === id) ?? null;
      const json = JSON.stringify(item);
      if (lastDetailSentRef.current.get(id) === json) return;
      lastDetailSentRef.current.set(id, json);
      emitTo(`detail-${id}`, "detail-data", item).catch(() => {});
    });
  }, [downloads, detailIds]);

  useEffect(() => {
    const unlisten = listen<string>("detail-closed", (e) => {
      const id = e.payload;
      setDetailIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      lastDetailSentRef.current.delete(id);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Clicking a download entry in the tray's menu restores main and opens
  // detail for that row. The "…and N more" sentinel has no real download
  // behind it, so it's ignored here — the tray click handler already
  // restored the window.
  useEffect(() => {
    const unlisten = listen<string>("tray-open-detail", (e) => {
      if (e.payload === "more") return;
      openDetail(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Action buttons in the detail popup emit here rather than calling
  // pause/cancel/resume commands directly, since main owns all download state.
  useEffect(() => {
    const unlisten = listen<DetailAction>("detail-action", (e) => {
      const item = downloadsRef.current.find((d) => d.id === e.payload.id);
      if (!item) return;
      if (e.payload.action === "pause") pauseMany([item]);
      else if (e.payload.action === "cancel") cancelMany([item]);
      else if (e.payload.action === "resume") resumeMany([item]);
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { openDetail };
}
