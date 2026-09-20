import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "../bindings";
import type { DownloadEvent } from "../bindings";
import type { AddPayload, DownloadItem } from "../types";
import { DEFAULT_PROXY } from "../types";
import { fallbackName } from "../format";
import { notify } from "../notify";
import { pushSpeedSample, SPEED_SAMPLE_INTERVAL_MS } from "../speedHistory";
import { retryBackoffMs } from "../retryBackoff";

// Progress events themselves arrive roughly every 150ms (`engine/progress.rs`'s
// tick) — far more often than the speed history / piece map need, and a
// fresh 160-number `pieceMap` array on every tick would mean re-rendering
// the detail window's piece map ~7x/sec for no visible gain.
// `SPEED_SAMPLE_INTERVAL_MS` lives in `speedHistory.ts` so `DetailWindow`
// can use the same number to label the sparkline's timeline.

// Satu-satunya pengecualian dari "retry membabi-buta tanpa klasifikasi
// error": checksum mismatch (`engine/mod.rs`) bukan cuma gagal — Rust-nya
// sendiri sudah menghapus resume sidecar-nya di titik itu, karena byte yang
// salah bukan byte yang hilang, jadi tidak ada progres valid untuk
// dilanjutkan. Retry di sini berarti mengunduh ulang SELURUH FILE dari nol
// — dan tidak akan pernah berhasil kalau penyebabnya expected-hash yang
// memang salah ketik. Kalau suatu saat teks pesan di Rust berubah,
// satu-satunya efeknya pengecualian ini berhenti berlaku dan
// checksum-mismatch kembali di-retry seperti error lain — bukan gagal
// secara diam-diam yang berbahaya.
const CHECKSUM_MISMATCH_PREFIX = "Checksum mismatch —";
// Kehabisan disk space juga gak akan sembuh dengan retry otomatis — kalau
// drive-nya masih penuh, percobaan berikutnya bakal gagal dengan alasan yang
// sama persis. mirrors DISK_SPACE_PREFIX di paths.rs.
const DISK_SPACE_PREFIX = "Not enough disk space —";

/** Owns the download list itself plus every action that mutates it: running,
 *  pausing, canceling, resuming, deleting, and applying live speed/connection
 *  changes. `onItemAdded`/`onItemsRemoved` let the caller keep table selection
 *  in sync without this hook knowing anything about selection state. */
export function useDownloads({
  maxRetryAttempts,
  onItemAdded,
  onItemsRemoved,
}: {
  maxRetryAttempts: number;
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
  // Last time (ms) each download's progress tick was allowed to sample
  // speed history / replace the piece map — see `SAMPLE_INTERVAL_MS`. Only
  // ever grows by one entry per download seen this session; cleaned up in
  // `removeMany` below so it doesn't accumulate across a long session's
  // worth of finished-and-removed downloads.
  const lastSampleAtRef = useRef<Map<string, number>>(new Map());
  // Pending auto-retry backoff timers, keyed by download id. Presence of an
  // entry means "a retry is already scheduled for this id" — doubles as the
  // idempotency guard in `handleDownloadError` below. Cleaned up in
  // `removeMany` and when a timer fires.
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // The exact error message a download was last finalized to "error" with —
  // a second guard, separate from `retryTimersRef`, for the *exhausted*
  // branch of `handleDownloadError` (see that function for why neither
  // guard can be replaced with a check against `downloadsRef.current`).
  const finalizedErrorRef = useRef<Map<string, string>>(new Map());

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

  // Like `patchItem`, but for a patch that depends on the item's prior state
  // (only `speedHistory`'s append needs this — everything else in this hook
  // either patches unconditionally or, in the `"error"` case, only *reads*
  // prior state for a toast without feeding it back into the patch).
  // Computing the derived fields inside the `setDownloads` updater keeps
  // the read-and-append atomic, instead of depending on a render having
  // landed between two 150ms-apart progress events.
  function patchItemWith(id: string, updater: (prev: DownloadItem) => Partial<DownloadItem>) {
    setDownloads((ds) => ds.map((d) => (d.id === id ? { ...d, ...updater(d) } : d)));
  }

  // Shared entry point for every way a download can fail — see call sites
  // below. `start_download` (Rust) always sends a `DownloadEvent::Error`
  // over the channel before returning `Err`, *except* when
  // `validate_download_url` rejects the URL before the channel is ever used
  // — so a post-validation failure can be observed via both the channel
  // event (`handleEvent`'s `"error"` case) and the rejected `invoke()`
  // promise (`startRun`'s `catch`), with no ordering guarantee between the
  // two, while a pre-validation failure is only ever seen via the `catch`.
  //
  // Idempotent against being called twice for the same failure via two
  // ref-based guards (not a check against `downloadsRef.current`/state,
  // which is only updated on render and so can't be trusted to reflect the
  // first call's patch by the time the second one runs in the same tick):
  // `retryTimersRef` for the "schedule a retry" branch, `finalizedErrorRef`
  // for the "give up" branch.
  function handleDownloadError(id: string, message: string) {
    if (retryTimersRef.current.has(id)) return;

    const item = downloadsRef.current.find((d) => d.id === id);
    const attempts = item?.retryCount ?? 0;
    const retryWouldHelp =
      !message.startsWith(CHECKSUM_MISMATCH_PREFIX) && !message.startsWith(DISK_SPACE_PREFIX);

    if (attempts < maxRetryAttempts && retryWouldHelp) {
      // A new failure episode starts — drop any "already finalized" marker
      // left over from a previous episode, so a later exhausted failure
      // isn't mistaken for a duplicate of an unrelated earlier one.
      finalizedErrorRef.current.delete(id);
      const delay = retryBackoffMs(attempts + 1);
      const timer = setTimeout(() => {
        retryTimersRef.current.delete(id);
        patchItem(id, { retryPending: false });
      }, delay);
      retryTimersRef.current.set(id, timer);
      patchItem(id, {
        state: "queued",
        retryPending: true,
        retryCount: attempts + 1,
        error: message,
        speed: 0,
      });
      return;
    }

    if (finalizedErrorRef.current.get(id) === message) return;
    finalizedErrorRef.current.set(id, message);

    patchItem(id, { state: "error", error: message, speed: 0, finishedAt: Date.now() });
    notify("Download failed", `${item?.filename ?? "Download"} — ${message}`);
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
          speedHistory: [],
          pieceMap: [],
          // A fresh run's peak starts from zero rather than carrying over a
          // stale value from a previous run of the same download (e.g. a
          // resumed or re-queued one).
          peakSpeed: 0,
        });
        break;
      case "progress": {
        // speedBps is `number | null` in the generated binding because specta
        // conservatively widens every f64 for NaN-safety; the backend never
        // actually sends null here.
        const speed = msg.data.speedBps ?? 0;

        // The speed sparkline and piece map both sample at a slower rate
        // than progress events arrive — `sample` below throttles those two
        // derived fields only, not the always-live fields or the peak
        // tracker, which are cheap enough (a comparison, not an array copy)
        // to just update on every tick and would otherwise miss a brief
        // speed spike that lands between two samples.
        const now = Date.now();
        const lastSample = lastSampleAtRef.current.get(id) ?? 0;
        const sample = now - lastSample >= SPEED_SAMPLE_INTERVAL_MS;
        if (sample) lastSampleAtRef.current.set(id, now);

        patchItemWith(id, (prev) => {
          const patch: Partial<DownloadItem> = {
            downloaded: msg.data.downloaded,
            total: msg.data.total,
            speed,
            peakSpeed: Math.max(prev.peakSpeed ?? 0, speed),
          };
          if (msg.data.connections.length > 0) patch.conns = msg.data.connections;
          if (sample) {
            patch.speedHistory = pushSpeedSample(prev.speedHistory ?? [], speed);
            if (msg.data.pieces.length > 0) patch.pieceMap = msg.data.pieces;
          }
          return patch;
        });
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
          // The reporter task is aborted (`engine/mod.rs`) right before this
          // event, before it ever gets to send a final all-255 piece map —
          // without clearing it here, the detail window would keep showing
          // whatever ~99%-filled map the last progress tick left behind.
          pieceMap: [],
          // A real success ends this failure episode — the auto-retry
          // attempt cap is about consecutive *automatic* retries, not a
          // lifetime cap on the download.
          retryCount: 0,
          retryPending: false,
        });
        completedBurstRef.current += 1;
        notify("Download complete", msg.data.filename);
        break;
      case "error":
        handleDownloadError(id, msg.data.message);
        break;
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
      handleDownloadError(item.id, String(e));
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
    onItemAdded?.(id);
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
        // `retryCount: 0` — manual resume is fresh user intent, so it
        // resets the auto-retry attempt cap (which is about consecutive
        // *automatic* retries, not a lifetime cap on the download).
        const base = { ...d, state: "queued" as const, error: undefined, retryCount: 0 };
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
    ids.forEach((id) => {
      lastSampleAtRef.current.delete(id);
      const timer = retryTimersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        retryTimersRef.current.delete(id);
      }
      finalizedErrorRef.current.delete(id);
    });
    onItemsRemoved?.(ids);
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
