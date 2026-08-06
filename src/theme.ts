import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { commands } from "./bindings";
import type { Theme } from "./types";

/* Color theme, applied by stamping `data-theme` on <html> — every color token
   in App.css hangs off that attribute.

   settings.json (via load_settings/save_settings) stays the source of truth.
   localStorage is only a paint-time mirror: the inline script in index.html /
   add.html / detail.html reads it to stamp the attribute *before* React
   mounts, so a light-theme user never sees a dark first frame. */

export const THEME_KEY = "adm-theme";

const mq =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

let current: Theme = "system";

function stamp() {
  const dark = current === "dark" || (current === "system" && !!mq?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// Attached once and left in place rather than added/removed as the setting
// changes; it's a no-op unless the user is actually on "system".
mq?.addEventListener("change", () => {
  if (current === "system") stamp();
});

/** Anything unrecognized in settings.json falls back to "system". */
export function normalizeTheme(value: unknown): Theme {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

export function applyTheme(t: Theme) {
  current = t;
  stamp();
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode / storage disabled — the attribute is still stamped, only
       the pre-paint shortcut is lost */
  }
}

/** Apply locally, then tell the other windows. Only the main window calls
 *  this; Add and Details are listeners. */
export function broadcastTheme(t: Theme) {
  applyTheme(t);
  emit("theme-changed", t).catch(() => {});
}

/** Called by every window alongside `useNativeShell()`: picks up the persisted
 *  theme at startup and follows live changes made in the main window's
 *  Settings dialog. */
export function useTheme() {
  useEffect(() => {
    commands
      .loadSettings()
      .then((s) => applyTheme(normalizeTheme(s.theme)))
      .catch(() => {});
    const unlisten = listen<Theme>("theme-changed", (e) => applyTheme(normalizeTheme(e.payload)));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
}
