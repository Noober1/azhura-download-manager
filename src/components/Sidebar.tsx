import { motion } from "motion/react";
import type { Category } from "../types";
import { FILE_CATEGORIES, CATEGORY_LABEL, CATEGORY_ICON } from "../categories";
import { LAYOUT_SPRING, SPRING_POP } from "../motion";
import { Icon } from "../ui";

/* A single category row. The active one gets a `motion.div` sharing
   `layoutId="sidebar-active"` with every other row's — motion animates it
   sliding to the new position instead of the highlight just jumping.
   `data-tip` always carries the label+count (not just when collapsed) so the
   two states need no separate tooltip logic; `aria-label` mirrors it since
   the collapsed rail hides the visible label/count text entirely — without
   it a screen reader would announce nothing but an empty button.
   `.cat-icon` gets its own hover/tap/activate motion, independent of the
   indicator's slide, so clicking a category reads as the icon *arriving*
   at the highlight rather than the highlight silently appearing under it. */
function CatButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`cat ${active ? "active" : ""}`}
      data-tip={`${label} (${count})`}
      data-tip-side="right"
      aria-label={`${label} (${count})`}
      onClick={onClick}
    >
      {active && (
        <motion.div
          className="cat-indicator"
          layoutId="sidebar-active"
          transition={LAYOUT_SPRING}
        />
      )}
      <span className="cat-content">
        <motion.span
          className="cat-icon"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.9 }}
          animate={{ scale: active ? [1, 1.25, 1] : 1 }}
          transition={SPRING_POP}
        >
          <Icon name={icon} size={15} />
        </motion.span>
        <span className="cat-label">{label}</span>
        <span className="cat-n">{count}</span>
      </span>
    </button>
  );
}

export function Sidebar({
  category,
  setCategory,
  totalCount,
  activeCount,
  finishedCount,
  categoryCounts,
  collapsed,
}: {
  category: Category;
  setCategory: (c: Category) => void;
  totalCount: number;
  activeCount: number;
  finishedCount: number;
  categoryCounts: Record<string, number>;
  /** Drives the icon-rail width only — the toggle button itself lives in
   *  the toolbar now, next to "Add download". */
  collapsed: boolean;
}) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="side-title">Category</div>
      <CatButton
        active={category === "all"}
        icon="all"
        label="All Downloads"
        count={totalCount}
        onClick={() => setCategory("all")}
      />
      <CatButton
        active={category === "active"}
        icon="active"
        label="Active"
        count={activeCount}
        onClick={() => setCategory("active")}
      />
      <CatButton
        active={category === "finished"}
        icon="finished"
        label="Finished"
        count={finishedCount}
        onClick={() => setCategory("finished")}
      />

      <div className="side-title">File type</div>
      {FILE_CATEGORIES.map((c) => (
        <CatButton
          key={c}
          active={category === c}
          icon={CATEGORY_ICON[c]}
          label={CATEGORY_LABEL[c]}
          count={categoryCounts[c] ?? 0}
          onClick={() => setCategory(c)}
        />
      ))}
    </aside>
  );
}

export default Sidebar;
