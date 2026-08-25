import { describe, it, expect } from "vitest";
import { pushSpeedSample, sparklinePoints, SPEED_SAMPLE_CAP } from "./speedHistory";

describe("pushSpeedSample", () => {
  it("appends to an empty history", () => {
    expect(pushSpeedSample([], 100)).toEqual([100]);
  });

  it("appends in order", () => {
    expect(pushSpeedSample([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const history = [1, 2];
    pushSpeedSample(history, 3);
    expect(history).toEqual([1, 2]);
  });

  it("drops the oldest sample once the cap is exceeded", () => {
    const result = pushSpeedSample([1, 2, 3], 4, 3);
    expect(result).toEqual([2, 3, 4]);
  });

  it("defaults to SPEED_SAMPLE_CAP", () => {
    const full = Array.from({ length: SPEED_SAMPLE_CAP }, (_, i) => i);
    const result = pushSpeedSample(full, 999);
    expect(result).toHaveLength(SPEED_SAMPLE_CAP);
    expect(result[result.length - 1]).toBe(999);
    expect(result[0]).toBe(1);
  });
});

describe("sparklinePoints", () => {
  it("returns an empty string for no samples", () => {
    expect(sparklinePoints([], 100, 40)).toBe("");
  });

  it("draws a flat line at the top for a single positive sample", () => {
    expect(sparklinePoints([50], 100, 40)).toBe("0,0 100,0");
  });

  it("draws a flat line at the bottom for a single zero sample", () => {
    expect(sparklinePoints([0], 100, 40)).toBe("0,40 100,40");
  });

  it("does not divide by zero when every sample is 0", () => {
    const points = sparklinePoints([0, 0, 0], 100, 40);
    // Every point should sit at the bottom (y = height), not NaN.
    expect(points).not.toContain("NaN");
    for (const pair of points.split(" ")) {
      const [, y] = pair.split(",");
      expect(Number(y)).toBe(40);
    }
  });

  it("places the highest sample at the top and the lowest at the bottom", () => {
    const points = sparklinePoints([0, 100], 100, 40);
    const [first, second] = points.split(" ");
    const [, firstY] = first.split(",");
    const [, secondY] = second.split(",");
    expect(Number(firstY)).toBe(40); // 0 -> bottom
    expect(Number(secondY)).toBe(0); // max -> top
  });

  it("spans the full width across all samples", () => {
    const points = sparklinePoints([1, 2, 3, 4], 90, 40);
    const pairs = points.split(" ").map((p) => p.split(",").map(Number));
    expect(pairs[0][0]).toBe(0);
    expect(pairs[pairs.length - 1][0]).toBe(90);
  });
});
