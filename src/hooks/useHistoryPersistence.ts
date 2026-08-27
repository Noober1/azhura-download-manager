import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import type { DownloadItem, HistoryEntry } from "../types";
import { DEFAULT_PROXY } from "../types";
import { isInsecureHttp } from "../format";
import { fromHistoryEntry, historyPayload } from "../history";

/** Restores a previous session on mount (unfinished downloads from their
 *  resume sidecars, finished ones from history.json) and persists finished
 *  downloads back, debounced — plus an immediate flush when the tray's Quit
 *  gives the app a short grace period before exiting. */
export function useHistoryPersistence(
  downloads: DownloadItem[],
  setDownloads: Dispatch<SetStateAction<DownloadItem[]>>,
  downloadsRef: RefObject<DownloadItem[]>,
  retentionDays: number,
) {
  // Stays false until the history file has been read, so the save effect can't
  // fire against the empty initial state and wipe the file before the load
  // lands. Refs (not state) because they must survive StrictMode's remount.
  const historyReadyRef = useRef(false);
  const lastSavedHistoryRef = useRef<string | null>(null);

  // Restore a previous session: unfinished downloads from their resume
  // sidecars, plus finished ones from the persisted history. Loaded together
  // so the merge happens in a single state update — a row whose sidecar is
  // still live must win over its history copy, since only the sidecar can
  // actually be resumed.
  useEffect(() => {
    Promise.all([commands.loadHistory(), commands.listResumable()])
      .then(([history, items]) => {
        const resumable: DownloadItem[] = items.map((it) => ({
          id: crypto.randomUUID(),
          url: it.url,
          headers: [],
          connections: it.connections,
          allowInsecure: isInsecureHttp(it.url),
          checksum: "",
          speedLimit: 0,
          filename: it.filename,
          filenameOverride: "",
          path: it.path,
          savePath: it.savePath ?? "",
          proxy: DEFAULT_PROXY,
          total: it.total,
          downloaded: it.downloaded,
          speed: 0,
          usedConnections: it.connections,
          numPieces: 0,
          pieceSize: 0,
          conns: [],
          state: "paused",
          addedAt: it.addedAt ?? Date.now(),
        }));

        const livePaths = new Set(resumable.map((r) => r.path));
        const restoredHistory: DownloadItem[] = history.entries
          .filter((e) => !e.path || !livePaths.has(e.path))
          // The generated binding types `state` as plain `string` (specta
          // doesn't know it's really a DlState union) — the value itself is
          // still always one of those literals, so this narrows the type
          // without touching the data.
          .map((e) => fromHistoryEntry(e as unknown as HistoryEntry));

        setDownloads((prev) => {
          // Rows can be added while these promises are in flight (a cold-start
          // deep link the user confirms quickly), so merge into `prev` rather
          // than replacing it.
          const knownPaths = new Set(prev.map((d) => d.path).filter(Boolean));
          const knownIds = new Set(prev.map((d) => d.id));
          return [
            // Resumable ids are regenerated every launch, so they can only be
            // deduped by path; history ids are stable and its path may be "".
            ...resumable.filter((r) => !knownPaths.has(r.path)),
            ...restoredHistory.filter(
              (h) => !knownIds.has(h.id) && (!h.path || !knownPaths.has(h.path)),
            ),
            ...prev,
          ];
        });

        // Seed the dirty check with what's already on disk, using the same
        // mapper the save effect uses so field-shape differences can't look
        // like a change. A file we couldn't parse leaves the gate shut, so a
        // read failure never cascades into overwriting the survivors.
        lastSavedHistoryRef.current = JSON.stringify(historyPayload(restoredHistory));
        historyReadyRef.current = history.readable;
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop history rows past the retention window. Done here rather than in
  // Rust's `save_history` because that only prunes the *file* — the list on
  // screen would keep showing rows the next restart silently dropped. Pruning
  // state instead makes both agree, since the save effect below derives the
  // file from this same list.
  useEffect(() => {
    if (retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    setDownloads((ds) =>
      ds.filter(
        (d) =>
          // `fromHistory` so a live row is never swept, and `finishedAt > 0`
          // because `toHistoryEntry` writes `?? 0` for rows that predate that
          // field — reading those as infinitely old would delete the user's
          // oldest history for a schema gap.
          !(d.fromHistory && (d.finishedAt ?? 0) > 0 && (d.finishedAt ?? 0) < cutoff),
      ),
    );
    // Keyed on `downloads.length`, NOT `downloads`: `.filter()` returns a new
    // array every run, so depending on the array itself would loop forever.
    // Length is stable when nothing was pruned, and still changes when rows
    // are restored at launch or added later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retentionDays, downloads.length]);

  // Persist finished downloads. Debounced because `downloads` churns ~7x/sec
  // per active download from progress events; the debounce also collapses
  // bursts of terminal transitions into one write, so two saves can't be
  // in flight at once and land out of order.
  useEffect(() => {
    if (!historyReadyRef.current) return;
    const entries = historyPayload(downloads);
    const json = JSON.stringify(entries);
    if (json === lastSavedHistoryRef.current) return;
    const t = setTimeout(() => {
      lastSavedHistoryRef.current = json;
      commands.saveHistory(entries).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [downloads]);

  // The tray's Quit gives the app a short grace period before exiting, which
  // the debounce above would otherwise swallow — flush immediately instead.
  useEffect(() => {
    const un = listen("app-quitting", () => {
      if (!historyReadyRef.current) return;
      const entries = historyPayload(downloadsRef.current);
      lastSavedHistoryRef.current = JSON.stringify(entries);
      commands.saveHistory(entries).catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
