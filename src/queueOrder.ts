import type { DownloadItem } from "./types";

export type QueueMove = "top" | "up" | "down" | "bottom";

/** Effective priority — lower starts sooner. Untouched rows fall back to
 *  `addedAt`, which is what makes the default order FIFO. */
export function rankOf(d: DownloadItem): number {
  return d.queueRank ?? d.addedAt;
}

/** Queued rows in the order the scheduler will start them. Stable: equal
 *  ranks keep array order. */
export function queueOrder(downloads: DownloadItem[]): DownloadItem[] {
  return downloads.filter((d) => d.state === "queued").sort((a, b) => rankOf(a) - rankOf(b));
  // NOTE: filter() already returns a fresh array, so sort() doesn't mutate `downloads`.
}

/** 1-based queue position per queued id. */
export function queuePositions(downloads: DownloadItem[]): Map<string, number> {
  const positions = new Map<string, number>();
  queueOrder(downloads).forEach((d, i) => positions.set(d.id, i + 1));
  return positions;
}

/** Moves every id in `ids` as a block (relative order preserved). top/bottom:
 *  block to the front/back. up/down: each selected id swaps one step past
 *  its nearest NON-selected neighbour (classic listbox behaviour; a selected
 *  id already at the edge, or blocked by selected ids at the edge, stays
 *  put). Ids not in `order` are ignored. Returns a new array; returns a copy
 *  of `order` (same contents) when nothing moves. */
export function moveIds(order: string[], ids: Set<string>, where: QueueMove): string[] {
  const next = [...order];

  if (where === "top" || where === "bottom") {
    const selected = next.filter((id) => ids.has(id));
    const rest = next.filter((id) => !ids.has(id));
    return where === "top" ? [...selected, ...rest] : [...rest, ...selected];
  }

  if (where === "up") {
    for (let i = 1; i < next.length; i++) {
      if (ids.has(next[i]) && !ids.has(next[i - 1])) {
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
      }
    }
    return next;
  }

  // where === "down"
  for (let i = next.length - 2; i >= 0; i--) {
    if (ids.has(next[i]) && !ids.has(next[i + 1])) {
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  }
  return next;
}

/** Moves `draggedId` so it sits right before `beforeId`, or at the end when
 *  `beforeId` is null. No-op (copy of `order`) if `draggedId` isn't in
 *  `order`, or `beforeId === draggedId`, or `beforeId` isn't in `order`. */
export function dropBefore(order: string[], draggedId: string, beforeId: string | null): string[] {
  if (!order.includes(draggedId)) return [...order];
  if (beforeId === draggedId) return [...order];
  if (beforeId !== null && !order.includes(beforeId)) return [...order];

  const rest = order.filter((id) => id !== draggedId);
  if (beforeId === null) return [...rest, draggedId];
  const at = rest.indexOf(beforeId);
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)];
}
