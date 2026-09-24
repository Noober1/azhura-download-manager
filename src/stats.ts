import type { DayRecord } from "./bindings";
import type { DlState, DownloadItem } from "./types";
import { TERMINAL_STATES } from "./constants";

export type DayStats = {
  bytes: number;
  activeMs: number;
  completed: number;
  /** Rows that ended in "error" this day. */
  errored: number;
  /** Rows that ended in "canceled" this day. */
  canceled: number;
  peakBps: number;
};
/** Keyed by local calendar day, "YYYY-MM-DD". */
export type StatsDays = Readonly<Record<string, DayStats>>;
export const EMPTY_DAY: DayStats = {
  bytes: 0,
  activeMs: 0,
  completed: 0,
  errored: 0,
  canceled: 0,
  peakBps: 0,
};

export type SeenRow = { downloaded: number; state: DlState };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The local calendar date as "YYYY-MM-DD", zero-padded. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** Sums `bytes`/`activeMs`/`completed`/`errored`/`canceled` and takes the max
 *  of `peakBps` — new object, `days` is never mutated. */
export function addToDay(days: StatsDays, key: string, patch: Partial<DayStats>): StatsDays {
  const existing = days[key] ?? EMPTY_DAY;
  const merged: DayStats = {
    bytes: existing.bytes + (patch.bytes ?? 0),
    activeMs: existing.activeMs + (patch.activeMs ?? 0),
    completed: existing.completed + (patch.completed ?? 0),
    errored: existing.errored + (patch.errored ?? 0),
    canceled: existing.canceled + (patch.canceled ?? 0),
    peakBps: Math.max(existing.peakBps, patch.peakBps ?? 0),
  };
  return { ...days, [key]: merged };
}

/** Merges two `StatsDays`, per key, with the same sum/max rules as `addToDay`. */
export function mergeDays(a: StatsDays, b: StatsDays): StatsDays {
  let out: StatsDays = { ...a };
  for (const key of Object.keys(b)) {
    out = addToDay(out, key, b[key]);
  }
  return out;
}

export function fromRecords(records: readonly DayRecord[]): StatsDays {
  const out: Record<string, DayStats> = {};
  for (const r of records) {
    out[r.day] = {
      bytes: r.bytes ?? 0,
      activeMs: r.activeMs ?? 0,
      completed: r.completed ?? 0,
      errored: r.errored ?? 0,
      canceled: r.canceled ?? 0,
      peakBps: r.peakBps ?? 0,
    };
  }
  return out;
}

export function toRecords(days: StatsDays): DayRecord[] {
  return Object.keys(days)
    .sort()
    .map((day) => ({ day, ...days[day] }));
}

/** Diffs `downloads` against the previously-seen snapshot to derive this
 *  tick's byte/completed/errored/canceled deltas — see the "Bytes semantics"
 *  note in the Batch 4b plan. Canceled/error transfers count bytes too; only
 *  a first-seen row (history load, resumable restore, backup import) is a
 *  pure baseline. A `downloaded` decrease (redownload restarting at 0)
 *  resets the baseline without going negative. `completed`/`errored`/
 *  `canceled` each count once per transition INTO that state (staying in it,
 *  or being seen there for the first time, doesn't count again). Deleted ids
 *  are pruned from the returned map. */
export function observeDownloads(
  seen: ReadonlyMap<string, SeenRow>,
  downloads: readonly DownloadItem[],
): { seen: Map<string, SeenRow>; bytes: number; completed: number; errored: number; canceled: number } {
  const next = new Map<string, SeenRow>();
  let bytes = 0;
  let completed = 0;
  let errored = 0;
  let canceled = 0;

  for (const d of downloads) {
    const prev = seen.get(d.id);
    if (prev) {
      if (d.downloaded > prev.downloaded) bytes += d.downloaded - prev.downloaded;
      if (d.state !== prev.state) {
        if (d.state === "completed") completed += 1;
        else if (d.state === "error") errored += 1;
        else if (d.state === "canceled") canceled += 1;
      }
    }
    next.set(d.id, { downloaded: d.downloaded, state: d.state });
  }

  return { seen: next, bytes, completed, errored, canceled };
}

type BackfillEntry = {
  state: string;
  downloaded: number;
  total: number | null;
  finishedAt: number;
};

/** Seeds `stats.json` once, from the terminal rows still in history.json —
 *  the only source available before any stats have been recorded. Those days
 *  get no `activeMs`/`peakBps`, since neither was ever tracked historically. */
export function backfillFromHistory(entries: readonly BackfillEntry[]): StatsDays {
  let days: StatsDays = {};
  for (const e of entries) {
    if (e.finishedAt <= 0) continue;
    if (!(TERMINAL_STATES as readonly string[]).includes(e.state)) continue;
    const bytes = e.downloaded > 0 ? e.downloaded : (e.total ?? 0);
    days = addToDay(days, dayKey(e.finishedAt), {
      bytes,
      completed: e.state === "completed" ? 1 : 0,
      errored: e.state === "error" ? 1 : 0,
      canceled: e.state === "canceled" ? 1 : 0,
    });
  }
  return days;
}

export function avgBps(s: DayStats): number | null {
  return s.activeMs > 0 ? (s.bytes * 1000) / s.activeMs : null;
}

/** The last `n` calendar days ending today, oldest first, zero-filled with
 *  `EMPTY_DAY`. Built with `new Date(y, m, d - i)` so month/year boundaries
 *  and DST land on the right date. */
export function dailySeries(
  days: StatsDays,
  todayMs: number,
  n = 30,
): { key: string; stats: DayStats }[] {
  const today = new Date(todayMs);
  const out: { key: string; stats: DayStats }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d.getTime());
    out.push({ key, stats: days[key] ?? EMPTY_DAY });
  }
  return out;
}

/** The last `n` months ending with the current one ("YYYY-MM" keys), each
 *  summing its days with the same rules as `mergeDays`. */
export function monthlySeries(
  days: StatsDays,
  todayMs: number,
  n = 12,
): { key: string; stats: DayStats }[] {
  const today = new Date(todayMs);
  const out: { key: string; stats: DayStats }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const stats = Object.keys(days)
      .filter((dk) => monthKey(dk) === key)
      .reduce<DayStats>(
        (acc, dk) => ({
          bytes: acc.bytes + days[dk].bytes,
          activeMs: acc.activeMs + days[dk].activeMs,
          completed: acc.completed + days[dk].completed,
          errored: acc.errored + days[dk].errored,
          canceled: acc.canceled + days[dk].canceled,
          peakBps: Math.max(acc.peakBps, days[dk].peakBps),
        }),
        EMPTY_DAY,
      );
    out.push({ key, stats });
  }
  return out;
}

export function summarize(
  days: StatsDays,
  todayMs: number,
): {
  totalBytes: number;
  totalCompleted: number;
  totalErrored: number;
  totalCanceled: number;
  todayBytes: number;
  monthBytes: number;
  avgBps30: number | null;
  peakBps: number;
  firstDay: string | null;
} {
  const keys = Object.keys(days);
  let totalBytes = 0;
  let totalCompleted = 0;
  let totalErrored = 0;
  let totalCanceled = 0;
  let peakBps = 0;
  let firstDay: string | null = null;

  for (const key of keys) {
    const s = days[key];
    totalBytes += s.bytes;
    totalCompleted += s.completed;
    totalErrored += s.errored;
    totalCanceled += s.canceled;
    peakBps = Math.max(peakBps, s.peakBps);
    if (firstDay === null || key < firstDay) firstDay = key;
  }

  const today = dayKey(todayMs);
  const todayBytes = days[today]?.bytes ?? 0;
  const month = monthKey(today);
  const monthBytes = keys
    .filter((k) => monthKey(k) === month)
    .reduce((sum, k) => sum + days[k].bytes, 0);

  const last30 = dailySeries(days, todayMs, 30);
  let sumBytes = 0;
  let sumActiveMs = 0;
  for (const { stats } of last30) {
    if (stats.activeMs > 0) {
      sumBytes += stats.bytes;
      sumActiveMs += stats.activeMs;
    }
  }
  const avgBps30 = sumActiveMs > 0 ? (sumBytes * 1000) / sumActiveMs : null;

  return {
    totalBytes,
    totalCompleted,
    totalErrored,
    totalCanceled,
    todayBytes,
    monthBytes,
    avgBps30,
    peakBps,
    firstDay,
  };
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** The y-axis top: the smallest of {1, 2, 2.5, 5, 10} x 10^k that is >= v. */
export function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  for (let k = exp - 1; k <= exp + 1; k++) {
    const scale = 10 ** k;
    for (const step of NICE_STEPS) {
      const candidate = step * scale;
      if (candidate >= v) return candidate;
    }
  }
  return v;
}

export function formatDayLabel(key: string, withYear = false): string {
  const [y, m, d] = key.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return withYear ? `${d} ${month} ${y}` : `${d} ${month}`;
}

export function formatMonthLabel(key: string, withYear = false): string {
  const [y, m] = key.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return withYear ? `${month} ${y}` : month;
}
