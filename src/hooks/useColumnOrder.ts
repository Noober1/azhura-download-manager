import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { SortKey } from "../constants";
import { loadColumnOrder, moveColumn, saveColumnOrder } from "../columns";

const DRAG_THRESHOLD_PX = 4;

/** Snapshot of the dragged header's own rect at drag start, in viewport
 *  coordinates — plain numbers rather than the `DOMRect` itself, so the
 *  floating ghost's position math below doesn't depend on any DOM API. */
export type DragRect = { left: number; top: number; width: number; height: number };

/** Drag-to-reorder state for the download table's column headers, modeled on
 *  `useColumnWidths`: a `mousedown` on a header arms window-level
 *  `mousemove`/`mouseup` listeners so the drag keeps tracking even if the
 *  cursor leaves the header.
 *
 *  Mouse-only — there is no keyboard path to reorder columns.
 *
 *  `dragRect` + `offsetX` drive a floating "ghost" copy of the dragged
 *  header that `DownloadTable` renders following the cursor — X axis only,
 *  its Y position stays pinned to the header's own top the whole drag,
 *  since columns only ever reorder left-right.
 *
 *  A reorder drag, by definition, ends with the cursor over a *different*
 *  `<th>` than it started on. Per the UIEvents spec, the trailing `click`
 *  fires on the nearest common ancestor of the mousedown and mouseup
 *  targets — here, the `<tr>` — so `SortTh`'s own `onClick` never runs and a
 *  `didReorderRef`-style flag (the pattern `useColumnWidths` uses for resize)
 *  would never get consumed or cleared. Instead, a real reorder arms a
 *  one-shot capture-phase `click` listener on `mouseup` that stops the event
 *  before it reaches anything, so the trailing click can never be
 *  misread as a sort regardless of where it lands. */
export function useColumnOrder() {
  const [order, setOrder] = useState<SortKey[]>(loadColumnOrder);
  const [drag, setDrag] = useState<{ key: SortKey; startX: number; rect: DragRect } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // How far the cursor has moved horizontally since the drag started — the
  // floating ghost header (rendered by `DownloadTable`) follows this on the
  // X axis only; its Y position stays pinned to the dragged header's own
  // top, by design (columns only ever reorder left-right).
  const [offsetX, setOffsetX] = useState(0);
  const didDragRef = useRef(false);
  // `onMouseUp` below is created once per `drag` change (the effect's only
  // dependency) and needs the *latest* drop index at release time — reading
  // the `dropIndex` state variable there would close over whatever it was
  // when the effect ran, not what `onMouseMove` set since. A ref sidesteps
  // that without adding `dropIndex` to the effect's deps (which would
  // re-arm the listeners, and lose `didDragRef`'s continuity, on every
  // pixel of movement).
  const dropIndexRef = useRef<number | null>(null);

  function startReorder(key: SortKey, e: ReactMouseEvent) {
    if (e.button !== 0) return;
    didDragRef.current = false;
    dropIndexRef.current = null;
    const r = e.currentTarget.getBoundingClientRect();
    setDrag({ key, startX: e.clientX, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
    setOffsetX(0);
  }

  useEffect(() => {
    if (!drag) return;
    const { key, startX } = drag;
    document.body.classList.add("col-reordering");

    // Headers are read in DOM order, which matches `order` (DownloadTable
    // renders `<SortTh>` by iterating `order`) — so a header's position in
    // this array IS its index in `order` for the whole drag, since `order`
    // itself doesn't change until drop.
    function headerRects(): DOMRect[] {
      return Array.from(document.querySelectorAll<HTMLElement>(".dtable thead th")).map((th) =>
        th.getBoundingClientRect(),
      );
    }

    function onMouseMove(e: MouseEvent) {
      if (!didDragRef.current && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      didDragRef.current = true;
      setOffsetX(e.clientX - startX);

      // Standard "sortable list" insertion-point algorithm: walk headers
      // left to right, and advance the drop index past every header whose
      // midpoint the cursor has crossed.
      let index = 0;
      headerRects().forEach((rect, i) => {
        const mid = rect.left + rect.width / 2;
        if (e.clientX >= mid) index = i + 1;
      });
      const clamped = Math.max(0, Math.min(order.length, index));
      dropIndexRef.current = clamped;
      setDropIndex(clamped);
    }

    function onMouseUp() {
      const finalDropIndex = dropIndexRef.current;
      if (didDragRef.current && finalDropIndex !== null) {
        const from = order.indexOf(key);
        // finalDropIndex is a gap position (0..order.length); moveColumn
        // expects a target slot, which is the same gap minus one once the
        // source is pulled out of the array when the gap is past it.
        const to = finalDropIndex > from ? finalDropIndex - 1 : finalDropIndex;
        const next = moveColumn(order, from, to);
        setOrder(next);
        saveColumnOrder(next);

        // See the module comment: the trailing click lands on whatever
        // element the drag ended over, not necessarily the header that was
        // dragged — capture-phase + stopPropagation intercepts it wherever
        // it lands, before SortTh's onClick (or anything else) sees it.
        window.addEventListener(
          "click",
          (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
          },
          { capture: true, once: true },
        );
      }
      setDrag(null);
      setDropIndex(null);
      setOffsetX(0);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("col-reordering");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  return {
    order,
    dragKey: drag?.key ?? null,
    // Only meaningful once `didDragRef` has actually crossed the threshold
    // (same as `dropIndex`, which follows the same gate) — otherwise a
    // plain click that never moves would flash a one-frame ghost before
    // `mouseup` clears it.
    dragRect: dropIndex !== null ? (drag?.rect ?? null) : null,
    offsetX,
    dropIndex,
    startReorder,
  };
}
