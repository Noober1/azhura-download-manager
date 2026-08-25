/** How often (ms) a progress tick is allowed to append a speed-history
 *  sample / replace the piece map — shared by `useDownloads` (which gates
 *  on it) and `DetailWindow` (which uses it to label the sparkline's
 *  timeline), so the two stay in sync by construction rather than by two
 *  copies of the same number agreeing. */
export const SPEED_SAMPLE_INTERVAL_MS = 500;

/** How many recent speed samples the detail window's sparkline keeps. Paired
 *  with `SPEED_SAMPLE_INTERVAL_MS`, this covers roughly the last 30 seconds
 *  of a download. */
export const SPEED_SAMPLE_CAP = 60;

/** Ring buffer, implemented immutably: always returns a new array, with the
 *  oldest sample dropped off the front once `cap` is exceeded. */
export function pushSpeedSample(
  history: number[],
  value: number,
  cap: number = SPEED_SAMPLE_CAP,
): number[] {
  const next = [...history, value];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** `points` attribute for an SVG `<polyline>`, normalized into a
 *  `width` x `height` viewBox with the most recent sample on the right.
 *  Handles the shapes a raw `value / max` normalization would divide by
 *  zero or crowd on: no samples, one sample, and every sample being 0 (a
 *  flat line at the bottom, not a line pinned to the top). */
export function sparklinePoints(samples: number[], width: number, height: number): string {
  if (samples.length === 0) return "";
  if (samples.length === 1) {
    const y = samples[0] > 0 ? 0 : height;
    return `0,${y} ${width},${y}`;
  }
  const max = Math.max(...samples);
  const step = width / (samples.length - 1);
  return samples
    .map((v, i) => {
      const y = max > 0 ? height - (v / max) * height : height;
      return `${i * step},${y}`;
    })
    .join(" ");
}
