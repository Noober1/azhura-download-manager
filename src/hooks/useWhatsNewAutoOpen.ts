import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../bindings";
import { loadSeenVersion, saveSeenVersion, shouldShowWhatsNew } from "../whatsNew";

/** Opens the What's New window once per session when the running version isn't the one the user last saw.
 *
 *  Waits for `locked` to clear: `useAppLock` reports locked until its first reply, and the Rust command
 *  silently no-ops while locked — opening early would mark the version seen with nothing shown. If the app
 *  autostarted hidden in the tray, waits for the first focus instead of popping a window nobody asked for. */
export function useWhatsNewAutoOpen(version: string, locked: boolean): void {
  const opened = useRef(false);

  useEffect(() => {
    if (locked || opened.current || !shouldShowWhatsNew(loadSeenVersion(), version)) return;

    let cancelled = false;
    let unlisten: Promise<() => void> | undefined;

    function open() {
      if (cancelled || opened.current) return;
      opened.current = true;
      commands
        .openWhatsNewWindow()
        .then(() => saveSeenVersion(version))
        .catch(() => {});
    }

    const win = getCurrentWindow();
    // `isVisible` failing counts as visible, same choice as `useUpdateCheck`.
    win
      .isVisible()
      .catch(() => true)
      .then((visible) => {
        if (cancelled) return;
        if (visible) {
          open();
          return;
        }
        unlisten = win.onFocusChanged(({ payload: focused }) => {
          if (focused) open();
        });
      });

    return () => {
      cancelled = true;
      unlisten?.then((f) => f());
    };
  }, [version, locked]);
}
