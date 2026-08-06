import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";

/** Rubber-band drag-select over the download table: `dragStart` arms the
 *  window mouse listeners below, `marquee` is the visible rectangle.
 *  `didDragRef` (shared with `useSelection`) distinguishes an actual drag
 *  from a plain click, since a drag's mouseup always fires a click right
 *  after it. */
export function useMarquee(
  didDragRef: RefObject<boolean>,
  tableWrapRef: RefObject<HTMLElement | null>,
  selectedIds: Set<string>,
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>,
) {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const dragBaseSelRef = useRef<Set<string>>(new Set());

  // Arms a rubber-band drag: only for the primary button, and not when the
  // mousedown started on the header (sorting owns that click). Ctrl/Shift
  // held at drag start adds to the existing selection instead of replacing it.
  function handleTableMouseDown(e: ReactMouseEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("thead")) return;
    didDragRef.current = false;
    dragBaseSelRef.current =
      e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selectedIds) : new Set();
    setDragStart({ x: e.clientX, y: e.clientY });
  }

  // The table wrapper's onClick: a drag's trailing click is suppressed here
  // (and the flag reset), otherwise clicking empty space clears selection.
  function handleTableClick(e: ReactMouseEvent) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    const t = e.target as HTMLElement;
    if (!t.closest(".drow")) setSelectedIds(new Set());
  }

  // Tracks an armed drag across the window (the cursor can leave the table
  // mid-drag) until mouseup. A plain click never moves past the 4px
  // threshold, so it never marks `didDragRef` and never touches selection —
  // `selectRow` and the table's onClick handle that case normally.
  useEffect(() => {
    if (!dragStart) return;
    const startX = dragStart.x;
    const startY = dragStart.y;

    function onMouseMove(e: MouseEvent) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!didDragRef.current && Math.hypot(dx, dy) < 4) return;
      didDragRef.current = true;

      const wrap = tableWrapRef.current;
      const wrapRect = wrap?.getBoundingClientRect();

      const boxLeft = Math.min(startX, e.clientX);
      const boxTop = Math.min(startY, e.clientY);
      const boxRight = Math.max(startX, e.clientX);
      const boxBottom = Math.max(startY, e.clientY);

      if (wrapRect) {
        const clampedLeft = Math.max(boxLeft, wrapRect.left);
        const clampedTop = Math.max(boxTop, wrapRect.top);
        const clampedRight = Math.min(boxRight, wrapRect.right);
        const clampedBottom = Math.min(boxBottom, wrapRect.bottom);
        setMarquee({
          left: clampedLeft,
          top: clampedTop,
          width: Math.max(0, clampedRight - clampedLeft),
          height: Math.max(0, clampedBottom - clampedTop),
        });
      }

      const hits = new Set(dragBaseSelRef.current);
      document.querySelectorAll<HTMLElement>(".drow").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > boxTop && r.top < boxBottom) {
          const id = el.dataset.id;
          if (id) hits.add(id);
        }
      });
      setSelectedIds(hits);

      if (wrap && wrapRect) {
        const edge = 20;
        if (e.clientY < wrapRect.top + edge) wrap.scrollTop -= 16;
        else if (e.clientY > wrapRect.bottom - edge) wrap.scrollTop += 16;
      }
    }

    function onMouseUp() {
      setDragStart(null);
      setMarquee(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragStart]);

  return { marquee, handleTableMouseDown, handleTableClick };
}
