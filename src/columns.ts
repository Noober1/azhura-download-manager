import type { SortKey } from "./constants";

/** Table column widths, in pixels, persisted to localStorage only — there is
 *  no settings.json round trip for these (see `src/theme.ts` for the same
 *  localStorage-as-source-of-truth pattern). */
export const COLUMN_ORDER: SortKey[] = [
  "name",
  "added",
  "status",
  "size",
  "downloaded",
  "pct",
  "speed",
];

export type ColumnWidths = Record<SortKey, number>;

export const COLUMN_WIDTHS_KEY = "adm-column-widths";
export const MIN_COLUMN_WIDTH = 56;
export const MAX_COLUMN_WIDTH = 900;

/** Pixel equivalents of the percentages the table used before columns became
 *  resizable, resolved against a ~900px table — a fresh install looks the
 *  same as it always did. */
export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 260,
  added: 140,
  status: 110,
  size: 100,
  downloaded: 110,
  pct: 80,
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
    for (const key of COLUMN_ORDER) {
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
  return COLUMN_ORDER.reduce((sum, key) => sum + widths[key], 0);
}
