import { formatSpeed } from "../format";
import { averageOf, peakOf, sparklinePoints } from "../speedHistory";

const GRAPH_WIDTH = 72;
const GRAPH_HEIGHT = 12;

/** Combined-speed sparkline for the status bar — `samples` from
 *  `useTotalSpeedHistory`. Renders nothing while idle (every sample is 0),
 *  so an idle status bar stays exactly as it looked before this existed.
 *
 *  A static polyline redrawn on data change, same as the detail window's own
 *  sparkline — no CSS transition or `motion` animation, so it needs no
 *  `useReducedMotionSetting()` check. If a transition is ever added here it
 *  must consult `src/reducedMotion.ts`, because raw SVG isn't covered by
 *  `MotionConfig`. */
export function SpeedGraph({ samples, total }: { samples: number[]; total: number }) {
  if (samples.every((v) => v === 0)) return null;

  return (
    <span
      className="sb-graph"
      data-tip={`Last 60s · avg ${formatSpeed(averageOf(samples))} · peak ${formatSpeed(peakOf(samples))}`}
      data-tip-side="top"
    >
      <svg aria-hidden="true" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none">
        <polyline points={sparklinePoints(samples, GRAPH_WIDTH, GRAPH_HEIGHT)} />
      </svg>
      <span className="sb-speed">{formatSpeed(total)}</span>
    </span>
  );
}
