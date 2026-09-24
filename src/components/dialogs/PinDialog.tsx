import { useState } from "react";
import { motion } from "motion/react";
import { commands } from "../../bindings";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";
import { isValidPin, pinFormError, sanitizePinInput } from "../../lock";

export type PinMode = "set" | "change" | "remove";

const TITLES: Record<PinMode, string> = {
  set: "Set PIN",
  change: "Change PIN",
  remove: "Remove PIN",
};

export function PinDialog({
  mode,
  onClose,
  onDone,
}: {
  mode: PinMode;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCurrent = mode === "change" || mode === "remove";
  const needsNext = mode === "set" || mode === "change";

  function validate(): string | null {
    if (needsCurrent && !isValidPin(current)) return "Enter your current PIN";
    if (needsNext) return pinFormError(next, confirm);
    return null;
  }

  function submit() {
    const clientError = validate();
    if (clientError) {
      setError(clientError);
      return;
    }
    setBusy(true);
    setError(null);
    const action =
      mode === "remove"
        ? commands.clearAppPin(current)
        : commands.setAppPin(mode === "set" ? null : current, next);
    action
      .then(() => {
        setBusy(false);
        onDone(mode === "set" ? "PIN set" : mode === "change" ? "PIN changed" : "App lock removed");
      })
      .catch((e) => {
        setBusy(false);
        setError(String(e));
      });
  }

  return (
    <motion.div
      className="overlay"
      onClick={onClose}
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
        aria-labelledby="pin-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="pin-dialog-title">
          {TITLES[mode]}
        </div>
        <div className="dialog-body">
          {needsCurrent && (
            <div className="field-row">
              <label htmlFor="pin-current">Current PIN</label>
              <input
                id="pin-current"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                autoFocus
                value={current}
                onChange={(e) => setCurrent(sanitizePinInput(e.currentTarget.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !needsNext) submit();
                }}
              />
            </div>
          )}
          {needsNext && (
            <>
              <div className="field-row">
                <label htmlFor="pin-next">New PIN</label>
                <input
                  id="pin-next"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  autoFocus={!needsCurrent}
                  value={next}
                  onChange={(e) => setNext(sanitizePinInput(e.currentTarget.value))}
                />
                <span className="field-unit">4–8 digits</span>
              </div>
              <div className="field-row">
                <label htmlFor="pin-confirm">Confirm PIN</label>
                <input
                  id="pin-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(sanitizePinInput(e.currentTarget.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              </div>
            </>
          )}
          {mode === "set" && (
            <p className="detail-note">
              Forgetting the PIN means deleting lock.json by hand — there is no recovery.
            </p>
          )}
          {error && <div className="pin-dialog-error">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary-btn" disabled={busy} onClick={submit}>
            {busy ? "Working…" : TITLES[mode]}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default PinDialog;
