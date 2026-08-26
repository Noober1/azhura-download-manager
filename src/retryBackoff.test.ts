import { describe, it, expect } from "vitest";
import { retryBackoffMs, RETRY_BACKOFF_CAP_MS } from "./retryBackoff";

describe("retryBackoffMs", () => {
  it("doubles each attempt: 2s, 4s, 8s, 16s", () => {
    expect(retryBackoffMs(1)).toBe(2_000);
    expect(retryBackoffMs(2)).toBe(4_000);
    expect(retryBackoffMs(3)).toBe(8_000);
    expect(retryBackoffMs(4)).toBe(16_000);
  });

  it("caps at RETRY_BACKOFF_CAP_MS from attempt 5 onward", () => {
    expect(retryBackoffMs(5)).toBe(RETRY_BACKOFF_CAP_MS);
    expect(retryBackoffMs(6)).toBe(RETRY_BACKOFF_CAP_MS);
  });

  it("never exceeds the cap for a large attempt number", () => {
    expect(retryBackoffMs(10)).toBe(RETRY_BACKOFF_CAP_MS);
    expect(retryBackoffMs(50)).toBe(RETRY_BACKOFF_CAP_MS);
  });
});
