import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

/* Confirms the restart that applies a downloaded update. The update itself is
   already on disk by this point, so nothing here is time-sensitive — the only
   cost being weighed is the interruption, which is why the count of affected
   downloads is spelled out rather than left for the user to guess at. */
export function UpdateRestartDialog({
  version,
  activeCount,
  queuedCount,
  onCancel,
  onConfirm,
}: {
  version: string | null;
  activeCount: number;
  queuedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onCancel);
  const affected = activeCount + queuedCount;

  return (
    <motion.div
      className="overlay"
      onClick={onCancel}
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
          Restart to install version {version}?
        </div>
        <div className="dialog-body">
          <p className="detail-note">
            Azhura will close and reopen. The update is already downloaded, so this only takes a
            moment.
          </p>
          {affected > 0 && (
            <p className="detail-note">
              {affected} download{affected > 1 ? "s" : ""} will be paused first and can be resumed
              afterwards — {affected > 1 ? "they" : "it"} won't start over.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary-btn" onClick={onConfirm}>
            Restart now
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default UpdateRestartDialog;
