import { useMemo, useState } from "react";
import type { Category, DownloadItem } from "../types";
import { categoryOf } from "../categories";
import { pctOf } from "../format";
import { STATUS_RANK, type SortKey } from "../constants";

/** Sidebar category filter + column sort, and the derived row lists both
 *  produce. Defaults to Date Added (newest first); `sort === null` (reachable
 *  by cycling a column's sort back off) falls back to insertion order. */
export function useSortedRows(downloads: DownloadItem[]) {
  const [category, setCategory] = useState<Category>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>({
    key: "added",
    dir: "desc",
  });

  const activeItems = downloads.filter((d) =>
    ["downloading", "verifying", "queued", "paused"].includes(d.state),
  );
  const finishedItems = downloads.filter((d) =>
    ["completed", "error", "canceled"].includes(d.state),
  );
  const shown =
    category === "active"
      ? activeItems
      : category === "finished"
        ? finishedItems
        : category === "all"
          ? downloads
          : downloads.filter((d) => categoryOf(d.filename) === category);

  // Counts for the sidebar's "File type" section, tallied once per downloads
  // change rather than filtering the whole list six times.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of downloads) {
      const c = categoryOf(d.filename);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [downloads]);

  // `shown` ordered by the active column sort, or left as-is (newest first)
  // when `sort` is null. `Array.prototype.sort` is stable, so ties keep
  // insertion order either way.
  const rows = useMemo(() => {
    if (!sort) return shown;
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    function value(d: DownloadItem): number | string {
      switch (key) {
        case "name":
          return d.filename;
        case "added":
          return d.addedAt;
        case "status":
          return STATUS_RANK[d.state];
        case "size":
          return d.total ?? -1;
        case "downloaded":
          return d.downloaded;
        case "pct":
          return pctOf(d) ?? -1;
        case "speed":
          return d.speed;
      }
    }
    return [...shown].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" || typeof vb === "string") {
        return dir * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      }
      return dir * (va - vb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return {
    category,
    setCategory,
    sort,
    toggleSort,
    activeItems,
    finishedItems,
    categoryCounts,
    rows,
  };
}
