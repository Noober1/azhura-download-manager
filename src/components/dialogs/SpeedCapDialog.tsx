import type { DownloadItem } from "../../types";

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
  function apply() {
    onApply(dialog.items, Math.round(dialog.mbps * 1024 * 1024));
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">Speed cap</div>
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
      </div>
    </div>
  );
}

export default SpeedCapDialog;
