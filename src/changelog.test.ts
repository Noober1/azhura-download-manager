import { describe, it, expect } from "vitest";
import changelogMd from "../CHANGELOG.md?raw";
import pkg from "../package.json";
import { findEntry, formatReleaseNotes, parseChangelog, splitInline } from "./changelog";

const SAMPLE = `# Changelog

Intro paragraph.

## [0.2.5] - Unreleased

### Added
- **One** first
  continued here
- Two

### Fixed
- Three

## [0.2.4] - 2026-08-29
- Loose bullet
`;

describe("parseChangelog", () => {
  it("parses versions, dates, sections and items", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => e.version)).toEqual(["0.2.5", "0.2.4"]);
    expect(entries[1].date).toBe("2026-08-29");
    expect(entries[0].sections.map((s) => s.title)).toEqual(["Added", "Fixed"]);
    expect(entries[0].sections[0].items).toHaveLength(2);
  });

  it("maps Unreleased and a missing date to null", () => {
    const entries = parseChangelog("## [1.0.0] - unreleased\n## [0.9.0]\n");
    expect(entries.map((e) => e.date)).toEqual([null, null]);
  });

  it("joins continuation lines", () => {
    expect(parseChangelog(SAMPLE)[0].sections[0].items[0]).toBe("**One** first continued here");
  });

  it("handles CRLF input", () => {
    const entries = parseChangelog(SAMPLE.replace(/\n/g, "\r\n"));
    expect(entries).toHaveLength(2);
    expect(entries[0].sections[0].items[1]).toBe("Two");
  });

  it("puts bullets before any section heading into an untitled section", () => {
    const last = parseChangelog(SAMPLE)[1];
    expect(last.sections).toEqual([{ title: "", items: ["Loose bullet"] }]);
  });
});

describe("findEntry", () => {
  const entries = parseChangelog(SAMPLE);

  it("accepts versions with or without a leading v", () => {
    expect(findEntry(entries, "v0.2.4")?.version).toBe("0.2.4");
    expect(findEntry(entries, "0.2.4")?.version).toBe("0.2.4");
  });

  it("returns undefined for an unknown version", () => {
    expect(findEntry(entries, "9.9.9")).toBeUndefined();
  });
});

describe("splitInline", () => {
  it("returns plain text as one segment", () => {
    expect(splitInline("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("splits code and bold", () => {
    expect(splitInline("a `b` **c** d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "code", text: "b" },
      { kind: "text", text: " " },
      { kind: "bold", text: "c" },
      { kind: "text", text: " d" },
    ]);
  });

  it("keeps an unmatched backtick literal", () => {
    expect(splitInline("a ` b")).toEqual([{ kind: "text", text: "a ` b" }]);
  });

  it("keeps an unmatched bold marker literal", () => {
    expect(splitInline("a ** b")).toEqual([{ kind: "text", text: "a ** b" }]);
  });
});

describe("formatReleaseNotes", () => {
  it("emits section headings and bullets without a version heading", () => {
    const out = formatReleaseNotes(parseChangelog(SAMPLE)[0]);
    expect(out).toContain("### Added");
    expect(out).toContain("- Two");
    expect(out).not.toContain("## [");
  });
});

describe("the real CHANGELOG.md", () => {
  const entries = parseChangelog(changelogMd);

  it("has entries that all carry content", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.sections.length).toBeGreaterThan(0);
      for (const s of e.sections) expect(s.items.length).toBeGreaterThan(0);
    }
  });

  it("has an entry for the package version", () => {
    expect(findEntry(entries, pkg.version)).toBeDefined();
  });
});
