import { describe, it, expect } from "vitest";
import {
  dateBucket,
  groupOrder,
  normalizeCollapsedGroups,
  normalizeGroupBy,
} from "./grouping";

// A fixed instant so every test reasons about the same local midnight,
// regardless of when/where this suite actually runs.
// 2026-09-20T15:30:00 local time.
const NOW = new Date(2026, 8, 20, 15, 30, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(): number {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe("dateBucket", () => {
  it("buckets the exact start of today as today", () => {
    expect(dateBucket(startOfToday(), NOW)).toBe("today");
  });

  it("buckets 1ms before today's midnight as yesterday", () => {
    expect(dateBucket(startOfToday() - 1, NOW)).toBe("yesterday");
  });

  it("buckets exactly 1 day before today's midnight (start of yesterday) as yesterday", () => {
    expect(dateBucket(startOfToday() - DAY_MS, NOW)).toBe("yesterday");
  });

  it("buckets 1ms before the 1-day threshold as week", () => {
    expect(dateBucket(startOfToday() - DAY_MS - 1, NOW)).toBe("week");
  });

  it("buckets exactly 7 days before today's midnight as week", () => {
    expect(dateBucket(startOfToday() - 7 * DAY_MS, NOW)).toBe("week");
  });

  it("buckets exactly 30 days before today's midnight as month", () => {
    expect(dateBucket(startOfToday() - 30 * DAY_MS, NOW)).toBe("month");
  });

  it("buckets anything older than 30 days as older", () => {
    expect(dateBucket(startOfToday() - 30 * DAY_MS - 1, NOW)).toBe("older");
  });

  it("buckets a future timestamp as today rather than off the end", () => {
    expect(dateBucket(NOW + 10 * DAY_MS, NOW)).toBe("today");
  });
});

describe("normalizeGroupBy", () => {
  it("passes through valid values", () => {
    expect(normalizeGroupBy("category")).toBe("category");
    expect(normalizeGroupBy("date")).toBe("date");
    expect(normalizeGroupBy("none")).toBe("none");
  });

  it("falls back to none for anything else", () => {
    expect(normalizeGroupBy("bogus")).toBe("none");
    expect(normalizeGroupBy(null)).toBe("none");
    expect(normalizeGroupBy(undefined)).toBe("none");
    expect(normalizeGroupBy(42)).toBe("none");
  });
});

describe("normalizeCollapsedGroups", () => {
  it("keeps only string entries from an array", () => {
    expect(normalizeCollapsedGroups(["video", "audio", 5, null, "docs"])).toEqual(
      new Set(["video", "audio", "docs"]),
    );
  });

  it("returns an empty set for a non-array value", () => {
    expect(normalizeCollapsedGroups("video")).toEqual(new Set());
    expect(normalizeCollapsedGroups(null)).toEqual(new Set());
    expect(normalizeCollapsedGroups(undefined)).toEqual(new Set());
    expect(normalizeCollapsedGroups({ video: true })).toEqual(new Set());
  });

  it("returns an empty set for an empty array", () => {
    expect(normalizeCollapsedGroups([])).toEqual(new Set());
  });
});

describe("groupOrder", () => {
  it("returns the file categories in canonical order for category grouping", () => {
    expect(groupOrder("category")).toEqual([
      "video",
      "audio",
      "program",
      "docs",
      "archive",
      "other",
    ]);
  });

  it("returns the date buckets in canonical order for date grouping", () => {
    expect(groupOrder("date")).toEqual(["today", "yesterday", "week", "month", "older"]);
  });

  it("returns an empty list when grouping is off", () => {
    expect(groupOrder("none")).toEqual([]);
  });
});
