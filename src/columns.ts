import type { SortKey } from "./constants";

/** Table column widths, in pixels, persisted to localStorage only — there is
 *  no settings.json round trip for these (see `src/theme.ts` for the same
 *  localStorage-as-source-of-truth pattern). */
export const DEFAULT_COLUMN_ORDER: SortKey[] = [
  "name",
  "added",
  "status",
  "size",
  "downloaded",
  "pct",
  "speed",
];

export const COLUMN_LABEL: Record<SortKey, string> = {
  name: "Name",
  added: "Date Added",
  status: "Status",
  size: "Size",
  downloaded: "Downloaded",
  pct: "Percentage",
  speed: "Speed",
};

export const COLUMN_CLASS: Record<SortKey, string> = {
  name: "col-name",
  added: "col-added",
  status: "col-status",
  size: "col-num",
  downloaded: "col-num",
  pct: "col-pct",
  speed: "col-num col-speed",
};

export type ColumnWidths = Record<SortKey, number>;

export const COLUMN_WIDTHS_KEY = "adm-column-widths";
export const COLUMN_ORDER_KEY = "adm-column-order";
export const MIN_COLUMN_WIDTH = 56;
export const MAX_COLUMN_WIDTH = 900;

/** Pixel equivalents of the percentages the table used before columns became
 *  resizable, resolved against a ~900px table — a fresh install looks the
 *  same as it always did. `pct` is the one exception: it grew from 80 to fit
 *  the progress bar added alongside the percentage text. */
export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 260,
  added: 140,
  status: 110,
  size: 100,
  downloaded: 110,
  pct: 120,
  speed: 110,
};

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)));
}

/** Anything unrecognized in a stored value falls back to the default for that
 *  column, key by key — mirrors `normalizeTheme` in `src/theme.ts`. */
export function normalizeColumnWidths(value: unknown): ColumnWidths {
  const out = { ...DEFAULT_COLUMN_WIDTHS };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of DEFAULT_COLUMN_ORDER) {
      const raw = record[key];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        out[key] = clampWidth(raw);
      }
    }
  }
  return out;
}

export function loadColumnWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
    return normalizeColumnWidths(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
}

export function saveColumnWidths(widths: ColumnWidths): void {
  try {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    /* private mode / storage disabled — resize still works for this session,
       only persistence across relaunches is lost */
  }
}

export function totalWidth(widths: ColumnWidths): number {
  return DEFAULT_COLUMN_ORDER.reduce((sum, key) => sum + widths[key], 0);
}

/** Anything unrecognized is dropped, duplicates are dropped (first instance
 *  wins), and any column missing from the stored value is appended at its
 *  default position — mirrors `normalizeColumnWidths` above, but for order
 *  instead of width. This keeps a stale/corrupt localStorage value from ever
 *  producing fewer than all seven columns. */
export function normalizeColumnOrder(value: unknown): SortKey[] {
  const seen = new Set<SortKey>();
  const out: SortKey[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (
        typeof raw === "string" &&
        !seen.has(raw as SortKey) &&
        (DEFAULT_COLUMN_ORDER as string[]).includes(raw)
      ) {
        seen.add(raw as SortKey);
        out.push(raw as SortKey);
      }
    }
  }
  for (const key of DEFAULT_COLUMN_ORDER) {
    if (!seen.has(key)) out.push(key);
  }
  return out;
}

export function loadColumnOrder(): SortKey[] {
  try {
    const raw = localStorage.getItem(COLUMN_ORDER_KEY);
    return normalizeColumnOrder(raw ? JSON.parse(raw) : undefined);
  } catch {
    return [...DEFAULT_COLUMN_ORDER];
  }
}

export function saveColumnOrder(order: SortKey[]): void {
  try {
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode / storage disabled — reorder still works for this
       session, only persistence across relaunches is lost */
  }
}

/** Returns a new array with the column at `from` moved to `to` — never
 *  mutates `order`. */
export function moveColumn(order: SortKey[], from: number, to: number): SortKey[] {
  if (from === to || from < 0 || from >= order.length || to < 0 || to >= order.length) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
