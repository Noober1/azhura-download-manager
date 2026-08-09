import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Escape-to-close, focus-in on mount, focus-restore on unmount, and a
 *  Tab/Shift+Tab trap — shared by all five dialogs so each doesn't hand-roll
 *  its own (partial, inconsistent) Escape handler. Returns a ref for the
 *  dialog panel (the `motion.div` carrying `role="dialog"`); give the same
 *  element `tabIndex={-1}` as a fallback focus target for the rare panel
 *  with no focusable children.
 *
 *  Respects an existing `autoFocus` on a field inside the panel (e.g.
 *  SpeedCapDialog's limit input) by only moving focus in if nothing inside
 *  the panel already has it — `autoFocus` fires synchronously during React's
 *  commit, before this effect runs, so by the time this checks, the field
 *  already has focus if it asked for it.
 *
 *  Restoring focus happens in the effect's cleanup, which — because these
 *  dialogs mount inside `AnimatePresence` — only actually runs once the exit
 *  animation finishes and the panel unmounts for real, not on the click that
 *  starts the close. The timing works out: focus returns right as the
 *  dialog visually finishes leaving. */
export function useDialogA11y<T extends HTMLElement>(onEscape: () => void) {
  const ref = useRef<T>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (!panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return ref;
}
