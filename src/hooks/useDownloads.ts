import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "../bindings";
import type { DownloadEvent } from "../bindings";
import type { AddPayload, DownloadItem } from "../types";
import { DEFAULT_PROXY } from "../types";
import { fallbackName } from "../format";
import { notify } from "../notify";

/** Owns the download list itself plus every action that mutates it: running,
 *  pausing, canceling, resuming, deleting, and applying live speed/connection
 *  changes. `onItemAdded`/`onItemsRemoved` let the caller keep table selection
 *  in sync without this hook knowing anything about selection state. */
export function useDownloads(callbacks: {
  onItemAdded?: (id: string) => void;
  onItemsRemoved?: (ids: Set<string>) => void;
}) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  // Guards against piling up pushes if one command outlives the 1s interval.
  const downloadsRef = useRef<DownloadItem[]>([]);
  downloadsRef.current = downloads;

  // Ids paused specifically to restart with a new connection count — lets
  // the "paused" event handler re-queue them instead of leaving them paused.
  const pendingRestartRef = useRef<Set<string>>(new Set());
  // Downloads that have completed since the queue was last empty, so draining
  // it can report "all N complete" instead of just the final filename.
  const completedBurstRef = useRef(0);

  const [pendingDelete, setPendingDelete] = useState<DownloadItem[] | null>(null);
  const [deleteWithFile, setDeleteWithFile] = useState(false);
  // Confirmation for changing connections on a download that's currently
  // running — the worker pool is fixed for the life of a run, so applying a
  // new count means pausing and re-queuing it.
  const [connRestart, setConnRestart] = useState<{ items: DownloadItem[]; value: number } | null>(
    null,
  );

  // One summary toast when the queue drains, instead of leaving the user to
  // count individual "complete" toasts. Only fires past two downloads — a
  // single one already got its own toast and doesn't need a second.
  useEffect(() => {
    const pending = downloads.filter((d) =>
      ["downloading", "verifying", "queued"].includes(d.state),
    ).length;
    if (pending > 0) return;
    const n = completedBurstRef.current;
    completedBurstRef.current = 0;
    if (n > 1) notify("All downloads complete", `${n} downloads finished.`);
  }, [downloads]);

  function patchItem(id: string, patch: Partial<DownloadItem>) {
    setDownloads((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function handleEvent(id: string, msg: DownloadEvent) {
    switch (msg.event) {
      case "started":
        patchItem(id, {
          filename: msg.data.filename,
          path: msg.data.path,
          total: msg.data.total,
          usedConnections: msg.data.connections,
          numPieces: msg.data.numPieces,
          pieceSize: msg.data.pieceSize,
          state: "downloading",
        });
        break;
      case "progress": {
        const patch: Partial<DownloadItem> = {
          downloaded: msg.data.downloaded,
          total: msg.data.total,
          // speedBps is `number | null` in the generated binding because specta
          // conservatively widens every f64 for NaN-safety; the backend never
          // actually sends null here.
          speed: msg.data.speedBps ?? 0,
        };
        if (msg.data.connections.length > 0) patch.conns = msg.data.connections;
        patchItem(id, patch);
        break;
      }
      case "paused":
        // A restart requested by applyConnections (§ context menu) pauses the
        // run just to pick up a new connection count — re-queue it instead of
        // leaving it sitting paused.
        if (pendingRestartRef.current.delete(id)) {
          patchItem(id, { state: "queued", speed: 0 });
        } else {
          patchItem(id, { state: "paused", speed: 0 });
        }
        break;
      case "canceled":
        patchItem(id, { state: "canceled", speed: 0, finishedAt: Date.now() });
        break;
      case "verifying":
        patchItem(id, { state: "verifying", speed: 0 });
        break;
      case "finished":
        patchItem(id, {
          state: "completed",
          speed: 0,
          path: msg.data.path,
          filename: msg.data.filename,
          missing: false,
          fromHistory: false,
          finishedAt: Date.now(),
        });
        completedBurstRef.current += 1;
        notify("Download complete", msg.data.filename);
        break;
      case "error": {
        patchItem(id, {
          state: "error",
          error: msg.data.message,
          speed: 0,
          finishedAt: Date.now(),
        });
        // The patch above hasn't landed in `downloads` yet, so read the name
        // from the ref rather than waiting a render for it.
        const name = downloadsRef.current.find((d) => d.id === id)?.filename ?? "Download";
        notify("Download failed", `${name} — ${msg.data.message}`);
        break;
      }
    }
  }

  async function startRun(item: DownloadItem) {
    const resume = item.usedConnections > 1 && !!item.path;
    patchItem(item.id, { state: "downloading", error: undefined, startedAt: Date.now() });

    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (msg) => handleEvent(item.id, msg);

    try {
      await commands.startDownload(
        {
          id: item.id,
          url: item.url,
          allowInsecure: item.allowInsecure,
          headers: item.headers,
          connections: item.connections,
          resume,
          resumePath: resume ? item.path : null,
          expectedChecksum: item.checksum || null,
          speedLimit: item.speedLimit > 0 ? item.speedLimit : null,
          filename: !resume && item.filenameOverride ? item.filenameOverride : null,
          savePath: item.savePath || null,
          proxy: item.proxy,
        },
        onEvent,
      );
    } catch (e) {
      patchItem(item.id, { state: "error", error: String(e) });
    }
  }

  // Payloads arrive from the separate "Add Download" window via a Tauri event.
  function addFromPayload(p: AddPayload) {
    const u = p.url.trim();
    if (!u) return;
    const id = crypto.randomUUID();
    const item: DownloadItem = {
      id,
      url: u,
      headers: p.headers,
      connections: p.connections,
      allowInsecure: p.allowInsecure,
      checksum: p.checksum.trim(),
      speedLimit: p.speedLimit > 0 ? p.speedLimit : 0,
      // Cosmetic only, until the "started" event reports the real name the
      // backend chose — must NOT be sent to start_download as if it were a
      // user override (see filenameOverride).
      filename: p.filename.trim() || fallbackName(u),
      filenameOverride: p.filename.trim(),
      path: "",
      savePath: p.savePath.trim(),
      proxy: p.proxy ?? DEFAULT_PROXY,
      total: null,
      downloaded: 0,
      speed: 0,
      usedConnections: 1,
      numPieces: 0,
      pieceSize: 0,
      conns: [],
      state: p.later ? "paused" : "queued",
      addedAt: Date.now(),
    };
    setDownloads((ds) => [item, ...ds]);
    callbacks.onItemAdded?.(id);
  }

  function pauseMany(items: DownloadItem[]) {
    items.forEach((i) => commands.pauseDownload(i.id));
  }
  function cancelMany(items: DownloadItem[]) {
    items.forEach((i) => commands.cancelDownload(i.id));
  }
  function resumeMany(items: DownloadItem[]) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) =>
      ds.map((d) => {
        if (!ids.has(d.id)) return d;
        const base = { ...d, state: "queued" as const, error: undefined };
        // A genuine paused row still has its resume sidecar — leave `path`
        // alone so it continues where it left off.
        if (!d.missing && !d.fromHistory && !d.awaitingCapture) return base;
        // Rows from history never have a live sidecar (if one existed,
        // list_resumable would have produced the row and won the merge), so
        // resuming them has to start over. Clearing `path` is what makes
        // startRun compute resume === false.
        const restart = {
          ...base,
          path: "",
          downloaded: 0,
          total: null,
          missing: false,
          fromHistory: false,
          awaitingCapture: false,
          conns: [],
          numPieces: 0,
          usedConnections: d.connections,
        };
        // Credentials were stripped before persisting, so replaying this
        // request would just 401/403. Park it until the extension captures a
        // fresh one — `awaitingCapture` keeps it out of the scheduler, and
        // resuming again simply reopens the page to retry.
        if (d.needsAuth && d.referer) {
          openUrl(d.referer).catch(() => {});
          notify(
            "Waiting for browser",
            `${d.filename} needs a fresh sign-in — its original page was reopened in your browser.`,
          );
          return { ...restart, state: "paused" as const, awaitingCapture: true };
        }
        return restart;
      }),
    );
  }

  // Context menu "Speed cap": updates the row(s) so a not-yet-started
  // download picks up the new cap at its next `start_download` call, and — for
  // anything currently running — pushes it live via `set_download_speed_limit`
  // so the change is visible within a couple of seconds instead of waiting for
  // a restart.
  function applySpeedCap(items: DownloadItem[], bytes: number) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.map((d) => (ids.has(d.id) ? { ...d, speedLimit: bytes } : d)));
    items
      .filter((i) => i.state === "downloading" || i.state === "verifying")
      .forEach((i) => commands.setDownloadSpeedLimit(i.id, { bytesPerSec: bytes }).catch(() => {}));
  }

  // Context menu "Connections": the worker pool is fixed for the life of a
  // run, so a row that's currently downloading needs the user's say-so to
  // pause + re-queue it (see the "paused" case in handleEvent, which detects
  // `pendingRestartRef` and re-queues instead of leaving it paused). Anything
  // not running just picks up the new count at its next start.
  function applyConnections(items: DownloadItem[], n: number) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.map((d) => (ids.has(d.id) ? { ...d, connections: n } : d)));
    const running = items.filter((i) => i.state === "downloading");
    if (running.length > 0) {
      setConnRestart({ items: running, value: n });
    }
  }

  function confirmConnRestart() {
    if (!connRestart) return;
    connRestart.items.forEach((i) => {
      pendingRestartRef.current.add(i.id);
      commands.pauseDownload(i.id).catch(() => {});
    });
    setConnRestart(null);
  }

  async function removeMany(items: DownloadItem[], deleteFile: boolean) {
    await Promise.allSettled(
      items
        .filter((i) => i.path)
        .map((i) => {
          // For anything short of "completed", `path` points at the temp
          // file, not a real file the user asked to keep — without its
          // resume metadata (always dropped on delete) it can never be
          // resumed again, so leaving it behind would just be orphaned
          // disk space. Only a completed download's checkbox choice matters.
          // A missing row is the exception: nothing of ours is at `path` any
          // more, so deleting it could only hit a file that later took over
          // that name.
          const removeFile = i.missing ? false : i.state === "completed" ? deleteFile : true;
          return commands.deleteDownload(i.path, removeFile).catch(() => {
            /* ignore */
          });
        }),
    );
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.filter((d) => !ids.has(d.id)));
    callbacks.onItemsRemoved?.(ids);
  }
  // Single seam every delete entry point (toolbar, context menu, Delete key)
  // routes through. `items` is the full candidate selection — the dialog
  // splits out any running downloads itself so it can explain why they're
  // excluded, and defaults "Delete source file also" to off.
  function requestDelete(items: DownloadItem[]) {
    const deletable = items.filter((d) => d.state !== "downloading" && d.state !== "verifying");
    if (deletable.length === 0) return;
    setDeleteWithFile(false);
    setPendingDelete(items);
  }
  function confirmDelete() {
    if (!pendingDelete) return;
    const deletable = pendingDelete.filter(
      (d) => d.state !== "downloading" && d.state !== "verifying",
    );
    removeMany(deletable, deleteWithFile);
    setPendingDelete(null);
  }

  return {
    downloads,
    setDownloads,
    downloadsRef,
    patchItem,
    startRun,
    addFromPayload,
    pauseMany,
    cancelMany,
    resumeMany,
    removeMany,
    applySpeedCap,
    applyConnections,
    connRestart,
    setConnRestart,
    confirmConnRestart,
    pendingDelete,
    setPendingDelete,
    deleteWithFile,
    setDeleteWithFile,
    requestDelete,
    confirmDelete,
  };
}
