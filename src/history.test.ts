import { describe, it, expect } from "vitest";
import { mergeImportedHistory } from "./history";
import type { DownloadItem, HistoryEntry } from "./types";
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
    state: "completed",
    addedAt: 0,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    url: "https://example.com/other.zip",
    headers: [],
    allowInsecure: false,
    checksum: "",
    speedLimit: 0,
    filename: "other.zip",
    filenameOverride: "",
    path: "",
    savePath: "",
    proxy: DEFAULT_PROXY,
    total: null,
    downloaded: 0,
    connections: 1,
    usedConnections: 1,
    state: "completed",
    error: null,
    referer: "",
    needsAuth: false,
    finishedAt: 1000,
    addedAt: 1000,
    ...overrides,
  };
}

describe("mergeImportedHistory", () => {
  it("skips an entry whose id already exists", () => {
    const prev = [makeItem({ id: "dup" })];
    const { next, added } = mergeImportedHistory(prev, [makeEntry({ id: "dup" })]);
    expect(added).toBe(0);
    expect(next).toBe(prev);
  });

  it("skips an entry whose non-empty path already exists", () => {
    const prev = [makeItem({ id: "1", path: "C:/Downloads/file.zip" })];
    const { next, added } = mergeImportedHistory(prev, [
      makeEntry({ id: "e2", path: "C:/Downloads/file.zip" }),
    ]);
    expect(added).toBe(0);
    expect(next).toBe(prev);
  });

  it("adds a genuinely new entry as fromHistory", () => {
    const prev = [makeItem({ id: "1" })];
    const { next, added } = mergeImportedHistory(prev, [makeEntry({ id: "new" })]);
    expect(added).toBe(1);
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe("new");
    expect(next[1].fromHistory).toBe(true);
  });

  it("returns the same prev array reference when nothing is added", () => {
    const prev = [makeItem({ id: "1" })];
    const { next } = mergeImportedHistory(prev, [makeEntry({ id: "1" })]);
    expect(next).toBe(prev);
  });
});
