import { useEffect, useState, type ReactElement } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/* Minimal inline icons — no emoji, stroke = currentColor. */
export function Icon({ name }: { name: string }) {
  const glyphs: Record<string, ReactElement> = {
    add: <path d="M9 2.5v13M2.5 9h13" />,
    resume: <path d="M4.5 3l10 6-10 6z" fill="currentColor" stroke="none" />,
    pause: (
      <>
        <rect x="4" y="3" width="3.5" height="12" fill="currentColor" stroke="none" />
        <rect x="10.5" y="3" width="3.5" height="12" fill="currentColor" stroke="none" />
      </>
    ),
    cancel: <path d="M4 4l10 10M14 4L4 14" />,
    trash: <path d="M3 5h12M7.5 5V3h3v2M5 5l.8 10h6.4L13 5" />,
    settings: (
      <>
        <path d="M2 5.5h7M13 5.5h3M2 12.5h3M9 12.5h7" />
        <circle cx="11" cy="5.5" r="2" fill="var(--surface)" />
        <circle cx="7" cy="12.5" r="2" fill="var(--surface)" />
      </>
    ),
    refresh: <path d="M14.5 9a5.5 5.5 0 1 1-1.7-3.97M14.5 2.5v4h-4" />,
    puzzle: (
      <>
        <rect x="3.5" y="3.5" width="11" height="11" />
        <circle cx="14.5" cy="9" r="2" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="9" r="2" fill="var(--surface)" stroke="none" />
      </>
    ),
    winmin: <path d="M3 9h12" />,
    winmax: <rect x="3.5" y="3.5" width="11" height="11" />,
    winrestore: (
      <>
        <rect x="5" y="5" width="9" height="9" />
        <path d="M5 5V3.5h9V12" />
      </>
    ),
    winclose: <path d="M4 4l10 10M14 4L4 14" />,
  };
  return (
    <svg
      viewBox="0 0 18 18"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphs[name]}
    </svg>
  );
}

/* Custom title-bar window controls. `variant="full"` = min/max/close (main window),
   `variant="close"` = close only (the reusable Add window, whose close just hides it). */
export function WindowControls({ variant }: { variant: "full" | "close" }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (variant !== "full") return;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [variant]);

  const win = getCurrentWindow();
  return (
    <div className="win-controls">
      {variant === "full" && (
        <>
          <button
            className="win-btn"
            title="Minimize"
            aria-label="Minimize"
            onClick={() => win.minimize()}
          >
            <Icon name="winmin" />
          </button>
          <button
            className="win-btn"
            title={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => win.toggleMaximize()}
          >
            <Icon name={maximized ? "winrestore" : "winmax"} />
          </button>
        </>
      )}
      <button
        className="win-btn win-close"
        title="Close"
        aria-label="Close"
        onClick={() => win.close()}
      >
        <Icon name="winclose" />
      </button>
    </div>
  );
}

/** Whether `target` is something the user can type into — inputs get to keep
 *  their native key handling (Backspace, Ctrl+C/V/X, etc). */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest('input, textarea, [contenteditable="true"]');
}

const BLOCKED_FUNCTION_KEYS = new Set(["F1", "F3", "F5", "F6", "F7", "F11", "F12"]);
// Browser-chrome accelerators with no meaning in a download manager: find,
// history, downloads-list, focus-address-bar, new-window/tab, open, print,
// save-as, view-source, close-tab, bookmark, search-page, minimize, favorites.
const BLOCKED_CTRL_LETTERS = new Set([
  "f", "g", "h", "j", "k", "l", "n", "o", "p", "r", "s", "t", "u", "w", "d", "e", "b", "i", "m",
]);
const BLOCKED_CTRL_SHIFT_LETTERS = new Set(["i", "j", "c", "k"]); // devtools variants
const ZOOM_KEYS = new Set(["=", "-", "+", "_", "0"]);

/** Suppresses the browser-isms WebView2 still exposes even with the
 *  host-level hardening applied in Rust (`harden_webview` in lib.rs) —
 *  find-in-page, reload, print, zoom, history navigation, the default context
 *  menu, ctrl-scroll zoom, and drag-and-drop navigation. Defense-in-depth on
 *  Windows; the only protection at all on other targets. */
export function useNativeShell() {
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (isEditable(e.target)) return;
      e.preventDefault();
    }

    // Capture phase: runs before any app-level key handler (e.g. App.tsx's
    // own keydown effect for Ctrl+A/Escape/Delete), but doesn't stop it —
    // only preventDefault() to kill the browser's default action.
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lower = key.toLowerCase();

      if (BLOCKED_FUNCTION_KEYS.has(key)) {
        e.preventDefault();
        return;
      }
      if (mod && e.shiftKey && BLOCKED_CTRL_SHIFT_LETTERS.has(lower)) {
        e.preventDefault();
        return;
      }
      if (mod && !e.shiftKey && BLOCKED_CTRL_LETTERS.has(lower)) {
        e.preventDefault();
        return;
      }
      if (mod && ZOOM_KEYS.has(key)) {
        e.preventDefault();
        return;
      }
      if (e.altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        e.preventDefault();
        return;
      }
      if (key === "Backspace" && !isEditable(e.target)) {
        e.preventDefault();
      }
    }

    function onWheel(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
    }
    function onAuxClick(e: MouseEvent) {
      e.preventDefault();
    }

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("auxclick", onAuxClick);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("auxclick", onAuxClick);
    };
  }, []);
}
