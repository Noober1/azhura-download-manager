import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { suppressNextClick } from "../suppressNextClick";

const DRAG_THRESHOLD_PX = 4;

/** Drag-to-reorder for the download table's Queue column: a `mousedown` on a
 *  row's grip arms window-level `mousemove`/`mouseup` listeners, modeled on
 *  `useColumnOrder`. `stopPropagation()`/`preventDefault()` on the grip's own
 *  mousedown keep this from ever arming `useMarquee`'s rubber-band select
 *  (which watches `mousedown` on `<main>`) or starting a text selection.
 *
 *  Only ever drags one row at a time — multi-row reorder goes through the
 *  context menu's Queue ▸ submenu instead. */
export function useQueueDrag(
  tableWrapRef: RefObject<HTMLElement | null>,
  queuePos: Map<string, number>,
  onDrop: (draggedId: string, beforeId: string | null) => void,
) {
  const [drag, setDrag] = useState<{ id: string; startY: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "end" | null>(null);
  const didDragRef = useRef(false);
  const dropRef = useRef<string | "end" | null>(null);
  // Read inside the mousemove listener (created once per drag) so a queue
  // position that shifts mid-drag (e.g. a row completing and leaving the
  // queue) doesn't require re-arming the listeners.
  const queuePosRef = useRef(queuePos);
  queuePosRef.current = queuePos;

  function startDrag(id: string, e: ReactMouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    didDragRef.current = false;
    dropRef.current = null;
    setDrag({ id, startY: e.clientY });
  }

  useEffect(() => {
    if (!drag) return;
    const { id, startY } = drag;
    document.body.classList.add("queue-reordering");

    function onMouseMove(e: MouseEvent) {
      if (!didDragRef.current && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      didDragRef.current = true;

      const rows = Array.from(document.querySelectorAll<HTMLElement>(".dtable tbody tr.drow")).filter(
        (el) => el.dataset.id && queuePosRef.current.has(el.dataset.id),
      );
      let target: string | "end" = "end";
      for (const el of rows) {
        const rect = el.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          target = el.dataset.id!;
          break;
        }
      }
      dropRef.current = target;
      setDropTarget(target);

      const wrap = tableWrapRef.current;
      if (wrap) {
        const wrapRect = wrap.getBoundingClientRect();
        const edge = 20;
        if (e.clientY < wrapRect.top + edge) wrap.scrollTop -= 16;
        else if (e.clientY > wrapRect.bottom - edge) wrap.scrollTop += 16;
      }
    }

    function onMouseUp() {
      if (didDragRef.current && dropRef.current) {
        onDrop(id, dropRef.current === "end" ? null : dropRef.current);
        suppressNextClick();
      }
      setDrag(null);
      setDropTarget(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("queue-reordering");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  return {
    dragId: drag?.id ?? null,
    // `dropTarget` state is only ever set inside `onMouseMove` past the
    // threshold check above, so it's naturally null until a real drag
    // starts — same gating `useColumnOrder`'s `dropIndex` relies on.
    dropBefore: dropTarget,
    startDrag,
  };
}
