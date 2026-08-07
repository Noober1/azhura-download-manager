import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SPEED_PRESETS, CONNECTION_PRESETS } from "../constants";

/* Fixed-position right-click menu for the selected row(s). Clamps itself to
   stay inside the window and dismisses on outside click, Escape, scroll, or
   the window losing focus. */
export function ContextMenu({
  x,
  y,
  resumableCount,
  pausableCount,
  cancelableCount,
  canReveal,
  canCopy,
  canDelete,
  canShowDetail,
  canModify,
  currentSpeedLimit,
  currentConnections,
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
  pausableCount: number;
  cancelableCount: number;
  canReveal: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canShowDetail: boolean;
  canModify: boolean;
  currentSpeedLimit: number | null;
  currentConnections: number | null;
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
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? Math.max(0, window.innerWidth - rect.width - 4) : x;
    const ny =
      y + rect.height > window.innerHeight ? Math.max(0, window.innerHeight - rect.height - 4) : y;
    setPos({ x: nx, y: ny });
    // Flyouts open to the right by default (180px wide); flip them to the
    // left instead if that would run off the screen.
    setFlip(nx + rect.width + 180 > window.innerWidth);
  }, [x, y]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className={`ctx-menu ${flip ? "flip" : ""}`} style={{ left: pos.x, top: pos.y }} ref={ref}>
      <button
        type="button"
        className="ctx-item"
        disabled={resumableCount === 0}
        onClick={() => run(onResume)}
      >
        Resume{resumableCount > 1 ? ` (${resumableCount})` : ""}
      </button>
      <button
        type="button"
        className="ctx-item"
        disabled={pausableCount === 0}
        onClick={() => run(onPause)}
      >
        Pause{pausableCount > 1 ? ` (${pausableCount})` : ""}
      </button>
      <button
        type="button"
        className="ctx-item"
        disabled={cancelableCount === 0}
        onClick={() => run(onCancel)}
      >
        Stop{cancelableCount > 1 ? ` (${cancelableCount})` : ""}
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item"
        disabled={!canShowDetail}
        onClick={() => run(onShowDetail)}
      >
        Show detail
      </button>
      <button type="button" className="ctx-item" disabled={!canReveal} onClick={() => run(onReveal)}>
        Open containing folder
      </button>
      <button type="button" className="ctx-item" disabled={!canCopy} onClick={() => run(onCopyLink)}>
        Copy link
      </button>
      <div className="ctx-sep" />
      <div className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}>
        Speed cap
        <span className="ctx-caret">▸</span>
        <div className="ctx-flyout">
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.bytes}
              type="button"
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
            className="ctx-item"
            disabled={!canModify}
            onClick={() => run(onCustomSpeedCap)}
          >
            Custom…
          </button>
        </div>
      </div>
      <div className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}>
        Connections
        <span className="ctx-caret">▸</span>
        <div className="ctx-flyout">
          {CONNECTION_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
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
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item danger"
        disabled={!canDelete}
        onClick={() => run(onDelete)}
      >
        Delete…
      </button>
    </div>
  );
}

export default ContextMenu;
