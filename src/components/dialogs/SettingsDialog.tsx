import { motion } from "motion/react";
import type { Theme } from "../../types";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export function SettingsDialog({
  maxConcurrent,
  globalLimitMbps,
  maxRetryAttempts,
  theme,
  minimizeToTray,
  notifications,
  runAtStartup,
  reduceMotion,
  clipboardWatch,
  scheduledStartEnabled,
  scheduledStartTime,
  historyMaxEntries,
  historyRetentionDays,
  historyCount,
  onSetMaxActive,
  onSetGlobalLimit,
  onSetMaxRetryAttempts,
  onSetTheme,
  onSetMinimizeToTray,
  onSetNotifications,
  onSetRunAtStartup,
  onSetReduceMotion,
  onSetClipboardWatch,
  onSetScheduledStartEnabled,
  onSetScheduledStartTime,
  onSetHistoryMaxEntries,
  onSetHistoryRetentionDays,
  onClearHistory,
  onClose,
}: {
  maxConcurrent: number;
  globalLimitMbps: number;
  maxRetryAttempts: number;
  theme: Theme;
  minimizeToTray: boolean;
  notifications: boolean;
  runAtStartup: boolean;
  reduceMotion: boolean;
  clipboardWatch: boolean;
  scheduledStartEnabled: boolean;
  scheduledStartTime: string;
  historyMaxEntries: number;
  historyRetentionDays: number;
  historyCount: number;
  onSetMaxActive: (n: number) => void;
  onSetGlobalLimit: (mbps: number) => void;
  onSetMaxRetryAttempts: (n: number) => void;
  onSetTheme: (t: Theme) => void;
  onSetMinimizeToTray: (v: boolean) => void;
  onSetNotifications: (v: boolean) => void;
  onSetRunAtStartup: (v: boolean) => void;
  onSetReduceMotion: (v: boolean) => void;
  onSetClipboardWatch: (v: boolean) => void;
  onSetScheduledStartEnabled: (v: boolean) => void;
  onSetScheduledStartTime: (v: string) => void;
  onSetHistoryMaxEntries: (n: number) => void;
  onSetHistoryRetentionDays: (n: number) => void;
  onClearHistory: () => void;
  onClose: () => void;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);

  return (
    <motion.div
      className="overlay"
      onClick={onClose}
      variants={OVERLAY_FADE}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        ref={panelRef}
        className="dialog dialog-sm"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="settings-dialog-title">
          Settings
        </div>
        <div className="dialog-body">
          <fieldset className="dialog-section">
            <legend className="dialog-section-title">Downloads</legend>
            <div className="field-row">
              <label htmlFor="maxc">Max active downloads</label>
              <input
                id="maxc"
                type="number"
                min={1}
                max={10}
                value={maxConcurrent}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n)) onSetMaxActive(n);
                }}
              />
              <span className="field-unit">1–10</span>
            </div>
            <div className="field-row">
              <label htmlFor="glim">Global speed limit</label>
              <input
                id="glim"
                type="number"
                min={0}
                step={0.5}
                value={globalLimitMbps}
                onChange={(e) => onSetGlobalLimit(Number(e.currentTarget.value))}
              />
              <span className="field-unit">MB/s · 0 = unlimited (live)</span>
            </div>
            <div className="field-row">
              <label htmlFor="retry">Max retry attempts</label>
              <input
                id="retry"
                type="number"
                min={0}
                max={10}
                value={maxRetryAttempts}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n)) onSetMaxRetryAttempts(n);
                }}
              />
              <span className="field-unit">0–10 · 0 = off</span>
            </div>
            <div className="check-row">
              <input
                type="checkbox"
                id="clip-watch"
                checked={clipboardWatch}
                onChange={(e) => onSetClipboardWatch(e.currentTarget.checked)}
              />
              <label htmlFor="clip-watch">Watch clipboard for links</label>
              <span className="field-unit">Offers copied http(s) links as downloads</span>
            </div>
          </fieldset>

          <fieldset className="dialog-section">
            <legend className="dialog-section-title">Scheduling</legend>
            <div className="check-row">
              <input
                type="checkbox"
                id="sched-enabled"
                checked={scheduledStartEnabled}
                onChange={(e) => onSetScheduledStartEnabled(e.currentTarget.checked)}
              />
              <label htmlFor="sched-enabled">Hold the queue until a set time</label>
            </div>
            <div className="field-row">
              <label htmlFor="sched-time">Start downloads at</label>
              <input
                id="sched-time"
                type="time"
                value={scheduledStartTime}
                disabled={!scheduledStartEnabled}
                onChange={(e) => onSetScheduledStartTime(e.currentTarget.value)}
              />
              <span className="field-unit">Every day · Resume overrides it</span>
            </div>
          </fieldset>

          <fieldset className="dialog-section">
            <legend className="dialog-section-title">Appearance</legend>
            <div className="field-row">
              <label htmlFor="theme">Color theme</label>
              <select
                id="theme"
                value={theme}
                onChange={(e) => onSetTheme(e.currentTarget.value as Theme)}
              >
                <option value="system">Use system setting</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div className="check-row">
              <input
                type="checkbox"
                id="reduce-motion"
                checked={reduceMotion}
                onChange={(e) => onSetReduceMotion(e.currentTarget.checked)}
              />
              <label htmlFor="reduce-motion">Reduce motion</label>
            </div>
          </fieldset>

          <fieldset className="dialog-section">
            <legend className="dialog-section-title">System</legend>
            <div className="check-row">
              <input
                type="checkbox"
                id="min-tray"
                checked={minimizeToTray}
                onChange={(e) => onSetMinimizeToTray(e.currentTarget.checked)}
              />
              <label htmlFor="min-tray">Minimize to tray</label>
            </div>
            <div className="check-row">
              <input
                type="checkbox"
                id="run-startup"
                checked={runAtStartup}
                onChange={(e) => onSetRunAtStartup(e.currentTarget.checked)}
              />
              <label htmlFor="run-startup">Run at startup</label>
              <span className="field-unit">Starts hidden in the tray</span>
            </div>
            <div className="check-row">
              <input
                type="checkbox"
                id="notify"
                checked={notifications}
                onChange={(e) => onSetNotifications(e.currentTarget.checked)}
              />
              <label htmlFor="notify">Show desktop notifications</label>
            </div>
          </fieldset>

          <fieldset className="dialog-section">
            <legend className="dialog-section-title">History</legend>
            <div className="field-row">
              <label htmlFor="hist-max">Keep at most</label>
              <input
                id="hist-max"
                type="number"
                min={50}
                max={5000}
                step={50}
                value={historyMaxEntries}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n)) onSetHistoryMaxEntries(n);
                }}
              />
              <span className="field-unit">50–5000 entries</span>
            </div>
            <div className="field-row">
              <label htmlFor="hist-days">Drop entries after</label>
              <input
                id="hist-days"
                type="number"
                min={0}
                max={365}
                value={historyRetentionDays}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n)) onSetHistoryRetentionDays(n);
                }}
              />
              <span className="field-unit">0–365 days · 0 = keep forever</span>
            </div>
            <div className="field-row">
              <button className="danger" disabled={historyCount === 0} onClick={onClearHistory}>
                Clear history{historyCount > 0 ? ` (${historyCount})` : ""}
              </button>
            </div>
          </fieldset>
        </div>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default SettingsDialog;
