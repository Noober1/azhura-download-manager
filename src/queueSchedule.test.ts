import { describe, it, expect } from "vitest";
import { isBeforeTarget } from "./queueSchedule";

/** 2026-08-27 at the given local time. */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 7, 27, hours, minutes, 0, 0);
}

describe("isBeforeTarget", () => {
  it("holds while the target is still ahead today", () => {
    expect(isBeforeTarget(at(1, 59), "02:00")).toBe(true);
    expect(isBeforeTarget(at(0, 0), "23:59")).toBe(true);
  });

  it("releases once the target has passed", () => {
    expect(isBeforeTarget(at(2, 1), "02:00")).toBe(false);
    expect(isBeforeTarget(at(23, 59), "02:00")).toBe(false);
  });

  it("releases exactly at the target", () => {
    expect(isBeforeTarget(at(2, 0), "02:00")).toBe(false);
  });

  it("never holds on a malformed time — a bad setting must not strand the queue", () => {
    expect(isBeforeTarget(at(1, 0), "")).toBe(false);
    expect(isBeforeTarget(at(1, 0), "9:5")).toBe(false);
    expect(isBeforeTarget(at(1, 0), "25:00")).toBe(false);
    expect(isBeforeTarget(at(1, 0), "12:70")).toBe(false);
    expect(isBeforeTarget(at(1, 0), "02:00:00")).toBe(false);
  });
});
