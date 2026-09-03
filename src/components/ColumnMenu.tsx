import { motion } from "motion/react";
import type { SortKey } from "../constants";
import { COLUMN_LABEL } from "../columns";
import { MENU_POP } from "../motion";
import { useContextMenuShell } from "./useContextMenuShell";

/* Right-click menu for the download table's header row: one checkable entry
   per column, plus a reset. Shares its positioning/dismissal shell with the
   row and empty-space menus (`useContextMenuShell`) and their
   `.ctx-menu`/`.ctx-item`/`.ctx-sep` styling, so it behaves identically —
   this is the same menu pattern, not a new one.

   Entries are listed in the table's own left-to-right order (hidden columns
   included, since `order` keeps their positions), so the menu reads like the
   table it configures. Deliberately does NOT close on toggle: turning three
   columns off in a row shouldn't mean three right-clicks, so `onToggle` is
   called directly instead of through the shell's `run`. */
export function ColumnMenu({
  x,
  y,
  order,
  hidden,
  onToggle,
  onShowAll,
  onClose,
}: {
  x: number;
  y: number;
  /** Every column, in table order — `useColumnOrder`'s full `order`, not its
   *  `visible`, or hidden columns would have no entry to turn back on. */
  order: SortKey[];
  hidden: Set<SortKey>;
  onToggle: (key: SortKey) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const { ref, pos, flip, run } = useContextMenuShell(x, y, onClose);
  // The last visible column can't be switched off — with no headers left
  // there'd be no way to right-click this menu open again. `useColumnVisibility`
  // enforces it too; this only greys the entry out so it's not a dead click.
  const lastVisible = order.length - hidden.size <= 1;

  return (
    <motion.div
      className={`ctx-menu ${flip ? "flip" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      ref={ref}
      role="menu"
      variants={MENU_POP}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {order.map((key) => {
        const shown = !hidden.has(key);
        return (
          <button
            key={key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={shown}
            className="ctx-item"
            disabled={shown && lastVisible}
            onClick={() => onToggle(key)}
          >
            <span className="ctx-check">{shown ? "✓" : ""}</span>
            {COLUMN_LABEL[key]}
          </button>
        );
      })}
      <div className="ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={hidden.size === 0}
        onClick={() => run(onShowAll)}
      >
        Show all columns
      </button>
    </motion.div>
  );
}

export default ColumnMenu;
