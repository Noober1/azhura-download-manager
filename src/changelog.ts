export type ChangelogSection = { title: string; items: string[] };
export type ChangelogEntry = { version: string; date: string | null; sections: ChangelogSection[] };
export type InlineSegment = { kind: "text" | "code" | "bold"; text: string };

const ENTRY_RE = /^## \[(\d+\.\d+\.\d+)\](?:\s*-\s*(.+))?$/;
const SECTION_RE = /^### (.+)$/;
const ITEM_RE = /^[-*] (.+)$/;

/** Parse the CHANGELOG.md shape documented in the file's header. Entries stay in file order. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  // True right after an item line, so an indented line can continue it.
  let canContinue = false;

  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const heading = ENTRY_RE.exec(line);
    if (heading) {
      const raw = heading[2]?.trim();
      const date = !raw || raw.toLowerCase() === "unreleased" ? null : raw;
      entry = { version: heading[1], date, sections: [] };
      entries.push(entry);
      section = null;
      canContinue = false;
      continue;
    }
    if (!entry) continue;

    const sec = SECTION_RE.exec(line);
    if (sec) {
      section = { title: sec[1].trim(), items: [] };
      entry.sections.push(section);
      canContinue = false;
      continue;
    }

    const item = ITEM_RE.exec(line);
    if (item) {
      if (!section) {
        section = { title: "", items: [] };
        entry.sections.push(section);
      }
      section.items.push(item[1].trim());
      canContinue = true;
      continue;
    }

    if (canContinue && section && /^\s+\S/.test(line)) {
      const last = section.items.length - 1;
      section.items[last] = `${section.items[last]} ${line.trim()}`;
      continue;
    }
    canContinue = false;
  }
  return entries;
}

/** Look up an entry by version; a leading "v" (as in a git tag) is ignored. */
export function findEntry(entries: ChangelogEntry[], version: string): ChangelogEntry | undefined {
  const wanted = version.replace(/^v/, "");
  return entries.find((e) => e.version === wanted);
}

/** Split `code` and **bold** spans out of a bullet; unmatched markers stay literal. */
export function splitInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    const marker = text.startsWith("**", i) ? "**" : text[i] === "`" ? "`" : null;
    if (marker) {
      const end = text.indexOf(marker, i + marker.length);
      if (end > i + marker.length) {
        flush();
        out.push({
          kind: marker === "`" ? "code" : "bold",
          text: text.slice(i + marker.length, end),
        });
        i = end + marker.length;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** Markdown body for the GitHub release: `###` sections with `- ` bullets, no version heading. */
export function formatReleaseNotes(entry: ChangelogEntry): string {
  return entry.sections
    .map((s) => {
      const bullets = s.items.map((it) => `- ${it}`).join("\n");
      return s.title ? `### ${s.title}\n${bullets}` : bullets;
    })
    .join("\n\n");
}
