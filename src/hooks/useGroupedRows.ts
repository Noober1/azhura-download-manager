import { useMemo, useState } from "react";
import type { DownloadItem } from "../types";
import {
  groupKeyOf,
  groupLabel,
  groupOrder,
  loadCollapsedGroups,
  loadGroupBy,
  saveCollapsedGroups,
  saveGroupBy,
  type GroupBy,
} from "../grouping";

export type GroupMeta = { key: string; label: string; count: number; collapsed: boolean };

/** Buckets the already-sorted, already-filtered row list from
 *  `useSortedRows` into named groups (category or date), overriding the
 *  active column sort at the top level: groups always appear in their
 *  canonical order (`groupOrder`), and the active sort only orders rows
 *  *within* each group.
 *
 *  Collapsing a group removes its rows from `rows` entirely rather than
 *  hiding them visually — `useSelection`, `useTableKeyboard` and
 *  `useMarquee` all treat "rows" as exactly what's positionally selectable
 *  and keyboard-navigable, and grouping must not teach them about rows that
 *  don't exist in that sense. `headersBefore`/`trailingGroups` are how the
 *  table renders the (non-selectable) group headers around that shortened
 *  list. */
export function useGroupedRows(sortedRows: DownloadItem[]) {
  const [groupBy, setGroupByState] = useState<GroupBy>(loadGroupBy);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedGroups);

  function setGroupBy(next: GroupBy) {
    setGroupByState(next);
    saveGroupBy(next);
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedGroups(next);
      return next;
    });
  }

  const derived = useMemo(() => {
    if (groupBy === "none") {
      return {
        rows: sortedRows,
        headersBefore: new Map<string, GroupMeta[]>(),
        trailingGroups: [] as GroupMeta[],
      };
    }

    // One `now` for the whole pass, so the date-bucket boundary can't shift
    // between the first row and the last.
    const now = Date.now();

    const buckets = new Map<string, DownloadItem[]>();
    for (const item of sortedRows) {
      const key = groupKeyOf(item, groupBy, now);
      const list = buckets.get(key);
      if (list) list.push(item);
      else buckets.set(key, [item]);
    }

    const order = groupOrder(groupBy).filter((key) => buckets.has(key));

    const rows: DownloadItem[] = [];
    const headersBefore = new Map<string, GroupMeta[]>();
    // Accumulates collapsed groups' headers as the loop walks `order`; each
    // one is either flushed onto the next visible group's first row, or —
    // if nothing visible follows — left here as the final trailing run.
    const trailingGroups: GroupMeta[] = [];

    for (const key of order) {
      const items = buckets.get(key)!;
      const meta: GroupMeta = {
        key,
        label: groupLabel(key, groupBy),
        count: items.length,
        collapsed: collapsed.has(key),
      };
      if (meta.collapsed) {
        trailingGroups.push(meta);
        continue;
      }
      // A run of collapsed groups just before this one has no row of its own
      // to anchor to, so their headers pile up here too, ahead of this
      // group's own header.
      const pending = [...trailingGroups.splice(0), meta];
      headersBefore.set(items[0].id, pending);
      rows.push(...items);
    }

    return { rows, headersBefore, trailingGroups };
  }, [sortedRows, groupBy, collapsed]);

  return { groupBy, setGroupBy, toggleGroup, ...derived };
}
