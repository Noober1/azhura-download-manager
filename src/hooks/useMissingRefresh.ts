import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../bindings";
import type { DownloadItem } from "../types";
import { isEditable } from "../ui";

/** Re-checks whether each finished row's file is still on disk. `missing` is
 *  otherwise only computed once, at history load — this is what keeps it
 *  live without a polling timer: it re-checks on F5, on the main window
 *  regaining OS focus, and whenever the caller's Refresh button fires
 *  `refresh()` directly. */
export function useMissingRefresh(
  downloadsRef: RefObject<DownloadItem[]>,
  patchItem: (id: string, patch: Partial<DownloadItem>) => void,
) {
  const refreshingRef = useRef(false);

  function refresh() {
    if (refreshingRef.current) return;
    const candidates = downloadsRef.current.filter(
      (d) => ["completed", "error", "canceled"].includes(d.state) && !!d.path,
    );
    if (candidates.length === 0) return;
    refreshingRef.current = true;
    commands
      .checkPathsMissing(candidates.map((d) => d.path))
      .then((missing) => {
        candidates.forEach((d, i) => {
          if (!!d.missing !== missing[i]) patchItem(d.id, { missing: missing[i] });
        });
      })
      .catch(() => {})
      .finally(() => {
        refreshingRef.current = false;
      });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "F5" || isEditable(e.target)) return;
      refresh();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadsRef, patchItem]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) refresh();
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadsRef, patchItem]);

  return { refresh };
}
