// ---------------------------------------------------------------------------
// Windows shell file-association icon cache
// ---------------------------------------------------------------------------
//
// A module-level store (not a hook) so every row sharing an extension shares
// one in-flight request and one cached result, instead of each `FileIcon`
// re-fetching independently. `src/fileIcons.tsx` is the sole consumer: it
// reads through `getShellIcon`/`subscribeShellIcons` (a `useSyncExternalStore`
// pair) and kicks off `requestShellIcon` from an effect, falling back to its
// bundled SVG set whenever this cache has no entry (yet, or ever) for an
// extension.

import { commands } from "./bindings";

/** `null` is a cached miss (the backend returned `None`, or the request
 *  failed) — it's never retried, same as a hit. */
const cache = new Map<string, string | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

/** Flipped on the first thrown `invoke` (missing command, no Tauri context —
 *  e.g. `bun run dev` in a plain browser tab) so every other row doesn't
 *  independently rediscover the same doomed call. */
let disabled = false;

/** The extension `iconFor`/shell lookups key on: lowercased, no leading dot.
 *  A name with no dot at all (a URL-derived "download") has none. */
export function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/** Pure cache read — safe as a `useSyncExternalStore` snapshot. */
export function getShellIcon(ext: string): string | null {
  return cache.get(ext) ?? null;
}

export function subscribeShellIcons(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Fire-and-forget: kicks off the backend lookup for `ext` if it isn't
 *  already cached or in flight. Callers don't await this — they re-render
 *  off the `subscribeShellIcons` notification once it resolves. */
export function requestShellIcon(ext: string): void {
  if (disabled || ext === "" || cache.has(ext) || pending.has(ext)) return;
  pending.add(ext);
  commands
    .shellIcon(ext)
    .then((uri) => {
      cache.set(ext, uri);
      pending.delete(ext);
      notify();
    })
    .catch(() => {
      disabled = true;
      pending.delete(ext);
    });
}
