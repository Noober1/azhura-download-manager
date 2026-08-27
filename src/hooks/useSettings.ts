import { useEffect, useState } from "react";
import { commands } from "../bindings";
import type { AppSettings, Theme } from "../types";
import { broadcastTheme, normalizeTheme, useTheme } from "../theme";
import { broadcastReducedMotion } from "../reducedMotion";
import { initNotifications, setNotificationsEnabled } from "../notify";

/** App-wide settings persisted to settings.json — scheduler knobs, tray
 *  behavior, theme, notifications, and the reduced-motion opt-in — plus the
 *  setters that keep the backend's copy (and, for theme/reduced-motion,
 *  sibling windows) in sync. */
export function useSettings() {
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [globalLimitMbps, setGlobalLimitMbps] = useState(0);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [notifications, setNotifications] = useState(true);
  const [runAtStartup, setRunAtStartup] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [clipboardWatch, setClipboardWatch] = useState(false);
  const [scheduledStartEnabled, setScheduledStartEnabled] = useState(false);
  const [scheduledStartTime, setScheduledStartTime] = useState("02:00");
  const [historyMaxEntries, setHistoryMaxEntries] = useState(500);
  const [historyRetentionDays, setHistoryRetentionDays] = useState(0);

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
        setMaxRetryAttempts(s.maxRetryAttempts ?? 3);
        setMinimizeToTray(s.minimizeToTray ?? false);
        setTheme(normalizeTheme(s.theme));
        setNotifications(notifications);
        setNotificationsEnabled(notifications);
        setReduceMotion(s.reduceMotion ?? false);
        setClipboardWatch(s.clipboardWatch ?? false);
        setScheduledStartEnabled(s.scheduledStartEnabled ?? false);
        setScheduledStartTime(s.scheduledStartTime ?? "02:00");
        setHistoryMaxEntries(s.historyMaxEntries ?? 500);
        setHistoryRetentionDays(s.historyRetentionDays ?? 0);
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

  // `save_settings` (Rust) overwrites the whole `AppSettings` struct — any
  // field missing from this payload falls back to its `#[serde(default)]`
  // value, not its last-saved one. Every tracked field must be listed here,
  // even ones this particular call isn't changing (that's what `overrides`
  // is for) — otherwise changing any ONE setting would silently reset every
  // other one back to default on save.
  function persistSettings(overrides: Partial<AppSettings> = {}) {
    commands.saveSettings({
      maxConcurrent,
      globalLimitMbps,
      maxRetryAttempts,
      minimizeToTray,
      theme,
      notifications,
      reduceMotion,
      clipboardWatch,
      scheduledStartEnabled,
      scheduledStartTime,
      historyMaxEntries,
      historyRetentionDays,
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

  // Lower bound 0 (not 1, unlike setMaxActive) — 0 means auto-retry is off,
  // matching today's behavior.
  function setMaxRetryAttemptsSetting(n: number) {
    const v = Math.min(10, Math.max(0, Math.round(n)));
    setMaxRetryAttempts(v);
    persistSettings({ maxRetryAttempts: v });
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

  // Applies here and pushes the change to the Add / Details windows, mirroring
  // setThemeSetting above — both windows hold their own MotionConfig instance.
  function setReduceMotionSetting(v: boolean) {
    setReduceMotion(v);
    broadcastReducedMotion(v);
    persistSettings({ reduceMotion: v });
  }

  function setClipboardWatchSetting(v: boolean) {
    setClipboardWatch(v);
    persistSettings({ clipboardWatch: v });
  }

  function setScheduledStartEnabledSetting(v: boolean) {
    setScheduledStartEnabled(v);
    persistSettings({ scheduledStartEnabled: v });
  }

  // `<input type="time">` reports "" while the field is being cleared or
  // half-typed; keeping the previous value rather than persisting garbage
  // means `isBeforeTarget` never has to interpret a broken schedule.
  function setScheduledStartTimeSetting(v: string) {
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    setScheduledStartTime(v);
    persistSettings({ scheduledStartTime: v });
  }

  // Mirrored by `HISTORY_MAX_BOUNDS` in Rust's `save_history`, which re-clamps
  // on its side — settings.json is user-editable, so the backend can't trust
  // this clamp to have happened.
  function setHistoryMaxEntriesSetting(n: number) {
    const v = Math.min(5000, Math.max(50, Math.round(n)));
    setHistoryMaxEntries(v);
    persistSettings({ historyMaxEntries: v });
  }

  function setHistoryRetentionDaysSetting(n: number) {
    const v = Math.min(365, Math.max(0, Math.round(n)));
    setHistoryRetentionDays(v);
    persistSettings({ historyRetentionDays: v });
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
    maxRetryAttempts,
    minimizeToTray,
    theme,
    notifications,
    runAtStartup,
    reduceMotion,
    clipboardWatch,
    scheduledStartEnabled,
    scheduledStartTime,
    historyMaxEntries,
    historyRetentionDays,
    setMaxActive,
    setGlobalLimit,
    setMaxRetryAttemptsSetting,
    setMinimizeToTraySetting,
    setThemeSetting,
    setNotificationsSetting,
    setRunAtStartupSetting,
    setReduceMotionSetting,
    setClipboardWatchSetting,
    setScheduledStartEnabledSetting,
    setScheduledStartTimeSetting,
    setHistoryMaxEntriesSetting,
    setHistoryRetentionDaysSetting,
  };
}
