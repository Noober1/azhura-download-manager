import type { DownloadItem } from "./types";
import { categoryOf, CATEGORY_LABEL, FILE_CATEGORIES, type FileCategory } from "./categories";

/** How the downloads table's rows are grouped — a pure per-view preference,
 *  persisted to localStorage only, the same way row density and column
 *  visibility are (see `src/columns.ts`): no `settings.json` round trip. */
export type GroupBy = "none" | "category" | "date";

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "category", label: "Group by category" },
  { value: "date", label: "Group by date" },
];

export const GROUP_BY_KEY = "adm-group-by";
export const GROUP_COLLAPSED_KEY = "adm-group-collapsed";

export type DateBucket = "today" | "yesterday" | "week" | "month" | "older";

export const DATE_BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "week", "month", "older"];

export const DATE_BUCKET_LABEL: Record<DateBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
  month: "Earlier this month",
  older: "Older",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar-day buckets in local time, not rolling 24h windows: a download
 *  from 23:50 yesterday reads as "Yesterday", not "Today", which is what the
 *  Date Added column shows too. A timestamp in the future (clock skew, a
 *  restored backup) falls into "today" rather than off the end. */
export function dateBucket(addedAt: number, now: number): DateBucket {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - DAY_MS;
  const week = today - 7 * DAY_MS;
  const month = today - 30 * DAY_MS;

  if (addedAt >= today) return "today";
  if (addedAt >= yesterday) return "yesterday";
  if (addedAt >= week) return "week";
  if (addedAt >= month) return "month";
  return "older";
}

/** The group a row belongs to, as an opaque key — `""` when grouping is off.
 *  `now` is passed in rather than read here so a single grouping pass uses
 *  one consistent instant instead of the bucket boundary shifting mid-list. */
export function groupKeyOf(item: DownloadItem, groupBy: GroupBy, now: number): string {
  switch (groupBy) {
    case "category":
      return categoryOf(item.filename);
    case "date":
      return dateBucket(item.addedAt, now);
    case "none":
      return "";
  }
}

/** Display label for a group key produced by `groupKeyOf`. */
export function groupLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === "category") return CATEGORY_LABEL[key as FileCategory] ?? key;
  if (groupBy === "date") return DATE_BUCKET_LABEL[key as DateBucket] ?? key;
  return key;
}

/** Canonical display order for a groupBy's keys. Groups with no rows are
 *  dropped by the caller — this only fixes the order among whichever ones
 *  are actually present. */
export function groupOrder(groupBy: GroupBy): string[] {
  if (groupBy === "category") return FILE_CATEGORIES;
  if (groupBy === "date") return DATE_BUCKET_ORDER;
  return [];
}

export function normalizeGroupBy(value: unknown): GroupBy {
  return value === "category" || value === "date" ? value : "none";
}

export function loadGroupBy(): GroupBy {
  try {
    return normalizeGroupBy(localStorage.getItem(GROUP_BY_KEY));
  } catch {
    return "none";
  }
}

export function saveGroupBy(v: GroupBy): void {
  try {
    localStorage.setItem(GROUP_BY_KEY, v);
  } catch {
    /* private mode / storage disabled — grouping still works for this
       session, only persistence across relaunches is lost */
  }
}

export function normalizeCollapsedGroups(value: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (typeof raw === "string") out.add(raw);
    }
  }
  return out;
}

export function loadCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(GROUP_COLLAPSED_KEY);
    return normalizeCollapsedGroups(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsedGroups(keys: Set<string>): void {
  try {
    localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    /* private mode / storage disabled — collapsing still works for this
       session, only persistence across relaunches is lost */
  }
}
