import { describe, it, expect } from "vitest";
import { queueOrder, queuePositions, moveIds, dropBefore } from "./queueOrder";
import type { DownloadItem } from "./types";
import { DEFAULT_PROXY } from "./types";

function item(
  id: string,
  state: DownloadItem["state"],
  addedAt: number,
  queueRank?: number,
): DownloadItem {
  return {
    id,
    url: "https://example.com/file.zip",
    headers: [],
    connections: 1,
    allowInsecure: false,
    checksum: "",
    speedLimit: 0,
    filename: `${id}.zip`,
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
    state,
    addedAt,
    queueRank,
  };
}

describe("queueOrder", () => {
  it("orders queued rows FIFO by addedAt when queueRank is unset", () => {
    const downloads = [item("c", "queued", 3), item("a", "queued", 1), item("b", "queued", 2)];
    expect(queueOrder(downloads).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("queueRank overrides addedAt", () => {
    const downloads = [
      item("a", "queued", 1, 5),
      item("b", "queued", 2, 1),
      item("c", "queued", 3, 3),
    ];
    expect(queueOrder(downloads).map((d) => d.id)).toEqual(["b", "c", "a"]);
  });

  it("drops non-queued rows", () => {
    const downloads = [item("a", "queued", 1), item("b", "downloading", 2), item("c", "paused", 3)];
    expect(queueOrder(downloads).map((d) => d.id)).toEqual(["a"]);
  });

  it("does not mutate the input array", () => {
    const downloads = [item("b", "queued", 2), item("a", "queued", 1)];
    const original = [...downloads];
    queueOrder(downloads);
    expect(downloads).toEqual(original);
  });
});

describe("queuePositions", () => {
  it("assigns 1-based positions to queued rows only", () => {
    const downloads = [item("a", "queued", 1), item("b", "downloading", 2), item("c", "queued", 3)];
    const positions = queuePositions(downloads);
    expect(positions.get("a")).toBe(1);
    expect(positions.get("c")).toBe(2);
    expect(positions.has("b")).toBe(false);
  });
});

describe("moveIds", () => {
  it("moves a multi-select block to the top, preserving relative order", () => {
    const result = moveIds(["a", "b", "c", "d"], new Set(["c", "a"]), "top");
    expect(result).toEqual(["a", "c", "b", "d"]);
  });

  it("moves a multi-select block to the bottom, preserving relative order", () => {
    const result = moveIds(["a", "b", "c", "d"], new Set(["a", "c"]), "bottom");
    expect(result).toEqual(["b", "d", "a", "c"]);
  });

  it("moves a single item up one step", () => {
    const result = moveIds(["a", "b", "c"], new Set(["c"]), "up");
    expect(result).toEqual(["a", "c", "b"]);
  });

  it("moves a single item down one step", () => {
    const result = moveIds(["a", "b", "c"], new Set(["a"]), "down");
    expect(result).toEqual(["b", "a", "c"]);
  });

  it("is a no-op moving up an item already at the front", () => {
    const result = moveIds(["a", "b", "c"], new Set(["a"]), "up");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("is a no-op moving up two selected items already bunched at the front", () => {
    const result = moveIds(["a", "b", "c"], new Set(["a", "b"]), "up");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("ignores ids not present in order", () => {
    const result = moveIds(["a", "b", "c"], new Set(["z"]), "top");
    expect(result).toEqual(["a", "b", "c"]);
  });
});

describe("dropBefore", () => {
  it("moves the dragged id to the front", () => {
    expect(dropBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("moves the dragged id into the middle", () => {
    expect(dropBefore(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves the dragged id to the end when beforeId is null", () => {
    expect(dropBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when beforeId equals draggedId", () => {
    expect(dropBefore(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when draggedId is not in order", () => {
    expect(dropBefore(["a", "b", "c"], "z", "a")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when beforeId is not in order", () => {
    expect(dropBefore(["a", "b", "c"], "a", "z")).toEqual(["a", "b", "c"]);
  });
});
