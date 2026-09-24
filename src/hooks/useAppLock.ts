import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import type { LockStatus, UnlockResult } from "../bindings";

/** The PIN lock's live status (`null` while the initial `lock_status` call is
 *  still in flight — the caller treats that as "locked" so nothing flashes
 *  unlocked before the real answer arrives) plus the three actions the UI
 *  needs. Rust owns all the actual state (`lock.rs`) — this hook just mirrors
 *  it and pushes the two commands that can change it. */
export function useAppLock() {
  const [status, setStatus] = useState<LockStatus | null>(null);

  function refresh() {
    commands
      .lockStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, locked: false, retryAfterSecs: 0 }));
  }

  useEffect(() => {
    refresh();
    const unlisten = listen<LockStatus>("lock-changed", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  function unlock(pin: string): Promise<UnlockResult> {
    return commands.unlockApp(pin);
  }

  function lockNow() {
    commands.lockApp().catch(() => {});
  }

  return { status, unlock, lockNow, refresh };
}
