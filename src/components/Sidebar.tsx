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
  activeCount,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count: number;
  /** How many of `count` are currently downloading/verifying/queued/paused —
   *  rendered as a small badge next to the count. Omitted (or 0) shows no
   *  badge, so All/Active/Finished — which don't pass it — stay as before. */
  activeCount?: number;
  onClick: () => void;
}) {
  const tip = activeCount
    ? `${label} (${count}, ${activeCount} active)`
    : `${label} (${count})`;
  return (
    <button
      className={`cat ${active ? "active" : ""}`}
      data-tip={tip}
      data-tip-side="right"
      aria-label={tip}
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
        {!!activeCount && (
          <span className="cat-active" aria-hidden="true">
            {activeCount}
          </span>
        )}
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
  activeCategoryCounts,
  collapsed,
}: {
  category: Category;
  setCategory: (c: Category) => void;
  totalCount: number;
  activeCount: number;
  finishedCount: number;
  categoryCounts: Record<string, number>;
  /** Same shape as `categoryCounts`, restricted to active downloads — drives
   *  each File type row's "N active" badge. */
  activeCategoryCounts: Record<string, number>;
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
          activeCount={activeCategoryCounts[c] ?? 0}
          onClick={() => setCategory(c)}
        />
      ))}
    </aside>
  );
}

export default Sidebar;
