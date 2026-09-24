import { describe, it, expect } from "vitest";
import { formatRetry, isValidPin, pinFormError, sanitizePinInput } from "./lock";

describe("sanitizePinInput", () => {
  it("strips non-digit characters", () => {
    expect(sanitizePinInput("12a 3-4")).toBe("1234");
  });

  it("cuts the value at 8 digits", () => {
    expect(sanitizePinInput("123456789012")).toBe("12345678");
  });
});

describe("isValidPin", () => {
  it("accepts 4 to 8 digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
  });

  it("rejects too short, too long, or non-numeric values", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });
});

describe("pinFormError", () => {
  it("flags an invalid PIN before checking the confirmation", () => {
    expect(pinFormError("123", "123")).toBe("PIN must be 4–8 digits");
  });

  it("flags a mismatched confirmation", () => {
    expect(pinFormError("1234", "4321")).toBe("PINs don't match");
  });

  it("returns null when the PIN is valid and confirmed", () => {
    expect(pinFormError("1234", "1234")).toBeNull();
  });
});

describe("formatRetry", () => {
  it("formats under a minute as seconds", () => {
    expect(formatRetry(30)).toBe("Try again in 30s");
  });

  it("formats a minute or more as minutes and seconds", () => {
    expect(formatRetry(125)).toBe("Try again in 2m 5s");
  });

  it("omits the seconds when the remainder is exactly on a minute", () => {
    expect(formatRetry(120)).toBe("Try again in 2m");
  });
});
