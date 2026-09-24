import { describe, it, expect } from "vitest";
import {
  moveRule,
  newRule,
  removeRule,
  targetIncomplete,
  updateRule,
  type AutoRule,
} from "./autoRules";

function rule(overrides: Partial<AutoRule> = {}): AutoRule {
  return { ...newRule(), id: "r1", ...overrides };
}

describe("moveRule", () => {
  it("swaps a rule with its next neighbor", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];
    const moved = moveRule(rules, 0, 1);
    expect(moved.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("swaps a rule with its previous neighbor", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];
    const moved = moveRule(rules, 2, -1);
    expect(moved.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op moving the first rule up", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];
    const moved = moveRule(rules, 0, -1);
    expect(moved).toBe(rules);
  });

  it("is a no-op moving the last rule down", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];
    const moved = moveRule(rules, 1, 1);
    expect(moved).toBe(rules);
  });
});

describe("updateRule", () => {
  it("patches only the matching rule and leaves the original array untouched", () => {
    const rules = [rule({ id: "a", pattern: "*.zip" }), rule({ id: "b", pattern: "*.iso" })];
    const updated = updateRule(rules, "a", { pattern: "*.rar" });
    expect(updated[0].pattern).toBe("*.rar");
    expect(updated[1].pattern).toBe("*.iso");
    expect(rules[0].pattern).toBe("*.zip");
  });
});

describe("removeRule", () => {
  it("drops the matching rule and leaves the original array untouched", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];
    const removed = removeRule(rules, "a");
    expect(removed.map((r) => r.id)).toEqual(["b"]);
    expect(rules.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("targetIncomplete", () => {
  it("flags an empty folder", () => {
    expect(targetIncomplete(rule({ target: "folder", folder: "" }))).toBe(true);
  });

  it("flags a relative folder", () => {
    expect(targetIncomplete(rule({ target: "folder", folder: "Downloads\\Foo" }))).toBe(true);
  });

  it("accepts a Windows drive-letter path", () => {
    expect(targetIncomplete(rule({ target: "folder", folder: "D:\\ISO" }))).toBe(false);
  });

  it("accepts a UNC path", () => {
    expect(targetIncomplete(rule({ target: "folder", folder: "\\\\server\\share" }))).toBe(false);
  });

  it("accepts a POSIX absolute path", () => {
    expect(targetIncomplete(rule({ target: "folder", folder: "/mnt/downloads" }))).toBe(false);
  });

  it("never flags a category target", () => {
    expect(targetIncomplete(rule({ target: "category", category: "video", folder: "" }))).toBe(
      false,
    );
  });
});
