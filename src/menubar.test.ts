import { describe, it, expect } from "vitest";
import {
  altTapStep,
  firstEnabledIndex,
  lastEnabledIndex,
  splitMnemonic,
  stepEnabledIndex,
  type MenuItem,
} from "./menubar";

describe("altTapStep", () => {
  it("arms on a bare Alt keydown", () => {
    const r = altTapStep(false, { type: "keydown", key: "Alt", repeat: false });
    expect(r).toEqual({ armed: true, toggle: false });
  });

  it("does not re-arm on an autorepeat Alt keydown after it was disarmed", () => {
    const r = altTapStep(false, { type: "keydown", key: "Alt", repeat: true });
    expect(r).toEqual({ armed: false, toggle: false });
  });

  it("stays armed on an autorepeat Alt keydown while already armed", () => {
    const r = altTapStep(true, { type: "keydown", key: "Alt", repeat: true });
    expect(r).toEqual({ armed: true, toggle: false });
  });

  it("disarms on a keydown of any other key", () => {
    const r = altTapStep(true, { type: "keydown", key: "Enter", repeat: false });
    expect(r).toEqual({ armed: false, toggle: false });
  });

  it("toggles on Alt keyup while armed", () => {
    const r = altTapStep(true, { type: "keyup", key: "Alt" });
    expect(r).toEqual({ armed: false, toggle: true });
  });

  it("does not toggle on Alt keyup while disarmed", () => {
    const r = altTapStep(false, { type: "keyup", key: "Alt" });
    expect(r).toEqual({ armed: false, toggle: false });
  });

  it("leaves armed state unchanged on a keyup of any other key", () => {
    expect(altTapStep(true, { type: "keyup", key: "Enter" })).toEqual({
      armed: true,
      toggle: false,
    });
    expect(altTapStep(false, { type: "keyup", key: "Enter" })).toEqual({
      armed: false,
      toggle: false,
    });
  });

  it("disarms on interrupt", () => {
    const r = altTapStep(true, { type: "interrupt" });
    expect(r).toEqual({ armed: false, toggle: false });
  });

  it("produces no toggle for Alt held through another key (Alt+Enter)", () => {
    let armed = false;
    ({ armed } = altTapStep(armed, { type: "keydown", key: "Alt", repeat: false }));
    // The browser also autorepeats the held Alt key while another key goes down.
    ({ armed } = altTapStep(armed, { type: "keydown", key: "Alt", repeat: true }));
    let toggle: boolean;
    ({ armed, toggle } = altTapStep(armed, { type: "keydown", key: "Enter", repeat: false }));
    expect(toggle).toBe(false);
    ({ armed, toggle } = altTapStep(armed, { type: "keyup", key: "Enter" }));
    expect(toggle).toBe(false);
    ({ armed, toggle } = altTapStep(armed, { type: "keyup", key: "Alt" }));
    expect(toggle).toBe(false);
  });

  it("produces exactly one toggle for a plain Alt tap", () => {
    let armed = false;
    let toggle: boolean;
    ({ armed, toggle } = altTapStep(armed, { type: "keydown", key: "Alt", repeat: false }));
    expect(toggle).toBe(false);
    ({ armed, toggle } = altTapStep(armed, { type: "keyup", key: "Alt" }));
    expect(toggle).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const item = (overrides: Partial<Extract<MenuItem, { kind: "item" }>> = {}): MenuItem => ({
  kind: "item",
  label: "Item",
  onSelect: () => {},
  ...overrides,
});
const submenu = (overrides: Partial<Extract<MenuItem, { kind: "submenu" }>> = {}): MenuItem => ({
  kind: "submenu",
  label: "Submenu",
  items: [],
  ...overrides,
});
const sep: MenuItem = { kind: "separator" };

describe("firstEnabledIndex / lastEnabledIndex", () => {
  it("skips a leading separator", () => {
    const items = [sep, item(), item()];
    expect(firstEnabledIndex(items)).toBe(1);
  });

  it("skips disabled items", () => {
    const items = [item({ disabled: true }), item({ disabled: true }), item()];
    expect(firstEnabledIndex(items)).toBe(2);
    expect(lastEnabledIndex(items)).toBe(2);
  });

  it("returns -1 for a menu of only separators/disabled items", () => {
    const items = [sep, item({ disabled: true }), sep];
    expect(firstEnabledIndex(items)).toBe(-1);
    expect(lastEnabledIndex(items)).toBe(-1);
  });

  it("treats an enabled submenu row as selectable", () => {
    const items = [sep, submenu()];
    expect(firstEnabledIndex(items)).toBe(1);
  });

  it("skips a disabled submenu row", () => {
    const items = [submenu({ disabled: true }), item()];
    expect(firstEnabledIndex(items)).toBe(1);
  });
});

describe("stepEnabledIndex", () => {
  it("wraps forward past the last item", () => {
    const items = [item(), sep, item()];
    expect(stepEnabledIndex(items, 2, 1)).toBe(0);
  });

  it("wraps backward past the first item", () => {
    const items = [item(), sep, item()];
    expect(stepEnabledIndex(items, 0, -1)).toBe(2);
  });

  it("skips a leading separator when wrapping backward", () => {
    const items = [sep, item(), item()];
    expect(stepEnabledIndex(items, 1, -1)).toBe(2);
  });

  it("skips disabled items in both directions", () => {
    const items = [item(), item({ disabled: true }), item()];
    expect(stepEnabledIndex(items, 0, 1)).toBe(2);
    expect(stepEnabledIndex(items, 2, -1)).toBe(0);
  });

  it("leaves `from` unchanged when nothing in the menu is selectable", () => {
    const items = [sep, item({ disabled: true }), sep];
    expect(stepEnabledIndex(items, 0, 1)).toBe(0);
    expect(stepEnabledIndex(items, -1, 1)).toBe(-1);
  });

  it("returns `from` unchanged for an empty menu", () => {
    expect(stepEnabledIndex([], 0, 1)).toBe(0);
  });
});

describe("splitMnemonic", () => {
  it("splits at a leading mnemonic", () => {
    expect(splitMnemonic("File", "F")).toEqual({ before: "", letter: "F", after: "ile" });
  });

  it("splits at a mnemonic in the middle of the label", () => {
    expect(splitMnemonic("Downloads", "o")).toEqual({
      before: "D",
      letter: "o",
      after: "wnloads",
    });
  });

  it("matches case-insensitively but preserves the label's own casing", () => {
    expect(splitMnemonic("View", "v")).toEqual({ before: "", letter: "V", after: "iew" });
  });

  it("puts the whole label in `after` when the mnemonic isn't in it", () => {
    expect(splitMnemonic("Help", "z")).toEqual({ before: "", letter: "", after: "Help" });
  });

  it("matches only the first occurrence", () => {
    expect(splitMnemonic("Tools", "o")).toEqual({ before: "T", letter: "o", after: "ols" });
  });
});
