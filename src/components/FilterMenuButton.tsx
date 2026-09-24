import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../ui";
import { MENU_POP, TAP } from "../motion";
import { useContextMenuShell } from "./useContextMenuShell";

type Option<T extends string> = { value: T; label: string };

/** Anchored dropdown for a single-select toolbar control — the icon-button
 *  equivalent of a `<select>`, for spots where a full-width native select
 *  (its current choice always spelled out in text) ate too much of the
 *  toolbar's fixed 35px row. Shares its panel styling and
 *  positioning/dismissal shell with the right-click menus
 *  (`useContextMenuShell`, `.ctx-menu`/`.ctx-item`), so it looks and behaves
 *  like the same menu system — just opened by a left-click on a toolbar
 *  button instead of a right-click on the table.
 *
 *  Kept as two components on purpose: `useContextMenuShell` calls hooks of
 *  its own, which Rules of Hooks bars calling conditionally — so the actual
 *  panel (`FilterMenuPanel`) only exists in the tree, and only then calls
 *  that hook, while `pos` is non-null. Exactly how `ColumnMenu`/`ContextMenu`
 *  are mounted conditionally by `App.tsx`, just with the "is it open" state
 *  owned locally instead of lifted to the parent. */
export function FilterMenuButton<T extends string>({
  icon,
  tip,
  ariaLabel,
  active,
  options,
  value,
  onChange,
}: {
  icon: string;
  tip: string;
  ariaLabel: string;
  /** Highlights the button (accent color) when the selection isn't the
   *  default — the same signal the old `<select>`'s `.active` class gave. */
  active: boolean;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function toggle() {
    if (pos) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <>
      <motion.button
        ref={buttonRef}
        className={`tbtn ${active ? "active" : ""}`}
        data-tip={tip}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={toggle}
        // Stops this click's `mousedown` from ever reaching the
        // document-level outside-click listener `useContextMenuShell`
        // registers below — without it, the same click that opens the menu
        // would also look like an outside click to that listener and
        // immediately close what it just opened.
        onMouseDown={(e) => e.stopPropagation()}
        whileTap={TAP}
      >
        <Icon name={icon} />
      </motion.button>
      <AnimatePresence>
        {pos && (
          <FilterMenuPanel
            x={pos.x}
            y={pos.y}
            options={options}
            value={value}
            onChange={onChange}
            onClose={() => setPos(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function FilterMenuPanel<T extends string>({
  x,
  y,
  options,
  value,
  onChange,
  onClose,
}: {
  x: number;
  y: number;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  onClose: () => void;
}) {
  const { ref, pos, flip, run } = useContextMenuShell(x, y, onClose);
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
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={value === o.value}
          className="ctx-item"
          onClick={() => run(() => onChange(o.value))}
        >
          <span className="ctx-check">{value === o.value ? "✓" : ""}</span>
          {o.label}
        </button>
      ))}
    </motion.div>
  );
}
