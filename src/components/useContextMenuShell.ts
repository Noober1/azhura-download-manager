import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The reusable core of a fixed-position right-click menu: clamps itself to
 *  stay inside the window, flips a submenu flyout to the left when the
 *  default right-opening side would run off the screen, and dismisses on
 *  outside click, Escape, scroll, or the window losing focus.
 *
 *  Lifted out of `ContextMenu` (the row menu) so `TableContextMenu` (the
 *  empty-space menu) gets identical positioning and dismissal behavior
 *  without duplicating it — this is a pure extraction, not a redesign, so
 *  the row menu's behavior is unchanged. */
export function useContextMenuShell(
  x: number,
  y: number,
  onClose: () => void,
): {
  ref: RefObject<HTMLDivElement | null>;
  pos: { x: number; y: number };
  flip: boolean;
  run: (action: () => void) => void;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? Math.max(0, window.innerWidth - rect.width - 4) : x;
    const ny =
      y + rect.height > window.innerHeight ? Math.max(0, window.innerHeight - rect.height - 4) : y;
    setPos({ x: nx, y: ny });
    // Flyouts open to the right by default (180px wide); flip them to the
    // left instead if that would run off the screen.
    setFlip(nx + rect.width + 180 > window.innerWidth);
  }, [x, y]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return { ref, pos, flip, run };
}
