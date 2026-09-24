import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import type { DownloadItem } from "../types";
import {
  addToDay,
  backfillFromHistory,
  dayKey,
  fromRecords,
  mergeDays,
  observeDownloads,
  toRecords,
  type SeenRow,
  type StatsDays,
} from "../stats";

const STATS_TICK_MS = 1000;
const STATS_SAVE_INTERVAL_MS = 15000;

/** Owns the dashboard's per-day stats: loads/backfills once, records byte and
 *  active-time deltas from `downloads` as they happen, and persists to
 *  `stats.json` periodically plus on quit. Mirrors `useHistoryPersistence`'s
 *  ready-gate/flush shape — see the Batch 4b plan for the full design. */
export function useStats(
  downloads: DownloadItem[],
  totalSpeed: number,
): { days: StatsDays; reset: () => void } {
  const daysRef = useRef<StatsDays>({});
  const loadedRef = useRef(false);
  const saveDirtyRef = useRef(false);
  const viewDirtyRef = useRef(false);
  const lastSaveRef = useRef(0);
  const seenRef = useRef<Map<string, SeenRow>>(new Map());
  const totalSpeedRef = useRef(totalSpeed);
  const anyDownloadingRef = useRef(false);

  const [days, setDays] = useState<StatsDays>({});

  function bump(
    patch: Partial<{
      bytes: number;
      activeMs: number;
      completed: number;
      errored: number;
      canceled: number;
      peakBps: number;
    }>,
  ) {
    daysRef.current = addToDay(daysRef.current, dayKey(Date.now()), patch);
    saveDirtyRef.current = true;
    viewDirtyRef.current = true;
  }

  function flush() {
    if (!loadedRef.current) return;
    commands.saveStats(toRecords(daysRef.current)).catch(() => {});
    lastSaveRef.current = Date.now();
    saveDirtyRef.current = false;
  }

  // Load (or backfill) once on mount. Leaving `loadedRef` false on failure
  // means this session never saves, so a read failure can't wipe the file.
  useEffect(() => {
    (async () => {
      try {
        const r = await commands.loadStats();
        let base: StatsDays;
        if (r.existed) {
          base = fromRecords(r.days);
        } else {
          const history = await commands.loadHistory();
          base = backfillFromHistory(history.entries);
          saveDirtyRef.current = true;
        }
        // Keeps anything recorded (via `bump`) before this load resolved.
        daysRef.current = mergeDays(base, daysRef.current);
        loadedRef.current = true;
        setDays(daysRef.current);
        if (saveDirtyRef.current) flush();
      } catch {
        // Leave loadedRef false — see the comment above.
      }
    })();
  }, []);

  // Diff `downloads` against the last snapshot and fold the deltas in.
  useEffect(() => {
    const { seen, bytes, completed, errored, canceled } = observeDownloads(seenRef.current, downloads);
    seenRef.current = seen;
    if (bytes || completed || errored || canceled) bump({ bytes, completed, errored, canceled });
    anyDownloadingRef.current = downloads.some((d) => d.state === "downloading");
  }, [downloads]);

  // Kept in a ref (rather than read directly) so the ticker effect below can
  // stay mount-only.
  useEffect(() => {
    totalSpeedRef.current = totalSpeed;
  }, [totalSpeed]);

  useEffect(() => {
    const id = setInterval(() => {
      if (anyDownloadingRef.current) {
        bump({ activeMs: STATS_TICK_MS, peakBps: Math.round(totalSpeedRef.current) });
      }
      if (viewDirtyRef.current) {
        setDays(daysRef.current);
        viewDirtyRef.current = false;
      }
      if (saveDirtyRef.current && Date.now() - lastSaveRef.current >= STATS_SAVE_INTERVAL_MS) {
        flush();
      }
    }, STATS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Flush on the tray's Quit grace period, same as useHistoryPersistence.
  useEffect(() => {
    const un = listen("app-quitting", () => flush());
    return () => {
      un.then((f) => f());
    };
  }, []);

  function reset() {
    daysRef.current = {};
    setDays({});
    saveDirtyRef.current = true;
    flush();
  }

  return { days, reset };
}
