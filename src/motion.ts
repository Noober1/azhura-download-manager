import type { TargetAndTransition, Transition, Variants } from "motion/react";

/** Shared motion tokens for the app's chrome — dialogs, menus, popups, and
 *  toolbar buttons. Deliberately NOT used by `DownloadTable` rows, which
 *  re-render several times a second during an active download; wrapping
 *  those in motion components would put animation cost on every progress
 *  patch.
 *
 *  DUR/DECEL/ACCEL mirror the --dur-N / --ease-N tokens in
 *  `src/styles/tokens.css`. CSS can't import JS, so one side has to be a
 *  copy — tokens.css is the canonical table; change both together. */

const DUR = { fast: 0.08, base: 0.12, slow: 0.18 } as const;
const DECEL: Transition["ease"] = [0, 0, 0, 1];
const ACCEL: Transition["ease"] = [0.7, 0, 1, 0.5];

const SPRING_POP: Transition = { type: "spring", stiffness: 400, damping: 30 };

/** A dialog's backdrop: plain opacity fade, no transform (nothing to guide
 *  the eye toward — it's just dimming the app behind the dialog). */
export const OVERLAY_FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.base, ease: DECEL } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: ACCEL } },
};

/** A dialog panel: scales and settles in with a slight upward drift, matching
 *  the direction a modal conventionally "arrives" from. */
export const DIALOG_POP: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING_POP },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: DUR.fast, ease: ACCEL } },
};

/** The right-click context menu: quick scale+fade, since it's positioned at
 *  the cursor and needs to feel immediate rather than settle in like a modal. */
export const MENU_POP: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR.base, ease: DECEL } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR.fast, ease: ACCEL } },
};

/** Press feedback for toolbar buttons — `whileTap`, not a variant, since it
 *  only ever needs the one pressed state. */
export const TAP: TargetAndTransition = { scale: 0.94 };

/** Transition for elements that reposition via a shared `layoutId` (e.g. the
 *  sidebar's active-category indicator) rather than mounting fresh. */
export const LAYOUT_SPRING: Transition = { type: "spring", stiffness: 500, damping: 40 };

/** The detail popup's body, once its first snapshot arrives (`ready` flips
 *  true) — a small settle-in rather than an abrupt appearance. */
export const BODY_ENTER: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: DECEL } },
};

/** A status label swapping for a different one (e.g. downloading → paused) —
 *  used inside `AnimatePresence mode="wait"` so the old label fades out
 *  before the new one fades in, rather than the text visibly snapping. */
export const STATUS_CROSSFADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.base, ease: DECEL } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: ACCEL } },
};

/** A toast arriving/leaving the stack — mirrors `MENU_POP`'s "needs to feel
 *  immediate" timing (a toast is also a transient, non-modal arrival) but
 *  slides up from the bottom instead of scaling from a cursor point, since
 *  it's anchored to a screen edge rather than a click position. */
export const TOAST_POP: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: DECEL } },
  exit: { opacity: 0, y: 4, transition: { duration: DUR.fast, ease: ACCEL } },
};
