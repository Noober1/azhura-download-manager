import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MENU_POP } from "../motion";
import {
  firstEnabledIndex,
  lastEnabledIndex,
  splitMnemonic,
  stepEnabledIndex,
  type Menu,
  type MenuItem,
} from "../menubar";
import { useContextMenuShell } from "./useContextMenuShell";

/** `path` is the chain of item indices from the top-level menu down to a
 *  specific row — `[itemIndex]` for a row in the open menu itself,
 *  `[submenuParentIndex, itemIndex]` for a row inside its flyout. Never
 *  includes the top-level *menu* index (File/Downloads/…) — ids only need
 *  to be unique while one menu is open at a time, and folding that in would
 *  just make every id longer for no benefit. */
function itemId(...path: number[]): string {
  return `menubar-item-${path.join("-")}`;
}

/** Classic Alt-tap menu bar (File/Downloads/View/Tools/Help). Mounted by
 *  `App.tsx` only while `useMenubar`'s `visible` is true, and unmounts
 *  itself as soon as anything is picked (`onDismiss`, called from
 *  `activate` below), Tab is pressed, or focus leaves the bar entirely
 *  (see the container's `onBlur` below — a click on, say, a table row
 *  moves DOM focus there directly, without going through any of this
 *  component's own handlers first, so it's the only way this component can
 *  learn that happened).
 *
 *  Owns which menu is open, which (if any) of its rows has its submenu
 *  flyout open, the keyboard cursor at both levels, and focus — none of
 *  that lives in `useMenubar`, which only tracks the Alt-tap itself.
 *
 *  DOM focus never leaves the trigger `<button>`s: the open dropdown's
 *  highlighted item (and, one level deeper, the open flyout's) is tracked in
 *  state and surfaced to assistive tech via `aria-activedescendant` on the
 *  focused trigger, the standard ARIA menubar pattern. This sidesteps moving
 *  focus into either panel and back on every arrow press, and means neither
 *  panel's own buttons are ever `Tab`-reachable (`Tab` here hides the whole
 *  bar and lets focus move on naturally — see `onKeyDown` below). It also
 *  means "is focus still inside the bar" is a clean, single check — see
 *  `onBlur`. */
export function MenuBar({ menus, onDismiss }: { menus: Menu[]; onDismiss: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState<{
    index: number;
    cursor: number;
    anchor: { x: number; y: number };
  } | null>(null);
  // Only meaningful (and only ever non-null) while `open` is set and the row
  // at `open.cursor` is a `kind: "submenu"` item — see `openSubmenuAt`.
  const [submenu, setSubmenu] = useState<{ cursor: number; anchor: { x: number; y: number } } | null>(
    null,
  );
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const openItem = open ? menus[open.index].items[open.cursor] : undefined;
  const submenuItems = submenu && openItem?.kind === "submenu" ? openItem.items : null;

  // Focuses the first trigger on mount, restores whatever had focus before
  // on unmount. The bar leaves via `AnimatePresence` in App.tsx, so this
  // cleanup runs once the exit animation actually finishes — the same
  // timing `useDialogA11y` relies on for the dialogs.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    triggerRefs.current[0]?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  function focusTrigger(i: number) {
    triggerRefs.current[i]?.focus();
  }

  function openMenuAt(i: number, cursor: number) {
    const rect = triggerRefs.current[i]?.getBoundingClientRect();
    if (!rect) return;
    setActiveIndex(i);
    setOpen({ index: i, cursor, anchor: { x: rect.left, y: rect.bottom } });
    setSubmenu(null);
    focusTrigger(i);
  }

  function toggleMenu(i: number) {
    if (open?.index === i) {
      setOpen(null);
      setSubmenu(null);
      setActiveIndex(i);
      focusTrigger(i);
    } else {
      openMenuAt(i, firstEnabledIndex(menus[i].items));
    }
  }

  // Hovering a different title only switches menus once one is already
  // open — with nothing open, moving the mouse across the bar must not pop
  // menus at the user.
  function hoverMenu(i: number) {
    if (open === null || open.index === i) return;
    openMenuAt(i, firstEnabledIndex(menus[i].items));
  }

  // Moves the cursor within the *open* menu (not its flyout) — always closes
  // any open submenu, since the highlight just left the row that owned it.
  function moveCursor(cursor: number) {
    if (open === null) return;
    setOpen({ ...open, cursor });
    setSubmenu(null);
  }

  // Opens (or re-anchors) the flyout for row `itemIndex` of the open menu,
  // and moves the cursor there too — covers both "arrow onto it then
  // ArrowRight/Enter" and "hover it with the mouse", which both land here.
  function openSubmenuAt(itemIndex: number) {
    if (open === null) return;
    const item = menus[open.index].items[itemIndex];
    if (item.kind !== "submenu" || item.disabled) return;
    const rect = document.getElementById(itemId(itemIndex))?.getBoundingClientRect();
    if (!rect) return;
    setOpen({ ...open, cursor: itemIndex });
    setSubmenu({ cursor: firstEnabledIndex(item.items), anchor: { x: rect.right, y: rect.top } });
  }

  function activate(item: MenuItem, path: number[]) {
    if (item.kind !== "item" || item.disabled) return;
    const rect = document.getElementById(itemId(...path))?.getBoundingClientRect();
    item.onSelect(rect);
    dismissRef.current();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const n = menus.length;
    if (n === 0) return;

    // A flyout is open — it owns the keyboard until closed or something in
    // it is picked. Kept as an early, separate branch rather than woven
    // into the switch below: every key here means something different one
    // level up (e.g. ArrowLeft backs out of the flyout instead of switching
    // top-level menus), and interleaving the two would read as one giant
    // four-way conditional on every case.
    if (open !== null && submenu !== null && submenuItems) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSubmenu({ ...submenu, cursor: stepEnabledIndex(submenuItems, submenu.cursor, 1) });
          return;
        case "ArrowUp":
          e.preventDefault();
          setSubmenu({ ...submenu, cursor: stepEnabledIndex(submenuItems, submenu.cursor, -1) });
          return;
        case "Home":
          e.preventDefault();
          setSubmenu({ ...submenu, cursor: firstEnabledIndex(submenuItems) });
          return;
        case "End":
          e.preventDefault();
          setSubmenu({ ...submenu, cursor: lastEnabledIndex(submenuItems) });
          return;
        case "Enter":
        case " ": {
          e.preventDefault();
          const item = submenuItems[submenu.cursor];
          if (item) activate(item, [open.cursor, submenu.cursor]);
          return;
        }
        case "ArrowLeft":
        case "Escape":
          // Backs out one level, same as Windows: the flyout closes, the
          // parent row stays highlighted, the bar stays up.
          e.preventDefault();
          setSubmenu(null);
          return;
        case "ArrowRight":
          // No second level of nesting to open — swallow it rather than
          // falling through to "switch top-level menus" while a flyout has
          // the keyboard.
          e.preventDefault();
          return;
        case "Tab":
          dismissRef.current();
          return;
        default:
          return;
      }
    }

    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        e.preventDefault();
        if (e.key === "ArrowRight" && open !== null) {
          const item = menus[open.index].items[open.cursor];
          if (item?.kind === "submenu" && !item.disabled) {
            openSubmenuAt(open.cursor);
            break;
          }
        }
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const next = (activeIndex + dir + n) % n;
        if (open !== null) openMenuAt(next, firstEnabledIndex(menus[next].items));
        else {
          setActiveIndex(next);
          focusTrigger(next);
        }
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        if (open === null) openMenuAt(activeIndex, firstEnabledIndex(menus[activeIndex].items));
        else moveCursor(stepEnabledIndex(menus[open.index].items, open.cursor, 1));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (open === null) openMenuAt(activeIndex, lastEnabledIndex(menus[activeIndex].items));
        else moveCursor(stepEnabledIndex(menus[open.index].items, open.cursor, -1));
        break;
      }
      case "Home": {
        if (open === null) return;
        e.preventDefault();
        moveCursor(firstEnabledIndex(menus[open.index].items));
        break;
      }
      case "End": {
        if (open === null) return;
        e.preventDefault();
        moveCursor(lastEnabledIndex(menus[open.index].items));
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (open === null) {
          openMenuAt(activeIndex, firstEnabledIndex(menus[activeIndex].items));
        } else {
          const item = menus[open.index].items[open.cursor];
          if (item?.kind === "submenu") openSubmenuAt(open.cursor);
          else if (item) activate(item, [open.cursor]);
        }
        break;
      }
      case "Escape": {
        e.preventDefault();
        // Only act when no dropdown is open. When one is, the open
        // `MenuPanel`'s own `useContextMenuShell` already has an Escape
        // listener that closes it — handling it here too would just be two
        // systems fighting over the same keypress.
        if (open === null) dismissRef.current();
        break;
      }
      case "Tab": {
        // No preventDefault: focus should genuinely move on to whatever's
        // next in tab order, same as it would if the bar weren't here.
        dismissRef.current();
        break;
      }
      default: {
        // Mnemonics: classic Windows "menu mode" — once the bar is up
        // (however it got revealed), typing a menu's underlined letter
        // alone jumps straight to it, no Alt held. Ignored with any
        // modifier down, so it can never fight a real shortcut.
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) break;
        const i = menus.findIndex((m) => m.mnemonic.toUpperCase() === e.key.toUpperCase());
        if (i === -1) break;
        e.preventDefault();
        openMenuAt(i, firstEnabledIndex(menus[i].items));
      }
    }
  }

  return (
    <div
      className="menubar"
      role="menubar"
      onKeyDown={onKeyDown}
      // Keyboard nav/mnemonics only reach `onKeyDown` above while focus is
      // on one of the triggers below (panel buttons are never focused —
      // see the module doc comment). If focus just moved somewhere outside
      // this whole subtree — clicked a table row, a toolbar button,
      // anything else — the bar can no longer respond to a single
      // keypress at all, so leaving it visible would just be a
      // dead-looking, unusable bar sitting there. Hide it instead.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          dismissRef.current();
        }
      }}
    >
      {menus.map((m, i) => {
        const mnemonic = splitMnemonic(m.label, m.mnemonic);
        const activeDescendant =
          open?.index === i
            ? itemId(...(submenu && submenuItems ? [open.cursor, submenu.cursor] : [open.cursor]))
            : undefined;
        return (
          <button
            key={m.label}
            ref={(el) => {
              triggerRefs.current[i] = el;
            }}
            type="button"
            className={`menubar-item ${open?.index === i ? "open" : ""}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open?.index === i}
            aria-activedescendant={activeDescendant}
            onClick={() => toggleMenu(i)}
            onMouseEnter={() => hoverMenu(i)}
            // Stops this click's `mousedown` from ever reaching the
            // document-level outside-click listener `useContextMenuShell`
            // registers for the open panel — without it, the same click that
            // opens a menu (or switches to a different one) would look like
            // an outside click and immediately close what it just opened.
            // Same trick `FilterMenuButton.tsx` uses for the same reason.
            onMouseDown={(e) => e.stopPropagation()}
          >
            {mnemonic.before}
            <span className="menubar-mnemonic">{mnemonic.letter}</span>
            {mnemonic.after}
          </button>
        );
      })}
      <AnimatePresence>
        {open && (
          <MenuPanel
            x={open.anchor.x}
            y={open.anchor.y}
            items={menus[open.index].items}
            cursor={open.cursor}
            onCursor={moveCursor}
            onActivate={(item, i) => activate(item, [i])}
            onOpenSubmenu={openSubmenuAt}
            onClose={() => setOpen(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open !== null && submenu && submenuItems && (
          <MenuPanel
            x={submenu.anchor.x}
            y={submenu.anchor.y}
            path={[open.cursor]}
            items={submenuItems}
            cursor={submenu.cursor}
            elevated
            onCursor={(i) => setSubmenu((s) => (s ? { ...s, cursor: i } : s))}
            onActivate={(item, i) => activate(item, [open.cursor, i])}
            onOpenSubmenu={() => {}}
            onClose={() => setSubmenu(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuPanel({
  x,
  y,
  path = [],
  items,
  cursor,
  elevated,
  onCursor,
  onActivate,
  onOpenSubmenu,
  onClose,
}: {
  x: number;
  y: number;
  /** Path of this panel's own rows, i.e. `[]` for the top-level open menu or
   *  `[submenuParentIndex]` for its flyout — see `itemId`'s doc comment. */
  path?: number[];
  items: MenuItem[];
  cursor: number;
  /** True for a submenu's own flyout panel — stacks it above the menu that
   *  opened it, matching `.ctx-flyout`'s z-index (61 vs `.ctx-menu`'s 60). */
  elevated?: boolean;
  onCursor: (i: number) => void;
  onActivate: (item: MenuItem, itemIndex: number) => void;
  onOpenSubmenu: (itemIndex: number) => void;
  onClose: () => void;
}) {
  const { ref, pos, flip, run } = useContextMenuShell(x, y, onClose);
  return (
    <motion.div
      className={`ctx-menu ${flip ? "flip" : ""}`}
      style={{ left: pos.x, top: pos.y, zIndex: elevated ? 61 : undefined }}
      ref={ref}
      role="menu"
      variants={MENU_POP}
      initial="initial"
      animate="animate"
      exit="exit"
      // Same reasoning as the trigger buttons' own `onMouseDown` above, one
      // level removed: a click inside *this* panel is not contained within
      // whichever panel opened it (they're separate floating trees), so
      // without this, clicking a flyout item would look like an outside
      // click to the parent menu's shell and close it out from under you.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} className="ctx-sep" />;
        const id = itemId(...path, i);
        if (item.kind === "submenu") {
          return (
            <div
              key={item.label}
              id={id}
              role="menuitem"
              aria-haspopup="menu"
              aria-disabled={item.disabled}
              className={`ctx-sub ${item.disabled ? "disabled" : ""} ${i === cursor ? "cursor" : ""}`}
              onMouseEnter={() => onOpenSubmenu(i)}
              onClick={() => onOpenSubmenu(i)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {item.label}
              <span className="ctx-caret" aria-hidden="true">
                ▸
              </span>
            </div>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            id={id}
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            disabled={item.disabled}
            className={`ctx-item ctx-row ${i === cursor ? "cursor" : ""}`}
            onMouseEnter={() => onCursor(i)}
            onClick={() => run(() => onActivate(item, i))}
          >
            {item.checked !== undefined && (
              <span className="ctx-check">{item.checked ? "✓" : ""}</span>
            )}
            {item.label}
            {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </motion.div>
  );
}
