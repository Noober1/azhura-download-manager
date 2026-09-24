import { motion } from "motion/react";
import { SPEED_PRESETS, CONNECTION_PRESETS } from "../constants";
import { MENU_POP } from "../motion";
import { useContextMenuShell } from "./useContextMenuShell";
import type { QueueMove } from "../queueOrder";

/* Fixed-position right-click menu for the selected row(s). Clamps itself to
   stay inside the window and dismisses on outside click, Escape, scroll, or
   the window losing focus. */
export function ContextMenu({
  x,
  y,
  resumableCount,
  resumeLabel,
  pausableCount,
  cancelableCount,
  canReveal,
  canCopy,
  canDelete,
  canShowDetail,
  canModify,
  currentSpeedLimit,
  currentConnections,
  canMoveInQueue,
  onMoveInQueue,
  onResume,
  onPause,
  onCancel,
  onReveal,
  onCopyLink,
  onShowDetail,
  onSpeedCap,
  onCustomSpeedCap,
  onConnections,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  resumableCount: number;
  /** "Resume" or "Redownload" — depends on whether every selected resumable
   *  row would restart from byte zero (see `isRedownload` in format.ts). */
  resumeLabel: string;
  pausableCount: number;
  cancelableCount: number;
  canReveal: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canShowDetail: boolean;
  canModify: boolean;
  currentSpeedLimit: number | null;
  currentConnections: number | null;
  canMoveInQueue: boolean;
  onMoveInQueue: (where: QueueMove) => void;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onReveal: () => void;
  onCopyLink: () => void;
  onShowDetail: () => void;
  onSpeedCap: (bytes: number) => void;
  onCustomSpeedCap: () => void;
  onConnections: (n: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { ref, pos, flip, run } = useContextMenuShell(x, y, onClose);

  return (
    <motion.div
      className={`ctx-menu ${flip ? "flip" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      ref={ref}
      role="menu"
      variants={MENU_POP}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={resumableCount === 0}
        onClick={() => run(onResume)}
      >
        {resumeLabel}{resumableCount > 1 ? ` (${resumableCount})` : ""}
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={pausableCount === 0}
        onClick={() => run(onPause)}
      >
        Pause{pausableCount > 1 ? ` (${pausableCount})` : ""}
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={cancelableCount === 0}
        onClick={() => run(onCancel)}
      >
        Stop{cancelableCount > 1 ? ` (${cancelableCount})` : ""}
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={!canShowDetail}
        onClick={() => run(onShowDetail)}
      >
        Show detail
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={!canReveal}
        onClick={() => run(onReveal)}
      >
        Open containing folder
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        disabled={!canCopy}
        onClick={() => run(onCopyLink)}
      >
        Copy link
      </button>
      <div className="ctx-sep" />
      <div
        className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}
        role="menuitem"
        aria-haspopup="true"
      >
        Speed cap
        <span className="ctx-caret" aria-hidden="true">▸</span>
        <div className="ctx-flyout" role="menu">
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.bytes}
              type="button"
              role="menuitem"
              className="ctx-item"
              disabled={!canModify}
              onClick={() => run(() => onSpeedCap(p.bytes))}
            >
              <span className="ctx-check">{currentSpeedLimit === p.bytes ? "•" : ""}</span>
              {p.label}
            </button>
          ))}
          <div className="ctx-sep" />
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={!canModify}
            onClick={() => run(onCustomSpeedCap)}
          >
            Custom…
          </button>
        </div>
      </div>
      <div
        className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}
        role="menuitem"
        aria-haspopup="true"
      >
        Connections
        <span className="ctx-caret" aria-hidden="true">▸</span>
        <div className="ctx-flyout" role="menu">
          {CONNECTION_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitem"
              className="ctx-item"
              disabled={!canModify}
              onClick={() => run(() => onConnections(n))}
            >
              <span className="ctx-check">{currentConnections === n ? "•" : ""}</span>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`ctx-item ctx-sub ${!canMoveInQueue ? "disabled" : ""}`}
        role="menuitem"
        aria-haspopup="true"
      >
        Queue
        <span className="ctx-caret" aria-hidden="true">▸</span>
        <div className="ctx-flyout" role="menu">
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={!canMoveInQueue}
            onClick={() => run(() => onMoveInQueue("top"))}
          >
            Move to top
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={!canMoveInQueue}
            onClick={() => run(() => onMoveInQueue("up"))}
          >
            Move up
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={!canMoveInQueue}
            onClick={() => run(() => onMoveInQueue("down"))}
          >
            Move down
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            disabled={!canMoveInQueue}
            onClick={() => run(() => onMoveInQueue("bottom"))}
          >
            Move to bottom
          </button>
        </div>
      </div>
      <div className="ctx-sep" />
      <button
        type="button"
        role="menuitem"
        className="ctx-item danger"
        disabled={!canDelete}
        onClick={() => run(onDelete)}
      >
        Delete…
      </button>
    </motion.div>
  );
}

export default ContextMenu;
