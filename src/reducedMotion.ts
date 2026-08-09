import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { commands } from "./bindings";

/* User opt-in on top of the OS-level `prefers-reduced-motion` setting —
   mirrors src/theme.ts's structure exactly. This is a boolean, not a
   tri-state: the app toggle can only ADD reduction on top of whatever the OS
   already prefers, never force motion back on against the OS setting (that's
   what `MotionConfig`'s "user" vs "always" distinction encodes downstream,
   see MotionProvider.tsx).

   settings.json (via load_settings/save_settings) stays the source of truth.
   localStorage is only a paint-time mirror: the inline script in index.html /
   add.html / detail.html reads it to stamp `data-reduced-motion` on <html>
   *before* React mounts, so the sweep keyframe never gets a chance to spin
   even one frame for a user who has it on. */

export const REDUCE_MOTION_KEY = "adm-reduce-motion";

let current = false;

function stamp() {
  document.documentElement.dataset.reducedMotion = current ? "on" : "off";
}

export function applyReducedMotion(v: boolean) {
  current = v;
  stamp();
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, v ? "1" : "0");
  } catch {
    /* private mode / storage disabled — the attribute is still stamped, only
       the pre-paint shortcut is lost */
  }
}

/** Apply locally, then tell the other windows. Only the main window calls
 *  this; Add and Details are listeners. */
export function broadcastReducedMotion(v: boolean) {
  applyReducedMotion(v);
  emit("reduce-motion-changed", v).catch(() => {});
}

/** Called by every window: picks up the persisted setting at startup and
 *  follows live changes made in the main window's Settings dialog. Returns
 *  the current value (unlike `useTheme()`, which is `void`) because
 *  `MotionProvider` needs it to configure `MotionConfig`. */
export function useReducedMotionSetting(): boolean {
  const [value, setValue] = useState(current);
  useEffect(() => {
    commands
      .loadSettings()
      .then((s) => {
        const v = s.reduceMotion ?? false;
        applyReducedMotion(v);
        setValue(v);
      })
      .catch(() => {});
    const unlisten = listen<boolean>("reduce-motion-changed", (e) => {
      applyReducedMotion(e.payload);
      setValue(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  return value;
}
