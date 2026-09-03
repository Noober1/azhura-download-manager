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
  "eta",
  "conns",
  "pieces",
];

export const COLUMN_LABEL: Record<SortKey, string> = {
  name: "Name",
  added: "Date Added",
  status: "Status",
  size: "Size",
  downloaded: "Downloaded",
  pct: "Percentage",
  speed: "Speed",
  eta: "ETA",
  conns: "Connections",
  pieces: "Pieces",
};

export const COLUMN_CLASS: Record<SortKey, string> = {
  name: "col-name",
  added: "col-added",
  status: "col-status",
  size: "col-num",
  downloaded: "col-num",
  pct: "col-pct",
  speed: "col-num col-speed",
  eta: "col-num",
  conns: "col-num",
  pieces: "col-num",
};

export type ColumnWidths = Record<SortKey, number>;

export const COLUMN_WIDTHS_KEY = "adm-column-widths";
export const COLUMN_ORDER_KEY = "adm-column-order";
export const COLUMN_HIDDEN_KEY = "adm-column-hidden";
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
  eta: 90,
  conns: 100,
  pieces: 110,
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

/** Minimum width the table needs to show `order` without squeezing. Takes the
 *  order rather than reading `DEFAULT_COLUMN_ORDER`, because callers pass the
 *  *visible* order — a hidden column must not keep reserving its width. */
export function totalWidth(widths: ColumnWidths, order: SortKey[]): number {
  return order.reduce((sum, key) => sum + widths[key], 0);
}

/** Anything unrecognized is dropped, duplicates are dropped (first instance
 *  wins), and any column missing from the stored value is appended at its
 *  default position — mirrors `normalizeColumnWidths` above, but for order
 *  instead of width. This keeps a stale/corrupt localStorage value from ever
 *  producing fewer columns than `DEFAULT_COLUMN_ORDER` has, and is also what
 *  gives a column added in a later release a position in an existing install's
 *  stored order. Visibility is tracked separately (see `loadHiddenColumns`);
 *  `order` always lists every column, shown or not. */
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

/* ---- Column visibility ---------------------------------------------------
   Stored as the set of *hidden* keys rather than visible ones, deliberately:
   that way a column introduced in a later release shows up for existing
   installs instead of being silently absent from an old stored list (the same
   forward-compatibility reasoning `normalizeColumnOrder` uses when it appends
   missing keys). `order` stays the full list either way — hiding never
   removes a column from it, so unhiding puts it back where it was. */

/** Off on a fresh install. The seven columns the table has always shown stay
 *  on; ETA, Connections and Pieces are opt-in, because turning all three on by
 *  default pushes the table's minimum width past the default window and gives
 *  everyone a horizontal scrollbar they didn't ask for. Connections and Pieces
 *  are also diagnostics that the Detail window already covers in more depth —
 *  the table wants them available, not mandatory. */
export const DEFAULT_HIDDEN_COLUMNS: SortKey[] = ["eta", "conns", "pieces"];

/** Anything unrecognized falls back to `DEFAULT_HIDDEN_COLUMNS` rather than to
 *  "nothing hidden" — same defaults-on-garbage contract as
 *  `normalizeColumnWidths` and `normalizeColumnOrder` above.
 *
 *  At least one column must survive: a table with no columns has no headers
 *  left to right-click, which would strand the user with no way back. */
export function normalizeHiddenColumns(value: unknown): Set<SortKey> {
  if (!Array.isArray(value)) return new Set(DEFAULT_HIDDEN_COLUMNS);
  const out = new Set<SortKey>();
  for (const raw of value) {
    if (typeof raw === "string" && (DEFAULT_COLUMN_ORDER as string[]).includes(raw)) {
      out.add(raw as SortKey);
    }
  }
  if (out.size >= DEFAULT_COLUMN_ORDER.length) return new Set(DEFAULT_HIDDEN_COLUMNS);
  return out;
}

export function loadHiddenColumns(): Set<SortKey> {
  try {
    const raw = localStorage.getItem(COLUMN_HIDDEN_KEY);
    return normalizeHiddenColumns(raw ? JSON.parse(raw) : DEFAULT_HIDDEN_COLUMNS);
  } catch {
    return new Set(DEFAULT_HIDDEN_COLUMNS);
  }
}

export function saveHiddenColumns(hidden: Set<SortKey>): void {
  try {
    localStorage.setItem(COLUMN_HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    /* private mode / storage disabled — show/hide still works for this
       session, only persistence across relaunches is lost */
  }
}

/** The columns actually rendered, in order. Everything that walks the table's
 *  DOM by index — `useColumnWidths`'s `autoFit`, `useColumnOrder`'s drag math,
 *  `renderCell` — must use this, not the full `order`, or it lands one column
 *  off as soon as anything is hidden. */
export function visibleOrder(order: SortKey[], hidden: Set<SortKey>): SortKey[] {
  return order.filter((key) => !hidden.has(key));
}

/** Folds a reordering of the *visible* columns back into the full `order`,
 *  which still carries the hidden ones. Each hidden column stays anchored to
 *  the visible column it currently sits behind (or to the front of the list,
 *  if it sits before every visible one), so unhiding it later puts it back
 *  next to the neighbor it was last seen with rather than at the end. */
export function applyVisibleOrder(
  order: SortKey[],
  hidden: Set<SortKey>,
  nextVisible: SortKey[],
): SortKey[] {
  // `leading` holds hidden columns that precede every visible one; `trailing`
  // maps each visible column to the hidden columns that follow it.
  const leading: SortKey[] = [];
  const trailing = new Map<SortKey, SortKey[]>();
  let anchor: SortKey | null = null;
  for (const key of order) {
    if (hidden.has(key)) {
      if (anchor === null) leading.push(key);
      else trailing.get(anchor)!.push(key);
    } else {
      anchor = key;
      trailing.set(key, []);
    }
  }
  const out = [...leading];
  for (const key of nextVisible) {
    out.push(key, ...(trailing.get(key) ?? []));
  }
  return out;
}
