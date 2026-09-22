import { describe, it, expect } from "vitest";
import {
  dayKey,
  monthKey,
  addToDay,
  mergeDays,
  observeDownloads,
  backfillFromHistory,
  dailySeries,
  monthlySeries,
  summarize,
  niceCeil,
  formatDayLabel,
  formatMonthLabel,
  EMPTY_DAY,
  type StatsDays,
  type SeenRow,
} from "./stats";
import type { DownloadItem } from "./types";
import { DEFAULT_PROXY } from "./types";

function item(id: string, state: DownloadItem["state"], downloaded: number): DownloadItem {
  return {
    id,
    url: "https://example.com/file.zip",
    headers: [],
    connections: 1,
    allowInsecure: false,
    checksum: "",
    speedLimit: 0,
    filename: `${id}.zip`,
    filenameOverride: "",
    path: "",
    savePath: "",
    proxy: DEFAULT_PROXY,
    total: null,
    downloaded,
    speed: 0,
    usedConnections: 1,
    numPieces: 0,
    pieceSize: 0,
    conns: [],
    state,
    addedAt: 0,
  };
}

describe("dayKey", () => {
  it("pads month and day to two digits", () => {
    expect(dayKey(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 8, 22).getTime())).toBe("2026-09-22");
  });
});

describe("addToDay / mergeDays", () => {
  it("sums bytes/activeMs/completed/errored/canceled and maxes peakBps, without mutating input", () => {
    const days: StatsDays = {
      "2026-09-01": { bytes: 10, activeMs: 100, completed: 1, errored: 1, canceled: 1, peakBps: 500 },
    };
    const before = JSON.stringify(days);
    const next = addToDay(days, "2026-09-01", {
      bytes: 5,
      activeMs: 50,
      completed: 1,
      errored: 2,
      canceled: 3,
      peakBps: 900,
    });
    expect(JSON.stringify(days)).toBe(before);
    expect(next["2026-09-01"]).toEqual({
      bytes: 15,
      activeMs: 150,
      completed: 2,
      errored: 3,
      canceled: 4,
      peakBps: 900,
    });
  });

  it("addToDay creates a fresh day from EMPTY_DAY when the key is new", () => {
    const next = addToDay({}, "2026-09-02", { bytes: 7 });
    expect(next["2026-09-02"]).toEqual({ ...EMPTY_DAY, bytes: 7 });
  });

  it("mergeDays combines two StatsDays per key with the same rules", () => {
    const a: StatsDays = { "2026-09-01": { ...EMPTY_DAY, bytes: 10, peakBps: 100 } };
    const b: StatsDays = {
      "2026-09-01": { ...EMPTY_DAY, bytes: 5, peakBps: 200 },
      "2026-09-02": { ...EMPTY_DAY, bytes: 3 },
    };
    const merged = mergeDays(a, b);
    expect(merged["2026-09-01"]).toEqual({ ...EMPTY_DAY, bytes: 15, peakBps: 200 });
    expect(merged["2026-09-02"]).toEqual({ ...EMPTY_DAY, bytes: 3 });
  });
});

describe("observeDownloads", () => {
  it("a first-seen row adds 0 bytes and 0 completed/errored/canceled", () => {
    const { seen, bytes, completed, errored, canceled } = observeDownloads(new Map(), [
      item("a", "downloading", 500),
    ]);
    expect(bytes).toBe(0);
    expect(completed).toBe(0);
    expect(errored).toBe(0);
    expect(canceled).toBe(0);
    expect(seen.get("a")).toEqual({ downloaded: 500, state: "downloading" });
  });

  it("a positive delta on an already-seen row is counted", () => {
    const prevSeen = new Map<string, SeenRow>([["a", { downloaded: 100, state: "downloading" }]]);
    const { bytes } = observeDownloads(prevSeen, [item("a", "downloading", 300)]);
    expect(bytes).toBe(200);
  });

  it("a decrease adds 0 bytes and resets the baseline", () => {
    const prevSeen = new Map<string, SeenRow>([["a", { downloaded: 500, state: "downloading" }]]);
    const { seen, bytes } = observeDownloads(prevSeen, [item("a", "downloading", 0)]);
    expect(bytes).toBe(0);
    expect(seen.get("a")).toEqual({ downloaded: 0, state: "downloading" });
  });

  it("moving to completed counts once, staying completed doesn't count again", () => {
    const prevSeen = new Map<string, SeenRow>([["a", { downloaded: 900, state: "downloading" }]]);
    const first = observeDownloads(prevSeen, [item("a", "completed", 1000)]);
    expect(first.completed).toBe(1);
    const second = observeDownloads(first.seen, [item("a", "completed", 1000)]);
    expect(second.completed).toBe(0);
  });

  it("moving to error counts once, staying error doesn't count again", () => {
    const prevSeen = new Map<string, SeenRow>([["a", { downloaded: 300, state: "downloading" }]]);
    const first = observeDownloads(prevSeen, [item("a", "error", 300)]);
    expect(first.errored).toBe(1);
    expect(first.completed).toBe(0);
    expect(first.canceled).toBe(0);
    const second = observeDownloads(first.seen, [item("a", "error", 300)]);
    expect(second.errored).toBe(0);
  });

  it("moving to canceled counts once, staying canceled doesn't count again", () => {
    const prevSeen = new Map<string, SeenRow>([["a", { downloaded: 300, state: "paused" }]]);
    const first = observeDownloads(prevSeen, [item("a", "canceled", 300)]);
    expect(first.canceled).toBe(1);
    expect(first.completed).toBe(0);
    expect(first.errored).toBe(0);
    const second = observeDownloads(first.seen, [item("a", "canceled", 300)]);
    expect(second.canceled).toBe(0);
  });

  it("prunes deleted ids from the returned seen map", () => {
    const prevSeen = new Map<string, SeenRow>([
      ["a", { downloaded: 100, state: "downloading" }],
      ["b", { downloaded: 100, state: "downloading" }],
    ]);
    const { seen } = observeDownloads(prevSeen, [item("a", "downloading", 100)]);
    expect(seen.has("b")).toBe(false);
    expect(seen.has("a")).toBe(true);
  });
});

describe("backfillFromHistory", () => {
  it("completed/canceled/error rows add bytes, each to its own counter", () => {
    const days = backfillFromHistory([
      { state: "completed", downloaded: 1000, total: null, finishedAt: 1000 },
      { state: "canceled", downloaded: 200, total: null, finishedAt: 1000 },
      { state: "error", downloaded: 50, total: null, finishedAt: 1000 },
    ]);
    const key = dayKey(1000);
    expect(days[key].bytes).toBe(1250);
    expect(days[key].completed).toBe(1);
    expect(days[key].errored).toBe(1);
    expect(days[key].canceled).toBe(1);
  });

  it("downloaded 0 falls back to total", () => {
    const days = backfillFromHistory([
      { state: "completed", downloaded: 0, total: 5000, finishedAt: 1000 },
    ]);
    expect(days[dayKey(1000)].bytes).toBe(5000);
  });

  it("finishedAt 0 is skipped", () => {
    const days = backfillFromHistory([
      { state: "completed", downloaded: 1000, total: null, finishedAt: 0 },
    ]);
    expect(Object.keys(days)).toHaveLength(0);
  });

  it("skips non-terminal states", () => {
    const days = backfillFromHistory([
      { state: "downloading", downloaded: 1000, total: null, finishedAt: 1000 },
    ]);
    expect(Object.keys(days)).toHaveLength(0);
  });
});

describe("dailySeries", () => {
  it("crosses a month boundary, zero-fills, and ends on today", () => {
    const today = new Date(2026, 2, 2).getTime(); // 2 Mar 2026
    const days: StatsDays = {
      "2026-02-28": { ...EMPTY_DAY, bytes: 100 },
    };
    const series = dailySeries(days, today, 5);
    expect(series).toHaveLength(5);
    expect(series[0].key).toBe("2026-02-26");
    expect(series[4].key).toBe("2026-03-02");
    expect(series.find((s) => s.key === "2026-02-28")!.stats.bytes).toBe(100);
    expect(series.find((s) => s.key === "2026-02-27")!.stats).toEqual(EMPTY_DAY);
  });
});

describe("monthlySeries", () => {
  it("crosses a year boundary and sums each month's days", () => {
    const today = new Date(2026, 0, 15).getTime(); // 15 Jan 2026
    const days: StatsDays = {
      "2025-12-30": { ...EMPTY_DAY, bytes: 100, completed: 1, peakBps: 200 },
      "2025-12-31": { ...EMPTY_DAY, bytes: 50, peakBps: 300 },
      "2026-01-01": { ...EMPTY_DAY, bytes: 10, peakBps: 50 },
    };
    const series = monthlySeries(days, today, 2);
    expect(series.map((s) => s.key)).toEqual(["2025-12", "2026-01"]);
    expect(series[0].stats).toEqual({ ...EMPTY_DAY, bytes: 150, completed: 1, peakBps: 300 });
    expect(series[1].stats.bytes).toBe(10);
  });
});

describe("summarize", () => {
  it("avgBps30 ignores backfilled days (activeMs 0) and is null with no active time", () => {
    const today = new Date(2026, 8, 22).getTime();
    const days: StatsDays = {
      [dayKey(today)]: { ...EMPTY_DAY, bytes: 1000, completed: 1, peakBps: 100 },
    };
    expect(summarize(days, today).avgBps30).toBeNull();

    const withActive: StatsDays = mergeDays(days, {
      [dayKey(today)]: { ...EMPTY_DAY, bytes: 2000, activeMs: 1000 },
    });
    const s = summarize(withActive, today);
    expect(s.avgBps30).toBe(3000);
  });

  it("totals completed/errored/canceled across all days", () => {
    const days: StatsDays = {
      "2026-09-01": { ...EMPTY_DAY, completed: 2, errored: 1 },
      "2026-09-02": { ...EMPTY_DAY, completed: 1, canceled: 3 },
    };
    const s = summarize(days, Date.now());
    expect(s.totalCompleted).toBe(3);
    expect(s.totalErrored).toBe(1);
    expect(s.totalCanceled).toBe(3);
  });
});

describe("niceCeil", () => {
  it.each([
    [0, 0],
    [7, 10],
    [1.3, 2],
    [2.2, 2.5],
    [4000, 5000],
  ])("niceCeil(%d) === %d", (input, expected) => {
    expect(niceCeil(input)).toBe(expected);
  });
});

describe("label formatters", () => {
  it("formatDayLabel", () => {
    expect(formatDayLabel("2026-09-22")).toBe("22 Sep");
    expect(formatDayLabel("2026-09-22", true)).toBe("22 Sep 2026");
  });

  it("formatMonthLabel", () => {
    expect(formatMonthLabel("2026-09")).toBe("Sep");
    expect(formatMonthLabel("2026-09", true)).toBe("Sep 2026");
  });
});

describe("monthKey", () => {
  it("slices the day key down to YYYY-MM", () => {
    expect(monthKey("2026-09-22")).toBe("2026-09");
  });
});
