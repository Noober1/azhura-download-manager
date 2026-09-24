import { useEffect, useRef, useState } from "react";
import { pushSpeedSample, SPEED_SAMPLE_INTERVAL_MS, TOTAL_SPEED_SAMPLE_CAP } from "../speedHistory";

/** Ring buffer of combined download speed for the status bar's sparkline.
 *
 *  Sampled on its own `SPEED_SAMPLE_INTERVAL_MS` timer rather than off the
 *  progress stream: progress events arrive ~every 150ms *per download*, so
 *  summing them directly would tick several times faster than the
 *  per-download history does and defeat the whole point of a shared sample
 *  interval. The live value is read from a ref so the interval is created
 *  once, not on every progress patch. */
export function useTotalSpeedHistory(totalSpeed: number): number[] {
  const [samples, setSamples] = useState<number[]>([]);
  const speedRef = useRef(totalSpeed);
  speedRef.current = totalSpeed;

  useEffect(() => {
    const id = setInterval(() => {
      setSamples((s) => pushSpeedSample(s, speedRef.current, TOTAL_SPEED_SAMPLE_CAP));
    }, SPEED_SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return samples;
}
