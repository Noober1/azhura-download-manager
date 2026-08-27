import { useEffect, useRef, useState } from "react";
import { isBeforeTarget } from "../queueSchedule";

/** How often the target time is re-checked. A minute of latency on a
 *  scheduled start is irrelevant, and re-checking on an interval (rather than
 *  arming one long `setTimeout`) survives the machine sleeping straight
 *  through the target — the normal case for a download manager left running
 *  overnight — and re-arms after midnight for free. */
const CHECK_MS = 60_000;

/** Holds the queue until a time of day, every day. `held` feeds
 *  `useScheduler`, which promotes nothing while it's true, so downloads added
 *  in the meantime wait in `queued` instead of starting.
 *
 *  Distinct from `useScheduler` on purpose: that one schedules *concurrency
 *  slots*, this one schedules *wall-clock time*. */
export function useQueueSchedule(enabled: boolean, timeHHMM: string) {
  const [held, setHeld] = useState(() => enabled && isBeforeTarget(new Date(), timeHHMM));
  // Set by an explicit user action (hitting Resume) — treated as "I want this
  // now", which outranks the schedule for the rest of the day.
  const overriddenRef = useRef(false);

  useEffect(() => {
    // A settings change is a fresh arming, so a previous override shouldn't
    // carry into it.
    overriddenRef.current = false;
    if (!enabled) {
      setHeld(false);
      return;
    }
    setHeld(isBeforeTarget(new Date(), timeHHMM));
    const timer = setInterval(() => {
      setHeld(!overriddenRef.current && isBeforeTarget(new Date(), timeHHMM));
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, timeHHMM]);

  function release() {
    overriddenRef.current = true;
    setHeld(false);
  }

  return { held, release };
}
