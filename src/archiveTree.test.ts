import { describe, it, expect } from "vitest";
import { buildArchiveTree, filterTree } from "./archiveTree";
import type { ArchiveEntry } from "./bindings";

function entry(path: string, overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    path,
    isDir: false,
    size: 0,
    compressed: null,
    encrypted: false,
    modified: null,
    ...overrides,
  };
}

describe("buildArchiveTree", () => {
  it("returns an empty tree for no entries", () => {
    expect(buildArchiveTree([])).toEqual([]);
  });

  it("synthesizes intermediate folders a file's path implies but the archive never listed", () => {
    // Real-world ZIPs frequently omit an explicit "docs/" entry when they
    // only ever recorded "docs/notes.txt" — the tree still needs a "docs" row.
    const tree = buildArchiveTree([entry("docs/notes.txt", { size: 10 })]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("docs");
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0]).toMatchObject({ name: "notes.txt", path: "docs/notes.txt", size: 10 });
  });

  it("aggregates a folder's size from everything nested under it", () => {
    const tree = buildArchiveTree([
      entry("docs/a.txt", { size: 10 }),
      entry("docs/sub/b.txt", { size: 5 }),
    ]);

    const docs = tree.find((n) => n.name === "docs");
    expect(docs?.size).toBe(15);
    const sub = docs?.children.find((n) => n.name === "sub");
    expect(sub?.size).toBe(5);
  });

  it("sorts folders before files, then case-insensitively by name", () => {
    const tree = buildArchiveTree([
      entry("zeta.txt"),
      entry("Alpha", { isDir: true }),
      entry("beta.txt"),
      entry("Zulu/inner.txt"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["Alpha", "Zulu", "beta.txt", "zeta.txt"]);
  });

  it("merges an explicit directory entry's metadata onto the same synthesized node", () => {
    const tree = buildArchiveTree([
      entry("locked/secret.txt", { size: 1 }),
      entry("locked", { isDir: true, encrypted: true, modified: "2024-03-07 09:05" }),
    ]);

    const locked = tree.find((n) => n.name === "locked");
    expect(locked?.encrypted).toBe(true);
    expect(locked?.modified).toBe("2024-03-07 09:05");
    // Size still comes from the aggregation, not the (irrelevant) dir entry's own size.
    expect(locked?.size).toBe(1);
  });

  it("ignores an empty path segment from a leading slash", () => {
    const tree = buildArchiveTree([entry("/readme.txt", { size: 3 })]);
    expect(tree.map((n) => n.name)).toEqual(["readme.txt"]);
  });
});

describe("filterTree", () => {
  const tree = buildArchiveTree([
    entry("docs/readme.txt", { size: 1 }),
    entry("docs/notes/todo.txt", { size: 1 }),
    entry("video.mp4", { size: 1 }),
  ]);

  it("returns every node unchanged for an empty query", () => {
    expect(filterTree(tree, "")).toBe(tree);
    expect(filterTree(tree, "   ")).toBe(tree);
  });

  it("keeps a matched folder's full subtree even where children don't themselves match", () => {
    const filtered = filterTree(tree, "docs");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("docs");
    // "notes" doesn't match "docs" either, but the whole docs/ subtree is kept.
    expect(filtered[0].children.map((n) => n.name)).toEqual(["notes", "readme.txt"]);
  });

  it("keeps ancestor folders of a matching descendant, filtering out siblings that don't lead anywhere", () => {
    const filtered = filterTree(tree, "todo");
    expect(filtered.map((n) => n.name)).toEqual(["docs"]);
    expect(filtered[0].children.map((n) => n.name)).toEqual(["notes"]);
    expect(filtered[0].children[0].children.map((n) => n.name)).toEqual(["todo.txt"]);
  });

  it("drops branches with no match at all", () => {
    const filtered = filterTree(tree, "video");
    expect(filtered.map((n) => n.name)).toEqual(["video.mp4"]);
  });

  it("is case-insensitive", () => {
    expect(filterTree(tree, "README").map((n) => n.name)).toEqual(["docs"]);
  });
});
