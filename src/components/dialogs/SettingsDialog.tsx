import type { Theme } from "../../types";

export function SettingsDialog({
  maxConcurrent,
  globalLimitMbps,
  theme,
  minimizeToTray,
  notifications,
  onSetMaxActive,
  onSetGlobalLimit,
  onSetTheme,
  onSetMinimizeToTray,
  onSetNotifications,
  onClose,
}: {
  maxConcurrent: number;
  globalLimitMbps: number;
  theme: Theme;
  minimizeToTray: boolean;
  notifications: boolean;
  onSetMaxActive: (n: number) => void;
  onSetGlobalLimit: (mbps: number) => void;
  onSetTheme: (t: Theme) => void;
  onSetMinimizeToTray: (v: boolean) => void;
  onSetNotifications: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">Settings</div>
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
      </div>
    </div>
  );
}

export default SettingsDialog;
