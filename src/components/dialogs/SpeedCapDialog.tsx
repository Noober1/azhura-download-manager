import { useEffect } from "react";
import { motion } from "motion/react";
import type { DownloadItem } from "../../types";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";

export function SpeedCapDialog({
  dialog,
  onChangeMbps,
  onApply,
  onCancel,
}: {
  dialog: { items: DownloadItem[]; mbps: number };
  onChangeMbps: (mbps: number) => void;
  onApply: (items: DownloadItem[], bytesPerSec: number) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function apply() {
    onApply(dialog.items, Math.round(dialog.mbps * 1024 * 1024));
  }

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
        className="dialog dialog-sm"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="speedcap-dialog-title"
      >
        <div className="dialog-head" id="speedcap-dialog-title">
          Speed cap
        </div>
        <div className="dialog-body">
          <div className="field-row">
            <label htmlFor="custom-cap">Limit</label>
            <input
              id="custom-cap"
              type="number"
              min={0}
              step={0.5}
              autoFocus
              value={dialog.mbps}
              onChange={(e) => onChangeMbps(Math.max(0, Number(e.currentTarget.value) || 0))}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
            />
            <span className="field-unit">MB/s · 0 = unlimited</span>
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary-btn" onClick={apply}>
            Apply
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default SpeedCapDialog;
