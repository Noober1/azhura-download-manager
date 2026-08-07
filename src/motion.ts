import type { TargetAndTransition, Transition, Variants } from "motion/react";

/** Shared motion tokens for the app's chrome — dialogs, menus, popups, and
 *  toolbar buttons. Deliberately NOT used by `DownloadTable` rows, which
 *  re-render several times a second during an active download; wrapping
 *  those in motion components would put animation cost on every progress
 *  patch. Mirrors the CSS timing already used for the few existing
 *  transitions (see `src/styles/*.css`) rather than inventing new ones. */

const SPRING_POP: Transition = { type: "spring", stiffness: 400, damping: 30 };

/** A dialog's backdrop: plain opacity fade, no transform (nothing to guide
 *  the eye toward — it's just dimming the app behind the dialog). */
export const OVERLAY_FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** A dialog panel: scales and settles in with a slight upward drift, matching
 *  the direction a modal conventionally "arrives" from. */
export const DIALOG_POP: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING_POP },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.1 } },
};

/** The right-click context menu: quick scale+fade, since it's positioned at
 *  the cursor and needs to feel immediate rather than settle in like a modal. */
export const MENU_POP: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.11, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.08 } },
};

/** Press feedback for toolbar buttons — `whileTap`, not a variant, since it
 *  only ever needs the one pressed state. */
export const TAP: TargetAndTransition = { scale: 0.92 };

/** Transition for elements that reposition via a shared `layoutId` (e.g. the
 *  sidebar's active-category indicator) rather than mounting fresh. */
export const LAYOUT_SPRING: Transition = { type: "spring", stiffness: 500, damping: 40 };

/** The detail popup's body, once its first snapshot arrives (`ready` flips
 *  true) — a small settle-in rather than an abrupt appearance. */
export const BODY_ENTER: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
};

/** A status label swapping for a different one (e.g. downloading → paused) —
 *  used inside `AnimatePresence mode="wait"` so the old label fades out
 *  before the new one fades in, rather than the text visibly snapping. */
export const STATUS_CROSSFADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};
