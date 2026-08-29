import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { TOOLTIP_POP } from "../motion";

type Side = "top" | "bottom" | "left" | "right";

const GAP = 6;
const MARGIN = 8;
const SHOW_DELAY = 500;

/** Resolve the requested side against the trigger's own position, flipping
 *  to the opposite side if the bubble would spill past the viewport. `size`
 *  is the tooltip's own measured box (0×0 on the first frame, before the
 *  ref has painted — good enough for the flip check since a not-yet-measured
 *  bubble hasn't rendered anywhere for the user to see anyway). */
function place(anchor: DOMRect, side: Side, size: { width: number; height: number }) {
  let resolved = side;
  if (side === "top" && anchor.top - size.height - GAP < MARGIN) resolved = "bottom";
  else if (side === "bottom" && anchor.bottom + size.height + GAP > window.innerHeight - MARGIN)
    resolved = "top";
  else if (side === "left" && anchor.left - size.width - GAP < MARGIN) resolved = "right";
  else if (side === "right" && anchor.right + size.width + GAP > window.innerWidth - MARGIN)
    resolved = "left";

  let top = 0;
  let left = 0;
  if (resolved === "top" || resolved === "bottom") {
    top = resolved === "top" ? anchor.top - size.height - GAP : anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = resolved === "left" ? anchor.left - size.width - GAP : anchor.right + GAP;
    top = anchor.top + anchor.height / 2 - size.height / 2;
  }
  left = Math.min(Math.max(left, MARGIN), window.innerWidth - size.width - MARGIN);
  top = Math.min(Math.max(top, MARGIN), window.innerHeight - size.height - MARGIN);
  return { top, left, side: resolved };
}

/** Custom tooltip layer, one instance per window (mounted by
 *  `MotionProvider`). Any element with `data-tip="..."` becomes a trigger;
 *  `data-tip-side` (default "bottom") picks which edge it opens from.
 *
 *  Listens on `document` rather than per-trigger — `DownloadTable`'s name
 *  cell is a trigger on every row and re-renders several times a second
 *  during an active download (see the perf note in motion.ts), so a
 *  delegated listener keeps that hot path free of any tooltip-specific
 *  subscription. */
export function TooltipHost() {
  const [state, setState] = useState<{ text: string; side: Side; anchor: DOMRect } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const activeTriggerRef = useRef<Element | null>(null);

  useEffect(() => {
    function clearShowTimer() {
      if (showTimer.current !== undefined) {
        window.clearTimeout(showTimer.current);
        showTimer.current = undefined;
      }
    }

    function hide() {
      clearShowTimer();
      activeTriggerRef.current = null;
      setState(null);
      setPos(null);
    }

    function armShow(trigger: Element) {
      const text = trigger.getAttribute("data-tip");
      if (!text) return;
      if (trigger === activeTriggerRef.current) return;
      clearShowTimer();
      activeTriggerRef.current = trigger;
      const side = (trigger.getAttribute("data-tip-side") as Side | null) ?? "bottom";
      showTimer.current = window.setTimeout(() => {
        setState({ text, side, anchor: trigger.getBoundingClientRect() });
      }, SHOW_DELAY);
    }

    function onPointerOver(e: PointerEvent) {
      const trigger = (e.target as Element | null)?.closest("[data-tip]");
      if (trigger) armShow(trigger);
    }
    function onPointerOut(e: PointerEvent) {
      const trigger = (e.target as Element | null)?.closest("[data-tip]");
      if (trigger && trigger === activeTriggerRef.current) hide();
    }
    function onFocusIn(e: FocusEvent) {
      const trigger = (e.target as Element | null)?.closest("[data-tip]");
      if (trigger) armShow(trigger);
    }
    function onFocusOut(e: FocusEvent) {
      const trigger = (e.target as Element | null)?.closest("[data-tip]");
      if (trigger && trigger === activeTriggerRef.current) hide();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearShowTimer();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Measure the bubble once it mounts with real content, then place it
  // against the trigger's rect — a tooltip's text length isn't known until
  // it renders, so the first-frame size can't be computed up front.
  useLayoutEffect(() => {
    if (!state) return;
    const el = bubbleRef.current;
    if (!el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    setPos(place(state.anchor, state.side, size));
  }, [state]);

  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          ref={bubbleRef}
          className="tooltip-bubble"
          role="tooltip"
          aria-hidden="true"
          style={{
            top: pos?.top ?? state.anchor.bottom + GAP,
            left: pos?.left ?? state.anchor.left,
            visibility: pos ? "visible" : "hidden",
          }}
          variants={TOOLTIP_POP[pos?.side ?? state.side]}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {state.text}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default TooltipHost;
