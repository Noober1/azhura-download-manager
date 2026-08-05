import { describe, it, expect } from "vitest";
import { normalizeTheme } from "./theme";

describe("normalizeTheme", () => {
  it("passes through recognized theme values", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("system")).toBe("system");
  });

  it("falls back to 'system' for anything unrecognized", () => {
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme(123)).toBe("system");
    expect(normalizeTheme("bogus")).toBe("system");
  });
});
