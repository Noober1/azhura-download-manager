import { useRef, useState, type RefObject } from "react";
import type { DownloadItem } from "../types";

/** Table row selection: the selected-id set, the shift-range anchor, and the
 *  click handler that reconciles both with ctrl/shift modifiers. `didDragRef`
 *  is owned by `useMarquee` — a drag's trailing mouseup always fires a click
 *  right after it, and this is what tells `selectRow` to ignore that click
 *  instead of re-selecting a single row. */
export function useSelection(rows: DownloadItem[], didDragRef: RefObject<boolean>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null); // shift-range anchor

  function selectRow(id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (e.shiftKey && anchorRef.current) {
      const ids = rows.map((d) => d.id);
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
      return;
    }
    setSelectedIds(new Set([id]));
    anchorRef.current = id;
  }

  function scrollRowIntoView(id: string) {
    document.querySelector(`.drow[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return { selectedIds, setSelectedIds, anchorRef, selectRow, scrollRowIntoView };
}
