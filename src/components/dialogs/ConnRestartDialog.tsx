export function ConnRestartDialog({
  itemCount,
  onApplyOnNextStart,
  onRestartNow,
}: {
  itemCount: number;
  onApplyOnNextStart: () => void;
  onRestartNow: () => void;
}) {
  return (
    <div className="overlay" onClick={onApplyOnNextStart}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">Apply new connection count?</div>
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
      </div>
    </div>
  );
}

export default ConnRestartDialog;
