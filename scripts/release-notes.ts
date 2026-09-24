// Usage: bun scripts/release-notes.ts v0.2.5  → prints the release body to stdout.
// Exits 1 if CHANGELOG.md has no entry for the tag or the entry is still Unreleased.
import { readFileSync } from "node:fs";
import { findEntry, formatReleaseNotes, parseChangelog } from "../src/changelog";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: bun scripts/release-notes.ts <tag>");
  process.exit(1);
}

const entry = findEntry(
  parseChangelog(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")),
  tag,
);
if (!entry) {
  console.error(`CHANGELOG.md has no entry for ${tag}`);
  process.exit(1);
}
if (entry.date === null) {
  console.error(
    `CHANGELOG.md entry for ${entry.version} is still marked Unreleased — set the release date before tagging`,
  );
  process.exit(1);
}

console.log(formatReleaseNotes(entry));
