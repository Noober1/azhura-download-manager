import { describe, it, expect } from "vitest";
import { statusBucket, matchesStatus } from "./statusFilter";
import type { DownloadItem } from "./types";
import { DEFAULT_PROXY } from "./types";

function makeItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: "1",
    url: "https://example.com/file.zip",
    headers: [],
    connections: 1,
    allowInsecure: false,
    checksum: "",
    speedLimit: 0,
    filename: "file.zip",
    filenameOverride: "",
    path: "",
    savePath: "",
    proxy: DEFAULT_PROXY,
    total: null,
    downloaded: 0,
    speed: 0,
    usedConnections: 1,
    numPieces: 0,
    pieceSize: 0,
    conns: [],
    state: "queued",
    addedAt: 0,
    ...overrides,
  };
}

describe("statusBucket", () => {
  it("collapses downloading and verifying into downloading", () => {
    expect(statusBucket(makeItem({ state: "downloading" }))).toBe("downloading");
    expect(statusBucket(makeItem({ state: "verifying" }))).toBe("downloading");
  });

  it("buckets awaitingCapture and retryPending as queued", () => {
    expect(statusBucket(makeItem({ state: "queued", awaitingCapture: true }))).toBe("queued");
    expect(statusBucket(makeItem({ state: "queued", retryPending: true }))).toBe("queued");
  });

  it("buckets a missing completed row as missing, not completed", () => {
    const item = makeItem({ state: "completed", missing: true });
    expect(statusBucket(item)).toBe("missing");
    expect(matchesStatus(item, "completed")).toBe(false);
    expect(matchesStatus(item, "missing")).toBe(true);
  });

  it("passes through a plain error state", () => {
    expect(statusBucket(makeItem({ state: "error" }))).toBe("error");
  });
});

describe("matchesStatus", () => {
  it("matches everything for the 'all' filter", () => {
    expect(matchesStatus(makeItem({ state: "downloading" }), "all")).toBe(true);
    expect(matchesStatus(makeItem({ state: "error" }), "all")).toBe(true);
  });

  it("matches only the same bucket for a specific filter", () => {
    expect(matchesStatus(makeItem({ state: "paused" }), "paused")).toBe(true);
    expect(matchesStatus(makeItem({ state: "paused" }), "queued")).toBe(false);
  });
});
