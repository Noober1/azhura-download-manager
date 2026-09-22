import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export type PowerAction = "sleep" | "shutdown";

const COUNTDOWN_SECONDS = 60;

export function PowerActionDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: PowerAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  // Escape and a backdrop click both cancel: for something that suspends the
  // machine, every ambiguous dismissal has to mean "don't".
  const panelRef = useDialogA11y<HTMLDivElement>(onCancel);

  // Kept in a ref so the interval below never needs rebuilding — restarting it
  // on each tick would reset the current second and stretch the countdown out
  // past a minute.
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Firing from an effect rather than from inside the updater above: updater
  // functions run during the render phase, so suspending the machine (and
  // setting state in the parent) from in there would be a side effect in the
  // middle of a render.
  useEffect(() => {
    if (secondsLeft > 0) return;
    onConfirmRef.current();
  }, [secondsLeft]);

  const verb = action === "sleep" ? "sleep" : "shut down";
  const label = action === "sleep" ? "Sleep" : "Shut down";

  return (
    <motion.div
      className="overlay overlay-top"
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
        aria-labelledby="power-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="power-dialog-title">
          All downloads finished
        </div>
        <div className="dialog-body">
          <p className="detail-note" aria-live="polite">
            The computer will {verb} in {secondsLeft}s.
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={onConfirm}>{label} now</button>
          <button className="primary-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default PowerActionDialog;
