import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  useTheme();

  // Restore persisted settings (scheduler knobs + tray behavior) from a
  // previous session; they otherwise reset to defaults every launch.
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((s) => {
        setMaxConcurrent(s.maxConcurrent);
        setGlobalLimitMbps(s.globalLimitMbps);
        setMinimizeToTray(s.minimizeToTray);
        setTheme(normalizeTheme(s.theme));
        setNotifications(s.notifications);
        setNotificationsEnabled(s.notifications);
        if (s.globalLimitMbps > 0) {
          invoke("set_global_speed_limit", {
            bytesPerSec: Math.round(s.globalLimitMbps * 1024 * 1024),
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

  function persistSettings(overrides: Partial<AppSettings> = {}) {
    invoke("save_settings", {
      settings: {
        maxConcurrent,
        globalLimitMbps,
        minimizeToTray,
        theme,
        notifications,
        ...overrides,
      } as AppSettings,
    });
  }

  function setMaxActive(n: number) {
    const v = Math.min(10, Math.max(1, Math.round(n)));
    setMaxConcurrent(v);
    persistSettings({ maxConcurrent: v });
  }

  function setGlobalLimit(mbps: number) {
    const v = Math.max(0, mbps || 0);
    setGlobalLimitMbps(v);
    invoke("set_global_speed_limit", { bytesPerSec: Math.round(v * 1024 * 1024) });
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

  return {
    maxConcurrent,
    globalLimitMbps,
    minimizeToTray,
    theme,
    notifications,
    setMaxActive,
    setGlobalLimit,
    setMinimizeToTraySetting,
    setThemeSetting,
    setNotificationsSetting,
  };
}
