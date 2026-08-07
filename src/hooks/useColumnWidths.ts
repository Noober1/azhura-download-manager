import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { SortKey } from "../constants";
import {
  COLUMN_ORDER,
  clampWidth,
  loadColumnWidths,
  saveColumnWidths,
  type ColumnWidths,
} from "../columns";

/** Drag-to-resize state for the download table's column headers, modeled on
 *  `useMarquee`: a `mousedown` on a header's resize handle arms window-level
 *  `mousemove`/`mouseup` listeners so the drag keeps tracking even if the
 *  cursor leaves the header. `didResizeRef` (read by `DownloadTable`'s sort
 *  click handler) distinguishes an actual drag from a plain click, since a
 *  drag's mouseup always fires a click right after it. */
export function useColumnWidths() {
  const [widths, setWidths] = useState<ColumnWidths>(loadColumnWidths);
  const [drag, setDrag] = useState<{ key: SortKey; startX: number; startWidth: number } | null>(
    null,
  );
  const didResizeRef = useRef(false);

  function startResize(key: SortKey, e: ReactMouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    didResizeRef.current = false;
    setDrag({ key, startX: e.clientX, startWidth: widths[key] });
  }

  useEffect(() => {
    if (!drag) return;
    const { key, startX, startWidth } = drag;
    document.body.classList.add("col-resizing");

    function onMouseMove(e: MouseEvent) {
      const dx = e.clientX - startX;
      if (!didResizeRef.current && Math.abs(dx) < 3) return;
      didResizeRef.current = true;
      setWidths((prev) => ({ ...prev, [key]: clampWidth(startWidth + dx) }));
    }

    function onMouseUp() {
      setDrag(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("col-resizing");
      setWidths((current) => {
        saveColumnWidths(current);
        return current;
      });
    };
  }, [drag]);

  // Snaps a column to fit the widest visible content (header + rows) in it.
  function autoFit(key: SortKey) {
    const i = COLUMN_ORDER.indexOf(key);
    if (i === -1) return;

    let widest = 0;
    const th = document.querySelector<HTMLElement>(
      `.dtable thead th:nth-child(${i + 1})`,
    );
    if (th) widest = Math.max(widest, th.scrollWidth);

    document.querySelectorAll<HTMLElement>(".dtable tbody tr.drow").forEach((tr) => {
      const cell = tr.children[i] as HTMLElement | undefined;
      if (!cell) return;
      if (key === "name") {
        const nameText = cell.querySelector<HTMLElement>(".name-text");
        if (nameText) widest = Math.max(widest, nameText.scrollWidth + 22);
      } else {
        widest = Math.max(widest, cell.scrollWidth);
      }
    });

    const next = clampWidth(widest + 16 + 2);
    setWidths((prev) => {
      const updated = { ...prev, [key]: next };
      saveColumnWidths(updated);
      return updated;
    });
  }

  return { widths, resizingKey: drag?.key ?? null, didResizeRef, startResize, autoFit };
}
