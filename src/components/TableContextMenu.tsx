import { motion } from "motion/react";
import { emitTo } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import type { AddPayload } from "../types";
import { DEFAULT_PROXY } from "../types";
import { MENU_POP } from "../motion";
import { useContextMenuShell } from "./useContextMenuShell";

/* Right-click menu for empty table space (not over a row) — see
   `handleEmptyContext` in App.tsx. Shares its positioning/dismissal shell
   with the row menu (`ContextMenu.tsx`) via `useContextMenuShell`, and the
   same `.ctx-menu`/`.ctx-item`/`.ctx-sep` styling. */
export function TableContextMenu({
  x,
  y,
  clipboardUrl,
  selectableCount,
  clearableCount,
  onSelectAll,
  onRefresh,
  onClearHistory,
  onOpenSettings,
  onClose,
}: {
  x: number;
  y: number;
  /** The clipboard's current content, already checked to look like an
   *  http(s) URL — `null` when it doesn't (or couldn't be read), which
   *  disables "Paste URL & download". */
  clipboardUrl: string | null;
  selectableCount: number;
  clearableCount: number;
  onSelectAll: () => void;
  onRefresh: () => void;
  onClearHistory: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const { ref, pos, flip, run } = useContextMenuShell(x, y, onClose);

  function pasteAndDownload() {
    if (!clipboardUrl) return;
    const payload: AddPayload = {
      url: clipboardUrl,
      allowInsecure: false,
      headers: [],
      connections: 0,
      checksum: "",
      speedLimit: 0,
      later: false,
      filename: "",
      savePath: "",
      proxy: DEFAULT_PROXY,
    };
    // `revealAddWindowCmd`, not `openAddWindow`: the latter emits
    // "window-opened", which makes the Add window re-read the clipboard —
    // by then it's the same URL, so it's harmless here, but matching
    // useClipboardWatch.ts's own reasoning keeps the two call sites consistent.
    commands.revealAddWindowCmd().catch(() => {});
    emitTo("add", "prefill-add", payload).catch(() => {});
  }

  return (
    <motion.div
      className={`ctx-menu ${flip ? "flip" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      ref={ref}
      role="menu"
      variants={MENU_POP}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        onClick={() => run(() => commands.openAddWindow())}
      >
        Add Download
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={!clipboardUrl}
        onClick={() => run(pasteAndDownload)}
      >
        Paste URL & download
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={selectableCount === 0}
        onClick={() => run(onSelectAll)}
      >
        Select all
      </button>
      <button type="button" role="menuitem" className="ctx-item" onClick={() => run(onRefresh)}>
        Refresh
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="ctx-item danger"
        disabled={clearableCount === 0}
        onClick={() => run(onClearHistory)}
      >
        Clear history{clearableCount > 0 ? ` (${clearableCount})` : ""}
      </button>
      <div className="ctx-sep" />
      <button type="button" role="menuitem" className="ctx-item" onClick={() => run(onOpenSettings)}>
        Settings
      </button>
    </motion.div>
  );
}

export default TableContextMenu;
