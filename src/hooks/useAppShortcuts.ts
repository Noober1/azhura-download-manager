import { useEffect } from "react";
import type { DownloadItem } from "../types";
import { isEditable } from "../ui";

/** App-chrome keyboard shortcuts — Add Download, sidebar toggle, Settings,
 *  Extensions, pause/resume, copy link, detail, and the shortcuts cheat
 *  sheet. Deliberately separate from `selection/useTableKeyboard.ts`, which
 *  owns row selection and navigation (Ctrl+A, arrows, Home/End, Delete,
 *  Enter) — these two hooks together cover every shortcut in the app, but
 *  each stays focused on its own slice.
 *
 *  Same structural conventions as `useTableKeyboard`: one document-level
 *  `keydown` listener, an early `isEditable` bail so typing in the search
 *  box or a dialog field never triggers a shortcut, and an `anyDialogOpen`
 *  bail so a dialog or the context menu keeps exclusive keyboard ownership
 *  while open.
 *
 *  No conflict with `useNativeShell`'s browser-ism blocklist: that handler
 *  runs in the capture phase and only calls `preventDefault()`, never
 *  `stopPropagation()`, so the keys it suppresses (Ctrl+B, Ctrl+N among
 *  them) still reach this listener — the same mechanism `Toolbar.tsx`
 *  already relies on for Ctrl+F. */
export function useAppShortcuts(opts: {
  anyDialogOpen: boolean;
  onToggleSidebar: () => void;
  onAddDownload: () => void;
  onShowSettings: () => void;
  onShowExtensions: () => void;
  onShowShortcuts: () => void;
  pausableSel: DownloadItem[];
  resumableSel: DownloadItem[];
  onPause: (items: DownloadItem[]) => void;
  onResume: (items: DownloadItem[]) => void;
  selectedItems: DownloadItem[];
  onCopyLink: (items: DownloadItem[]) => void;
  singleSelected: DownloadItem | null;
  openDetail: (id: string) => void;
  lockEnabled: boolean;
  onLockNow: () => void;
}) {
  const {
    anyDialogOpen,
    onToggleSidebar,
    onAddDownload,
    onShowSettings,
    onShowExtensions,
    onShowShortcuts,
    pausableSel,
    resumableSel,
    onPause,
    onResume,
    selectedItems,
    onCopyLink,
    singleSelected,
    openDetail,
    lockEnabled,
    onLockNow,
  } = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if (anyDialogOpen) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        onToggleSidebar();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onAddDownload();
        return;
      }
      if (mod && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        onShowSettings();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        onShowExtensions();
        return;
      }
      if (mod && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        onShowShortcuts();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (lockEnabled) onLockNow();
        return;
      }
      // Pause-before-resume: for a mixed selection, the reversible action
      // (pausing something running) is what an ambiguous keypress should
      // start — never the surprising one (resuming a row the user
      // deliberately paused).
      if (!mod && !e.altKey && e.key === " ") {
        e.preventDefault();
        if (pausableSel.length > 0) onPause(pausableSel);
        else if (resumableSel.length > 0) onResume(resumableSel);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "c" && selectedItems.length > 0) {
        e.preventDefault();
        onCopyLink(selectedItems);
        return;
      }
      if (e.altKey && e.key === "Enter" && singleSelected) {
        e.preventDefault();
        openDetail(singleSelected.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDialogOpen, pausableSel, resumableSel, selectedItems, singleSelected, lockEnabled]);
}
