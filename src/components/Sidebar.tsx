import type { Category } from "../types";
import { FILE_CATEGORIES, CATEGORY_LABEL } from "../categories";

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
      <button
        className={`cat ${category === "all" ? "active" : ""}`}
        onClick={() => setCategory("all")}
      >
        All Downloads <span className="cat-n">{totalCount}</span>
      </button>
      <button
        className={`cat ${category === "active" ? "active" : ""}`}
        onClick={() => setCategory("active")}
      >
        Active <span className="cat-n">{activeCount}</span>
      </button>
      <button
        className={`cat ${category === "finished" ? "active" : ""}`}
        onClick={() => setCategory("finished")}
      >
        Finished <span className="cat-n">{finishedCount}</span>
      </button>

      <div className="side-title">File type</div>
      {FILE_CATEGORIES.map((c) => (
        <button
          key={c}
          className={`cat ${category === c ? "active" : ""}`}
          onClick={() => setCategory(c)}
        >
          {CATEGORY_LABEL[c]} <span className="cat-n">{categoryCounts[c] ?? 0}</span>
        </button>
      ))}
    </aside>
  );
}

export default Sidebar;
