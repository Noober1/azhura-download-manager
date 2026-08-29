import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "./bindings";
import type { ArchiveListing, ArchiveRequest } from "./bindings";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import { formatBytes } from "./format";
import { buildArchiveTree, filterTree } from "./archiveTree";
import { ArchiveTree } from "./components/archive/ArchiveTree";
import "./App.css";

type Status = "scanning" | "done" | "error";

/* The separate native "Preview archive" popup, opened from the Add window's
   "Preview contents" button (see `openArchivePreview` in useAddForm.ts). A
   single window (labeled `archive-preview`) — reused, not duplicated, if a
   second preview is requested while one is still open, in which case Rust
   re-stashes the request and emits `archive-window-opened` to tell this
   already-mounted tree to collect and re-scan it.

   Built hidden by the Rust side; shown here (via `showArchiveWindow`) only
   once there's at least a "Scanning…" state to display, so there's never a
   flash of an empty popup — the same handshake the Details popup uses. */
export function ArchiveWindow() {
  useNativeShell();
  useTheme();

  const [status, setStatus] = useState<Status>("scanning");
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [filterText, setFilterText] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  function runScan(req: ArchiveRequest) {
    const myId = ++requestIdRef.current;
    setStatus("scanning");
    setListing(null);
    setErrorMessage("");
    setFilterText("");
    commands
      .inspectArchive(req)
      .then((result) => {
        if (requestIdRef.current !== myId) return;
        setListing(result);
        setStatus("done");
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== myId) return;
        setErrorMessage(typeof e === "string" ? e : "Couldn't read this archive.");
        setStatus("error");
      });
  }

  async function collectAndScan() {
    // `take_archive_request` is one-shot — a second, redundant call (e.g.
    // React StrictMode's dev-only double-invoke of this effect) finds the
    // stash already emptied by the first and gets `null` back. That's
    // normal, not a failure: silently do nothing, the same way
    // `take_pending_deep_link` is handled in useAddForm.ts.
    const req = await commands.takeArchiveRequest().catch(() => null);
    if (!req) return;
    commands.showArchiveWindow().catch(() => {});
    runScan(req);
  }

  // Initial load: the request stashed by `open_archive_window` right before
  // this window was created.
  useEffect(() => {
    collectAndScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A later "Preview contents" click while this window is already open
  // re-stashes a new request and fires this instead of building a second
  // window.
  useEffect(() => {
    const unlisten = listen("archive-window-opened", () => {
      collectAndScan();
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listing) return;
    getCurrentWindow()
      .setTitle(`Archive Contents — ${listing.filename}`)
      .catch(() => {});
  }, [listing?.filename]);

  const tree = useMemo(() => (listing ? buildArchiveTree(listing.entries) : []), [listing]);

  // Root level starts expanded, everything deeper starts collapsed — reset
  // every time a new listing actually replaces the tree, not on every render.
  useEffect(() => {
    setExpanded(new Set(tree.filter((n) => n.isDir).map((n) => n.path)));
  }, [tree]);

  const isFiltering = filterText.trim().length > 0;
  const visibleTree = useMemo(() => filterTree(tree, filterText), [tree, filterText]);
  // While filtering, every matched branch is shown open — there'd be no way
  // to see *why* a deeply nested file matched otherwise. Clearing the filter
  // reverts to whatever the user had manually expanded before.
  const isExpanded = (path: string) => isFiltering || expanded.has(path);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function close() {
    commands.closeArchiveWindow();
  }

  const fileCount = listing?.entries.filter((e) => !e.isDir).length ?? 0;

  return (
    <div className="add-window archive-window">
      <div className="dialog-head add-head" data-tauri-drag-region>
        <span data-tip={listing?.filename}>
          {listing ? `Archive Contents — ${listing.filename}` : "Archive Contents"}
        </span>
        <WindowControls variant="close" />
      </div>

      {status === "scanning" && (
        <div className="dialog-body archive-status-body">
          <p className="detail-note">Scanning archive…</p>
        </div>
      )}

      {status === "error" && (
        <div className="dialog-body archive-status-body">
          <p className="detail-note archive-error">{errorMessage}</p>
        </div>
      )}

      {status === "done" && listing && (
        <>
          <div className="archive-summary">
            <span className="archive-summary-format">{listing.format.toUpperCase()}</span>
            <span className="archive-summary-stat">
              {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
            <span className="archive-summary-stat tabular">{formatBytes(listing.total)}</span>
            {listing.entries.length > 0 && (
              <input
                className="archive-filter"
                value={filterText}
                onChange={(e) => setFilterText(e.currentTarget.value)}
                placeholder="Filter…"
                spellCheck={false}
              />
            )}
          </div>

          {listing.encryptedNames && (
            <div className="inline-warn archive-note">
              <strong>🔒 Encrypted</strong> — this archive's file names are encrypted and can't be
              listed without a password.
            </div>
          )}
          {listing.truncated && !listing.encryptedNames && (
            <div className="archive-note archive-truncated">
              Showing a partial listing — this archive is larger than the preview can scan.
            </div>
          )}

          <div className="dialog-body archive-tree-body">
            {listing.encryptedNames ? null : listing.entries.length === 0 ? (
              <p className="detail-note">This archive is empty.</p>
            ) : visibleTree.length === 0 ? (
              <p className="detail-note">No entries match "{filterText}".</p>
            ) : (
              <ArchiveTree nodes={visibleTree} isExpanded={isExpanded} onToggle={toggle} />
            )}
          </div>
        </>
      )}

      <div className="dialog-actions">
        <button className="primary-btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

export default ArchiveWindow;
