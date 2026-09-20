import { describe, it, expect } from "vitest";
import { accelFromEvent } from "./hotkey";

function key(
  code: string,
  overrides: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {},
) {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("accelFromEvent", () => {
  it("builds a Ctrl+Alt+letter accelerator", () => {
    expect(accelFromEvent(key("KeyD", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+D");
  });

  it("builds a Ctrl+Shift+digit accelerator", () => {
    expect(accelFromEvent(key("Digit5", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+5");
  });

  it("builds an Alt+function-key accelerator", () => {
    expect(accelFromEvent(key("F9", { altKey: true }))).toBe("Alt+F9");
  });

  it("returns null for a shift-only combo with no other modifier", () => {
    expect(accelFromEvent(key("KeyD", { shiftKey: true }))).toBeNull();
  });

  it("returns null for a bare key with no modifier", () => {
    expect(accelFromEvent(key("KeyD"))).toBeNull();
  });

  it("returns null for a modifier key pressed alone", () => {
    expect(accelFromEvent(key("ControlLeft", { ctrlKey: true }))).toBeNull();
  });

  it("returns null for an unsupported key like Space", () => {
    expect(accelFromEvent(key("Space", { ctrlKey: true }))).toBeNull();
  });
});
