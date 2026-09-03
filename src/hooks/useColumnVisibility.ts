import { useState } from "react";
import type { SortKey } from "../constants";
import { DEFAULT_COLUMN_ORDER, loadHiddenColumns, saveHiddenColumns } from "../columns";

/** Which of the table's columns are turned off, persisted to localStorage the
 *  same way `useColumnWidths` and `useColumnOrder` persist theirs. Kept
 *  separate from `useColumnOrder` on purpose: `order` is *positions* and stays
 *  complete whether or not a column is on screen, so hiding and re-showing a
 *  column never loses where it sat.
 *
 *  `toggle` refuses to hide the last visible column — the header's own
 *  right-click menu is the only way back, and with zero headers there'd be
 *  nothing left to right-click. The menu greys that entry out too; this is the
 *  backstop, not the UI. */
export function useColumnVisibility() {
  const [hidden, setHidden] = useState<Set<SortKey>>(loadHiddenColumns);

  const visibleCount = DEFAULT_COLUMN_ORDER.length - hidden.size;

  function toggle(key: SortKey) {
    setHidden((prev) => {
      if (!prev.has(key) && visibleCount <= 1) return prev;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHiddenColumns(next);
      return next;
    });
  }

  function showAll() {
    setHidden((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<SortKey>();
      saveHiddenColumns(next);
      return next;
    });
  }

  return { hidden, visibleCount, toggle, showAll };
}
