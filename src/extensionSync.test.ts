import { describe, it, expect } from "vitest";
// @ts-expect-error no @types/node in this project; these run fine under vitest's node environment
import { readFileSync } from "node:fs";
// @ts-expect-error no @types/node in this project; these run fine under vitest's node environment
import path from "node:path";

// extension/common.js and extension-firefox/common.js are copies of
// extension-shared/common.js (via `bun run sync:ext`), because an extension
// can't load a file from outside its own root. tauri.conf.json bundles both
// extension/ and extension-firefox/ as resources, so a stale copy would ship
// silently — this test is what actually catches that, not manual discipline.
// @ts-expect-error import.meta.dirname needs @types/node; works at runtime under vitest
const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "extension-shared", "common.js"));

describe("extension common.js sync", () => {
  it("extension/common.js matches extension-shared/common.js byte-for-byte", () => {
    const copy = readFileSync(path.join(root, "extension", "common.js"));
    expect(copy.equals(source)).toBe(true);
  });

  it("extension-firefox/common.js matches extension-shared/common.js byte-for-byte", () => {
    const copy = readFileSync(path.join(root, "extension-firefox", "common.js"));
    expect(copy.equals(source)).toBe(true);
  });
});
