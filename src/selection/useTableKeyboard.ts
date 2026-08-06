import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { DownloadItem } from "../types";
import { isEditable } from "../ui";

/** Keyboard shortcuts for the download table's selection: Ctrl/Cmd+A selects
 *  everything shown, Escape clears, Delete opens the confirmation dialog for
 *  the current selection, arrow keys/Home/End move a single-row cursor
 *  (Shift extends the range from the anchor), Enter opens the detail popup
 *  for one row. Disabled entirely while a modal dialog or the context menu
 *  is open — their own handlers deal with Escape. */
export function useTableKeyboard(opts: {
  rows: DownloadItem[];
  selectedItems: DownloadItem[];
  singleSelected: DownloadItem | null;
  anyDialogOpen: boolean;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  anchorRef: MutableRefObject<string | null>;
  requestDelete: (items: DownloadItem[]) => void;
  scrollRowIntoView: (id: string) => void;
  openDetail: (id: string) => void;
}) {
  const {
    rows,
    selectedItems,
    singleSelected,
    anyDialogOpen,
    setSelectedIds,
    anchorRef,
    requestDelete,
    scrollRowIntoView,
    openDetail,
  } = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      // A modal dialog or the context menu owns keyboard input while open —
      // their own handlers deal with Escape.
      if (anyDialogOpen) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(rows.map((d) => d.id)));
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (e.key === "Delete") {
        requestDelete(selectedItems);
        return;
      }
      if (rows.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const ids = rows.map((d) => d.id);
        const from = anchorRef.current ? ids.indexOf(anchorRef.current) : -1;
        const base = from === -1 ? (e.key === "ArrowDown" ? -1 : ids.length) : from;
        const next = Math.min(ids.length - 1, Math.max(0, base + (e.key === "ArrowDown" ? 1 : -1)));
        const nextId = ids[next];
        if (e.shiftKey && from !== -1) {
          const [lo, hi] = from < next ? [from, next] : [next, from];
          setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        } else {
          setSelectedIds(new Set([nextId]));
          anchorRef.current = nextId;
        }
        scrollRowIntoView(nextId);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const ids = rows.map((d) => d.id);
        const targetId = e.key === "Home" ? ids[0] : ids[ids.length - 1];
        const from = anchorRef.current ? ids.indexOf(anchorRef.current) : -1;
        if (e.shiftKey && from !== -1) {
          const targetIdx = e.key === "Home" ? 0 : ids.length - 1;
          const [lo, hi] = from < targetIdx ? [from, targetIdx] : [targetIdx, from];
          setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        } else {
          setSelectedIds(new Set([targetId]));
          anchorRef.current = targetId;
        }
        scrollRowIntoView(targetId);
        return;
      }
      if (e.key === "Enter" && singleSelected) {
        e.preventDefault();
        openDetail(singleSelected.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedItems, singleSelected, anyDialogOpen]);
}
