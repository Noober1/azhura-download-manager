import { invoke } from "@tauri-apps/api/core";
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
  onResume,
  onPause,
  onCancel,
  onRequestDelete,
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
  onResume: (items: DownloadItem[]) => void;
  onPause: (items: DownloadItem[]) => void;
  onCancel: (items: DownloadItem[]) => void;
  onRequestDelete: (items: DownloadItem[]) => void;
  onShowSettings: () => void;
  onShowExtensions: () => void;
}) {
  return (
    <div className="topbar" data-tauri-drag-region>
      <button
        className="tbtn primary"
        title="Add download"
        onClick={() => invoke("open_add_window")}
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
