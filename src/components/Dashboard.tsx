import { useState } from "react";
import { formatBytes, formatSpeed } from "../format";
import {
  avgBps,
  dailySeries,
  formatDayLabel,
  formatMonthLabel,
  monthlySeries,
  niceCeil,
  summarize,
  type StatsDays,
} from "../stats";

type Range = "daily" | "monthly";

/** Statistics view, toggled into the main area in place of the download
 *  table (see `App.tsx`'s `view` state) — not a dialog or a separate window.
 *  Purely presentational: `days` comes from `useStats`, and `onReset` is its
 *  `reset()`. `activeNow` is a live count (downloading/verifying/queued/
 *  paused), not part of the persisted per-day stats — passed in so it always
 *  agrees with the sidebar's own "Active" count. */
export function Dashboard({
  days,
  activeNow,
  onReset,
}: {
  days: StatsDays;
  activeNow: number;
  onReset: () => void;
}) {
  const [range, setRange] = useState<Range>("daily");
  const [confirmReset, setConfirmReset] = useState(false);

  const now = Date.now();
  const summary = summarize(days, now);
  const series = range === "daily" ? dailySeries(days, now, 30) : monthlySeries(days, now, 12);
  const top = niceCeil(Math.max(0, ...series.map((s) => s.stats.bytes)));

  function handleReset() {
    onReset();
    setConfirmReset(false);
  }

  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <header>
        <h2 id="dashboard-title">Statistics</h2>
        <p className="dash-subtitle">
          {summary.firstDay ? `Since ${formatDayLabel(summary.firstDay, true)}` : "No downloads recorded yet"}
        </p>
      </header>

      <div className="dash-tiles">
        <div className="dash-tile">
          <div className="dash-tile-value">{formatBytes(summary.totalBytes)}</div>
          <div className="dash-tile-label">Total downloaded</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{formatBytes(summary.monthBytes)}</div>
          <div className="dash-tile-label">This month</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{formatBytes(summary.todayBytes)}</div>
          <div className="dash-tile-label">Today</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{activeNow}</div>
          <div className="dash-tile-label">Active now</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{summary.totalCompleted}</div>
          <div className="dash-tile-label">Files completed</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{summary.totalErrored}</div>
          <div className="dash-tile-label">Errors</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{summary.totalCanceled}</div>
          <div className="dash-tile-label">Canceled</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">
            {summary.avgBps30 == null ? "—" : formatSpeed(summary.avgBps30)}
          </div>
          <div className="dash-tile-label">Avg speed (30 days)</div>
        </div>
        <div className="dash-tile">
          <div className="dash-tile-value">{formatSpeed(summary.peakBps)}</div>
          <div className="dash-tile-label">Peak speed</div>
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-card-head">
          <span className="dash-card-title">
            {range === "daily" ? "Downloaded per day (last 30 days)" : "Downloaded per month (last 12 months)"}
          </span>
          <span className="dash-seg" role="group" aria-label="Chart range">
            <button
              type="button"
              aria-pressed={range === "daily"}
              className={range === "daily" ? "active" : ""}
              onClick={() => setRange("daily")}
            >
              Daily
            </button>
            <button
              type="button"
              aria-pressed={range === "monthly"}
              className={range === "monthly" ? "active" : ""}
              onClick={() => setRange("monthly")}
            >
              Monthly
            </button>
          </span>
        </div>

        <div className="dash-chart">
          <div className="dash-yaxis">
            <span>{formatBytes(top)}</span>
            <span>0</span>
          </div>
          <svg
            className="dash-bars"
            viewBox={`0 0 ${series.length * 10} 100`}
            preserveAspectRatio="none"
            width="100%"
            height="160"
            role="img"
            aria-label={range === "daily" ? "Bytes downloaded per day" : "Bytes downloaded per month"}
          >
            {series.map(({ key, stats }, i) => {
              const label = range === "daily" ? formatDayLabel(key, true) : formatMonthLabel(key, true);
              const avg = avgBps(stats);
              const tip =
                `${label} · ${formatBytes(stats.bytes)} · ${stats.completed} file(s)` +
                (avg != null ? ` · avg ${formatSpeed(avg)}` : "");
              const rawH = top > 0 ? (stats.bytes / top) * 100 : 0;
              const h = stats.bytes > 0 ? Math.max(rawH, 1.5) : 0;
              const isCurrent = i === series.length - 1;
              return (
                <g key={key}>
                  <rect
                    x={i * 10}
                    y={0}
                    width={10}
                    height={100}
                    fill="transparent"
                    data-tip={tip}
                    data-tip-side="top"
                  />
                  <rect
                    className={isCurrent ? "dash-bar current" : "dash-bar"}
                    x={i * 10 + 1.5}
                    y={100 - h}
                    width={7}
                    height={h}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="dash-xlabels">
          {series.map(({ key }, i) => {
            const isLast = i === series.length - 1;
            const show = range === "monthly" || i % 5 === 4 || isLast;
            return (
              <span key={key}>{show ? (range === "daily" ? formatDayLabel(key) : formatMonthLabel(key)) : ""}</span>
            );
          })}
        </div>
      </div>

      <div className="dash-footer">
        {confirmReset ? (
          <>
            <span className="dash-reset-warning">Reset all statistics? This can't be undone.</span>
            <button type="button" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={handleReset}>
              Reset
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)}>
            Reset statistics…
          </button>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
