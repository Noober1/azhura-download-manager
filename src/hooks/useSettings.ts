import { useEffect, useState } from "react";
import { commands } from "../bindings";
import type { AppSettings, Theme } from "../types";
import { broadcastTheme, normalizeTheme, useTheme } from "../theme";
import { initNotifications, setNotificationsEnabled } from "../notify";

/** App-wide settings persisted to settings.json — scheduler knobs, tray
 *  behavior, theme, and notifications — plus the setters that keep the
 *  backend's copy (and, for theme, sibling windows) in sync. */
export function useSettings() {
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [globalLimitMbps, setGlobalLimitMbps] = useState(0);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [notifications, setNotifications] = useState(true);
  const [runAtStartup, setRunAtStartup] = useState(false);

  useTheme();

  // Restore persisted settings (scheduler knobs + tray behavior) from a
  // previous session; they otherwise reset to defaults every launch.
  useEffect(() => {
    commands
      .loadSettings()
      .then((s) => {
        // The generated binding types every field optional (it doubles as
        // save_settings's input type, where a partial settings.json on disk
        // falls back to `#[serde(default)]`) — load_settings itself always
        // returns the struct fully populated, so these fallbacks are never
        // actually exercised; they just match AppSettings::default() in Rust.
        const globalLimitMbps = s.globalLimitMbps ?? 0;
        const notifications = s.notifications ?? true;
        setMaxConcurrent(s.maxConcurrent ?? 3);
        setGlobalLimitMbps(globalLimitMbps);
        setMinimizeToTray(s.minimizeToTray ?? false);
        setTheme(normalizeTheme(s.theme));
        setNotifications(notifications);
        setNotificationsEnabled(notifications);
        if (globalLimitMbps > 0) {
          commands.setGlobalSpeedLimit({
            bytesPerSec: Math.round(globalLimitMbps * 1024 * 1024),
          });
        }
      })
      .catch(() => {});
  }, []);

  // Asked for once per launch. A denial silently disables toasts rather than
  // surfacing an error the user can't act on from here.
  useEffect(() => {
    initNotifications();
  }, []);

  // Not part of settings.json / persistSettings below: the OS-level registry
  // entry (or macOS LaunchAgent) the backend's autostart plugin manages is
  // the single source of truth, so this is loaded from its own command
  // instead of `loadSettings`'s snapshot.
  useEffect(() => {
    commands
      .getRunAtStartup()
      .then(setRunAtStartup)
      .catch(() => {});
  }, []);

  function persistSettings(overrides: Partial<AppSettings> = {}) {
    commands.saveSettings({
      maxConcurrent,
      globalLimitMbps,
      minimizeToTray,
      theme,
      notifications,
      ...overrides,
    } as AppSettings);
  }

  function setMaxActive(n: number) {
    const v = Math.min(10, Math.max(1, Math.round(n)));
    setMaxConcurrent(v);
    persistSettings({ maxConcurrent: v });
  }

  function setGlobalLimit(mbps: number) {
    const v = Math.max(0, mbps || 0);
    setGlobalLimitMbps(v);
    commands.setGlobalSpeedLimit({ bytesPerSec: Math.round(v * 1024 * 1024) });
    persistSettings({ globalLimitMbps: v });
  }

  function setMinimizeToTraySetting(v: boolean) {
    setMinimizeToTray(v);
    persistSettings({ minimizeToTray: v });
  }

  // Applies here and pushes the change to the Add / Details windows, which
  // hold their own copy of the stylesheet.
  function setThemeSetting(v: Theme) {
    setTheme(v);
    broadcastTheme(v);
    persistSettings({ theme: v });
  }

  function setNotificationsSetting(v: boolean) {
    setNotifications(v);
    setNotificationsEnabled(v);
    persistSettings({ notifications: v });
  }

  // Optimistic: flips the checkbox immediately, then reverts it if the OS
  // call actually fails (e.g. the registry key is locked down).
  function setRunAtStartupSetting(v: boolean) {
    setRunAtStartup(v);
    commands.setRunAtStartup(v).catch(() => setRunAtStartup(!v));
  }

  return {
    maxConcurrent,
    globalLimitMbps,
    minimizeToTray,
    theme,
    notifications,
    runAtStartup,
    setMaxActive,
    setGlobalLimit,
    setMinimizeToTraySetting,
    setThemeSetting,
    setNotificationsSetting,
    setRunAtStartupSetting,
  };
}
