import { useEffect } from "react";
import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";

export function ConnRestartDialog({
  itemCount,
  onApplyOnNextStart,
  onRestartNow,
}: {
  itemCount: number;
  onApplyOnNextStart: () => void;
  onRestartNow: () => void;
}) {
  // Mirrors the backdrop click's own dismiss target: Escape is "cancel this
  // dialog," and the safe default here is applying on next start rather than
  // restarting now, same as clicking outside.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onApplyOnNextStart();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onApplyOnNextStart]);

  return (
    <motion.div
      className="overlay"
      onClick={onApplyOnNextStart}
      variants={OVERLAY_FADE}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="dialog dialog-sm"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connrestart-dialog-title"
      >
        <div className="dialog-head" id="connrestart-dialog-title">
          Apply new connection count?
        </div>
        <div className="dialog-body">
          <p className="detail-note">
            {itemCount > 1
              ? `${itemCount} downloads are running.`
              : "This download is running."}{" "}
            Restarting resumes from where it left off — no progress is lost.
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={onApplyOnNextStart}>Apply on next start</button>
          <button className="primary-btn" onClick={onRestartNow}>
            Restart now
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ConnRestartDialog;
