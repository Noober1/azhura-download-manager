import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/* Desktop toasts for the things that happen while the user isn't looking —
   the app keeps downloading after it hides to the tray, so a finished or
   failed download would otherwise go unnoticed until they reopen the window.

   Both flags are module-level rather than React state on purpose: the call
   sites are inside `handleEvent`, a plain function the download Channel calls
   from outside the render tree, so threading state through it would mean
   rebuilding the handler on every settings change. */

let enabled = true;
let granted = false;

export function setNotificationsEnabled(v: boolean) {
  enabled = v;
}

/** Asked for once at startup. A denial (or a platform that can't do toasts at
 *  all) just leaves `notify` a no-op — never an error the user has to see. */
export async function initNotifications() {
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
}

export function notify(title: string, body: string) {
  if (!enabled || !granted) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* a toast failing is never worth interrupting a download over */
  }
}
