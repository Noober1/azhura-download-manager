import { useEffect, useRef } from "react";
import { commands } from "../bindings";
import type { DownloadItem } from "../types";
import { formatSpeed } from "../format";
import { Icon, WindowControls } from "../ui";

export function Toolbar({
  resumableSel,
  pausableSel,
  cancelableSel,
  deletableSel,
  selectedItems,
  selectedCount,
  totalSpeed,
  activeCount,
  queuedCount,
  searchQuery,
  onSearchChange,
  onResume,
  onPause,
  onCancel,
  onRequestDelete,
  onRefresh,
  onShowSettings,
  onShowExtensions,
}: {
  resumableSel: DownloadItem[];
  pausableSel: DownloadItem[];
  cancelableSel: DownloadItem[];
  deletableSel: DownloadItem[];
  selectedItems: DownloadItem[];
  selectedCount: number;
  totalSpeed: number;
  activeCount: number;
  queuedCount: number;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onResume: (items: DownloadItem[]) => void;
  onPause: (items: DownloadItem[]) => void;
  onCancel: (items: DownloadItem[]) => void;
  onRequestDelete: (items: DownloadItem[]) => void;
  onRefresh: () => void;
  onShowSettings: () => void;
  onShowExtensions: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+F focuses the search box instead of WebView2's native find-in-page
  // (still suppressed separately by `useNativeShell`'s blocklist — that
  // handler's preventDefault() doesn't stopPropagation(), so this listener
  // still sees the same keystroke).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className="topbar" data-tauri-drag-region>
      <button
        className="tbtn primary"
        title="Add download"
        onClick={() => commands.openAddWindow()}
      >
        <Icon name="add" />
      </button>
      <span className="tsep" />
      <button
        className="tbtn"
        title={`Resume${resumableSel.length > 1 ? ` (${resumableSel.length})` : ""}`}
        disabled={resumableSel.length === 0}
        onClick={() => onResume(resumableSel)}
      >
        <Icon name="resume" />
      </button>
      <button
        className="tbtn"
        title={`Pause${pausableSel.length > 1 ? ` (${pausableSel.length})` : ""}`}
        disabled={pausableSel.length === 0}
        onClick={() => onPause(pausableSel)}
      >
        <Icon name="pause" />
      </button>
      <button
        className="tbtn"
        title={`Cancel${cancelableSel.length > 1 ? ` (${cancelableSel.length})` : ""}`}
        disabled={cancelableSel.length === 0}
        onClick={() => onCancel(cancelableSel)}
      >
        <Icon name="cancel" />
      </button>
      <button
        className="tbtn danger"
        title={`Delete${deletableSel.length > 1 ? ` (${deletableSel.length})` : ""}`}
        disabled={deletableSel.length === 0}
        onClick={() => onRequestDelete(selectedItems)}
      >
        <Icon name="trash" />
      </button>
      <span className="tsep" />
      <button className="tbtn" title="Settings" onClick={onShowSettings}>
        <Icon name="settings" />
      </button>
      <button className="tbtn" title="Refresh file status (F5)" onClick={onRefresh}>
        <Icon name="refresh" />
      </button>

      <input
        ref={searchRef}
        className="search-input"
        type="text"
        placeholder="Search filename or referer…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSearchChange("");
            e.currentTarget.blur();
          }
        }}
      />

      <div className="topbar-status">
        <span className="ts-speed">{formatSpeed(totalSpeed)}</span>
        <span className="ts-counts">
          {activeCount} active · {queuedCount} queued
          {selectedCount > 1 ? ` · ${selectedCount} selected` : ""}
        </span>
      </div>
      <button
        className="tbtn"
        title="Install browser extension"
        onClick={onShowExtensions}
      >
        <Icon name="puzzle" />
      </button>
      <WindowControls variant="full" />
    </div>
  );
}

export default Toolbar;
