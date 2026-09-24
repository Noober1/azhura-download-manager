import { describe, it, expect } from "vitest";
import { shouldShowWhatsNew } from "./whatsNew";

describe("shouldShowWhatsNew", () => {
  it("shows when nothing was seen yet", () => {
    expect(shouldShowWhatsNew(null, "0.2.5")).toBe(true);
  });

  it("stays hidden when the seen version matches", () => {
    expect(shouldShowWhatsNew("0.2.5", "0.2.5")).toBe(false);
  });

  it("shows on upgrade or downgrade", () => {
    expect(shouldShowWhatsNew("0.2.4", "0.2.5")).toBe(true);
    expect(shouldShowWhatsNew("0.2.6", "0.2.5")).toBe(true);
  });

  it("stays hidden while the current version is still unknown", () => {
    expect(shouldShowWhatsNew(null, "")).toBe(false);
  });
});
