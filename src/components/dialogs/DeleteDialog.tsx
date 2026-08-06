import { useEffect } from "react";
import type { DownloadItem } from "../../types";

/* Confirms a single or batch delete, offering to also remove the source
   file(s) from disk (unchecked by default). Running downloads in `items` are
   excluded from the action but called out so the user knows why. */
export function DeleteDialog({
  items,
  deleteWithFile,
  onToggleDeleteWithFile,
  onCancel,
  onConfirm,
}: {
  items: DownloadItem[];
  deleteWithFile: boolean;
  onToggleDeleteWithFile: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const deletable = items.filter((d) => d.state !== "downloading" && d.state !== "verifying");
  const skipped = items.length - deletable.length;
  const shownNames = deletable.slice(0, 5);
  const moreCount = deletable.length - shownNames.length;
  // A missing row has no temp file left to warn about.
  const hasIncomplete = deletable.some((d) => d.state !== "completed" && !d.missing);

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          {deletable.length === 1 ? `Delete "${deletable[0].filename}"?` : `Delete ${deletable.length} downloads?`}
        </div>
        <div className="dialog-body">
          {deletable.length > 1 && (
            <ul className="del-list">
              {shownNames.map((d) => (
                <li key={d.id} title={d.filename}>
                  {d.filename}
                </li>
              ))}
              {moreCount > 0 && <li>…and {moreCount} more</li>}
            </ul>
          )}
          {skipped > 0 && (
            <p className="detail-note">
              {skipped} running download{skipped > 1 ? "s are" : " is"} not included — pause or
              stop {skipped > 1 ? "them" : "it"} first.
            </p>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteWithFile}
              onChange={(e) => onToggleDeleteWithFile(e.currentTarget.checked)}
            />
            Delete source file also
          </label>
          <p className="detail-note">
            {deleteWithFile
              ? "Files are removed permanently, not sent to the Recycle Bin."
              : "Applies to completed downloads only — this doesn't send anything to the Recycle Bin."}
          </p>
          {hasIncomplete && (
            <p className="detail-note">
              Partial downloads are never resumable once removed, so their temp file is always
              deleted regardless of the checkbox above.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteDialog;
