import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { commands } from "../bindings";
import type { DownloadItem } from "../types";
import { formatSpeed } from "../format";
import { STATUS_FILTER_OPTIONS, type StatusFilter } from "../statusFilter";
import { GROUP_BY_OPTIONS, type GroupBy } from "../grouping";
import { Icon, WindowControls } from "../ui";
import { TAP } from "../motion";
import { FilterMenuButton } from "./FilterMenuButton";

export function Toolbar({
  resumableSel,
  resumeLabel,
  pausableSel,
  cancelableSel,
  deletableSel,
  selectedItems,
  selectedCount,
  totalSpeed,
  activeCount,
  queuedCount,
  groupBy,
  onGroupByChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  onResume,
  onPause,
  onCancel,
  onRequestDelete,
  onRefresh,
  onShowSettings,
  onShowExtensions,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  resumableSel: DownloadItem[];
  /** "Resume" or "Redownload" — see ContextMenu's `resumeLabel` prop. */
  resumeLabel: string;
  pausableSel: DownloadItem[];
  cancelableSel: DownloadItem[];
  deletableSel: DownloadItem[];
  selectedItems: DownloadItem[];
  selectedCount: number;
  totalSpeed: number;
  activeCount: number;
  queuedCount: number;
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onResume: (items: DownloadItem[]) => void;
  onPause: (items: DownloadItem[]) => void;
  onCancel: (items: DownloadItem[]) => void;
  onRequestDelete: (items: DownloadItem[]) => void;
  onRefresh: () => void;
  onShowSettings: () => void;
  onShowExtensions: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  // Ticks up on every Refresh click so the icon's rotation accumulates
  // (spin += 360°) instead of resetting mid-turn — mashing the button spins
  // continuously rather than stuttering back to 0 on each click.
  const [refreshSpin, setRefreshSpin] = useState(0);

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
      <motion.button
        className="tbtn"
        data-tip={`${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} · Ctrl+B`}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!sidebarCollapsed}
        onClick={onToggleSidebar}
        whileTap={TAP}
      >
        <Icon name="panel" size={15} active={!sidebarCollapsed} />
      </motion.button>
      <span className="tsep" />
      <motion.button
        className="tbtn"
        data-tip="Add download · Ctrl+N"
        aria-label="Add download"
        onClick={() => commands.openAddWindow()}
        whileTap={TAP}
      >
        <Icon name="add" />
      </motion.button>
      <span className="tsep" />
      <motion.button
        className="tbtn"
        data-tip={`${resumeLabel}${resumableSel.length > 1 ? ` (${resumableSel.length})` : ""} · Space`}
        aria-label={`${resumeLabel}${resumableSel.length > 1 ? ` (${resumableSel.length})` : ""}`}
        disabled={resumableSel.length === 0}
        onClick={() => onResume(resumableSel)}
        whileTap={TAP}
      >
        <Icon name="resume" />
      </motion.button>
      <motion.button
        className="tbtn"
        data-tip={`Pause${pausableSel.length > 1 ? ` (${pausableSel.length})` : ""} · Space`}
        aria-label={`Pause${pausableSel.length > 1 ? ` (${pausableSel.length})` : ""}`}
        disabled={pausableSel.length === 0}
        onClick={() => onPause(pausableSel)}
        whileTap={TAP}
      >
        <Icon name="pause" />
      </motion.button>
      <motion.button
        className="tbtn"
        data-tip={`Cancel${cancelableSel.length > 1 ? ` (${cancelableSel.length})` : ""}`}
        aria-label={`Cancel${cancelableSel.length > 1 ? ` (${cancelableSel.length})` : ""}`}
        disabled={cancelableSel.length === 0}
        onClick={() => onCancel(cancelableSel)}
        whileTap={TAP}
      >
        <Icon name="cancel" />
      </motion.button>
      <motion.button
        className="tbtn"
        data-tip={`Delete${deletableSel.length > 1 ? ` (${deletableSel.length})` : ""} · Delete`}
        aria-label={`Delete${deletableSel.length > 1 ? ` (${deletableSel.length})` : ""}`}
        disabled={deletableSel.length === 0}
        onClick={() => onRequestDelete(selectedItems)}
        whileTap={TAP}
      >
        <Icon name="trash" />
      </motion.button>
      <span className="tsep" />
      <motion.button
        className="tbtn"
        data-tip="Settings · Ctrl+,"
        aria-label="Settings"
        onClick={onShowSettings}
        whileTap={TAP}
      >
        <Icon name="settings" />
      </motion.button>
      <motion.button
        className="tbtn"
        data-tip="Refresh file status · F5"
        aria-label="Refresh file status (F5)"
        onClick={() => {
          setRefreshSpin((s) => s + 1);
          onRefresh();
        }}
        whileTap={TAP}
      >
        <motion.span
          className="tbtn-spin"
          animate={{ rotate: refreshSpin * 360 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <Icon name="refresh" />
        </motion.span>
      </motion.button>

      <FilterMenuButton
        icon="group"
        tip="Group rows"
        ariaLabel="Group rows"
        active={groupBy !== "none"}
        options={GROUP_BY_OPTIONS}
        value={groupBy}
        onChange={onGroupByChange}
      />

      <FilterMenuButton
        icon="filter"
        tip="Filter by status"
        ariaLabel="Filter by status"
        active={statusFilter !== "all"}
        options={STATUS_FILTER_OPTIONS}
        value={statusFilter}
        onChange={onStatusFilterChange}
      />

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
      <motion.button
        className="tbtn"
        data-tip="Install browser extension · Ctrl+Shift+X"
        aria-label="Install browser extension"
        onClick={onShowExtensions}
        whileTap={TAP}
      >
        <Icon name="puzzle" />
      </motion.button>
      <WindowControls variant="full" />
    </div>
  );
}

export default Toolbar;
