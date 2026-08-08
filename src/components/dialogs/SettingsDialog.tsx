import { motion } from "motion/react";
import type { Theme } from "../../types";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";

export function SettingsDialog({
  maxConcurrent,
  globalLimitMbps,
  theme,
  minimizeToTray,
  notifications,
  runAtStartup,
  onSetMaxActive,
  onSetGlobalLimit,
  onSetTheme,
  onSetMinimizeToTray,
  onSetNotifications,
  onSetRunAtStartup,
  onClose,
}: {
  maxConcurrent: number;
  globalLimitMbps: number;
  theme: Theme;
  minimizeToTray: boolean;
  notifications: boolean;
  runAtStartup: boolean;
  onSetMaxActive: (n: number) => void;
  onSetGlobalLimit: (mbps: number) => void;
  onSetTheme: (t: Theme) => void;
  onSetMinimizeToTray: (v: boolean) => void;
  onSetNotifications: (v: boolean) => void;
  onSetRunAtStartup: (v: boolean) => void;
  onClose: () => void;
}) {
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
        className="dialog dialog-sm"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div className="dialog-head" id="settings-dialog-title">
          Settings
        </div>
        <div className="dialog-body">
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
