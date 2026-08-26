export const RETRY_BACKOFF_CAP_MS = 30_000;

/** Exponential backoff for auto-retry, capped at 30s: attempt 1 → 2s,
 *  2 → 4s, 3 → 8s, 4 → 16s, 5+ → 30s. `attempt` is 1-indexed — the attempt
 *  about to be made, after `attempt - 1` prior failures. */
export function retryBackoffMs(attempt: number): number {
  return Math.min(RETRY_BACKOFF_CAP_MS, 2_000 * 2 ** (attempt - 1));
}
