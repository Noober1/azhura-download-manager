import { describe, it, expect } from "vitest";
import { csvCell, historyToCsv, exportFileName } from "./csvExport";
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

describe("csvCell", () => {
  it("quotes a value containing a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("prefixes a formula-looking value with an apostrophe", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("prefixes a leading-dash value with an apostrophe", () => {
    expect(csvCell("-1")).toBe("'-1");
  });

  it("leaves a plain value untouched", () => {
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("historyToCsv", () => {
  it("starts with a BOM and contains only the header for an empty list", () => {
    const csv = historyToCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Name,Status,Size (bytes)");
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("renders a completed item with its status label and ISO dates", () => {
    const csv = historyToCsv([
      makeItem({ state: "completed", addedAt: 1735689600000, finishedAt: 1735689660000 }),
    ]);
    expect(csv).toContain("Complete");
    expect(csv).toContain(new Date(1735689600000).toISOString());
  });
});

describe("exportFileName", () => {
  it("formats kind, date and extension", () => {
    expect(exportFileName("history", "csv", new Date(2026, 8, 5))).toBe("azhura-history-2026-09-05.csv");
  });
});
