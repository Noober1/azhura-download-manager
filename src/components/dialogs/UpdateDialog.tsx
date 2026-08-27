import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import type { UpdateState } from "../../hooks/useUpdateCheck";

/** Release notes come from the update feed, which is remote content — rendered
 *  as plain text, never as markup. Capped because a long changelog would push
 *  the buttons off the panel. */
const NOTES_MAX_CHARS = 600;

export function UpdateDialog({
  state,
  onInstall,
  onDismiss,
}: {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const busy = state.stage === "downloading" || state.stage === "ready";
  // Escape and backdrop clicks are ignored mid-download: dismissing the dialog
  // wouldn't stop the install, so it would only hide a running operation.
  const panelRef = useDialogA11y<HTMLDivElement>(busy ? () => {} : onDismiss);

  const notes = state.notes?.trim().slice(0, NOTES_MAX_CHARS) ?? "";
  const indeterminate = state.percent < 0;

  return (
    <motion.div
      className="overlay"
      onClick={busy ? undefined : onDismiss}
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
        aria-labelledby="update-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="update-dialog-title">
          Version {state.version} is available
        </div>
        <div className="dialog-body">
          {notes && <p className="update-notes">{notes}</p>}

          {state.stage === "downloading" && (
            <>
              <div
                className="update-bar"
                role="progressbar"
                aria-label="Update download progress"
                {...(indeterminate
                  ? {}
                  : { "aria-valuenow": state.percent, "aria-valuemin": 0, "aria-valuemax": 100 })}
              >
                <div
                  className={`update-bar-fill${indeterminate ? " indeterminate" : ""}`}
                  style={indeterminate ? undefined : { width: `${state.percent}%` }}
                />
              </div>
              <p className="detail-note" aria-live="polite">
                {indeterminate ? "Downloading…" : `Downloading… ${state.percent}%`}
              </p>
            </>
          )}

          {state.stage === "ready" && (
            <p className="detail-note" aria-live="polite">
              Installed — restarting.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onDismiss} disabled={busy}>
            Later
          </button>
          <button className="primary-btn" onClick={onInstall} disabled={busy}>
            {busy ? "Installing…" : "Install and restart"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default UpdateDialog;
