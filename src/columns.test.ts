import { describe, it, expect } from "vitest";
import {
  clampWidth,
  normalizeColumnWidths,
  totalWidth,
  COLUMN_ORDER,
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
    for (const key of COLUMN_ORDER) {
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
    const expected = COLUMN_ORDER.reduce((sum, key) => sum + DEFAULT_COLUMN_WIDTHS[key], 0);
    expect(totalWidth(DEFAULT_COLUMN_WIDTHS)).toBe(expected);
  });
});
