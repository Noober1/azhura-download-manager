import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

/** Grace period on a critical update before it applies itself. Long enough to
 *  finish a sentence, short enough that the fix actually lands. */
const CRITICAL_COUNTDOWN_SECONDS = 30;

/* Confirms the restart that applies a downloaded update. The update itself is
   already on disk by this point, so nothing here is time-sensitive — the only
   cost being weighed is the interruption, which is why the count of affected
   downloads is spelled out rather than left for the user to guess at.

   `critical` releases are the exception: the feed flagged the fix as one that
   shouldn't wait on someone getting around to it, so the dialog offers no way
   out and restarts on its own once the countdown runs down. Downloads still
   pause and resume either way, so the cost of being wrong about that is an
   interruption, not lost work. */
export function UpdateRestartDialog({
  version,
  critical,
  activeCount,
  queuedCount,
  onCancel,
  onConfirm,
}: {
  version: string | null;
  critical: boolean;
  activeCount: number;
  queuedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // A critical prompt ignores Escape and backdrop clicks — the only control
  // it offers is the one that goes forward.
  const panelRef = useDialogA11y<HTMLDivElement>(critical ? () => {} : onCancel);
  const affected = activeCount + queuedCount;

  const [secondsLeft, setSecondsLeft] = useState(CRITICAL_COUNTDOWN_SECONDS);
  // Held in a ref so the interval never rebuilds — restarting it each tick
  // would reset the current second and stretch the countdown indefinitely.
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    if (!critical) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [critical]);

  // Fired from an effect rather than the updater above: updater functions run
  // during render, and restarting the app is not a render-phase side effect.
  useEffect(() => {
    if (!critical || secondsLeft > 0) return;
    onConfirmRef.current();
  }, [critical, secondsLeft]);

  return (
    <motion.div
      className="overlay"
      onClick={critical ? undefined : onCancel}
      variants={OVERLAY_FADE}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        ref={panelRef}
        className="dialog dialog-sm"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-restart-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="update-restart-title">
          {critical
            ? `Critical update ${version} — restarting`
            : `Restart to install version ${version}?`}
        </div>
        <div className="dialog-body">
          <p className="detail-note" aria-live={critical ? "polite" : "off"}>
            {critical
              ? `This release fixes something that shouldn't wait. Azhura restarts in ${secondsLeft}s.`
              : "Azhura will close and reopen. The update is already downloaded, so this only takes a moment."}
          </p>
          {affected > 0 && (
            <p className="detail-note">
              {affected} download{affected > 1 ? "s" : ""} will be paused first and can be resumed
              afterwards — {affected > 1 ? "they" : "it"} won't start over.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          {!critical && <button onClick={onCancel}>Cancel</button>}
          <button className="primary-btn" onClick={onConfirm}>
            Restart now
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default UpdateRestartDialog;
