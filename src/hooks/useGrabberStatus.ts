import { useEffect, useState } from "react";
import { commands } from "../bindings";
import type { GrabberStatus } from "../bindings";

const POLL_MS = 10_000;

/** Live status of the loopback bridge the browser extension talks to (see
 *  `src-tauri/src/bridge.rs`) — polled rather than pushed since it can flip
 *  to inactive at any time if the accept loop ever exits. */
export function useGrabberStatus(): GrabberStatus {
  const [status, setStatus] = useState<GrabberStatus>({ running: false, port: null });

  useEffect(() => {
    let cancelled = false;
    function poll() {
      commands
        .grabberStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
