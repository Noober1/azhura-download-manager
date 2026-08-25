import { describe, it, expect } from "vitest";
import type { SortKey } from "./constants";
import {
  clampWidth,
  normalizeColumnWidths,
  normalizeColumnOrder,
  moveColumn,
  totalWidth,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "./columns";

describe("clampWidth", () => {
  it("floors at MIN_COLUMN_WIDTH", () => {
    expect(clampWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(-100)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(1)).toBe(MIN_COLUMN_WIDTH);
  });

  it("caps at MAX_COLUMN_WIDTH", () => {
    expect(clampWidth(10000)).toBe(MAX_COLUMN_WIDTH);
  });

  it("rounds fractional values", () => {
    expect(clampWidth(120.4)).toBe(120);
    expect(clampWidth(120.6)).toBe(121);
  });

  it("falls back to MIN_COLUMN_WIDTH for non-finite input", () => {
    expect(clampWidth(NaN)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(Infinity)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(-Infinity)).toBe(MIN_COLUMN_WIDTH);
  });
});

describe("normalizeColumnWidths", () => {
  it("returns defaults for unrecognized values", () => {
    expect(normalizeColumnWidths(undefined)).toEqual(DEFAULT_COLUMN_WIDTHS);
    expect(normalizeColumnWidths(null)).toEqual(DEFAULT_COLUMN_WIDTHS);
    expect(normalizeColumnWidths("garbage")).toEqual(DEFAULT_COLUMN_WIDTHS);
    expect(normalizeColumnWidths(["not", "an", "object"])).toEqual(DEFAULT_COLUMN_WIDTHS);
    expect(normalizeColumnWidths(42)).toEqual(DEFAULT_COLUMN_WIDTHS);
  });

  it("fills in missing keys from defaults", () => {
    const result = normalizeColumnWidths({ name: 300 });
    expect(result.name).toBe(300);
    for (const key of DEFAULT_COLUMN_ORDER) {
      if (key !== "name") expect(result[key]).toBe(DEFAULT_COLUMN_WIDTHS[key]);
    }
  });

  it("clamps out-of-range numbers per key", () => {
    const result = normalizeColumnWidths({ name: 5, speed: 99999 });
    expect(result.name).toBe(MIN_COLUMN_WIDTH);
    expect(result.speed).toBe(MAX_COLUMN_WIDTH);
  });

  it("ignores non-numeric values for a key and falls back to its default", () => {
    const result = normalizeColumnWidths({ name: "wide", added: null });
    expect(result.name).toBe(DEFAULT_COLUMN_WIDTHS.name);
    expect(result.added).toBe(DEFAULT_COLUMN_WIDTHS.added);
  });

  it("drops unknown keys", () => {
    const result = normalizeColumnWidths({ bogus: 200 });
    expect((result as Record<string, number>).bogus).toBeUndefined();
    expect(result).toEqual(DEFAULT_COLUMN_WIDTHS);
  });
});

describe("totalWidth", () => {
  it("sums all columns in order", () => {
    const expected = DEFAULT_COLUMN_ORDER.reduce((sum, key) => sum + DEFAULT_COLUMN_WIDTHS[key], 0);
    expect(totalWidth(DEFAULT_COLUMN_WIDTHS)).toBe(expected);
  });
});

describe("normalizeColumnOrder", () => {
  it("returns the default order for unrecognized values", () => {
    expect(normalizeColumnOrder(undefined)).toEqual(DEFAULT_COLUMN_ORDER);
    expect(normalizeColumnOrder(null)).toEqual(DEFAULT_COLUMN_ORDER);
    expect(normalizeColumnOrder("garbage")).toEqual(DEFAULT_COLUMN_ORDER);
    expect(normalizeColumnOrder(42)).toEqual(DEFAULT_COLUMN_ORDER);
    expect(normalizeColumnOrder({ not: "an array" })).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("drops unrecognized keys", () => {
    const result = normalizeColumnOrder(["speed", "bogus", "name"]);
    expect(result).not.toContain("bogus");
  });

  it("drops duplicates, keeping the first occurrence's position", () => {
    const result = normalizeColumnOrder(["speed", "name", "speed", "added"]);
    expect(result.filter((k) => k === "speed")).toHaveLength(1);
    expect(result[0]).toBe("speed");
  });

  it("appends any column missing from the stored value at its default position", () => {
    const result = normalizeColumnOrder(["speed", "name"]);
    expect(result).toHaveLength(DEFAULT_COLUMN_ORDER.length);
    // Every default column not explicitly listed follows, in default order.
    const rest = DEFAULT_COLUMN_ORDER.filter((k) => k !== "speed" && k !== "name");
    expect(result.slice(2)).toEqual(rest);
  });

  it("round-trips a full valid permutation unchanged", () => {
    const permuted = [...DEFAULT_COLUMN_ORDER].reverse();
    expect(normalizeColumnOrder(permuted)).toEqual(permuted);
  });
});

describe("moveColumn", () => {
  it("moves a column forward", () => {
    const result = moveColumn(["name", "added", "status", "size"], 0, 2);
    expect(result).toEqual(["added", "status", "name", "size"]);
  });

  it("moves a column backward", () => {
    const result = moveColumn(["name", "added", "status", "size"], 3, 1);
    expect(result).toEqual(["name", "size", "added", "status"]);
  });

  it("does not mutate the input array", () => {
    const order = ["name", "added", "status", "size"] as const;
    const original = [...order];
    moveColumn([...order], 0, 2);
    expect(order).toEqual(original);
  });

  it("returns the same array reference for a no-op move", () => {
    const order: SortKey[] = ["name", "added", "status", "size"];
    expect(moveColumn(order, 1, 1)).toBe(order);
  });

  it("returns the same array reference for an out-of-range index", () => {
    const order: SortKey[] = ["name", "added", "status", "size"];
    expect(moveColumn(order, -1, 2)).toBe(order);
    expect(moveColumn(order, 0, 99)).toBe(order);
  });
});
