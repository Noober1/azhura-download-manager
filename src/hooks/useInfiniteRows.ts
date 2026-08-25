import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { DownloadItem } from "../types";

const INITIAL_ROWS = 60;
const PAGE_ROWS = 60;

/** Renders `rows` incrementally instead of all at once, so a very long
 *  downloads list doesn't cost a full DOM render on every progress patch.
 *  Nothing here changes what the *logical* row list is — `useTableKeyboard`,
 *  `useSelection`, and `useMarquee` all keep operating on the full `rows`;
 *  only `visibleRows` (fed into `DownloadTable`'s existing `rows` prop) is
 *  trimmed. One deliberate side effect: a marquee box dragged across the
 *  whole table only selects rows that are actually rendered — with
 *  append-on-scroll and `useMarquee`'s existing edge auto-scroll, that's
 *  indistinguishable from selecting everything in practice, but it's worth
 *  naming so it isn't rediscovered later as a bug.
 *
 *  `viewKey` identifies "which list is being looked at" (category + search +
 *  sort, from `useSortedRows`) — changing it resets the render window back
 *  to the top. `rows` itself is deliberately not a reset trigger: it churns
 *  on every progress patch (~7/sec), which would otherwise reset the window
 *  constantly. */
export function useInfiniteRows(
  rows: DownloadItem[],
  tableWrapRef: RefObject<HTMLElement | null>,
  viewKey: string,
) {
  const [count, setCount] = useState(INITIAL_ROWS);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  // "Adjust state during render" (a React-documented pattern): this resets
  // `count` synchronously, before the current render ever commits, so the
  // DOM never shows a stale (too-long) row count for a frame. A `useEffect`
  // here would run one paint late and let the container's real `scrollTop`
  // briefly disagree with the already-shrunk content.
  const prevViewKeyRef = useRef(viewKey);
  if (prevViewKeyRef.current !== viewKey) {
    prevViewKeyRef.current = viewKey;
    setCount(INITIAL_ROWS);
  }

  // Runs after the reset above has committed but before the browser paints,
  // landing the scroll position at 0 in the same frame the row count
  // shrinks. Without this, the browser clamps `scrollTop` to the new
  // (shorter) `scrollHeight` on its own — which the intersection observer
  // below would read as "already at the bottom" and immediately load a
  // second page instead of the list actually returning to the top.
  useLayoutEffect(() => {
    const wrap = tableWrapRef.current;
    if (wrap) wrap.scrollTop = 0;
  }, [viewKey, tableWrapRef]);

  // Loads the next page once the sentinel row (rendered by `DownloadTable`
  // right after the visible rows) comes into view. An `IntersectionObserver`
  // rather than a `scroll` handler: a `scroll` listener never fires at all
  // if `.table-wrap` is taller than `INITIAL_ROWS` rows of content (a
  // maximized window on a tall display), permanently stranding every row
  // past the first page. The observer instead fires as soon as the sentinel
  // is visible — on mount, on resize, and after a shrink — so it corrects
  // itself in every one of those cases without any extra plumbing.
  useEffect(() => {
    const root = tableWrapRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setCount((c) => Math.min(rows.length, c + PAGE_ROWS));
        }
      },
      { root },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-observing on every `count`/`rows.length` change is what lets a
    // still-short container keep growing page by page (each grow can bring
    // the sentinel back into view) and lets a newly-narrowed filter recheck
    // whether the sentinel is even still reachable.
  }, [rows.length, count, tableWrapRef]);

  const visibleRows = rows.length <= count ? rows : rows.slice(0, count);

  // Grows the render window just enough to cover `id`, for keyboard
  // navigation (Home/End/Ctrl+A/arrow keys) landing on a row past the
  // current page. A no-op if `id` is already rendered or not found.
  function ensureRendered(id: string) {
    const i = rows.findIndex((d) => d.id === id);
    if (i === -1 || i < count) return;
    setCount(Math.min(rows.length, i + 1));
  }

  return { visibleRows, sentinelRef, count, ensureRendered };
}
