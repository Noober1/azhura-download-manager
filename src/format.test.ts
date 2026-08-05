import { describe, it, expect } from "vitest";
import {
  parseHeaders,
  mergeHeaders,
  formatBytes,
  formatEta,
  truncate,
  pctOf,
  isResumable,
  statusClass,
  statusLabel,
  looksLikeUrl,
  fallbackName,
} from "./format";
import type { DownloadItem, DlState } from "./types";
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

describe("parseHeaders", () => {
  it("ignores comment lines and lines without a colon", () => {
    const text = "# a comment\nNoColonHere\nX-Test: value";
    expect(parseHeaders(text)).toEqual([["X-Test", "value"]]);
  });

  it("drops pairs with an empty name or value", () => {
    expect(parseHeaders("Empty-Value:\n: no-name")).toEqual([]);
  });

  it("only splits on the first colon, keeping colons in the value", () => {
    const text = "Referer: https://example.com/path?x=1:2";
    expect(parseHeaders(text)).toEqual([["Referer", "https://example.com/path?x=1:2"]]);
  });
});

describe("mergeHeaders", () => {
  it("lets a dedicated field override a same-named textarea line, case-insensitively", () => {
    const merged = mergeHeaders("referer: https://old.example", {
      referer: "https://new.example",
    });
    expect(merged).toEqual([["Referer", "https://new.example"]]);
  });

  it("leaves textarea headers alone when no dedicated field is set", () => {
    const merged = mergeHeaders("X-Custom: value", {});
    expect(merged).toEqual([["X-Custom", "value"]]);
  });

  it("adds all three dedicated fields when provided", () => {
    const merged = mergeHeaders("", {
      userAgent: "UA/1.0",
      referer: "https://ref.example",
      cookie: "a=b",
    });
    expect(merged).toEqual([
      ["User-Agent", "UA/1.0"],
      ["Referer", "https://ref.example"],
      ["Cookie", "a=b"],
    ]);
  });
});

describe("formatBytes", () => {
  it("handles zero and negative values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("stays in whole bytes under 1024", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("crosses the 1024 boundary into KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("reaches TB for large enough values", () => {
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });
});

describe("formatEta", () => {
  it("shows a dash for non-positive or non-finite input", () => {
    expect(formatEta(0)).toBe("—");
    expect(formatEta(-1)).toBe("—");
    expect(formatEta(Infinity)).toBe("—");
  });

  it("formats seconds, minutes, and hours", () => {
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(125)).toBe("2m 5s");
    expect(formatEta(3665)).toBe("1h 1m");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("ellipsizes in the middle, keeping both ends visible", () => {
    expect(truncate("abcdefghij", 5)).toBe("ab…ij");
  });
});

describe("pctOf", () => {
  it("is null when total is missing or non-positive", () => {
    expect(pctOf(makeItem({ total: null }))).toBeNull();
    expect(pctOf(makeItem({ total: 0 }))).toBeNull();
    expect(pctOf(makeItem({ total: -10 }))).toBeNull();
  });

  it("computes a percentage", () => {
    expect(pctOf(makeItem({ total: 200, downloaded: 50 }))).toBe(25);
  });

  it("clamps to 100", () => {
    expect(pctOf(makeItem({ total: 100, downloaded: 150 }))).toBe(100);
  });
});

describe("isResumable", () => {
  const terminalTrue: DlState[] = ["paused", "error", "canceled"];
  const otherStates: DlState[] = ["queued", "downloading", "verifying", "completed"];

  it.each(terminalTrue)("is resumable in state %s with no flags set", (state) => {
    expect(isResumable(makeItem({ state }))).toBe(true);
  });

  it.each(otherStates)("is not resumable in state %s with no flags set", (state) => {
    expect(isResumable(makeItem({ state }))).toBe(false);
  });

  it("a completed download still on disk is not resumable", () => {
    expect(isResumable(makeItem({ state: "completed", missing: false }))).toBe(false);
  });

  it("a completed download that's missing is resumable", () => {
    expect(isResumable(makeItem({ state: "completed", missing: true }))).toBe(true);
  });

  it("fromHistory makes any state resumable", () => {
    expect(isResumable(makeItem({ state: "queued", fromHistory: true }))).toBe(true);
  });

  it("awaitingCapture makes any state resumable", () => {
    expect(isResumable(makeItem({ state: "downloading", awaitingCapture: true }))).toBe(true);
  });
});

describe("statusClass / statusLabel", () => {
  it("awaitingCapture wins over everything else", () => {
    const item = makeItem({ state: "error", missing: true, awaitingCapture: true });
    expect(statusClass(item)).toBe("queued");
    expect(statusLabel(item)).toBe("Waiting for browser");
  });

  it("missing (without awaitingCapture) reports as missing", () => {
    const item = makeItem({ state: "completed", missing: true });
    expect(statusClass(item)).toBe("missing");
    expect(statusLabel(item)).toBe("Moved / deleted");
  });

  it("otherwise reports the plain state", () => {
    const item = makeItem({ state: "downloading" });
    expect(statusClass(item)).toBe("downloading");
    expect(statusLabel(item)).toBe("Downloading");
  });
});

describe("looksLikeUrl", () => {
  it("accepts http(s) URLs only", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("http://example.com")).toBe(true);
    expect(looksLikeUrl("ftp://example.com")).toBe(false);
    expect(looksLikeUrl("not a url")).toBe(false);
  });
});

describe("fallbackName", () => {
  it("takes the last path segment, ignoring query/fragment", () => {
    expect(fallbackName("https://example.com/path/file.zip?x=1")).toBe("file.zip");
  });

  it("falls back to 'download' when the path ends in a slash", () => {
    expect(fallbackName("https://example.com/")).toBe("download");
  });
});
