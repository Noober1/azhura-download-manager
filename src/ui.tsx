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
          <button className="win-btn" title="Minimize" onClick={() => win.minimize()}>
            <Icon name="winmin" />
          </button>
          <button
            className="win-btn"
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => win.toggleMaximize()}
          >
            <Icon name={maximized ? "winrestore" : "winmax"} />
          </button>
        </>
      )}
      <button className="win-btn win-close" title="Close" onClick={() => win.close()}>
        <Icon name="winclose" />
      </button>
    </div>
  );
}

/* Suppress the browser's native right-click menu, except in editable fields (so Paste
   works). Custom per-item context menus attach separately via onContextMenu. */
export function useSuppressContextMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);
}
