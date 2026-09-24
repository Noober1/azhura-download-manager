/** Pure data model + logic for the classic Alt-tap menu bar
 *  (`src/hooks/useMenubar.ts`, `src/components/MenuBar.tsx`). Kept free of
 *  React so the tricky bits — the Alt-tap state machine and the
 *  skip-separators/skip-disabled navigation — are unit-testable without a
 *  DOM, the same way `src/grouping.ts`/`src/statusFilter.ts` keep their pure
 *  logic separate from the hooks that drive them. */

export type MenuItem =
  | {
      kind: "item";
      label: string;
      /** Right-aligned hint, e.g. "Ctrl+N". Display only — the real binding
       *  lives in `useAppShortcuts`/`useTableKeyboard`/`useMissingRefresh`. */
      shortcut?: string;
      disabled?: boolean;
      /** Renders the `.ctx-check` tick and `role="menuitemradio"` (View > Theme). */
      checked?: boolean;
      /** `rect` is the activated item's own on-screen box, so an action that
       *  opens a second anchored popup (View > Show/Hide Columns, which
       *  reuses `ColumnMenu`) can position it under the item the user
       *  actually picked. Every other item ignores the argument. */
      onSelect: (rect?: DOMRect) => void;
    }
  | {
      /** A row that opens a nested flyout instead of doing anything itself
       *  (View > Theme/Group Rows/Filter by Status). Only one level deep —
       *  a submenu's own `items` are never themselves `kind: "submenu"`;
       *  `MenuBar.tsx` only ever renders two panel levels. */
      kind: "submenu";
      label: string;
      disabled?: boolean;
      items: MenuItem[];
    }
  | { kind: "separator" };

export type Menu = {
  label: string;
  /** Single letter, case-insensitive — the underlined mnemonic. Pressing it
   *  alone (no Alt) while the bar is visible jumps straight to this menu,
   *  matching classic Windows "menu mode" (Alt reveals the bar; once in it,
   *  bare letters navigate without holding Alt down). Must be unique across
   *  the menus passed to one `MenuBar` — nothing enforces that here, it's on
   *  the caller (see `buildMenus()` in `App.tsx`). */
  mnemonic: string;
  items: MenuItem[];
};

/** Splits `label` around the first case-insensitive occurrence of
 *  `mnemonic`, so the caller can render that one letter underlined. Falls
 *  back to putting the whole label in `after` (nothing underlined) if the
 *  mnemonic isn't actually in the label — a mismatch between the two would
 *  be a caller bug, not something to throw over. */
export function splitMnemonic(
  label: string,
  mnemonic: string,
): { before: string; letter: string; after: string } {
  const idx = label.toUpperCase().indexOf(mnemonic.toUpperCase());
  if (idx === -1) return { before: "", letter: "", after: label };
  return { before: label.slice(0, idx), letter: label.slice(idx, idx + 1), after: label.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Alt-tap detection
// ---------------------------------------------------------------------------

/** A tap of Alt means: Alt went down and came back up with nothing else in
 *  between. `keydown`/`keyup` carry the raw `key` so the reducer can tell a
 *  bare Alt from Alt-as-a-modifier for something else; `interrupt` covers
 *  everything that should cancel an in-progress tap without itself being a
 *  keyboard event (a mouse press, the window losing focus, a dialog taking
 *  over). */
export type AltTapEvent =
  | { type: "keydown"; key: string; repeat: boolean }
  | { type: "keyup"; key: string }
  | { type: "interrupt" };

export type AltTapResult = { armed: boolean; toggle: boolean };

/** One step of the tap-detector. `armed` means "Alt is down and nothing else
 *  has happened yet"; `toggle` means "a tap just completed — flip the bar's
 *  visibility".
 *
 *  Holding Alt autorepeats its own `keydown` (with `repeat: true`) — that
 *  must NOT re-arm after something has already disarmed it, or holding Alt
 *  down through an unrelated `Alt+X` combo would leave the machine armed
 *  again the moment the other key is released, turning the eventual Alt-up
 *  into a bogus tap. */
export function altTapStep(armed: boolean, e: AltTapEvent): AltTapResult {
  switch (e.type) {
    case "keydown":
      if (e.key !== "Alt") return { armed: false, toggle: false };
      return e.repeat ? { armed, toggle: false } : { armed: true, toggle: false };
    case "keyup":
      if (e.key !== "Alt") return { armed, toggle: false };
      return { armed: false, toggle: armed };
    case "interrupt":
      return { armed: false, toggle: false };
  }
}

// ---------------------------------------------------------------------------
// Cursor navigation
// ---------------------------------------------------------------------------

function isSelectable(item: MenuItem): boolean {
  return item.kind !== "separator" && !item.disabled;
}

/** -1 when the menu has nothing selectable at all. */
export function firstEnabledIndex(items: MenuItem[]): number {
  return items.findIndex(isSelectable);
}

/** -1 when the menu has nothing selectable at all. */
export function lastEnabledIndex(items: MenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isSelectable(items[i])) return i;
  }
  return -1;
}

/** Steps `dir` from `from`, skipping separators/disabled items, wrapping at
 *  both ends. Returns `from` unchanged if nothing else in the menu is
 *  selectable (including when `from` itself isn't, e.g. a menu of only
 *  separators). */
export function stepEnabledIndex(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (n === 0) return from;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    if (isSelectable(items[i])) return i;
  }
  return from;
}
