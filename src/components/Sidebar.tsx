import { motion } from "motion/react";
import type { Category } from "../types";
import { FILE_CATEGORIES, CATEGORY_LABEL } from "../categories";
import { LAYOUT_SPRING } from "../motion";

/* A single category row. The active one gets a `motion.div` sharing
   `layoutId="sidebar-active"` with every other row's — motion animates it
   sliding to the new position instead of the highlight just jumping. */
function CatButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button className={`cat ${active ? "active" : ""}`} onClick={onClick}>
      {active && (
        <motion.div
          className="cat-indicator"
          layoutId="sidebar-active"
          transition={LAYOUT_SPRING}
        />
      )}
      <span className="cat-content">
        {label} <span className="cat-n">{count}</span>
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
}: {
  category: Category;
  setCategory: (c: Category) => void;
  totalCount: number;
  activeCount: number;
  finishedCount: number;
  categoryCounts: Record<string, number>;
}) {
  return (
    <aside className="sidebar">
      <div className="side-title">Category</div>
      <CatButton
        active={category === "all"}
        label="All Downloads"
        count={totalCount}
        onClick={() => setCategory("all")}
      />
      <CatButton
        active={category === "active"}
        label="Active"
        count={activeCount}
        onClick={() => setCategory("active")}
      />
      <CatButton
        active={category === "finished"}
        label="Finished"
        count={finishedCount}
        onClick={() => setCategory("finished")}
      />

      <div className="side-title">File type</div>
      {FILE_CATEGORIES.map((c) => (
        <CatButton
          key={c}
          active={category === c}
          label={CATEGORY_LABEL[c]}
          count={categoryCounts[c] ?? 0}
          onClick={() => setCategory(c)}
        />
      ))}
    </aside>
  );
}

export default Sidebar;
