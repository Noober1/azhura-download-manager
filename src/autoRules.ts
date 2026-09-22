import type { AutoRule as GeneratedAutoRule } from "./bindings";

/** The generated binding types every field optional (specta sees
 *  `#[serde(default)]` on the Rust struct and can't tell a field is always
 *  present) — this is the shape the dialog and settings actually work with. */
export type AutoRule = Required<GeneratedAutoRule>;

export type AutoRuleKind = "wildcard" | "regex";
export type AutoRuleTarget = "folder" | "category";

/** Fills in the same defaults `AutoRule::default()` uses on the Rust side, so
 *  a rule loaded from disk (or missing a field for any other reason) never
 *  crashes the dialog on an `undefined` access. */
export function normalizeAutoRule(r: GeneratedAutoRule): AutoRule {
  return {
    id: r.id ?? "",
    enabled: r.enabled ?? true,
    kind: r.kind ?? "wildcard",
    pattern: r.pattern ?? "",
    target: r.target ?? "folder",
    folder: r.folder ?? "",
    category: r.category ?? "",
  };
}

export function newRule(): AutoRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    kind: "wildcard",
    pattern: "",
    target: "folder",
    folder: "",
    category: "video",
  };
}

/** Immutable swap of `rules[index]` with its neighbor in direction `dir`.
 *  No-op (returns the same array reference) at either end. */
export function moveRule(rules: AutoRule[], index: number, dir: -1 | 1): AutoRule[] {
  const target = index + dir;
  if (target < 0 || target >= rules.length) return rules;
  const next = [...rules];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function updateRule(rules: AutoRule[], id: string, patch: Partial<AutoRule>): AutoRule[] {
  return rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export function removeRule(rules: AutoRule[], id: string): AutoRule[] {
  return rules.filter((r) => r.id !== id);
}

const ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]|^\\\\|^\//;

/** Whether a rule's destination is unusable as-is: a folder target with an
 *  empty or non-absolute-looking path. A category target is always complete
 *  once a category is picked (the dialog always defaults one in). */
export function targetIncomplete(rule: AutoRule): boolean {
  if (rule.target !== "folder") return false;
  const trimmed = rule.folder.trim();
  return trimmed === "" || !ABSOLUTE_PATH.test(trimmed);
}
