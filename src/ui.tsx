import { useEffect, useState, type ReactElement } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "motion/react";
import { LAYOUT_SPRING } from "./motion";

/* Minimal inline icons — no emoji, stroke = currentColor. `size` defaults to
   the toolbar's 14px; the empty-state badge is the one caller that scales it
   up. `active` is only consumed by the `panel` glyph (the sidebar toggle) —
   every other name ignores it. */
export function Icon({ name, size = 14, active }: { name: string; size?: number; active?: boolean }) {
  const glyphs: Record<string, ReactElement> = {
    add: <path d="M9 2.5v13M2.5 9h13" />,
    tray: (
      <>
        <path d="M9 2.5v8M5.5 7.5L9 11l3.5-3.5" />
        <path d="M3 11v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
      </>
    ),
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
    // Toolbar filter-menu buttons (FilterMenuButton.tsx) — group-by and
    // status-filter, replacing the wide `<select>`s that used to spell out
    // the current choice in text.
    group: (
      <>
        <path d="M9 3l7 4-7 4-7-4z" />
        <path d="M2 11l7 4 7-4" />
      </>
    ),
    filter: <path d="M3 4h12l-4.5 5.5v4.5l-3 1.5v-6z" />,
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
    // Sidebar category rows (Sidebar.tsx) — the three status buckets, then
    // one per `FileCategory` in categories.ts (kept in the same order as
    // `FILE_CATEGORIES`).
    all: <path d="M3 5.5h12M3 9h12M3 12.5h12" />,
    active: (
      <>
        <path d="M9 3v7.5M5.5 7.5L9 11l3.5-3.5" />
        <path d="M3 14h12" />
      </>
    ),
    finished: <path d="M3.5 9.5l3.5 3.5 7.5-8" />,
    video: (
      <>
        <rect x="2.5" y="4" width="13" height="10" rx="1.5" />
        <path d="M7.5 7.2v3.6l3.5-1.8z" fill="currentColor" stroke="none" />
      </>
    ),
    audio: (
      <>
        <circle cx="6" cy="13" r="2" />
        <path d="M8 13V4l6-1.3V11" />
      </>
    ),
    program: (
      <>
        <rect x="2.5" y="3.5" width="13" height="11" rx="1" />
        <path d="M5.5 7l2 2-2 2M9.5 11h3" />
      </>
    ),
    docs: (
      <>
        <path d="M5 2.5h5l3 3v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
        <path d="M10 2.5V6h3" />
        <path d="M6 9.5h6M6 12h4" />
      </>
    ),
    archive: (
      <>
        <rect x="2.5" y="5" width="13" height="9.5" rx="1" />
        <path d="M2.5 5V3.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V5" />
        <path d="M7.5 8.5h3" />
      </>
    ),
    other: <path d="M5 2.5h5l3 3v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />,
    // Sidebar toggle (Toolbar.tsx) — a window split into a side panel and a
    // main area, the standard "toggle sidebar" pictogram. The panel half
    // fills in and the divider slides over when the sidebar is showing
    // (`active`), so the icon itself previews the state instead of just
    // sitting there while the real sidebar's width animates separately.
    panel: (
      <>
        <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
        {/* Filled left region = the panel itself: grows wider (and fades
            in) as the divider slides right, so the icon reads as the panel
            *filling up to* the divider rather than an unrelated block
            sliding underneath it. Width, not `x`, is what's animated — the
            left edge stays pinned to the frame's inner corner. */}
        <motion.rect
          x="3.3"
          y="4.3"
          height="9.4"
          rx="0.5"
          fill="currentColor"
          stroke="none"
          animate={{ width: active ? 3.2 : 1.2, fillOpacity: active ? 0.9 : 0.5 }}
          transition={LAYOUT_SPRING}
        />
        <motion.path d="M6.5 3.5v11" animate={{ x: active ? 0 : -2 }} transition={LAYOUT_SPRING} />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
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
            data-tip="Minimize"
            aria-label="Minimize"
            onClick={() => win.minimize()}
          >
            <Icon name="winmin" />
          </button>
          <button
            className="win-btn"
            data-tip={maximized ? "Restore" : "Maximize"}
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => win.toggleMaximize()}
          >
            <Icon name={maximized ? "winrestore" : "winmax"} />
          </button>
        </>
      )}
      <button
        className="win-btn win-close"
        data-tip="Close"
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
