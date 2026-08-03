import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DownloadItem, DetailAction } from "./types";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  statusClass,
  statusLabel,
  pctOf,
} from "./format";
import { WindowControls, useSuppressContextMenu } from "./ui";
import "./App.css";

/* The separate native "Download Details" window. A pure view driven by
   `detail-data` snapshots the main window pushes whenever the targeted row
   changes; action buttons emit `detail-action` back to main rather than
   calling any download command directly, since main owns all download state. */
export function DetailWindow() {
  const [item, setItem] = useState<DownloadItem | null>(null);
  const [ready, setReady] = useState(false);

  useSuppressContextMenu();

  useEffect(() => {
    const unlisten = listen<DownloadItem | null>("detail-data", (e) => {
      setItem(e.payload);
      setReady(true);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  function sendAction(action: DetailAction["action"]) {
    if (!item) return;
    emitTo("main", "detail-action", { id: item.id, action } as DetailAction);
  }

  function close() {
    invoke("close_detail_window");
  }

  if (!ready) {
    return (
      <div className="add-window">
        <div className="dialog-head add-head" data-tauri-drag-region>
          <span>Download Details</span>
          <WindowControls variant="close" />
        </div>
        <div className="dialog-body" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="add-window">
        <div className="dialog-head add-head" data-tauri-drag-region>
          <span>Download Details</span>
          <WindowControls variant="close" />
        </div>
        <div className="dialog-body">
          <p className="detail-note">This download was removed.</p>
        </div>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const pct = pctOf(item);
  const eta =
    item.total && item.speed > 0 ? Math.max(0, (item.total - item.downloaded) / item.speed) : null;
  const elapsed =
    item.startedAt && item.state === "downloading" ? (Date.now() - item.startedAt) / 1000 : null;

  const pausable = item.state === "downloading";
  const cancelable = pausable;
  const resumable =
    !!item.missing ||
    !!item.fromHistory ||
    !!item.awaitingCapture ||
    ["paused", "error", "canceled"].includes(item.state);
  const canReveal = item.state === "completed" && !!item.path && !item.missing;

  return (
    <div className="add-window">
      <div className="dialog-head add-head" data-tauri-drag-region>
        <span>Download Details</span>
        <WindowControls variant="close" />
      </div>

      <div className="dialog-body detail-window-body">
        <div className="detail-title-row">
          <span className="detail-title selectable" title={item.filename}>
            {item.filename}
          </span>
          <span className={`mode-tag ${statusClass(item)}`}>{statusLabel(item)}</span>
        </div>

        <div className="cell-pct detail-overall">
          <div className="mini-track">
            <div
              className={`mini-bar ${
                item.state === "completed" && !item.missing ? "done" : ""
              } ${item.state === "error" || item.state === "canceled" ? "error" : ""} ${
                pct === null && item.state === "downloading" ? "indeterminate" : ""
              }`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
          <span className="pct-num">{pct !== null ? `${pct.toFixed(0)}%` : "—"}</span>
        </div>

        <div className="detail-meta">
          <span className="tabular">
            {formatBytes(item.downloaded)}
            {item.total ? ` / ${formatBytes(item.total)}` : ""}
          </span>
          {item.state === "downloading" && (
            <span className="tabular">
              {formatSpeed(item.speed)}
              {eta !== null ? ` · ETA ${formatEta(eta)}` : ""}
            </span>
          )}
          {elapsed !== null && <span className="tabular">Elapsed {formatEta(elapsed)}</span>}
        </div>

        {item.state === "downloading" && item.conns.length > 1 && (
          <div className="segments">
            {item.conns.map((c, i) => {
              const p = c.total > 0 ? Math.min(100, (c.downloaded / c.total) * 100) : 0;
              const idle = c.total === 0;
              return (
                <div className="seg" key={i}>
                  <span className="seg-idx">#{i + 1}</span>
                  <div className="seg-track">
                    <div
                      className={`seg-bar ${idle ? "idle" : ""}`}
                      style={{ width: idle ? "100%" : `${p}%` }}
                    />
                  </div>
                  <span className="seg-pct">{c.pieces} pcs</span>
                </div>
              );
            })}
          </div>
        )}

        {item.state === "verifying" && <div className="detail-note">Verifying checksum…</div>}
        {item.state === "completed" && item.checksum && <p className="ok">✓ Checksum verified</p>}
        {item.state === "completed" && !item.missing && (
          <p className="detail-path selectable" title={item.path}>
            Saved to {item.path}
          </p>
        )}
        {item.missing && (
          <p className="detail-path selectable" title={item.path}>
            No longer at {item.path} — resume to download it again.
          </p>
        )}
        {item.awaitingCapture && (
          <div className="detail-note">
            Opened the original page in your browser. Start the download there and the extension
            will hand it back here automatically.
          </div>
        )}
        {item.state === "error" && item.error && <p className="err selectable">{item.error}</p>}

        <div className="detail-grid">
          <span className="detail-grid-label">URL</span>
          <span className="detail-grid-value selectable" title={item.url}>
            {item.url}
          </span>

          <span className="detail-grid-label">Save path</span>
          <span className="detail-grid-value selectable">
            {item.savePath || "default downloads folder"}
          </span>

          {item.path && (
            <>
              <span className="detail-grid-label">File path</span>
              <span className="detail-grid-value selectable" title={item.path}>
                {item.path}
              </span>
            </>
          )}

          <span className="detail-grid-label">Connections</span>
          <span className="detail-grid-value">
            {item.usedConnections} of {item.connections} requested
          </span>

          {item.numPieces > 0 && (
            <>
              <span className="detail-grid-label">Pieces</span>
              <span className="detail-grid-value">
                {item.numPieces} × {formatBytes(item.pieceSize)}
              </span>
            </>
          )}

          <span className="detail-grid-label">Speed cap</span>
          <span className="detail-grid-value">
            {item.speedLimit > 0 ? `${formatSpeed(item.speedLimit)}` : "Unlimited"}
          </span>

          {item.checksum && (
            <>
              <span className="detail-grid-label">Checksum</span>
              <span className="detail-grid-value selectable">{item.checksum}</span>
            </>
          )}

          {item.referer && (
            <>
              <span className="detail-grid-label">Referer</span>
              <span className="detail-grid-value selectable" title={item.referer}>
                {item.referer}
              </span>
            </>
          )}

          {!!item.finishedAt && (
            <>
              <span className="detail-grid-label">Finished</span>
              <span className="detail-grid-value">{new Date(item.finishedAt).toLocaleString()}</span>
            </>
          )}
        </div>
      </div>

      <div className="dialog-actions">
        <button disabled={!resumable} onClick={() => sendAction("resume")}>
          Resume
        </button>
        <button disabled={!pausable} onClick={() => sendAction("pause")}>
          Pause
        </button>
        <button disabled={!cancelable} onClick={() => sendAction("cancel")}>
          Cancel
        </button>
        <button disabled={!canReveal} onClick={() => revealItemInDir(item.path).catch(() => {})}>
          Open folder
        </button>
        <button onClick={() => writeText(item.url)}>Copy link</button>
        <button className="primary-btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

export default DetailWindow;
